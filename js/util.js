// Funções auxiliares: datas, dinheiro, texto, identificadores.

export const pad = n => String(n).padStart(2, '0');

export function todayISO(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function parseISO(s) {
  const [y, m, d] = s.split('-').map(Number);
  return { y, m, d };
}

export function daysInMonth(y, m) {
  return new Date(y, m, 0).getDate();
}

// Dia que não existe no mês vira o último dia do mês (F7).
export function dateOf(y, m, d) {
  while (m > 12) { m -= 12; y += 1; }
  while (m < 1) { m += 12; y -= 1; }
  const dd = Math.min(d, daysInMonth(y, m));
  return `${y}-${pad(m)}-${pad(dd)}`;
}

export function addMonths(iso, n) {
  const { y, m, d } = parseISO(iso);
  return dateOf(y, m + n, d);
}

export function addDays(iso, n) {
  const { y, m, d } = parseISO(iso);
  const dt = new Date(y, m - 1, d + n);
  return todayISO(dt);
}

export const monthOf = iso => iso.slice(0, 7);

export function addMonthKey(mes, n) {
  const [y, m] = mes.split('-').map(Number);
  return dateOf(y, m + n, 1).slice(0, 7);
}

export function lastDayOfMonth(mes) {
  const [y, m] = mes.split('-').map(Number);
  return dateOf(y, m, 31);
}

const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const MONTHS_SHORT = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

export function monthName(mes, withYear = true) {
  const [y, m] = mes.split('-').map(Number);
  return withYear ? `${MONTHS[m - 1]}/${y}` : MONTHS[m - 1];
}

export function monthShort(mes) {
  const [y, m] = mes.split('-').map(Number);
  return `${MONTHS_SHORT[m - 1]}/${String(y).slice(2)}`;
}

export function fmtDate(iso, withYear = false) {
  if (!iso) return '';
  const { y, m, d } = parseISO(iso);
  return withYear ? `${pad(d)}/${pad(m)}/${y}` : `${pad(d)}/${pad(m)}`;
}

export function daysBetween(a, b) {
  const pa = parseISO(a), pb = parseISO(b);
  const da = Date.UTC(pa.y, pa.m - 1, pa.d), db = Date.UTC(pb.y, pb.m - 1, pb.d);
  return Math.round((db - da) / 86400000);
}

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const BRL_INTEIRO = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 0, maximumFractionDigits: 0 });
// Único lugar que formata dinheiro. Negativo leva o sinal de menos (U+2212) antes do R$: −R$ 320,00.
// inteiro: só reais, arredondando para baixo (número de destaque). sinal: mostra + nos positivos.
export function formatarReais(valor, { inteiro = false, sinal = false } = {}) {
  const v = Number(valor) || 0;
  const abs = Math.abs(v);
  const txt = inteiro ? BRL_INTEIRO.format(Math.floor(abs + 1e-9)) : BRL.format(abs);
  return (v < 0 && (inteiro ? Math.floor(abs + 1e-9) : abs) > 0 ? '−' : sinal && v > 0 ? '+' : '') + txt;
}
export const money = v => formatarReais(v);
export const round2 = v => Math.round((Number(v) + Number.EPSILON) * 100) / 100;

export function normalize(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
}

export function uid(prefix) {
  const r = (crypto.getRandomValues ? crypto.getRandomValues(new Uint32Array(2)) : [Math.random() * 2 ** 32, Date.now()]);
  return `${prefix}_${Date.now().toString(36)}${Array.from(r).map(n => Math.floor(n).toString(36)).join('').slice(0, 8)}`;
}

export function slug(s) {
  return normalize(s).replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 30);
}

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function nowStamp() {
  return new Date().toISOString();
}

// Valor digitado ("1.200,50", "35.90", "150") -> número
export function parseMoney(s) {
  let t = String(s).trim().replace(/^r\$\s*/i, '').replace(/\s/g, '');
  if (!t) return null;
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '');
  const n = Number(t);
  return Number.isFinite(n) ? round2(n) : null;
}
