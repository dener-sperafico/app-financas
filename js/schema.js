// Estrutura da planilha (aba Planilha do documento do projeto).
const TRACK = ['criado_por', 'criado_em', 'alterado_por', 'alterado_em'];

export const SHEETS = {
  Config: ['chave', 'valor'],
  Cartoes: ['id', 'nome', 'titular', 'dia_fechamento', 'dia_vencimento', 'ativo', ...TRACK],
  Categorias: ['id', 'nome', 'tipo', 'repasse', 'dia_transferencia', 'sistema', 'arquivada', 'ordem', ...TRACK],
  Palavras: ['palavra', 'categoria_id', 'origem', 'usos', ...TRACK],
  Orcamento: ['categoria_id', 'mes', 'valor', 'origem', ...TRACK],
  Lancamentos: ['id', 'tipo', 'descricao', 'valor', 'categoria_id', 'forma', 'cartao_id', 'data', 'mes_orcamento',
    'fatura_id', 'fatura_manual', 'situacao', 'recorrencia_id', 'ocorrencia', 'valor_automatico', ...TRACK],
  Recorrencias: ['id', 'repeticao', 'total_ocorrencias', 'data_inicio', 'encerrada_em', 'valor_total',
    'tipo', 'descricao', 'valor', 'categoria_id', 'forma', 'cartao_id', ...TRACK],
  Faturas: ['id', 'cartao_id', 'mes', 'data_fechamento', 'data_vencimento', 'situacao', 'data_pagamento', ...TRACK],
};

export const SHEET_NAMES = Object.keys(SHEETS);

// Chave única de cada registro, por aba.
export const KEY = {
  Config: r => r.chave,
  Cartoes: r => r.id,
  Categorias: r => r.id,
  Palavras: r => r.palavra,
  Orcamento: r => `${r.categoria_id}|${r.mes}`,
  Lancamentos: r => r.id,
  Recorrencias: r => r.id,
  Faturas: r => r.id,
};

const NUMBERS = new Set(['valor', 'valor_total', 'dia_fechamento', 'dia_vencimento', 'dia_transferencia',
  'ordem', 'usos', 'ocorrencia', 'total_ocorrencias']);
const BOOLS = new Set(['ativo', 'repasse', 'sistema', 'arquivada', 'fatura_manual', 'valor_automatico']);

// Linha da planilha (array) -> objeto
export function rowToObj(sheet, values) {
  const cols = SHEETS[sheet];
  const o = {};
  cols.forEach((c, i) => {
    let v = values[i];
    if (v === undefined || v === null) v = '';
    if (NUMBERS.has(c)) {
      if (v === '') o[c] = null;
      else {
        const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'));
        o[c] = Number.isFinite(n) ? n : null;
      }
    } else if (BOOLS.has(c)) {
      o[c] = v === true || String(v).toUpperCase() === 'SIM' || String(v).toUpperCase() === 'TRUE';
    } else {
      o[c] = String(v).trim();
    }
  });
  return o;
}

// Objeto -> linha da planilha (array)
export function objToRow(sheet, o) {
  return SHEETS[sheet].map(c => {
    const v = o[c];
    if (BOOLS.has(c)) return v ? 'SIM' : 'NÃO';
    if (v === null || v === undefined) return '';
    if (NUMBERS.has(c)) return Number(v);
    return String(v);
  });
}

export function isValidRow(sheet, o) {
  const key = KEY[sheet](o);
  if (!key || key.includes('undefined')) return false;
  if (sheet === 'Lancamentos') return o.valor !== null && !!o.data && !!o.categoria_id && !!o.tipo;
  if (sheet === 'Orcamento') return o.valor !== null && /^\d{4}-\d{2}$/.test(o.mes);
  return true;
}

// Categorias sugeridas para uma planilha nova, com as palavras iniciais.
export const SEED_CATEGORIES = [
  { id: 'cat_salario', nome: 'Salário', tipo: 'entrada', palavras: ['salario', 'pagamento', 'holerite'] },
  { id: 'cat_outras_entradas', nome: 'Outras entradas', tipo: 'entrada', palavras: ['venda', 'reembolso', 'recebido'] },
  { id: 'cat_resgate', nome: 'Resgate de investimento', tipo: 'entrada', palavras: ['resgate'] },
  { id: 'cat_moradia', nome: 'Moradia', tipo: 'saida', palavras: ['aluguel', 'condominio', 'luz', 'agua', 'internet', 'gas'] },
  { id: 'cat_mercado', nome: 'Mercado', tipo: 'saida', palavras: ['mercado', 'supermercado', 'feira', 'padaria', 'hortifruti'] },
  { id: 'cat_transporte', nome: 'Transporte', tipo: 'saida', palavras: ['gasolina', 'posto', 'combustivel', 'uber', 'estacionamento', 'pedagio'] },
  { id: 'cat_restaurantes', nome: 'Restaurantes', tipo: 'saida', palavras: ['jantar', 'almoco', 'restaurante', 'ifood', 'lanche', 'cafe'] },
  { id: 'cat_saude', nome: 'Saúde', tipo: 'saida', palavras: ['farmacia', 'consulta', 'exame', 'medico', 'dentista'] },
  { id: 'cat_assinaturas', nome: 'Assinaturas', tipo: 'saida', palavras: ['assinatura', 'streaming', 'netflix', 'spotify'] },
  { id: 'cat_lazer', nome: 'Lazer', tipo: 'saida', palavras: ['cinema', 'show', 'viagem', 'passeio'] },
  { id: 'cat_compras', nome: 'Compras', tipo: 'saida', palavras: ['roupa', 'loja', 'presente'] },
  { id: 'cat_reserva', nome: 'Reserva de emergência', tipo: 'investimento', palavras: ['aporte', 'reserva', 'investimento'] },
  { id: 'cat_ajustes', nome: 'Ajustes', tipo: 'saida', sistema: true, palavras: [] },
];
