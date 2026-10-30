// Regras de negócio. Tudo é calculado a partir dos registros da planilha (aba "O que o app calcula").
import { addMonths, addDays, daysBetween, dateOf, parseISO, monthOf, todayISO, lastDayOfMonth, addMonthKey, round2, uid, normalize } from './util.js?v=38';
import { SEED_CATEGORIES } from './schema.js?v=38';

export const AJUSTES = 'cat_ajustes';
// Gasto que não se encaixa em nenhuma categoria: não exige orçado e não ensina palavras ao campo de lançamento.
export const FORA = 'cat_fora_orcamento';
export function garantirFora(S) {
  if (!S.find('Categorias', FORA)) {
    S.upsert('Categorias', { id: FORA, nome: 'Fora do orçamento', tipo: 'saida', repasse: false, dia_transferencia: null, sistema: true, arquivada: false, ordem: 999, forma_prevista: '' });
  }
}
export const FORMAS = [
  { id: 'pix', nome: 'Pix' }, { id: 'debito', nome: 'Débito' }, { id: 'dinheiro', nome: 'Dinheiro' },
  { id: 'boleto', nome: 'Boleto' }, { id: 'cartao', nome: 'Cartão' },
];
export const formaNome = f => (FORMAS.find(x => x.id === f) || { nome: f === 'ajuste' ? 'Ajuste' : f }).nome;

const STOP = new Set(['de', 'da', 'do', 'das', 'dos', 'para', 'pra', 'com', 'sem', 'por', 'uma', 'um', 'que', 'nos', 'nas', 'aos', 'pro', 'meu', 'minha', 'hoje', 'ontem', 'amanha']);

// ---------- Acesso aos dados ----------
export const cfg = (S, k) => (S.find('Config', k) || {}).valor;
export const categorias = (S, { tipo, todas = false } = {}) => S.get('Categorias')
  .filter(c => (todas || !c.arquivada) && (!tipo || c.tipo === tipo))
  .sort((a, b) => (a.ordem ?? 99) - (b.ordem ?? 99) || a.nome.localeCompare(b.nome));
export const categoria = (S, id) => S.find('Categorias', id);
export const cartoes = (S, todos = false) => S.get('Cartoes').filter(c => todos || c.ativo).sort((a, b) => a.nome.localeCompare(b.nome));
export const cartao = (S, id) => S.find('Cartoes', id);

export const signOf = tipo => (tipo === 'entrada' ? 1 : -1);
export const sign = l => signOf(l.tipo);

// ---------- Cartões e faturas (N13) ----------
// Compra até o dia anterior ao fechamento: fatura que fecha naquele mês.
// No dia do fechamento ou depois: fatura seguinte. Mês da fatura = mês do vencimento.
export function faturaInfo(card, dataCompra) {
  const { y, m } = parseISO(dataCompra);
  let fech = dateOf(y, m, card.dia_fechamento);
  if (dataCompra >= fech) fech = dateOf(y, m + 1, card.dia_fechamento);
  const f = parseISO(fech);
  const venc = card.dia_vencimento > card.dia_fechamento
    ? dateOf(f.y, f.m, card.dia_vencimento)
    : dateOf(f.y, f.m + 1, card.dia_vencimento);
  const mes = monthOf(venc);
  return { id: `${card.id}_${mes}`, cartao_id: card.id, mes, data_fechamento: fech, data_vencimento: venc };
}

export function faturaInfoFromId(S, faturaId) {
  const f = S.find('Faturas', faturaId);
  if (f) return f;
  const idx = faturaId.lastIndexOf('_');
  const cardId = faturaId.slice(0, idx), mes = faturaId.slice(idx + 1);
  const card = cartao(S, cardId);
  if (!card) return null;
  const [y, mm] = mes.split('-').map(Number);
  const venc = dateOf(y, mm, card.dia_vencimento);
  const fech = card.dia_vencimento > card.dia_fechamento ? dateOf(y, mm, card.dia_fechamento) : dateOf(y, mm - 1, card.dia_fechamento);
  return { id: faturaId, cartao_id: cardId, mes, data_fechamento: fech, data_vencimento: venc, situacao: 'prevista', data_pagamento: '' };
}

// Valor que a fatura cobra: compras somam, créditos (ajuste a favor) subtraem.
export const faturaTotal = (S, faturaId) => round2(S.get('Lancamentos')
  .filter(l => l.fatura_id === faturaId).reduce((t, l) => t - sign(l) * l.valor, 0));

export const faturaItens = (S, faturaId) => S.get('Lancamentos').filter(l => l.fatura_id === faturaId)
  .sort((a, b) => a.data.localeCompare(b.data));

export function faturasDoCartao(S, cardId, hoje = todayISO()) {
  const ids = new Set(S.get('Faturas').filter(f => f.cartao_id === cardId).map(f => f.id));
  S.get('Lancamentos').forEach(l => { if (l.cartao_id === cardId && l.fatura_id) ids.add(l.fatura_id); });
  // Meses futuros em que há orçado previsto para este cartão também têm fatura (estimada).
  if (categoriasDoCartao(S, cardId).length) for (let i = 0; i <= 12; i++) ids.add(`${cardId}_${addMonthKey(monthOf(hoje), i)}`);
  return [...ids].map(id => {
    const total = faturaTotal(S, id);
    const est = estimativaFatura(S, id, hoje);
    const estimativa = round2(est.reduce((t, x) => t + x.valor, 0));
    return { ...faturaInfoFromId(S, id), total, estimativa, previsao: round2(total + estimativa), est };
  }).filter(f => f.mes && (f.total || f.estimativa || S.find('Faturas', f.id))).sort((a, b) => a.mes.localeCompare(b.mes));
}

// ---------- Forma de pagamento prevista por categoria ----------
// Guardada como 'pix', 'debito', 'dinheiro', 'boleto' ou 'cartao:<id do cartão>'.
export function formaPrevista(S, catId) {
  const v = String(categoria(S, catId)?.forma_prevista || '');
  if (!v) return null;
  if (v.startsWith('cartao:')) { const c = cartao(S, v.slice(7)); return c && c.ativo ? { forma: 'cartao', cartao_id: c.id } : null; }
  return { forma: v, cartao_id: '' };
}
export const categoriasDoCartao = (S, cardId) => categorias(S).filter(c => c.forma_prevista === `cartao:${cardId}` && c.tipo !== 'entrada');

// O que ainda deve entrar numa fatura aberta: o orçado ainda não usado das categorias pagas neste cartão.
export function estimativaFatura(S, faturaId, hoje = todayISO()) {
  const f = faturaInfoFromId(S, faturaId);
  if (!f || f.situacao === 'paga' || f.data_fechamento <= hoje) return [];
  return categoriasDoCartao(S, f.cartao_id).map(c => ({ categoria: c, valor: Math.max(0, catMes(S, c.id, f.mes).disponivel) }))
    .filter(x => x.valor > 0);
}

// ---------- Orçamento ----------
export function orcado(S, catId, mes) {
  const r = S.find('Orcamento', `${catId}|${mes}`);
  return r ? r.valor : null;
}

export function precisaOrcado(S, catId, mes) {
  const c = categoria(S, catId);
  if (!c || c.sistema || c.tipo === 'entrada') return false; // entradas e Ajustes não exigem orçado (N22)
  return orcado(S, catId, mes) === null;
}

// Salvar orçado; "repetir" copia para os 12 meses seguintes preservando meses ajustados à mão (N21).
export function setOrcado(S, catId, mes, valor, repetir = false) {
  const rows = [{ categoria_id: catId, mes, valor: round2(valor), origem: 'manual' }];
  if (repetir) {
    for (let i = 1; i <= 12; i++) {
      const m = addMonthKey(mes, i);
      // Copiar substitui os 12 meses seguintes (revisão de 30/10: antes preservava meses ajustados à mão,
      // mas o orçado importado estava todo marcado assim e a cópia não mudava nada).
      rows.push({ categoria_id: catId, mes: m, valor: round2(valor), origem: 'copiado' });
    }
  }
  rows.forEach(r => S.upsert('Orcamento', r));
}

export function catMes(S, catId, mes) {
  const c = categoria(S, catId);
  const cs = c ? signOf(c.tipo) : -1;
  let realizado = 0, previsto = 0;
  S.get('Lancamentos').forEach(l => {
    if (l.categoria_id !== catId || l.mes_orcamento !== mes) return;
    const v = sign(l) === cs ? l.valor : -l.valor;
    if (l.situacao === 'confirmado') realizado += v; else previsto += v;
  });
  const orc = orcado(S, catId, mes);
  const o = orc ?? 0;
  realizado = round2(realizado); previsto = round2(previsto);
  return {
    categoria: c, orcado: orc, realizado, previsto,
    disponivel: round2(o - realizado - previsto),
    uso: o > 0 ? (realizado + previsto) / o : (realizado + previsto > 0 ? Infinity : 0),
  };
}

export function resumoMes(S, mes) {
  const linhas = categorias(S, { todas: true })
    .map(c => catMes(S, c.id, mes))
    .filter(x => !x.categoria.arquivada || x.realizado || x.previsto || x.orcado);
  const soma = (tipo, k) => round2(linhas.filter(x => x.categoria.tipo === tipo).reduce((t, x) => t + (x[k] || 0), 0));
  const entradas = { orcado: soma('entrada', 'orcado'), realizado: soma('entrada', 'realizado'), previsto: soma('entrada', 'previsto') };
  const saidas = { orcado: soma('saida', 'orcado'), realizado: soma('saida', 'realizado'), previsto: soma('saida', 'previsto') };
  const guardado = soma('investimento', 'realizado');
  const guardadoPrevisto = soma('investimento', 'previsto');
  const guardadoOrcado = soma('investimento', 'orcado');
  const dispSaidas = round2(saidas.orcado - saidas.realizado - saidas.previsto);
  // Projeção por grupo: em cada categoria vale o maior entre o orçado e o realizado + previsto.
  const proj = tipo => round2(linhas.filter(x => x.categoria.tipo === tipo && !x.categoria.arquivada)
    .reduce((t, x) => t + Math.max(x.orcado || 0, x.realizado + x.previsto), 0));
  const livre = tipo => round2(linhas.filter(x => x.categoria.tipo === tipo && !x.categoria.sistema && x.orcado !== null)
    .reduce((t, x) => t + Math.max(0, x.disponivel), 0));
  const acima = tipo => round2(linhas.filter(x => x.categoria.tipo === tipo && x.disponivel < 0)
    .reduce((t, x) => t - x.disponivel, 0));
  entradas.projecao = proj('entrada'); saidas.projecao = proj('saida');
  saidas.livre = livre('saida'); saidas.acima = acima('saida');
  saidas.estouradas = linhas.filter(x => x.categoria.tipo === 'saida' && x.orcado !== null && x.disponivel < 0).length;
  const guardadoProjecao = proj('investimento');
  return {
    linhas, entradas, saidas, guardado, guardadoPrevisto, guardadoOrcado, guardadoProjecao,
    percGuardado: entradas.realizado > 0 ? guardado / entradas.realizado : 0,
    dispSaidas,
    sobraOrcada: round2(entradas.orcado - saidas.orcado - guardadoOrcado),
    sobraProjetada: round2(entradas.projecao - saidas.projecao - guardadoProjecao),
  };
}

// ---------- Saldo, pendentes, fechamento ----------
export function saldoAtual(S) {
  const base = Number(cfg(S, 'saldo_inicial')) || 0;
  const desde = cfg(S, 'data_saldo_inicial') || '0000-00-00';
  let s = base;
  S.get('Lancamentos').forEach(l => {
    if (l.situacao === 'confirmado' && l.forma !== 'cartao' && l.data >= desde) s += sign(l) * l.valor;
  });
  S.get('Faturas').forEach(f => {
    if (f.situacao === 'paga' && f.data_pagamento >= desde) s -= faturaTotal(S, f.id);
  });
  return round2(s);
}

// Repetições no cartão (parcelas e assinaturas) se resolvem sozinhas: viram realizadas quando a fatura delas fecha.
// A 1ª parcela de uma compra parcelada já nasce realizada (a compra aconteceu). Nenhuma delas vira pendente.
const ehParcelaCartao = (S, l) => {
  if (l.forma !== 'cartao' || !l.recorrencia_id) return false;
  const rep = S.find('Recorrencias', l.recorrencia_id)?.repeticao;
  return rep === 'parcelada' || rep === 'mensal' || rep === 'anual';
};
const automatica = (S, l) => {
  if (!ehParcelaCartao(S, l)) return false;
  return S.find('Recorrencias', l.recorrencia_id).repeticao !== 'parcelada' || (l.ocorrencia || 1) > 1;
};

export function sincronizarParcelas(S, hoje = todayISO()) {
  S.get('Lancamentos').filter(l => automatica(S, l)).forEach(l => {
    const f = l.fatura_id ? faturaInfoFromId(S, l.fatura_id) : null;
    const deve = f && f.data_fechamento <= hoje ? 'confirmado' : 'previsto';
    if (l.situacao !== deve) S.upsert('Lancamentos', { ...l, situacao: deve });
  });
}

export function pendentes(S, hoje = todayISO()) {
  const lancs = S.get('Lancamentos').filter(l => l.situacao === 'previsto' && l.data <= hoje && !ehParcelaCartao(S, l))
    .map(l => ({ kind: 'lanc', item: l, data: l.data }));
  const fats = [];
  const vistos = new Set();
  [...S.get('Faturas').map(f => f.id), ...S.get('Lancamentos').filter(l => l.fatura_id).map(l => l.fatura_id)].forEach(id => {
    if (vistos.has(id)) return; vistos.add(id);
    const f = faturaInfoFromId(S, id);
    if (!f || f.situacao === 'paga' || f.data_vencimento > hoje) return;
    const total = faturaTotal(S, id);
    if (total <= 0) return;
    fats.push({ kind: 'fatura', item: { ...f, total }, data: f.data_vencimento });
  });
  return [...lancs, ...fats].sort((a, b) => a.data.localeCompare(b.data));
}

// Fechamento previsto do mês atual (N26, exceção do mês atual):
// parte do saldo de hoje e desconta só o que ainda falta acontecer.
// Fechamento do mês atual, separado nas partes que o compõem.
export function fechamentoDetalhe(S, hoje = todayISO()) {
  const mes = monthOf(hoje);
  const fim = lastDayOfMonth(mes);
  const saldo = saldoAtual(S);
  let receber = 0, pagar = 0, faturas = 0, reservado = 0;
  S.get('Lancamentos').forEach(l => {
    if (l.situacao !== 'previsto' || l.forma === 'cartao' || l.data > fim) return;
    if (sign(l) > 0) receber += l.valor; else pagar += l.valor;
  });
  const vistos = new Set();
  [...S.get('Faturas').map(f => f.id), ...S.get('Lancamentos').filter(l => l.fatura_id).map(l => l.fatura_id)].forEach(id => {
    if (vistos.has(id)) return; vistos.add(id);
    const f = faturaInfoFromId(S, id);
    if (f && f.situacao !== 'paga' && f.data_vencimento <= fim) faturas += faturaTotal(S, id);
  });
  categorias(S).forEach(c => {
    if (c.sistema) return;
    const resto = Math.max(0, catMes(S, c.id, mes).disponivel);
    if (c.tipo === 'entrada') receber += resto; else reservado += resto;
  });
  receber = round2(receber); pagar = round2(pagar); faturas = round2(faturas); reservado = round2(reservado);
  return { mes, fim, saldo, receber, pagar, faturas, reservado, total: round2(saldo + receber - pagar - faturas - reservado) };
}

// ---------- Futuro: saldo estimado dia a dia ----------
// Parte do saldo de hoje e, a cada dia: + entradas previstas, − contas previstas, − faturas no vencimento
// (lançado + estimativa pelo orçado), − orçado ainda livre sem data, espalhado por igual nos dias do mês.
// Gasto com data (previsto) sai no dia dele; só o que sobra do orçado é espalhado. O último dia do mês
// atual fecha com o mesmo valor de fechamentoMesAtual. Previsto e fatura atrasados entram hoje.
export function projecaoDiaria(S, hoje = todayISO(), meses = 12) {
  const mes0 = monthOf(hoje);
  const fimTotal = lastDayOfMonth(addMonthKey(mes0, meses));
  const mov = new Map();
  const add = (data, m) => {
    const d = data < hoje ? hoje : data;
    if (d > fimTotal) return;
    if (!mov.has(d)) mov.set(d, []);
    mov.get(d).push(m);
  };
  S.get('Lancamentos').forEach(l => {
    if (l.situacao !== 'previsto' || l.forma === 'cartao') return;
    add(l.data, { tipo: sign(l) > 0 ? 'entrada' : 'saida', descricao: l.descricao, valor: round2(sign(l) * l.valor), categoria_id: l.categoria_id, id: l.id, atrasado: l.data < hoje });
  });
  const abertas = new Set();
  cartoes(S, true).forEach(c => faturasDoCartao(S, c.id, hoje).forEach(f => {
    if (f.situacao === 'paga') return;
    if (f.data_fechamento > hoje) abertas.add(f.id);
    const v = round2(f.total + f.estimativa);
    if (v <= 0) return;
    add(f.data_vencimento, { tipo: 'fatura', descricao: `Fatura ${c.nome}`, valor: -v, lancado: f.total, estimativa: f.estimativa, fatura_id: f.id, atrasado: f.data_vencimento < hoje });
  }));
  const porMes = {};
  for (let i = 0; i <= meses; i++) {
    const mes = addMonthKey(mes0, i);
    const ini = i === 0 ? hoje : `${mes}-01`;
    const fim = lastDayOfMonth(mes);
    let livre = 0, receber = 0;
    categorias(S).forEach(c => {
      if (c.sistema) return;
      const resto = Math.max(0, catMes(S, c.id, mes).disponivel);
      if (!resto) return;
      if (c.tipo === 'entrada') { receber += resto; return; }
      // Categoria paga no cartão, com a fatura do mês ainda aberta: já está na estimativa da fatura.
      if (String(c.forma_prevista || '').startsWith('cartao:') && abertas.has(`${c.forma_prevista.slice(7)}_${mes}`)) return;
      livre += resto;
    });
    receber = round2(receber); livre = round2(livre);
    if (receber) add(fim, { tipo: 'entrada', descricao: 'Entradas orçadas ainda sem data', valor: receber, orcado: true });
    const dias = daysBetween(ini, fim) + 1;
    const centavos = Math.round(livre * 100);
    const base = Math.floor(centavos / dias);
    porMes[mes] = { mes, ini, fim, livre, dias, porDia: base / 100, ultimoDia: (centavos - base * (dias - 1)) / 100 };
  }
  let saldo = saldoAtual(S);
  const dias = [];
  for (let d = hoje; d <= fimTotal; d = addDays(d, 1)) {
    const pm = porMes[monthOf(d)];
    const variavel = pm ? (d === pm.fim ? pm.ultimoDia : pm.porDia) : 0;
    const ms = mov.get(d) || [];
    saldo = round2(saldo + ms.reduce((t, m) => t + m.valor, 0) - variavel);
    dias.push({ data: d, movimentos: ms, variavel, saldo });
  }
  return { saldoInicial: saldoAtual(S), dias, porMes };
}

export function fechamentoMesAtual(S, hoje = todayISO()) {
  return fechamentoDetalhe(S, hoje).total;
}

// ---------- Lançamentos e recorrências ----------
export function mesOrcamento(S, l) {
  if (l.forma === 'cartao' && l.fatura_id) return faturaInfoFromId(S, l.fatura_id)?.mes || monthOf(l.data);
  return monthOf(l.data);
}

function dividir(total, n) {
  const base = Math.floor((total * 100) / n) / 100;
  const primeira = round2(total - base * (n - 1));
  return Array.from({ length: n }, (_, i) => (i === 0 ? primeira : base));
}

// Monta os lançamentos de um rascunho (único, parcelado, mensal ou anual).
export function montar(S, d, hoje = todayISO()) {
  const card = d.forma === 'cartao' ? cartao(S, d.cartao_id) : null;
  const rep = d.repeticao || 'unica';
  const vezes = d.vezes ? Number(d.vezes) : null;
  let datas = [], valores = [];
  if (rep === 'parcelada') {
    const n = Math.max(2, vezes || 2);
    datas = Array.from({ length: n }, (_, i) => addMonths(d.data, i));
    valores = dividir(d.valor, n);
  } else if (rep === 'mensal' || rep === 'anual') {
    const passo = rep === 'mensal' ? 1 : 12;
    const limite = addMonths(hoje, 12);
    for (let i = 0; ; i++) {
      const dt = addMonths(d.data, i * passo);
      if (vezes ? i >= vezes : (dt > limite && i > 0)) break;
      datas.push(dt); valores.push(round2(d.valor));
      if (i > 400) break;
    }
  } else {
    datas = [d.data]; valores = [round2(d.valor)];
  }
  const recId = rep === 'unica' ? '' : uid('rec');
  const primeiraSit = d.situacao || (d.data <= hoje ? 'confirmado' : 'previsto');
  const lancs = datas.map((dt, i) => {
    let fat = null;
    if (card) {
      fat = (i === 0 && d.fatura_id && d.fatura_id.startsWith(`${card.id}_`)) ? faturaInfoFromId(S, d.fatura_id) : faturaInfo(card, dt);
      if (rep === 'parcelada' && i > 0) fat = faturaInfo(card, dt);
    }
    // Parcelas no cartão: a primeira segue a compra; as seguintes ficam previstas até a fatura delas fechar.
    const pelaFatura = fat && fat.data_fechamento <= hoje ? 'confirmado' : 'previsto';
    const sit = card && rep !== 'unica' && (rep !== 'parcelada' || i > 0) ? pelaFatura
      : i === 0 ? primeiraSit : (dt <= hoje ? 'confirmado' : 'previsto');
    return {
      id: d.id && i === 0 ? d.id : uid('lan'),
      tipo: d.tipo, descricao: d.descricao, valor: valores[i], categoria_id: d.categoria_id,
      forma: d.forma, cartao_id: card ? card.id : '', data: dt,
      mes_orcamento: fat ? fat.mes : monthOf(dt),
      fatura_id: fat ? fat.id : '', fatura_manual: !!(i === 0 && d.fatura_manual),
      situacao: sit, recorrencia_id: recId, ocorrencia: recId ? i + 1 : null, valor_automatico: false,
      _fatura: fat,
    };
  });
  const rec = recId ? {
    id: recId, repeticao: rep, total_ocorrencias: rep === 'parcelada' ? datas.length : vezes,
    data_inicio: d.data, encerrada_em: '', valor_total: rep === 'parcelada' ? round2(d.valor) : null,
    tipo: d.tipo, descricao: d.descricao, valor: rep === 'parcelada' ? null : round2(d.valor),
    categoria_id: d.categoria_id, forma: d.forma, cartao_id: card ? card.id : '',
  } : null;
  return { rec, lancs };
}

function ensureFatura(S, fat) {
  if (fat && !S.find('Faturas', fat.id)) {
    S.upsert('Faturas', { id: fat.id, cartao_id: fat.cartao_id, mes: fat.mes, data_fechamento: fat.data_fechamento, data_vencimento: fat.data_vencimento, situacao: 'prevista', data_pagamento: '' });
  }
}

// Previsto em mês sem orçado: o próprio valor vira o orçado daquele mês (N22).
function orcadoAutomatico(S, l) {
  if (precisaOrcado(S, l.categoria_id, l.mes_orcamento)) {
    S.upsert('Orcamento', { categoria_id: l.categoria_id, mes: l.mes_orcamento, valor: l.valor, origem: 'previsto' });
  }
}

export function salvarNovo(S, d, hoje = todayISO()) {
  const { rec, lancs } = montar(S, d, hoje);
  if (rec) S.upsert('Recorrencias', rec);
  lancs.forEach((l, i) => {
    ensureFatura(S, l._fatura);
    delete l._fatura;
    if (i > 0) orcadoAutomatico(S, l);
    S.upsert('Lancamentos', l);
  });
  aprender(S, d.descricao, d.categoria_id);
  return lancs;
}

// Edição de uma ocorrência (as demais da série não mudam nesta versão).
export function salvarEdicao(S, original, d) {
  const card = d.forma === 'cartao' ? cartao(S, d.cartao_id) : null;
  let fat = null;
  if (card) {
    if (d.fatura_manual && d.fatura_id && d.fatura_id.startsWith(`${card.id}_`)) fat = faturaInfoFromId(S, d.fatura_id);
    else fat = faturaInfo(card, d.data);
  }
  const l = {
    ...original,
    tipo: d.tipo, descricao: d.descricao, valor: round2(d.valor), categoria_id: d.categoria_id,
    forma: d.forma, cartao_id: card ? card.id : '', data: d.data,
    fatura_id: fat ? fat.id : '', fatura_manual: !!(card && d.fatura_manual),
    mes_orcamento: fat ? fat.mes : monthOf(d.data),
    situacao: d.situacao || original.situacao,
  };
  ensureFatura(S, fat);
  S.upsert('Lancamentos', l);
  if (normalize(original.descricao) !== normalize(d.descricao) || original.categoria_id !== d.categoria_id) aprender(S, d.descricao, d.categoria_id);
  return l;
}

// Excluir: só esta ocorrência, ou esta e as próximas (encerra a série).
export function excluir(S, l, alcance = 'esta') {
  if (alcance === 'proximas' && l.recorrencia_id) {
    S.get('Lancamentos').filter(x => x.recorrencia_id === l.recorrencia_id && (x.ocorrencia || 0) >= (l.ocorrencia || 0))
      .forEach(x => S.remove('Lancamentos', x.id));
    const rec = S.find('Recorrencias', l.recorrencia_id);
    if (rec) S.upsert('Recorrencias', { ...rec, encerrada_em: l.data });
  } else {
    S.remove('Lancamentos', l.id);
  }
}

// Séries sem fim: mantém sempre 12 meses de ocorrências gravadas à frente.
export function estenderRecorrencias(S, hoje = todayISO()) {
  sincronizarParcelas(S, hoje);
  const limite = addMonths(hoje, 12);
  S.get('Recorrencias').forEach(rec => {
    if (rec.total_ocorrencias || rec.encerrada_em || rec.repeticao === 'parcelada') return;
    const passo = rec.repeticao === 'anual' ? 12 : 1;
    const ocs = S.get('Lancamentos').filter(l => l.recorrencia_id === rec.id);
    let n = ocs.reduce((mx, l) => Math.max(mx, l.ocorrencia || 0), 0);
    if (!n) return;
    for (let guard = 0; guard < 60; guard++) {
      const dt = addMonths(rec.data_inicio, n * passo);
      if (dt > limite) break;
      const { lancs } = montar(S, { ...rec, id: undefined, data: dt, repeticao: 'unica', situacao: 'previsto' }, hoje);
      const l = { ...lancs[0], recorrencia_id: rec.id, ocorrencia: n + 1 };
      ensureFatura(S, l._fatura); delete l._fatura;
      orcadoAutomatico(S, l);
      S.upsert('Lancamentos', l);
      n++;
    }
  });
}

export function confirmar(S, l) {
  S.upsert('Lancamentos', { ...l, situacao: 'confirmado' });
}

// Pagar fatura: valor cobrado diferente vira item na categoria Ajustes (N14).
export function pagarFatura(S, faturaId, valorCobrado, dataPagamento) {
  const f = faturaInfoFromId(S, faturaId);
  const total = faturaTotal(S, faturaId);
  const dif = round2(valorCobrado - total);
  if (Math.abs(dif) >= 0.01) {
    S.upsert('Lancamentos', {
      id: uid('lan'), tipo: dif > 0 ? 'saida' : 'entrada', descricao: 'Ajuste da fatura', valor: Math.abs(dif),
      categoria_id: AJUSTES, forma: 'cartao', cartao_id: f.cartao_id, data: dataPagamento, mes_orcamento: f.mes,
      fatura_id: faturaId, fatura_manual: true, situacao: 'confirmado', recorrencia_id: '', ocorrencia: null, valor_automatico: false,
    });
  }
  S.upsert('Faturas', { ...f, situacao: 'paga', data_pagamento: dataPagamento });
}

// Ajuste de saldo real (N19): a diferença vira lançamento em Ajustes.
export function ajustarSaldo(S, saldoReal, hoje = todayISO()) {
  const dif = round2(saldoReal - saldoAtual(S));
  if (Math.abs(dif) < 0.01) return 0;
  S.upsert('Lancamentos', {
    id: uid('lan'), tipo: dif > 0 ? 'entrada' : 'saida', descricao: 'Ajuste de saldo', valor: Math.abs(dif),
    categoria_id: AJUSTES, forma: 'ajuste', cartao_id: '', data: hoje, mes_orcamento: monthOf(hoje),
    fatura_id: '', fatura_manual: false, situacao: 'confirmado', recorrencia_id: '', ocorrencia: null, valor_automatico: false,
  });
  return dif;
}

// ---------- Aprendizado de palavras (N04) ----------
export function palavrasDe(texto) {
  return [...new Set(normalize(texto).split(/[^a-z0-9]+/)
    .filter(w => w.length >= 3 && !STOP.has(w) && !/^\d+$/.test(w)))];
}

export function aprender(S, descricao, catId) {
  if (!catId || catId === AJUSTES || catId === FORA) return;
  palavrasDe(descricao).forEach(p => {
    const ex = S.find('Palavras', p);
    if (ex && ex.categoria_id === catId) S.upsert('Palavras', { ...ex, usos: (ex.usos || 0) + 1 });
    else S.upsert('Palavras', { palavra: p, categoria_id: catId, origem: 'aprendida', usos: 1 });
  });
}

// ---------- Planilha nova ----------
export function seedRows(objToRow, user) {
  const now = new Date().toISOString();
  const track = [user.email, now, user.email, now];
  const hoje = todayISO();
  const config = [['versao_esquema', 1], ['saldo_inicial', ''], ['data_saldo_inicial', hoje], ['criada_em', hoje]];
  const cats = SEED_CATEGORIES.map((c, i) => objToRow('Categorias', {
    id: c.id, nome: c.nome, tipo: c.tipo, repasse: false, dia_transferencia: null, sistema: !!c.sistema, arquivada: false, ordem: i + 1,
    criado_por: track[0], criado_em: track[1], alterado_por: track[2], alterado_em: track[3],
  }));
  const pals = [];
  SEED_CATEGORIES.forEach(c => c.palavras.forEach(p => pals.push(objToRow('Palavras', {
    palavra: normalize(p), categoria_id: c.id, origem: 'inicial', usos: 0,
    criado_por: track[0], criado_em: track[1], alterado_por: track[2], alterado_em: track[3],
  }))));
  return { Config: config, Categorias: cats, Palavras: pals };
}
