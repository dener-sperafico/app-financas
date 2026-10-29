// Estado local, cache offline e sincronização com a planilha (fila de envio).
import { SHEETS, SHEET_NAMES, KEY, rowToObj, objToRow, isValidRow } from './schema.js?v=13';
import { nowStamp } from './util.js?v=13';
import { AuthError } from './google.js?v=13';

export const TOMBSTONE = '#excluido';
const BATCH = 200;

function emptyState() {
  const data = {}, rows = {};
  SHEET_NAMES.forEach(n => { data[n] = []; rows[n] = {}; });
  return { spreadsheet: null, user: null, data, rows, queue: [], lastSync: null, invalid: 0 };
}

export class Store {
  constructor(backend) {
    this.backend = backend;
    this.storageKey = 'af_state_v1' + (backend.mode === 'demo' ? '_demo' : '');
    this.listeners = new Set();
    this.syncing = false;
    this.status = { online: navigator.onLine, authNeeded: false, error: null };
    this.notices = [];
    this.load();
    window.addEventListener('online', () => { this.status.online = true; this.emit(); this.flush(); });
    window.addEventListener('offline', () => { this.status.online = false; this.emit(); });
  }

  load() {
    try {
      const s = JSON.parse(localStorage.getItem(this.storageKey) || 'null');
      this.s = s ? { ...emptyState(), ...s } : emptyState();
    } catch { this.s = emptyState(); }
    this._index();
  }

  _index() {
    this.idx = {};
    SHEET_NAMES.forEach(n => {
      this.idx[n] = new Map(this.s.data[n].map(o => [KEY[n](o), o]));
    });
  }

  save() {
    try { localStorage.setItem(this.storageKey, JSON.stringify(this.s)); } catch (e) { console.warn('Falha ao salvar no aparelho', e); }
  }

  subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit() { this.listeners.forEach(fn => { try { fn(); } catch (e) { console.error(e); } }); }

  get user() { return this.s.user; }
  get spreadsheet() { return this.s.spreadsheet; }
  get queue() { return this.s.queue; }
  get(sheet) { return this.s.data[sheet]; }
  find(sheet, key) { return this.idx[sheet].get(key); }

  setUser(u) { this.s.user = u; this.save(); }
  setSpreadsheet(sp) { this.s.spreadsheet = sp; this.save(); }

  _put(sheet, obj) {
    const key = KEY[sheet](obj);
    const list = this.s.data[sheet];
    const i = list.findIndex(o => KEY[sheet](o) === key);
    if (i >= 0) list[i] = obj; else list.push(obj);
    this.idx[sheet].set(key, obj);
  }

  upsert(sheet, obj) {
    const key = KEY[sheet](obj);
    const prev = this.find(sheet, key);
    const email = this.s.user ? this.s.user.email : '';
    const now = nowStamp();
    const o = { ...obj };
    if (sheet !== 'Config') {
      o.criado_por = prev?.criado_por || o.criado_por || email;
      o.criado_em = prev?.criado_em || o.criado_em || now;
      o.alterado_por = email;
      o.alterado_em = now;
    }
    this._put(sheet, o);
    this.s.queue.push({ op: 'put', sheet, key, obj: o, base: prev ? prev.alterado_em || '' : null });
    if (!this._batching) { this.save(); this.emit(); this.flushSoon(); }
    return o;
  }

  // Muitas gravações de uma vez (importação): salva e avisa a tela só no final.
  batch(fn) {
    this._batching = true;
    try { fn(); } finally {
      this._batching = false;
      this.save(); this.emit(); this.flushSoon();
    }
  }

  remove(sheet, key) {
    const list = this.s.data[sheet];
    const i = list.findIndex(o => KEY[sheet](o) === key);
    if (i >= 0) list.splice(i, 1);
    this.idx[sheet].delete(key);
    this.s.queue.push({ op: 'del', sheet, key });
    this.save();
    this.emit();
    this.flushSoon();
  }

  setConfig(chave, valor) { this.upsert('Config', { chave, valor }); }

  // ---------- Leitura completa da planilha ----------
  async pull() {
    const raw = await this.backend.readAll(this.s.spreadsheet.id);
    const data = {}, rows = {};
    let invalid = 0;
    SHEET_NAMES.forEach(n => {
      data[n] = []; rows[n] = {};
      (raw[n] || []).forEach((values, i) => {
        if (i === 0) return;
        if (!values || !values.length || values.every(v => v === '' || v === null)) return;
        if (String(values[0]) === TOMBSTONE) return;
        const o = rowToObj(n, values);
        if (!isValidRow(n, o)) { invalid++; return; }
        const k = KEY[n](o);
        rows[n][k] = i + 1;
        const at = data[n].findIndex(x => KEY[n](x) === k);
        if (at >= 0) data[n][at] = o; else data[n].push(o);
      });
    });
    // Mudanças locais ainda não enviadas continuam valendo.
    this.s.queue.forEach(q => {
      if (q.op === 'put') {
        const at = data[q.sheet].findIndex(x => KEY[q.sheet](x) === q.key);
        if (at >= 0) data[q.sheet][at] = q.obj; else data[q.sheet].push(q.obj);
      } else {
        data[q.sheet] = data[q.sheet].filter(x => KEY[q.sheet](x) !== q.key);
      }
    });
    this.s.data = data;
    this.s.rows = rows;
    this.s.invalid = invalid;
    this.s.lastSync = nowStamp();
    this._index();
    this.save();
    this.emit();
  }

  // ---------- Envio da fila ----------
  flushSoon() {
    clearTimeout(this._t);
    this._t = setTimeout(() => this.flush(), 400);
  }

  async _findRow(sheet, key) {
    const values = await this.backend.readSheet(this.s.spreadsheet.id, sheet);
    for (let i = 1; i < values.length; i++) {
      if (!values[i] || String(values[i][0]) === TOMBSTONE) continue;
      const o = rowToObj(sheet, values[i]);
      if (KEY[sheet](o) === key) return i + 1;
    }
    return null;
  }

  async flush() {
    if (this.syncing || !this.s.spreadsheet || !this.s.queue.length) return;
    if (!navigator.onLine) { this.status.online = false; this.emit(); return; }
    if (!this.backend.hasToken()) { this.status.authNeeded = true; this.emit(); return; }
    this.syncing = true; this.status.error = null; this.emit();
    const id = this.s.spreadsheet.id;
    try {
      while (this.s.queue.length) {
        // Alterações em linhas que já existem vão juntas, num único envio (a planilha limita gravações por minuto).
        const lote = this._loteAtualizacoes();
        if (lote.length > 1) { await this._enviarLote(id, lote); continue; }
        const q = this.s.queue[0];
        const rowsOf = this.s.rows[q.sheet];
        if (q.op === 'put') {
          let n = rowsOf[q.key];
          if (!n && q.tried) n = await this._findRow(q.sheet, q.key);
          if (!n) {
            // Agrupa lançamentos novos da mesma aba num único envio.
            const group = [];
            for (const x of this.s.queue) {
              if (group.length >= BATCH || x.op !== 'put' || x.sheet !== q.sheet || rowsOf[x.key] || x.tried) break;
              if (group.some(g => g.key === x.key)) break;
              group.push(x);
            }
            if (!group.length) group.push(q);
            group.forEach(g => { g.tried = true; });
            this.save();
            const start = await this.backend.appendRows(id, q.sheet, group.map(g => objToRow(q.sheet, g.obj)));
            group.forEach((g, i) => { rowsOf[g.key] = start + i; });
            this.s.queue.splice(0, group.length);
            this.save();
            continue;
          }
          if (q.sheet === 'Lancamentos' && q.base !== null) await this._checkConflict(q, n);
          await this.backend.updateRow(id, q.sheet, n, objToRow(q.sheet, q.obj));
          rowsOf[q.key] = n;
        } else {
          let n = rowsOf[q.key];
          if (!n) n = await this._findRow(q.sheet, q.key);
          if (n) {
            const blank = SHEETS[q.sheet].map((_, i) => (i === 0 ? TOMBSTONE : ''));
            await this.backend.updateRow(id, q.sheet, n, blank);
          }
          delete rowsOf[q.key];
        }
        this.s.queue.shift();
        this.save();
      }
      this.status.authNeeded = false;
    } catch (e) {
      if (e instanceof AuthError) this.status.authNeeded = true;
      else if (e instanceof TypeError) this.status.online = false;
      else if (e.status === 429) {
        // Limite de gravações por minuto do Google: espera e tenta de novo sozinho.
        this.status.error = 'o Google pediu uma pausa nas gravações. O app tenta de novo em 1 minuto';
        clearTimeout(this._retry);
        this._retry = setTimeout(() => { this.status.error = null; this.flush(); }, 65000);
      }
      else this.status.error = e.message || String(e);
      console.warn('Sincronização interrompida', e);
    } finally {
      this.syncing = false;
      this.save();
      this.emit();
    }
  }

  // Duas pessoas editando o mesmo lançamento: vale a última gravação, com aviso (N02).
  _loteAtualizacoes() {
    const lote = [], vistos = new Set();
    for (const x of this.s.queue) {
      if (lote.length >= 100) break;
      const n = this.s.rows[x.sheet][x.key];
      const k = `${x.sheet}|${x.key}`;
      if (!n || vistos.has(k)) break;
      vistos.add(k);
      lote.push({ q: x, n });
    }
    return lote;
  }

  async _enviarLote(id, lote) {
    const conferir = lote.filter(({ q }) => q.op === 'put' && q.sheet === 'Lancamentos' && q.base);
    if (conferir.length && this.backend.readRows) {
      try {
        const remotos = await this.backend.readRows(id, conferir.map(({ q, n }) => ({ sheet: q.sheet, n })));
        conferir.forEach(({ q }, i) => this._avisarConflito(q, rowToObj(q.sheet, remotos[i] || [])));
      } catch { /* aviso é opcional */ }
    }
    await this.backend.updateRows(id, lote.map(({ q, n }) => ({
      sheet: q.sheet, n,
      row: q.op === 'put' ? objToRow(q.sheet, q.obj) : SHEETS[q.sheet].map((_, i) => (i === 0 ? TOMBSTONE : '')),
    })));
    lote.forEach(({ q }) => { if (q.op !== 'put') delete this.s.rows[q.sheet][q.key]; });
    this.s.queue.splice(0, lote.length);
    this.save();
  }

  _avisarConflito(q, remote) {
    const me = this.s.user?.email;
    if (remote.id === q.key && remote.alterado_em && q.base && remote.alterado_em !== q.base && remote.alterado_por !== me) {
      this.notices.push({
        id: Date.now() + Math.random(),
        text: `${remote.alterado_por.split('@')[0]} tinha alterado "${remote.descricao}" ao mesmo tempo. Ficou a sua versão; a outra tinha valor ${remote.valor}.`,
      });
    }
  }

  async _checkConflict(q, n) {
    try {
      const remote = rowToObj(q.sheet, await this.backend.readRow(this.s.spreadsheet.id, q.sheet, n));
      const me = this.s.user?.email;
      if (remote.id === q.key && remote.alterado_em && q.base && remote.alterado_em !== q.base && remote.alterado_por !== me) {
        this.notices.push({
          id: Date.now(),
          text: `${remote.alterado_por.split('@')[0]} tinha alterado "${remote.descricao}" ao mesmo tempo. Ficou a sua versão; a outra tinha valor ${remote.valor}.`,
        });
      }
    } catch { /* aviso é opcional */ }
  }

  reset() {
    this.s = emptyState();
    this._index();
    localStorage.removeItem(this.storageKey);
    this.emit();
  }
}
