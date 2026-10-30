// Comunicação direta com o Google: login (Google Identity Services), Sheets, Drive e Picker.
import { CONFIG } from './config.js?v=36';
import { SHEETS } from './schema.js?v=36';

const TOKEN_KEY = 'af_token';
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
    if (this.token && window.google?.accounts?.oauth2) {
      try { google.accounts.oauth2.revoke(this.token.access, () => {}); } catch { /* ignora */ }
    }
    this.token = null;
    localStorage.removeItem(TOKEN_KEY);
  }

  async api(url, opts = {}) {
    if (!this.hasToken()) throw new AuthError('expired');
    const res = await fetch(url, {
      ...opts,
      headers: { Authorization: `Bearer ${this.token.access}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
    });
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
