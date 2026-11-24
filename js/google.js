// Comunicação direta com o Google: login (Google Identity Services), Sheets, Drive e Picker.
import { CONFIG } from './config.js?v=85';
import { SHEETS } from './schema.js?v=85';

const TOKEN_KEY = 'af_token';
const SESSAO_KEY = 'af_sessao';
const OAUTH_KEY = 'af_oauth';
const ACESSO_KEY = 'af_acesso';
const ESPERA_KEY = 'af_aguardando';
const ler = k => { try { return localStorage.getItem(k); } catch { return null; } };
const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets';
const DRIVE_API = 'https://www.googleapis.com/drive/v3';

export class AuthError extends Error {
  constructor(msg) { super(msg || 'auth'); this.name = 'AuthError'; }
}

const scripts = {};
function loadScript(src) {
  if (!scripts[src]) {
    scripts[src] = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src; s.async = true; s.defer = true;
      s.onload = resolve;
      s.onerror = () => { delete scripts[src]; reject(new Error('Não foi possível carregar ' + src)); };
      document.head.appendChild(s);
    });
  }
  return scripts[src];
}

export class GoogleBackend {
  constructor() {
    this.mode = 'google';
    this.tokenClient = null;
    this.pending = null;
    try { this.token = JSON.parse(localStorage.getItem(TOKEN_KEY) || 'null'); } catch { this.token = null; }
    this.sessao = CONFIG.AUTH_URL ? ler(SESSAO_KEY) : null;
    this.renovando = null;
    // acesso: { admin, pendentes } vindo do servidor; aguardando: { email } enquanto o acesso não é liberado.
    try { this.acesso = JSON.parse(ler(ACESSO_KEY) || 'null') || {}; } catch { this.acesso = {}; }
    try { this.aguardando = JSON.parse(ler(ESPERA_KEY) || 'null'); } catch { this.aguardando = null; }
  }

  // Guarda o que o servidor disse sobre a sessão e o acesso desta pessoa.
  _lerResposta(d) {
    if (d.sessao) { this.sessao = d.sessao; localStorage.setItem(SESSAO_KEY, this.sessao); }
    if (d.access_token) {
      this.acesso = { admin: !!d.admin, pendentes: Number(d.pendentes) || 0 };
      localStorage.setItem(ACESSO_KEY, JSON.stringify(this.acesso));
      this._esperar(null);
    }
  }

  _esperar(info) {
    this.aguardando = info;
    if (info) localStorage.setItem(ESPERA_KEY, JSON.stringify(info));
    else localStorage.removeItem(ESPERA_KEY);
  }

  // ---- Login que dura (servidor em CONFIG.AUTH_URL) ----
  // Com sessão guardada, o app pega conexões novas sozinho, sem janela do Google.
  temSessao() { return !!this.sessao; }

  _guardarToken(r) {
    this.token = { access: r.access_token, exp: Date.now() + (Number(r.expires_in) || 3600) * 1000 };
    localStorage.setItem(TOKEN_KEY, JSON.stringify(this.token));
  }

  _esquecerSessao() {
    this.sessao = null;
    localStorage.removeItem(SESSAO_KEY);
    this.acesso = {}; localStorage.removeItem(ACESSO_KEY);
    this._esperar(null);
  }

  async _servidor(rota, corpo) {
    const res = await fetch(CONFIG.AUTH_URL + rota, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo),
    });
    let dados = {};
    try { dados = await res.json(); } catch { /* ignora */ }
    return { ok: res.ok, status: res.status, dados };
  }

  // Pega uma conexão nova pelo servidor. Sessão recusada pelo Google = esquece e pede login de novo.
  renovar() {
    if (!this.sessao) return Promise.reject(new AuthError('sem-sessao'));
    if (!this.renovando) {
      this.renovando = (async () => {
        const r = await this._servidor('/renovar', { sessao: this.sessao });
        if (r.ok && r.dados.access_token) { this._guardarToken(r.dados); this._lerResposta(r.dados); return; }
        if (r.status === 403 && r.dados.erro === 'aguardando') {
          this.token = null; localStorage.removeItem(TOKEN_KEY);
          this._esperar({ email: r.dados.email || this.aguardando?.email || '' });
          throw new AuthError('aguardando');
        }
        if (r.status === 401) this._esquecerSessao();
        throw new AuthError(r.dados.erro || 'renovar');
      })().finally(() => { this.renovando = null; });
    }
    return this.renovando;
  }

  // ---- Admin: quem pode usar o app ----
  async _admin(rota, corpo = {}) {
    if (!this.sessao) throw new AuthError('sem-sessao');
    const r = await this._servidor('/admin/' + rota, { ...corpo, sessao: this.sessao });
    if (!r.ok) { const e = new Error(r.dados.erro || 'admin'); e.status = r.status; throw e; }
    const pessoas = r.dados.pessoas || [];
    this.acesso = { ...this.acesso, pendentes: pessoas.filter(p => p.novo).length };
    localStorage.setItem(ACESSO_KEY, JSON.stringify(this.acesso));
    return pessoas;
  }
  adminLista() { return this._admin('lista'); }
  adminSalvar(email, liberado, antigo) { return this._admin('salvar', { email, liberado, antigo }); }
  adminExcluir(email) { return this._admin('excluir', { email }); }

  // true se tem conexão válida (renovando pelo servidor se precisar).
  async garantirToken() {
    if (this.hasToken() && this.minutesLeft() > 5) return true;
    if (!this.sessao) return this.hasToken();
    try { await this.renovar(); } catch { /* segue com o que tiver */ }
    return this.hasToken();
  }

  // Leva para o Google (página inteira). Ao voltar, voltaDoGoogle() termina o login.
  _irParaGoogle(hint) {
    const state = Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('');
    const volta = location.origin + location.pathname;
    localStorage.setItem(OAUTH_KEY, JSON.stringify({ state, volta, hash: location.hash || '' }));
    const p = new URLSearchParams({
      client_id: CONFIG.CLIENT_ID, redirect_uri: volta, response_type: 'code', scope: CONFIG.SCOPES,
      access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', state,
    });
    if (hint) p.set('login_hint', hint);
    location.assign('https://accounts.google.com/o/oauth2/v2/auth?' + p);
    return new Promise(() => {}); // a página vai sair
  }

  // Chamado na abertura do app. Retorna null (não era volta do Google), { ok: true, hash } ou { erro }.
  async voltaDoGoogle() {
    const q = new URLSearchParams(location.search);
    if (!q.has('state') || !(q.has('code') || q.has('error'))) return null;
    let salvo = null;
    try { salvo = JSON.parse(ler(OAUTH_KEY) || 'null'); } catch { /* ignora */ }
    localStorage.removeItem(OAUTH_KEY);
    history.replaceState(null, '', location.pathname + (salvo?.hash || location.hash || ''));
    if (!salvo || salvo.state !== q.get('state')) return { erro: 'state' };
    if (q.has('error')) return { erro: q.get('error') };
    try {
      const r = await this._servidor('/entrar', { code: q.get('code'), redirect_uri: salvo.volta });
      if (r.status === 403 && r.dados.erro === 'aguardando') {
        if (r.dados.sessao) { this.sessao = r.dados.sessao; localStorage.setItem(SESSAO_KEY, this.sessao); }
        this._esperar({ email: r.dados.email || '' });
        return { aguardando: true };
      }
      if (!r.ok || !r.dados.access_token) return { erro: r.dados.erro || 'entrar' };
      this._guardarToken(r.dados);
      this._lerResposta(r.dados);
      return { ok: true, hash: salvo.hash };
    } catch (e) {
      return { erro: 'rede' };
    }
  }

  async init() {
    await loadScript('https://accounts.google.com/gsi/client');
    this.tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: CONFIG.CLIENT_ID,
      scope: CONFIG.SCOPES,
      callback: r => this._onToken(r),
      error_callback: e => this._onTokenError(e),
    });
  }

  _onToken(r) {
    const p = this.pending; this.pending = null;
    if (!p) return;
    if (r.error) { p.reject(new AuthError(r.error)); return; }
    this.token = { access: r.access_token, exp: Date.now() + (Number(r.expires_in) || 3600) * 1000 };
    localStorage.setItem(TOKEN_KEY, JSON.stringify(this.token));
    p.resolve();
  }

  _onTokenError(e) {
    const p = this.pending; this.pending = null;
    if (p) p.reject(new AuthError(e && e.type ? e.type : 'popup'));
  }

  hasToken() {
    return !!(this.token && this.token.exp > Date.now() + 30000);
  }

  // Precisa ser chamado a partir de um toque do usuário (o Google abre uma janela).
  // silent: não mostra escolha de conta nem consentimento; se o Google precisar perguntar algo, falha.
  signIn(hint, { silent = false } = {}) {
    if (this.sessao) return this.renovar();
    if (CONFIG.AUTH_URL && !silent) return this._irParaGoogle(hint);
    if (!this.tokenClient) return Promise.reject(new AuthError('not-ready'));
    if (this.pending) return this.pending.promise;
    let resolve, reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    this.pending = { resolve, reject, promise };
    this.tokenClient.requestAccessToken({ prompt: silent ? 'none' : '', login_hint: hint || undefined });
    return promise;
  }

  // Minutos até a conexão vencer (0 se já venceu).
  minutesLeft() {
    return this.token ? Math.max(0, (this.token.exp - Date.now()) / 60000) : 0;
  }

  signOut() {
    if (this.sessao) {
      this._servidor('/sair', { sessao: this.sessao }).catch(() => {});
      this._esquecerSessao();
    } else if (this.token && window.google?.accounts?.oauth2) {
      try { google.accounts.oauth2.revoke(this.token.access, () => {}); } catch { /* ignora */ }
    }
    this.token = null;
    localStorage.removeItem(TOKEN_KEY);
  }

  async api(url, opts = {}, tentou = false) {
    if (!(await this.garantirToken())) throw new AuthError('expired');
    const res = await fetch(url, {
      ...opts,
      headers: { Authorization: `Bearer ${this.token.access}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
    });
    if (res.status === 401 && this.sessao && !tentou) {
      this.token = null;
      return this.api(url, opts, true);
    }
    if (res.status === 401) {
      this.token = null; localStorage.removeItem(TOKEN_KEY);
      throw new AuthError('expired');
    }
    if (!res.ok) {
      let detail = '';
      try { detail = (await res.json()).error?.message || ''; } catch { /* ignora */ }
      const err = new Error(detail || `Erro ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return res.status === 204 ? null : res.json();
  }

  async getUser() {
    const r = await this.api(`${DRIVE_API}/about?fields=user(displayName,emailAddress)`);
    return { email: r.user.emailAddress, name: (r.user.displayName || r.user.emailAddress).split(' ')[0] };
  }

  async createSpreadsheet(seeds) {
    const names = Object.keys(SHEETS);
    const body = {
      properties: { title: CONFIG.SPREADSHEET_TITLE, locale: 'pt_BR' },
      sheets: names.map(name => ({
        properties: { title: name, gridProperties: { frozenRowCount: 1 } },
        data: [{
          startRow: 0, startColumn: 0,
          rowData: [{ values: SHEETS[name].map(h => ({ userEnteredValue: { stringValue: h }, userEnteredFormat: { textFormat: { bold: true } } })) }],
        }],
      })),
    };
    const created = await this.api(SHEETS_API, { method: 'POST', body: JSON.stringify(body) });
    const id = created.spreadsheetId;
    // Cabeçalho protegido (só aviso, para não travar quem edita à mão).
    const requests = created.sheets.map(s => ({
      addProtectedRange: { protectedRange: { range: { sheetId: s.properties.sheetId, startRowIndex: 0, endRowIndex: 1 }, warningOnly: true, description: 'Cabeçalho usado pelo app' } },
    }));
    await this.api(`${SHEETS_API}/${id}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests }) });
    const data = Object.entries(seeds).filter(([, rows]) => rows.length).map(([sheet, rows]) => ({ range: `${sheet}!A2`, values: rows }));
    if (data.length) {
      await this.api(`${SHEETS_API}/${id}/values:batchUpdate`, { method: 'POST', body: JSON.stringify({ valueInputOption: 'RAW', data }) });
    }
    // Marca o arquivo para o app encontrá-lo em outro aparelho.
    await this.api(`${DRIVE_API}/files/${id}`, { method: 'PATCH', body: JSON.stringify({ appProperties: { appFinancas: '1' } }) });
    return { id, name: CONFIG.SPREADSHEET_TITLE };
  }

  async findSpreadsheets() {
    const q = encodeURIComponent("appProperties has { key='appFinancas' and value='1' } and trashed=false");
    const r = await this.api(`${DRIVE_API}/files?q=${q}&fields=files(id,name,modifiedTime,ownedByMe)&orderBy=modifiedTime desc&pageSize=10&includeItemsFromAllDrives=true&supportsAllDrives=true`);
    return (r.files || []).map(f => ({ id: f.id, name: f.name }));
  }

  async fileInfo(id) {
    return this.api(`${DRIVE_API}/files/${id}?fields=id,name,capabilities(canEdit),trashed&supportsAllDrives=true`);
  }

  async pickSpreadsheet() {
    await loadScript('https://apis.google.com/js/api.js');
    await new Promise(res => gapi.load('picker', res));
    return new Promise(resolve => {
      const view = new google.picker.DocsView(google.picker.ViewId.SPREADSHEETS)
        .setMode(google.picker.DocsViewMode.LIST)
        .setIncludeFolders(false);
      const picker = new google.picker.PickerBuilder()
        .addView(view)
        .setOAuthToken(this.token.access)
        .setDeveloperKey(CONFIG.API_KEY)
        .setAppId(CONFIG.APP_ID)
        .setLocale('pt-BR')
        .setTitle('Escolha a planilha compartilhada com você')
        .setCallback(d => {
          if (d.action === google.picker.Action.PICKED) {
            const doc = d.docs[0];
            resolve({ id: doc.id, name: doc.name });
          } else if (d.action === google.picker.Action.CANCEL) {
            resolve(null);
          }
        })
        .build();
      picker.setVisible(true);
    });
  }

  // Garante que todas as abas existem e que o cabeçalho está atualizado.
  async ensureSheets(id) {
    const meta = await this.api(`${SHEETS_API}/${id}?fields=sheets.properties(title,sheetId)`);
    const existing = new Set(meta.sheets.map(s => s.properties.title));
    const missing = Object.keys(SHEETS).filter(n => !existing.has(n));
    if (missing.length) {
      await this.api(`${SHEETS_API}/${id}:batchUpdate`, {
        method: 'POST',
        body: JSON.stringify({ requests: missing.map(title => ({ addSheet: { properties: { title, gridProperties: { frozenRowCount: 1 } } } })) }),
      });
    }
    const data = Object.entries(SHEETS).map(([sheet, cols]) => ({ range: `${sheet}!A1`, values: [cols] }));
    await this.api(`${SHEETS_API}/${id}/values:batchUpdate`, { method: 'POST', body: JSON.stringify({ valueInputOption: 'RAW', data }) });
  }

  async readAll(id) {
    const names = Object.keys(SHEETS);
    const ranges = names.map(n => `ranges=${encodeURIComponent(n + '!A1:Z')}`).join('&');
    const r = await this.api(`${SHEETS_API}/${id}/values:batchGet?${ranges}&valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING`);
    const out = {};
    names.forEach((n, i) => { out[n] = (r.valueRanges[i] && r.valueRanges[i].values) || []; });
    return out;
  }

  async readSheet(id, sheet) {
    const r = await this.api(`${SHEETS_API}/${id}/values/${encodeURIComponent(sheet + '!A1:Z')}?valueRenderOption=UNFORMATTED_VALUE`);
    return r.values || [];
  }

  async readRow(id, sheet, rowNumber) {
    const r = await this.api(`${SHEETS_API}/${id}/values/${encodeURIComponent(`${sheet}!A${rowNumber}:Z${rowNumber}`)}?valueRenderOption=UNFORMATTED_VALUE`);
    return (r.values && r.values[0]) || [];
  }

  // Grava linhas novas no fim da aba e devolve o número da primeira.
  async appendRows(id, sheet, rows) {
    const r = await this.api(`${SHEETS_API}/${id}/values/${encodeURIComponent(sheet + '!A1')}:append?valueInputOption=RAW&insertDataOption=OVERWRITE&includeValuesInResponse=false`, {
      method: 'POST', body: JSON.stringify({ values: rows }),
    });
    const m = /![A-Z]+(\d+)/.exec(r.updates.updatedRange);
    return m ? Number(m[1]) : null;
  }

  // Várias linhas de uma vez: [{ sheet, n, row }]
  async updateRows(id, itens) {
    await this.api(`${SHEETS_API}/${id}/values:batchUpdate`, {
      method: 'POST',
      body: JSON.stringify({ valueInputOption: 'RAW', data: itens.map(x => ({ range: `${x.sheet}!A${x.n}`, values: [x.row] })) }),
    });
  }

  async readRows(id, itens) {
    const ranges = itens.map(x => `ranges=${encodeURIComponent(`${x.sheet}!A${x.n}:Z${x.n}`)}`).join('&');
    const r = await this.api(`${SHEETS_API}/${id}/values:batchGet?${ranges}&valueRenderOption=UNFORMATTED_VALUE`);
    return (r.valueRanges || []).map(v => (v.values && v.values[0]) || []);
  }

  async updateRow(id, sheet, rowNumber, row) {
    await this.api(`${SHEETS_API}/${id}/values/${encodeURIComponent(`${sheet}!A${rowNumber}`)}?valueInputOption=RAW`, {
      method: 'PUT', body: JSON.stringify({ values: [row] }),
    });
  }
}
