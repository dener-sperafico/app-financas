// Modo demonstração: imita o Google guardando a "planilha" no próprio navegador.
// Abra o app com ?demo=1 para usar. Nada é enviado para o Google.
import { SHEETS } from './schema.js?v=15';

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
  signOut() { this.signed = false; localStorage.removeItem('af_mock_signed'); }
  async getUser() { return { email: 'demo@exemplo.com', name: 'Demo' }; }

  async createSpreadsheet(seeds) {
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
