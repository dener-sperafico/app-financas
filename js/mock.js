// Modo demonstração: imita o Google guardando a "planilha" no próprio navegador.
// Abra o app com ?demo=1 para usar. Nada é enviado para o Google.
import { SHEETS } from './schema.js?v=88';

const KEY = 'af_mock_db';

export class MockBackend {
  constructor() {
    this.mode = 'demo';
    this.signed = localStorage.getItem('af_mock_signed') === '1';
    try { this.db = JSON.parse(localStorage.getItem(KEY) || '{"files":{}}'); } catch { this.db = { files: {} }; }
  }

  _save() { localStorage.setItem(KEY, JSON.stringify(this.db)); }
  async _lag() { await new Promise(r => setTimeout(r, 120)); }

  async init() {}
  hasToken() { return this.signed; }
  async signIn() { this.signed = true; localStorage.setItem('af_mock_signed', '1'); }
  minutesLeft() { return this.signed ? 60 : 0; }
  temSessao() { return false; }
  // Admin de mentira, para ver as telas no modo demonstração.
  get acesso() { return { admin: true, pendentes: this._pessoas().filter(p => p.novo).length }; }
  get aguardando() { try { return JSON.parse(localStorage.getItem('af_mock_aguardando') || 'null'); } catch { return null; } }
  _pessoas() {
    try { const l = JSON.parse(localStorage.getItem('af_mock_pessoas') || 'null'); if (l) return l; } catch { /* ignora */ }
    return [
      { email: 'carol@exemplo.com', nome: 'Carol', liberado: true, novo: false, desde: '2026-10-27' },
      { email: 'amigo@exemplo.com', nome: 'Amigo', liberado: true, novo: false, desde: '2026-10-30' },
      { email: 'alguem.novo@exemplo.com', nome: 'Alguém Novo', liberado: false, novo: true, desde: '2026-11-24' },
    ];
  }
  _gravarPessoas(l) { localStorage.setItem('af_mock_pessoas', JSON.stringify(l)); return l; }
  async adminLista() {
    await this._lag();
    // Uso de mentira para ver o Admin e o painel de engajamento na demonstração.
    const hoje = new Date();
    const dia = n => { const d = new Date(hoje); d.setDate(d.getDate() - n); return d.toLocaleDateString('sv-SE'); };
    const pessoas = this._pessoas().map((p, i) => ({ ...p, uso: p.novo ? { ultimo: '', dias7: 0, dias30: 0, aberturas30: 0, lancamentos30: 0 } : { ultimo: new Date(hoje - (i % 9) * 26 * 3600e3).toISOString(), dias7: Math.max(0, 7 - (i % 8)), dias30: Math.max(1, 24 - i * 2), aberturas30: Math.max(1, 60 - i * 5), lancamentos30: Math.max(0, 80 - i * 7) } }));
    this.painel = { hoje: dia(0), serie: Array.from({ length: 30 }, (_, i) => ({ dia: dia(29 - i), ativos: 2 + ((i * 7) % 5) + (i > 20 ? 2 : 0), aberturas: 6 + ((i * 5) % 9), lancamentos: 4 + ((i * 3) % 7) })) };
    return pessoas;
  }
  async registrarUso() { return true; }
  async adminSalvar(email, liberado, antigo) {
    await this._lag();
    const l = this._pessoas().filter(p => p.email !== (antigo || email));
    const velho = this._pessoas().find(p => p.email === (antigo || email)) || { nome: '', desde: new Date().toISOString() };
    l.push({ ...velho, email: email.trim().toLowerCase(), liberado: liberado !== false, novo: false });
    this._gravarPessoas(l);
    return this.adminLista();
  }
  async adminExcluir(email) { this._gravarPessoas(this._pessoas().filter(p => p.email !== email)); return this.adminLista(); }
  async garantirToken() { return this.signed; }
  signOut() { this.signed = false; localStorage.removeItem('af_mock_signed'); }
  async getUser() { return { email: 'demo@exemplo.com', name: 'Demo' }; }

  async createSpreadsheet(seeds) {
    if (!this.signed) { const e = new Error('expired'); e.name = 'AuthError'; throw e; }
    await this._lag();
    const id = 'demo_' + Date.now().toString(36);
    const sheets = {};
    Object.entries(SHEETS).forEach(([n, cols]) => { sheets[n] = [cols.slice(), ...(seeds[n] || [])]; });
    this.db.files[id] = { name: 'Oikon (demonstração)', sheets };
    this._save();
    return { id, name: this.db.files[id].name };
  }

  async findSpreadsheets() {
    return Object.entries(this.db.files).map(([id, f]) => ({ id, name: f.name }));
  }

  async fileInfo(id) {
    const f = this.db.files[id];
    if (!f) { const e = new Error('Não encontrada'); e.status = 404; throw e; }
    return { id, name: f.name, capabilities: { canEdit: true }, trashed: false };
  }

  async pickSpreadsheet() {
    const list = await this.findSpreadsheets();
    return list[0] || null;
  }

  _file(id) {
    const f = this.db.files[id];
    if (!f) { const e = new Error('Planilha não encontrada'); e.status = 404; throw e; }
    return f;
  }

  async ensureSheets(id) {
    const f = this._file(id);
    Object.entries(SHEETS).forEach(([n, cols]) => {
      if (!f.sheets[n]) f.sheets[n] = [cols.slice()];
      else f.sheets[n][0] = cols.slice();
    });
    this._save();
  }

  async readAll(id) {
    await this._lag();
    const f = this._file(id);
    return JSON.parse(JSON.stringify(f.sheets));
  }

  async readSheet(id, sheet) { return JSON.parse(JSON.stringify(this._file(id).sheets[sheet] || [])); }
  async readRow(id, sheet, n) { return (this._file(id).sheets[sheet] || [])[n - 1] || []; }

  async appendRows(id, sheet, rows) {
    await this._lag();
    const s = this._file(id).sheets[sheet];
    const start = s.length + 1;
    rows.forEach(r => s.push(r.slice()));
    this._save();
    return start;
  }

  async updateRows(id, itens) { for (const x of itens) await this.updateRow(id, x.sheet, x.n, x.row); }
  async readRows(id, itens) { return Promise.all(itens.map(x => this.readRow(id, x.sheet, x.n))); }
  async updateRow(id, sheet, n, row) {
    await this._lag();
    const s = this._file(id).sheets[sheet];
    while (s.length < n) s.push([]);
    s[n - 1] = row.slice();
    this._save();
  }
}
