// Campo único: interpreta frases como "gasolina 300 nubank dener 29/10" sem IA (N04).
import { normalize, parseMoney, todayISO, addDays, dateOf, parseISO, pad, daysBetween } from './util.js?v=5';
import { categorias, cartoes, palavrasDe, categoria } from './model.js?v=5';

const FORMA_WORDS = {
  pix: 'pix', debito: 'debito', dinheiro: 'dinheiro', especie: 'dinheiro', boleto: 'boleto',
  cartao: 'cartao', credito: 'cartao',
};

function parseData(tok, hoje) {
  const t = normalize(tok);
  if (t === 'hoje') return hoje;
  if (t === 'ontem') return addDays(hoje, -1);
  if (t === 'amanha') return addDays(hoje, 1);
  const m = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/.exec(t);
  if (!m) return null;
  const { y } = parseISO(hoje);
  let yy = m[3] ? Number(m[3]) : y;
  if (yy < 100) yy += 2000;
  const d = Number(m[1]), mo = Number(m[2]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return dateOf(yy, mo, d);
}

export function interpretar(S, texto, hoje = todayISO()) {
  const original = String(texto || '').trim();
  const tokens = original.split(/\s+/).filter(Boolean);
  const norm = tokens.map(normalize);
  const used = tokens.map(() => false);
  const r = {
    texto: original, tipo: null, valor: null, descricao: '', categoria_id: '',
    forma: null, cartao_id: '', data: hoje, repeticao: 'unica', vezes: null,
    cartoesAmbiguos: null, categoriaSugerida: false,
  };

  // Cartão pelo nome cadastrado (o mais longo que casar).
  const cards = cartoes(S).map(c => ({ c, parts: normalize(c.nome).split(/\s+/) }));
  let melhor = null;
  for (let i = 0; i < norm.length; i++) {
    cards.forEach(({ c, parts }) => {
      if (parts.every((p, j) => norm[i + j] === p) && (!melhor || parts.length > melhor.len)) melhor = { c, i, len: parts.length };
    });
  }
  if (melhor) {
    for (let j = 0; j < melhor.len; j++) used[melhor.i + j] = true;
    r.forma = 'cartao'; r.cartao_id = melhor.c.id;
  } else {
    for (let i = 0; i < norm.length && !r.forma; i++) {
      const cands = cards.filter(({ parts }) => parts[0] === norm[i]);
      if (cands.length === 1) { used[i] = true; r.forma = 'cartao'; r.cartao_id = cands[0].c.id; }
      else if (cands.length > 1) { used[i] = true; r.forma = 'cartao'; r.cartoesAmbiguos = cands.map(x => x.c.id); }
    }
  }

  for (let i = 0; i < tokens.length; i++) {
    if (used[i]) continue;
    const t = norm[i];
    // Parcelas: "3x"
    let m = /^(\d{1,2})x$/.exec(t);
    if (m && Number(m[1]) >= 2) { r.repeticao = 'parcelada'; r.vezes = Number(m[1]); used[i] = true; continue; }
    if (t === 'mensal' || t === 'mensalmente') { r.repeticao = 'mensal'; used[i] = true; continue; }
    if (t === 'anual' || t === 'anualmente') { r.repeticao = 'anual'; used[i] = true; continue; }
    // "dia 15"
    if (t === 'dia' && /^\d{1,2}$/.test(norm[i + 1] || '')) {
      const { y, m: mo } = parseISO(hoje);
      r.data = dateOf(y, mo, Number(norm[i + 1])); used[i] = used[i + 1] = true; i++; continue;
    }
    const dt = parseData(t, hoje);
    if (dt) { r.data = dt; used[i] = true; continue; }
    if (FORMA_WORDS[t]) {
      if (FORMA_WORDS[t] === 'cartao') { if (!r.forma) r.forma = 'cartao'; }
      else if (!r.cartao_id) r.forma = FORMA_WORDS[t];
      used[i] = true; continue;
    }
    if (r.valor === null && /^(r\$)?\d/.test(t)) {
      const v = parseMoney(t);
      if (v !== null && v > 0) { r.valor = v; used[i] = true; continue; }
    }
  }

  const resto = tokens.filter((_, i) => !used[i]).join(' ').trim();
  r.descricao = resto ? resto.charAt(0).toUpperCase() + resto.slice(1) : '';

  // Categoria pelas palavras associadas e pelo nome da categoria.
  const ativas = new Map(categorias(S).filter(c => !c.sistema).map(c => [c.id, c]));
  const score = new Map();
  palavrasDe(r.descricao).forEach(w => {
    const p = S.find('Palavras', w);
    if (p && ativas.has(p.categoria_id)) score.set(p.categoria_id, (score.get(p.categoria_id) || 0) + 2 + Math.min(3, (p.usos || 0) * 0.2));
    ativas.forEach(c => { if (palavrasDe(c.nome).includes(w)) score.set(c.id, (score.get(c.id) || 0) + 1.5); });
  });
  let best = null;
  score.forEach((v, k) => { if (!best || v > best[1]) best = [k, v]; });
  if (best) { r.categoria_id = best[0]; r.categoriaSugerida = true; }

  const cat = r.categoria_id ? categoria(S, r.categoria_id) : null;
  r.tipo = cat ? cat.tipo : 'saida';
  if (!r.forma) r.forma = formaMaisUsada(S);
  if (r.tipo === 'entrada' && r.forma === 'cartao') r.forma = 'pix';
  return r;
}

export function formaMaisUsada(S) {
  const cont = {};
  S.get('Lancamentos').slice(-60).forEach(l => {
    if (['pix', 'debito', 'dinheiro', 'boleto'].includes(l.forma) && l.tipo !== 'entrada') cont[l.forma] = (cont[l.forma] || 0) + 1;
  });
  const top = Object.entries(cont).sort((a, b) => b[1] - a[1])[0];
  return top ? top[0] : 'pix';
}

// Previsto parecido já existente (ex.: "salário 9000" com o salário previsto) — N04.
export function previstoParecido(S, d) {
  if (!d.categoria_id) return null;
  return S.get('Lancamentos').find(l => l.situacao === 'previsto' && l.categoria_id === d.categoria_id
    && Math.abs(daysBetween(l.data, d.data)) <= 7) || null;
}

export { pad };
