// App de finanças do casal — telas e navegação.
import { GoogleBackend, AuthError } from './google.js?v=5';
import { MockBackend } from './mock.js?v=5';
import { Store } from './store.js?v=5';
import { objToRow } from './schema.js?v=5';
import * as M from './model.js?v=5';
import { interpretar, previstoParecido } from './parser.js?v=5';
import {
  todayISO, monthOf, monthName, lastDayOfMonth, dateOf, parseISO, addDays, monthShort, fmtDate, money, esc, parseMoney, addMonthKey, daysBetween, round2, uid, slug, normalize,
} from './util.js?v=5';

const params = new URLSearchParams(location.search);
const DEMO = params.has('demo');
const B = DEMO ? new MockBackend() : new GoogleBackend();
const S = new Store(B);
const ui = { modal: null, toast: null, busy: false, found: null, msg: null, sheetError: null, bootError: null, search: '', lastRoute: null, pendingRender: false };
const hoje = () => todayISO();

// ---------- Navegação ----------
function route() {
  const h = location.hash.replace(/^#\/?/, '');
  const [path, qs] = h.split('?');
  const parts = path.split('/');
  return { name: parts[0] || '', arg: parts[1] || '', arg2: parts[2] || '', q: new URLSearchParams(qs || '') };
}
const go = h => { if (location.hash === h) render(); else location.hash = h; };

// Histórico de telas desta sessão, para o botão Voltar saber se pode voltar de verdade.
const NAV_KEY = 'af_nav';
let navStack = [];
try { navStack = JSON.parse(sessionStorage.getItem(NAV_KEY) || '[]'); } catch { navStack = []; }
let navReplace = false;
function trackNav() {
  const h = location.hash || '#/inicio';
  if (navReplace) { navStack[navStack.length - 1] = h; navReplace = false; }
  else if (navStack[navStack.length - 2] === h) navStack.pop();
  else if (navStack[navStack.length - 1] !== h) navStack.push(h);
  if (navStack.length > 50) navStack = navStack.slice(-50);
  try { sessionStorage.setItem(NAV_KEY, JSON.stringify(navStack)); } catch { /* ignora */ }
}
trackNav();
// Troca de mês dentro da mesma tela: não empilha.
const swap = h => { navReplace = true; location.replace(h); };
const backBtn = fallback => `<button class="back" data-act="back" data-href="${fallback}" aria-label="Voltar"><span aria-hidden="true">‹</span> Voltar</button>`;

const ICON = {
  inicio: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/></svg>',
  lancamentos: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>',
  mes: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>',
  mais: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/></svg>',
};

// ---------- Renderização ----------
const $ = sel => document.querySelector(sel);

function render() {
  const a = document.activeElement;
  if (a && $('#main')?.contains(a) && ['INPUT', 'SELECT', 'TEXTAREA'].includes(a.tagName) && !ui.forceRender) {
    ui.pendingRender = true; // não apaga o que a pessoa está digitando
    return;
  }
  ui.forceRender = false;
  ui.pendingRender = false;
  const r = guard(route());
  const hasComposer = ['inicio', 'lancamentos'].includes(r.name);
  $('#main').className = 'shell' + (hasComposer ? ' with-composer' : '');
  $('#main').innerHTML = screen(r);
  const showNav = !['login', 'setup'].includes(r.name);
  $('#nav').innerHTML = showNav ? nav(r) : '';
  const routeKey = r.name;
  if (ui.lastRoute !== routeKey) {
    $('#composer').innerHTML = hasComposer ? composer() : '';
    ui.lastRoute = routeKey;
  }
  $('#toast').innerHTML = ui.toast ? `<div class="toast" role="status">${esc(ui.toast)}</div>` : '';
}
document.addEventListener('focusout', () => setTimeout(() => { if (ui.pendingRender) render(); }, 50));

function guard(r) {
  if (!S.user && r.name !== 'login') return { name: 'login', arg: '', q: r.q };
  if (S.user && !S.spreadsheet && r.name !== 'setup') return { name: 'setup', arg: 'planilha', q: r.q };
  if (S.user && r.name === 'login') return { name: S.spreadsheet ? 'inicio' : 'setup', arg: 'planilha', q: r.q };
  if (!r.name) return { name: 'inicio', arg: '', q: r.q };
  return r;
}

function screen(r) {
  switch (r.name) {
    case 'login': return scrLogin();
    case 'setup': return scrSetup(r.arg || 'planilha');
    case 'inicio': return scrInicio();
    case 'lancamentos': return scrLancamentos(r.q);
    case 'mes': return r.arg2 ? scrMesCategoria(r.arg, r.arg2) : scrMes(r.arg || monthOf(hoje()));
    case 'pendentes': return scrPendentes();
    case 'mais': return scrMais();
    case 'cartoes': return scrCartoes();
    case 'cartao': return scrCartao(r.arg);
    case 'categorias': return scrCategorias();
    case 'saldo': return scrSaldo();
    default: return scrInicio();
  }
}

function nav(r) {
  const tab = (name, label, href) => `<a href="${href}" class="${r.name === name || (name === 'mais' && ['cartoes', 'cartao', 'categorias', 'saldo'].includes(r.name)) ? 'on' : ''}">${ICON[name]}<span>${label}</span></a>`;
  return `<nav class="tabs" aria-label="Navegação principal">${tab('inicio', 'Início', '#/inicio')}${tab('lancamentos', 'Lançamentos', '#/lancamentos')}${tab('mes', 'Mês', '#/mes')}${tab('mais', 'Mais', '#/mais')}</nav>`;
}

function composer() {
  return `<div class="composer"><form data-form="composer" autocomplete="off">
    <label for="cmp" class="hidden">Novo lançamento</label>
    <input id="cmp" name="t" placeholder="Ex.: mercado 150 pix" enterkeyhint="send" />
    <button type="submit">Lançar</button></form></div>`;
}

function toast(msg) {
  ui.toast = msg; render();
  clearTimeout(ui._tt); ui._tt = setTimeout(() => { ui.toast = null; $('#toast').innerHTML = ''; }, 3200);
}

// ---------- Avisos no topo ----------
function banners() {
  const out = [];
  const st = S.status, q = S.queue.length;
  if (DEMO) out.push(`<div class="banner info"><span>Modo demonstração: os dados ficam só neste navegador.</span></div>`);
  if (ui.sheetError === 'notfound') out.push(`<div class="banner err"><span>A planilha não foi encontrada: foi apagada, movida para a lixeira ou deixou de ser compartilhada com você.</span><a class="btn" href="#/mais">Opções</a></div>`);
  if (ui.sheetError === 'noperm') out.push(`<div class="banner err"><span>Sua conta pode ver a planilha, mas não editar. Peça para compartilharem com permissão de edição.</span></div>`);
  if (!st.online) out.push(`<div class="banner warn"><span>Sem internet${q ? ` · ${q} ${q === 1 ? 'alteração aguardando' : 'alterações aguardando'} envio` : ''}. Lançar continua funcionando.</span></div>`);
  else if (st.authNeeded && auth.falhou) out.push(`<div class="banner warn"><span>A conexão com o Google expirou${q ? ` · ${q} aguardando envio` : ''}.</span><button class="btn" data-act="reconnect">Reconectar</button></div>`);
  else if (st.error) out.push(`<div class="banner err"><span>Não foi possível sincronizar: ${esc(st.error)}</span><button class="btn" data-act="sync">Tentar de novo</button></div>`);
  else if (q && S.syncing) out.push(`<div class="banner info"><span>Enviando ${q} ${q === 1 ? 'alteração' : 'alterações'} para a planilha…</span></div>`);
  S.notices.forEach(n => out.push(`<div class="banner info"><span>${esc(n.text)}</span><button class="btn" data-act="notice-ok" data-id="${n.id}">Ok</button></div>`));
  if (S.s.invalid) out.push(`<div class="banner warn"><span>${S.s.invalid} linha(s) da planilha foram ignoradas por estarem incompletas.</span></div>`);
  return out.join('');
}

// ---------- Entrar ----------
function scrLogin() {
  return `<div class="login">
    <div class="logo" aria-hidden="true">R$</div>
    <h1>Finanças do casal</h1>
    <p class="muted">Os dados ficam numa planilha Google no seu Drive. O app não guarda seus dados em outro lugar.</p>
    ${ui.bootError ? `<div class="banner err">${esc(ui.bootError)}</div>` : ''}
    <button class="btn primary block" data-act="login" ${ui.busy ? 'disabled' : ''}>${ui.busy ? 'Entrando…' : 'Entrar com Google'}</button>
    <p class="small muted">Só contas Google autorizadas conseguem entrar.</p>
    ${ui.msg ? `<div class="banner err">${esc(ui.msg)}</div>` : ''}
    ${DEMO ? '<p class="small muted">Modo demonstração: nada é enviado ao Google.</p>' : ''}
  </div>`;
}

// ---------- Primeiro acesso ----------
const STEPS = ['planilha', 'saldo', 'cartoes', 'orcamento', 'compartilhar'];
function steps(cur) {
  const i = STEPS.indexOf(cur);
  const configurado = S.spreadsheet && S.get('Lancamentos').length;
  return `${configurado && navStack.length > 1 ? `<div class="top">${backBtn('#/mais')}</div>` : ''}<div class="steps" aria-label="Etapa ${i + 1} de ${STEPS.length}">${STEPS.map((_, k) => `<i class="${k <= i ? 'on' : ''}"></i>`).join('')}</div>
    <div class="small muted">Etapa ${i + 1} de ${STEPS.length}</div>`;
}

function scrSetup(step) {
  if (step !== 'planilha' && !S.spreadsheet) step = 'planilha';
  const skip = next => `<a class="btn link" href="#/setup/${next}">Pular por agora</a>`;
  if (step === 'planilha') {
    if (ui.found === null && !ui.busy) loadFound();
    const found = ui.found || [];
    return `${steps('planilha')}
      <div class="top"><h1>Onde ficam os dados?</h1></div>
      <div class="stack">
        ${found.length ? `<div class="section-title">Planilhas suas que o app já usa</div>
          <div class="list">${found.map(f => `<button class="item" data-act="open-sheet" data-id="${esc(f.id)}" data-name="${esc(f.name)}"><span><span class="t">${esc(f.name)}</span><br><span class="s">Continuar com esta planilha</span></span><span aria-hidden="true">›</span></button>`).join('')}</div>` : ''}
        <div class="card stack">
          <div><h2>Criar planilha nova</h2><p class="muted small">Já vem estruturada, com categorias sugeridas. Fica no seu Drive.</p></div>
          <button class="btn primary" data-act="create-sheet" ${ui.busy ? 'disabled' : ''}>Criar planilha nova</button>
        </div>
        <div class="card stack">
          <div><h2>Abrir planilha compartilhada comigo</h2><p class="muted small">Para quem vai usar a planilha que o cônjuge criou e compartilhou pelo Google Drive.</p></div>
          <button class="btn" data-act="pick-sheet" ${ui.busy ? 'disabled' : ''}>Escolher no Google Drive</button>
        </div>
        ${ui.busy ? '<p class="muted">Aguarde…</p>' : ''}
        ${ui.msg ? `<div class="banner err">${esc(ui.msg)}</div>` : ''}
        <p class="small muted">Cada planilha é independente. Ninguém vê dados de outra planilha.</p>
      </div>`;
  }
  if (step === 'saldo') {
    const v = M.cfg(S, 'saldo_inicial');
    return `${steps('saldo')}
      <div class="top"><h1>Quanto tem hoje na conta do casal?</h1></div>
      <form class="stack" data-form="setup-saldo">
        <label class="field"><span>Saldo em ${fmtDate(hoje(), true)}</span><input name="saldo" inputmode="decimal" placeholder="0,00" value="${v !== '' && v !== undefined ? esc(String(v).replace('.', ',')) : ''}" required></label>
        <p class="small muted">É o ponto de partida, antes dos lançamentos de hoje. Daqui em diante o saldo só muda com lançamentos confirmados. Orçamento não mexe no saldo.</p>
        <div class="btns">${skip('cartoes')}<button class="btn primary">Continuar</button></div>
      </form>`;
  }
  if (step === 'cartoes') {
    return `${steps('cartoes')}
      <div class="top"><h1>Cartões de crédito</h1></div>
      <div class="stack">
        ${M.cartoes(S).length ? `<div class="list">${M.cartoes(S).map(c => `<div class="item"><span><span class="t">${esc(c.nome)}</span><br><span class="s">${esc(c.titular)} · fecha dia ${c.dia_fechamento} · vence dia ${c.dia_vencimento}</span></span></div>`).join('')}</div>` : '<p class="muted">Nenhum cartão ainda.</p>'}
        ${cardForm(null, 'setup-cartao')}
        <div class="btns">${skip('orcamento')}<a class="btn primary" href="#/setup/orcamento">Continuar</a></div>
      </div>`;
  }
  if (step === 'orcamento') {
    const mes = monthOf(hoje());
    return `${steps('orcamento')}
      <div class="top"><h1>Orçamento de ${monthName(mes)}</h1></div>
      <form class="stack" data-form="setup-orcamento">
        <p class="small muted">Quanto planejam por categoria neste mês. Deixe vazio o que não se aplica. Orçado não mexe no saldo atual.</p>
        ${orcamentoInputs(mes)}
        <div class="btns" style="flex-direction:column">
          <button class="btn primary" name="modo" value="repetir">Salvar e repetir nos próximos 12 meses</button>
          <button class="btn" name="modo" value="so">Salvar só para ${monthName(mes)}</button>
          ${skip('compartilhar')}
        </div>
      </form>`;
  }
  // compartilhar
  return `${steps('compartilhar')}
    <div class="top"><h1>Usar junto com o cônjuge</h1></div>
    <div class="stack">
      <div class="card stack">
        <div>1. Abra a planilha no Google Drive.</div>
        <div>2. Clique em <b>Compartilhar</b> e informe o e-mail dele ou dela, com permissão de <b>Editor</b>.</div>
        <div>3. A pessoa entra no app com a conta Google dela e escolhe <b>Abrir planilha compartilhada comigo</b>.</div>
        ${sheetLink('Abrir a planilha no Google Drive')}
      </div>
      <p class="small muted">Cada lançamento registra quem fez. A pessoa também precisa estar na lista de usuários de teste do Google Cloud.</p>
      <a class="btn primary" href="#/inicio">Concluir</a>
    </div>`;
}

function sheetLink(label) {
  if (!S.spreadsheet) return '';
  if (DEMO) return '<p class="small muted">(No modo demonstração não há planilha real.)</p>';
  return `<a class="btn" target="_blank" rel="noopener" href="https://docs.google.com/spreadsheets/d/${esc(S.spreadsheet.id)}/edit">${label}</a>`;
}

function orcamentoInputs(mes) {
  const grupo = (tipo, titulo) => {
    const cs = M.categorias(S, { tipo }).filter(c => !c.sistema);
    if (!cs.length) return '';
    return `<div class="section-title">${titulo}</div><div class="card stack">${cs.map(c => {
      const v = M.orcado(S, c.id, mes);
      return `<label class="field"><span>${esc(c.nome)}${c.repasse ? ' · repasse' : ''}</span><input name="o_${esc(c.id)}" inputmode="decimal" placeholder="—" value="${v !== null ? esc(String(v).replace('.', ',')) : ''}"></label>`;
    }).join('')}</div>`;
  };
  return grupo('saida', 'Saídas') + grupo('investimento', 'Investimentos') + grupo('entrada', 'Entradas');
}

async function loadFound() {
  if (!B.hasToken()) { ui.found = []; return; }
  ui.found = [];
  try { ui.found = await B.findSpreadsheets(); } catch (e) { handleError(e); }
  ui.forceRender = true; render();
}

// ---------- Início ----------
function scrInicio() {
  const mes = monthOf(hoje());
  const pend = M.pendentes(S);
  const saldo = M.saldoAtual(S);
  const fd = M.fechamentoDetalhe(S);
  const res = M.resumoMes(S, mes);
  const atencao = res.linhas.filter(x => x.categoria.tipo !== 'entrada' && !x.categoria.sistema && x.orcado && x.uso >= 0.8)
    .sort((a, b) => b.uso - a.uso);
  const ultimos = S.get('Lancamentos').filter(l => l.situacao === 'confirmado').slice().sort((a, b) => (b.criado_em || '').localeCompare(a.criado_em || '')).slice(0, 5);
  const semSaldo = M.cfg(S, 'saldo_inicial') === '' || M.cfg(S, 'saldo_inicial') === undefined;
  const semOrc = !S.get('Orcamento').some(o => o.mes === mes);
  const nome = S.user?.name || '';
  return `${banners()}
    <div class="top"><div><div class="muted small">Olá, ${esc(nome)}</div><h1>${cap(monthName(mes))}</h1></div></div>
    <div class="stack">
      ${pend.length ? `<div class="card alert stack">
        <div class="row"><b>${pend.length} ${pend.length === 1 ? 'pendente' : 'pendentes'} · mais antigo há ${Math.max(0, daysBetween(pend[0].data, hoje()))} dia(s)</b><a class="btn link" href="#/pendentes">Ver todos</a></div>
        ${pend.slice(0, 3).map(pendRow).join('')}
        <div class="small">Continuam contando na previsão até vocês decidirem.</div>
      </div>` : ''}
      ${semSaldo || semOrc ? `<div class="card info stack"><b>Complete a configuração</b>
        ${semSaldo ? '<a href="#/setup/saldo">Informar o saldo atual</a>' : ''}
        ${semOrc ? `<a href="#/setup/orcamento">Orçar ${monthName(mes, false)}</a>` : ''}
        ${!M.cartoes(S).length ? '<a href="#/setup/cartoes">Cadastrar cartões</a>' : ''}</div>` : ''}
      <a class="card" href="#/saldo" style="text-decoration:none;color:inherit"><div class="row"><div><div class="label">Saldo atual</div><div class="big num ${saldo < 0 ? 'neg' : ''}">${money(saldo)}</div><div class="small muted">O que está na conta hoje: só lançamentos confirmados</div></div><span aria-hidden="true">›</span></div></a>
      ${previsaoCard(fd, res, mes)}
      ${atencao.length ? `<div class="card stack"><div class="label">Atenção no mês</div>${atencao.slice(0, 4).map(x => `<div class="row"><span>${esc(x.categoria.nome)} · ${x.uso > 1 ? '<span class="badge est">estourou</span>' : `${Math.round(x.uso * 100)}% usado`}</span><span class="num ${x.disponivel < 0 ? 'neg' : ''}">${x.disponivel < 0 ? '− ' + money(-x.disponivel) : 'restam ' + money(x.disponivel)}</span></div>`).join('')}</div>` : ''}
      <div class="section-title">Atalhos</div>
      <div class="grid2">
        <a class="btn" href="#/pendentes">Pendentes</a>
        <a class="btn" href="#/mes">Orçamento do mês</a>
        <a class="btn" href="#/cartoes">Faturas dos cartões</a>
        <a class="btn" href="#/saldo">Ajustar saldo</a>
      </div>
      ${ultimos.length ? `<div class="section-title">Últimos lançamentos</div><div class="list">${ultimos.map(lancItem).join('')}</div>` : '<p class="muted">Nenhum lançamento ainda. Experimente escrever no campo abaixo: <b>mercado 150 pix</b>.</p>'}
    </div>`;
}

const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

// Card único: quanto deve sobrar no fim do mês, de onde vem esse número e como estão as saídas.
function previsaoCard(fd, res, mes) {
  const linha = (rot, v, sinal) => v ? `<div class="kv"><span>${sinal} ${rot}</span><span class="num">${money(v)}</span></div>` : '';
  const sa = res.saidas;
  const usado = round2(sa.realizado + sa.previsto);
  const pct = sa.orcado ? Math.min(100, Math.round((usado / sa.orcado) * 100)) : 0;
  const cls = sa.orcado && usado > sa.orcado ? 'over' : pct >= 80 ? 'near' : '';
  return `<a class="card stack" href="#/mes" style="text-decoration:none;color:inherit">
    <div class="row"><div><div class="label">Previsão para ${fmtDate(fd.fim)}</div><div class="big num ${fd.total < 0 ? 'neg' : ''}">${money(fd.total)}</div><div class="small muted">Quanto deve sobrar na conta no fim de ${monthName(mes, false)}</div></div><span aria-hidden="true">›</span></div>
    <div class="calc">
      <div class="kv"><span>Saldo atual</span><span class="num">${money(fd.saldo)}</span></div>
      ${linha('A receber', fd.receber, '+')}
      ${linha('Contas previstas', fd.pagar, '−')}
      ${linha('Faturas a pagar', fd.faturas, '−')}
      ${linha('Orçado que ainda pode ser gasto', fd.reservado, '−')}
      <div class="kv total"><span>= Previsão</span><span class="num">${money(fd.total)}</span></div>
    </div>
    ${sa.orcado ? `<div><div class="row small"><b>Saídas de ${monthName(mes, false)}</b><span class="num">${money(usado)} de ${money(sa.orcado)}</span></div>
      <div class="bar ${cls}"><i style="width:${pct}%"></i></div>
      <div class="small muted" style="margin-top:4px">Ainda cabe ${money(sa.livre)} no orçado${sa.estouradas ? ` · ${sa.estouradas} ${sa.estouradas === 1 ? 'categoria passou' : 'categorias passaram'} ${money(sa.acima)}` : ''}</div></div>` : ''}
  </a>`;
}
const lastDay = mes => lastDayOfMonth(mes);

function pendRow(p) {
  if (p.kind === 'fatura') {
    const c = M.cartao(S, p.item.cartao_id);
    return `<div class="row" style="border-top:1px solid #f0c78a;padding-top:8px"><span><b>Fatura ${esc(c ? c.nome : '')}</b> · ${monthName(p.item.mes, false)}<br><span class="small">${money(p.item.total)} · venceu ${fmtDate(p.item.data_vencimento)}</span></span>
      <span class="btns" style="flex:none"><button class="btn primary" data-act="pagar-fatura" data-id="${esc(p.item.id)}">Confirmar</button><button class="btn" data-act="fatura" data-id="${esc(p.item.id)}">Editar</button></span></div>`;
  }
  const l = p.item;
  return `<div class="row" style="border-top:1px solid #f0c78a;padding-top:8px"><span><b>${esc(l.descricao)}</b><br><span class="small">${money(l.valor)} · ${fmtDate(l.data)} · há ${Math.max(0, daysBetween(l.data, hoje()))} dia(s)</span></span>
    <span class="btns" style="flex:none"><button class="btn primary" data-act="confirmar" data-id="${esc(l.id)}">Confirmar</button><button class="btn" data-act="editar" data-id="${esc(l.id)}">Editar</button></span></div>`;
}

function lancItem(l) {
  const c = M.categoria(S, l.categoria_id);
  const card = l.cartao_id ? M.cartao(S, l.cartao_id) : null;
  const naFila = S.queue.some(q => q.sheet === 'Lancamentos' && q.key === l.id);
  const pend = l.situacao === 'previsto' && l.data <= hoje();
  const badge = naFila ? '<span class="badge envio">aguardando envio</span>' : pend ? '<span class="badge pend">pendente</span>' : l.situacao === 'previsto' ? '<span class="badge prev">previsto</span>' : '';
  const sub = [fmtDate(l.data), c ? c.nome : '', card ? card.nome : M.formaNome(l.forma)];
  if (card && l.mes_orcamento !== monthOf(l.data)) sub.push(`conta em ${monthName(l.mes_orcamento, false)}`);
  if (l.ocorrencia) {
    const rec = S.find('Recorrencias', l.recorrencia_id);
    sub.push(rec && rec.total_ocorrencias ? `${l.ocorrencia} de ${rec.total_ocorrencias}` : `${l.ocorrencia}ª`);
  }
  const quem = l.criado_por && S.user && l.criado_por !== S.user.email ? ` · ${esc(l.criado_por.split('@')[0])}` : '';
  return `<button class="item" data-act="editar" data-id="${esc(l.id)}">
    <span><span class="t">${esc(l.descricao)}</span> ${badge}<br><span class="s">${esc(sub.filter(Boolean).join(' · '))}${quem}</span></span>
    <span class="r num ${l.tipo === 'entrada' ? 'pos' : ''}">${l.tipo === 'entrada' ? '+ ' : ''}${money(l.valor)}</span></button>`;
}

// ---------- Lançamentos ----------
function scrLancamentos(q) {
  const mes = q.get('mes') || monthOf(hoje());
  const cat = q.get('cat');
  const link = (m) => `#/lancamentos?mes=${m}${cat ? '&cat=' + cat : ''}`;
  return `${banners()}
    <div class="top">${cat ? backBtn(`#/mes/${mes}`) : ''}<h1>Lançamentos</h1><span></span></div>
    <div class="row" style="margin-bottom:10px"><a class="btn" href="${link(addMonthKey(mes, -1))}" data-swap aria-label="Mês anterior">‹</a><b>${cap(monthName(mes))}</b><a class="btn" href="${link(addMonthKey(mes, 1))}" data-swap aria-label="Mês seguinte">›</a></div>
    ${cat ? `<div class="banner info"><span>Categoria: <b>${esc(M.categoria(S, cat)?.nome || '')}</b> · pelo mês do orçamento</span><a class="btn" href="#/lancamentos?mes=${mes}">Limpar</a></div>` : ''}
    <label class="field" style="margin-bottom:12px"><span class="hidden">Buscar</span><input data-search placeholder="Buscar por texto" value="${esc(ui.search)}"></label>
    <div id="lanc-list">${lancList(mes, cat)}</div>`;
}

function lancList(mes, cat) {
  const s = normalize(ui.search);
  let ls = S.get('Lancamentos').filter(l => (cat ? l.categoria_id === cat && l.mes_orcamento === mes : monthOf(l.data) === mes));
  if (s) ls = ls.filter(l => normalize(`${l.descricao} ${M.categoria(S, l.categoria_id)?.nome || ''}`).includes(s));
  ls.sort((a, b) => b.data.localeCompare(a.data) || (b.criado_em || '').localeCompare(a.criado_em || ''));
  if (!ls.length) return '<p class="muted">Nenhum lançamento neste mês.</p>';
  const pend = ls.filter(l => l.situacao === 'previsto' && l.data <= hoje());
  const resto = ls.filter(l => !pend.includes(l));
  return (pend.length ? `<div class="section-title">Pendentes</div><div class="list">${pend.map(lancItem).join('')}</div>` : '')
    + `<div class="section-title">${cat ? 'Lançamentos' : 'Por data'}</div><div class="list">${resto.map(lancItem).join('')}</div>`;
}

// ---------- Pendentes ----------
function scrPendentes() {
  const pend = M.pendentes(S);
  return `${banners()}
    <div class="top">${backBtn('#/inicio')}</div>
    <h1>Pendentes (${pend.length})</h1>
    <p class="muted small">A data já passou e ainda não foram confirmados. Continuam contando na previsão até vocês decidirem. Para adiar, edite a data; para cancelar, exclua.</p>
    ${pend.length ? `<div class="card stack">${pend.map(pendRow).join('')}</div>` : '<p class="muted">Nada pendente.</p>'}`;
}

// ---------- Mês ----------
function scrMes(mes) {
  const res = M.resumoMes(S, mes);
  const grupo = (tipo, titulo) => {
    const todas = res.linhas.filter(x => x.categoria.tipo === tipo && (!x.categoria.sistema || x.realizado || x.previsto));
    const vazias = todas.filter(x => x.orcado === null && !x.realizado && !x.previsto);
    const ls = todas.filter(x => !vazias.includes(x))
      .sort((a, b) => (b.disponivel < 0) - (a.disponivel < 0) || (b.uso === Infinity ? 9 : b.uso) - (a.uso === Infinity ? 9 : a.uso));
    if (!todas.length) return '';
    const semOrc = vazias.length ? `<div class="small muted" style="margin-top:8px">Sem orçado neste mês: ${vazias.map(x => `<a class="btn link small" href="#/mes/${mes}/${esc(x.categoria.id)}">${esc(x.categoria.nome)}</a>`).join(' · ')}</div>` : '';
    if (!ls.length) return `<div class="section-title">${titulo}</div>${semOrc}`;
    return `<div class="section-title">${titulo}</div><div class="list">${ls.map(x => {
      const c = x.categoria;
      const usado = x.realizado + x.previsto;
      const pct = x.orcado ? Math.min(100, Math.round((usado / x.orcado) * 100)) : (usado ? 100 : 0);
      const est = tipo !== 'entrada' && x.disponivel < 0 && x.orcado !== null;
      const cls = est ? 'over' : (x.uso >= 0.8 && tipo !== 'entrada' ? 'near' : '');
      const right = tipo === 'entrada'
        ? `<span class="num">${money(x.realizado)}</span><br><span class="s">de ${x.orcado !== null ? money(x.orcado) : '—'}</span>`
        : x.orcado === null ? `<span class="s">sem orçado</span>` : `<span class="num ${est ? 'neg' : ''}">${est ? '− ' + money(-x.disponivel) : money(x.disponivel)}</span><br><span class="s">${est ? 'acima' : 'disponível'}</span>`;
      return `<a class="item" href="#/mes/${mes}/${esc(c.id)}">
        <span style="flex:1;min-width:0"><span class="t">${esc(c.nome)}</span> ${est ? `<span class="badge est">estourou</span>` : ''}${c.repasse ? ' <span class="badge prev">repasse</span>' : ''}
        <br><span class="s">orçado ${x.orcado !== null ? money(x.orcado) : '—'} · realizado ${money(x.realizado)} · previsto ${money(x.previsto)}</span>
        <div class="bar ${cls}"><i style="width:${pct}%"></i></div></span>
        <span class="r">${right}</span></a>`;
    }).join('')}</div>${semOrc}`;
  };
  return `${banners()}
    <div class="row" style="margin-bottom:14px"><a class="btn" href="#/mes/${addMonthKey(mes, -1)}" data-swap aria-label="Mês anterior">‹</a><h1>${cap(monthName(mes))}</h1><a class="btn" href="#/mes/${addMonthKey(mes, 1)}" data-swap aria-label="Mês seguinte">›</a></div>
    ${resumoCard(res, mes)}
    <p class="small muted">Compras no cartão contam no mês da fatura. A sobra do orçado não passa para o mês seguinte. Toque numa categoria para ver os lançamentos dela.</p>
    ${grupo('saida', 'Saídas')}${grupo('investimento', 'Investimentos')}${grupo('entrada', 'Entradas')}`;
}

// Resumo do mês: o que foi planejado, o que já aconteceu e o que ainda está previsto.
function resumoCard(res, mes) {
  const n = v => money(v).replace(/^R\$\s?/, '');
  const row = (rot, o, r, p) => `<tr><th scope="row">${rot}</th><td class="num">${n(o)}</td><td class="num">${n(r)}</td><td class="num">${n(p)}</td></tr>`;
  const sa = res.saidas;
  return `<div class="card stack">
    <div class="label">Resumo de ${monthName(mes, false)} (R$)</div>
    <table class="resumo">
      <thead><tr><th></th><th scope="col">Orçado</th><th scope="col">Realizado</th><th scope="col">Previsto</th></tr></thead>
      <tbody>
        ${row('Entradas', res.entradas.orcado, res.entradas.realizado, res.entradas.previsto)}
        ${row('Saídas', sa.orcado, sa.realizado, sa.previsto)}
        ${row('Guardado', res.guardadoOrcado, res.guardado, res.guardadoPrevisto)}
      </tbody>
    </table>
    <div class="calc">
      <div class="kv"><span>Sobra planejada <span class="muted small">(entradas − saídas − guardado, pelo orçado)</span></span><span class="num ${res.sobraOrcada < 0 ? 'neg' : ''}">${money(res.sobraOrcada)}</span></div>
      <div class="kv"><span>Sobra projetada <span class="muted small">(considerando o que já passou do orçado)</span></span><span class="num ${res.sobraProjetada < 0 ? 'neg' : ''}">${money(res.sobraProjetada)}</span></div>
      <div class="kv"><span>Ainda cabe gastar nas saídas</span><span class="num">${money(sa.livre)}</span></div>
      ${sa.estouradas ? `<div class="kv"><span class="neg">${sa.estouradas} ${sa.estouradas === 1 ? 'categoria passou' : 'categorias passaram'} do orçado</span><span class="num neg">${money(sa.acima)}</span></div>` : ''}
    </div>
  </div>`;
}

// ---------- Categoria no mês ----------
function scrMesCategoria(mes, catId) {
  const c = M.categoria(S, catId);
  if (!c) return `<div class="top">${backBtn(`#/mes/${mes}`)}</div><p>Categoria não encontrada.</p>`;
  const x = M.catMes(S, catId, mes);
  const entrada = c.tipo === 'entrada';
  const usado = round2(x.realizado + x.previsto);
  const pct = x.orcado ? Math.min(100, Math.round((usado / x.orcado) * 100)) : (usado ? 100 : 0);
  const est = !entrada && x.orcado !== null && x.disponivel < 0;
  const cls = est ? 'over' : (!entrada && x.uso >= 0.8 ? 'near' : '');
  const ls = S.get('Lancamentos').filter(l => l.categoria_id === catId && l.mes_orcamento === mes)
    .sort((a, b) => a.data.localeCompare(b.data));
  const pend = ls.filter(l => l.situacao === 'previsto' && l.data <= hoje() && !(l.forma === 'cartao' && l.recorrencia_id));
  const prev = ls.filter(l => l.situacao === 'previsto' && !pend.includes(l));
  const conf = ls.filter(l => l.situacao === 'confirmado').reverse();
  const bloco = (t, arr) => arr.length ? `<div class="section-title">${t} (${arr.length})</div><div class="list">${arr.map(lancItem).join('')}</div>` : '';
  return `${banners()}
    <div class="top">${backBtn(`#/mes/${mes}`)}<button class="btn" data-act="orcado" data-cat="${esc(catId)}" data-mes="${mes}">${x.orcado === null ? 'Definir orçado' : 'Alterar orçado'}</button></div>
    <div class="row" style="margin-bottom:12px"><a class="btn" href="#/mes/${addMonthKey(mes, -1)}/${esc(catId)}" data-swap aria-label="Mês anterior">‹</a>
      <div style="text-align:center"><h1>${esc(c.nome)}</h1><div class="small muted">${cap(monthName(mes))}</div></div>
      <a class="btn" href="#/mes/${addMonthKey(mes, 1)}/${esc(catId)}" data-swap aria-label="Mês seguinte">›</a></div>
    <div class="card stack">
      <div class="row"><div><div class="label">${entrada ? 'Falta receber' : est ? 'Acima do orçado' : 'Disponível'}</div>
        <div class="big num ${est ? 'neg' : ''}">${entrada ? money(Math.max(0, (x.orcado || 0) - x.realizado)) : x.orcado === null ? '—' : money(Math.abs(x.disponivel))}</div></div>
        ${est ? '<span class="badge est">estourou</span>' : ''}${c.repasse ? '<span class="badge prev">repasse</span>' : ''}</div>
      ${x.orcado !== null ? `<div class="bar ${cls}"><i style="width:${pct}%"></i></div>` : ''}
      <div class="grid3">
        <div><div class="small muted">Orçado</div><div class="num">${x.orcado !== null ? money(x.orcado) : '—'}</div></div>
        <div><div class="small muted">${entrada ? 'Recebido' : 'Realizado'}</div><div class="num">${money(x.realizado)}</div></div>
        <div><div class="small muted">Previsto</div><div class="num">${money(x.previsto)}</div></div>
      </div>
      ${x.orcado === null && !entrada ? '<div class="small muted">Sem orçado neste mês. Toque em "Definir orçado".</div>' : ''}
    </div>
    ${bloco('Pendentes', pend)}${bloco('Previstos', prev)}${bloco(entrada ? 'Recebidos' : 'Realizados', conf)}
    ${!ls.length ? `<p class="muted" style="margin-top:16px">Nenhum lançamento nesta categoria em ${monthName(mes, false)}.</p>` : ''}`;
}

// ---------- Mais ----------
function scrMais() {
  const q = S.queue.length;
  return `${banners()}
    <div class="top"><h1>Mais</h1></div>
    <div class="stack">
      <div class="card stack"><div class="label">Planilha conectada</div>
        <div><b>${esc(S.spreadsheet?.name || '')}</b><br><span class="small muted">Quem acessa é definido no compartilhamento do Google Drive.</span></div>
        ${sheetLink('Abrir no Google Drive')}
        <div class="small muted">Última sincronização: ${S.s.lastSync ? new Date(S.s.lastSync).toLocaleString('pt-BR') : 'ainda não'}${q ? ` · ${q} aguardando envio` : ''}</div>
        <button class="btn" data-act="sync">Sincronizar agora</button>
      </div>
      <div class="list">
        <a class="item" href="#/cartoes"><span class="t">Cartões e faturas</span><span>›</span></a>
        <a class="item" href="#/categorias"><span class="t">Categorias</span><span>›</span></a>
        <a class="item" href="#/saldo"><span class="t">Ajustar saldo real</span><span>›</span></a>
        <a class="item" href="#/setup/orcamento"><span class="t">Orçar o mês atual</span><span>›</span></a>
        <a class="item" href="#/setup/compartilhar"><span class="t">Como compartilhar com o cônjuge</span><span>›</span></a>
      </div>
      <div class="card stack"><div class="label">Conta neste aparelho</div><div>${esc(S.user?.email || '')}</div>
        <button class="btn danger" data-act="logout">Sair e limpar os dados deste aparelho</button>
        <div class="small muted">A planilha no Drive não é alterada.</div></div>
    </div>`;
}

// ---------- Cartões ----------
function cardForm(c, formName) {
  return `<form class="card stack" data-form="${formName}">
    <h2>${c ? 'Editar cartão' : 'Novo cartão'}</h2>
    ${c ? `<input type="hidden" name="id" value="${esc(c.id)}">` : ''}
    <label class="field"><span>Nome (como vai escrever no campo de lançamento)</span><input name="nome" required placeholder="Ex.: Nubank Dener" value="${esc(c?.nome || '')}"></label>
    <label class="field"><span>Titular</span><input name="titular" required value="${esc(c?.titular || '')}"></label>
    <div class="grid2">
      <label class="field"><span>Dia de fechamento</span><input name="fech" type="number" min="1" max="31" required value="${c?.dia_fechamento ?? ''}"></label>
      <label class="field"><span>Dia de vencimento</span><input name="venc" type="number" min="1" max="31" required value="${c?.dia_vencimento ?? ''}"></label>
    </div>
    <p class="small muted">Compra até o dia anterior ao fechamento entra na fatura daquele mês. No dia do fechamento ou depois, vai para a fatura seguinte.</p>
    ${c ? `<label class="check"><input type="checkbox" name="ativo" ${c.ativo ? 'checked' : ''}> Cartão em uso</label>` : ''}
    <button class="btn primary">${c ? 'Salvar' : 'Adicionar cartão'}</button>
  </form>`;
}

function scrCartoes() {
  const cs = M.cartoes(S, true);
  return `${banners()}
    <div class="top">${backBtn('#/mais')}</div>
    <h1>Cartões e faturas</h1>
    <div class="stack" style="margin-top:12px">
      ${cs.length ? `<div class="list">${cs.map(c => {
        const prox = M.faturasDoCartao(S, c.id).find(f => f.situacao !== 'paga' && f.total > 0);
        return `<a class="item" href="#/cartao/${esc(c.id)}"><span><span class="t">${esc(c.nome)}</span>${c.ativo ? '' : ' <span class="badge envio">inativo</span>'}<br><span class="s">${esc(c.titular)} · fecha ${c.dia_fechamento} · vence ${c.dia_vencimento}${prox ? ` · fatura ${monthName(prox.mes, false)} ${money(prox.total)}` : ''}</span></span><span>›</span></a>`;
      }).join('')}</div>` : '<p class="muted">Nenhum cartão cadastrado. Gastos no cartão precisam do cartão para saber em qual fatura e mês contam.</p>'}
      ${cardForm(null, 'cartao')}
    </div>`;
}

function scrCartao(id) {
  const c = M.cartao(S, id);
  if (!c) return `<div class="top">${backBtn('#/cartoes')}</div><p>Cartão não encontrado.</p>`;
  const fats = M.faturasDoCartao(S, id).reverse();
  return `${banners()}
    <div class="top">${backBtn('#/cartoes')}</div>
    <h1>${esc(c.nome)}</h1>
    <div class="section-title">Faturas</div>
    ${fats.length ? `<div class="list">${fats.map(f => `<button class="item" data-act="fatura" data-id="${esc(f.id)}"><span><span class="t">${cap(monthName(f.mes))}</span> ${f.situacao === 'paga' ? '' : (f.data_vencimento <= hoje() && f.total > 0 ? '<span class="badge pend">pendente</span>' : '')}<br><span class="s">fecha ${fmtDate(f.data_fechamento)} · vence ${fmtDate(f.data_vencimento)}${f.situacao === 'paga' ? ` · paga em ${fmtDate(f.data_pagamento)}` : ''}</span></span><span class="r num">${money(f.total)}</span></button>`).join('')}</div>` : '<p class="muted">Nenhuma compra neste cartão ainda.</p>'}
    <div style="margin-top:16px">${cardForm(c, 'cartao')}</div>
    <p class="small muted">Cartão com compras não pode ser apagado: desmarque "Cartão em uso" para tirá-lo das opções.</p>`;
}

// ---------- Categorias ----------
function scrCategorias() {
  const grupo = (tipo, titulo) => {
    const cs = M.categorias(S, { tipo, todas: true }).filter(c => !c.sistema);
    return `<div class="section-title">${titulo}</div><div class="list">${cs.map(c => `<button class="item" data-act="categoria" data-id="${esc(c.id)}"><span><span class="t">${esc(c.nome)}</span>${c.arquivada ? ' <span class="badge envio">arquivada</span>' : ''}${c.repasse ? ' <span class="badge prev">repasse</span>' : ''}<br><span class="s">${esc(S.get('Palavras').filter(p => p.categoria_id === c.id).map(p => p.palavra).slice(0, 6).join(', ') || 'sem palavras')}</span></span><span>›</span></button>`).join('') || '<div class="item muted">Nenhuma</div>'}</div>`;
  };
  return `${banners()}
    <div class="top">${backBtn('#/mais')}<button class="btn primary" data-act="categoria" data-id="">Nova categoria</button></div>
    <h1>Categorias</h1>
    <p class="small muted">As palavras são o que o campo de lançamento usa para sugerir a categoria. Elas também são aprendidas a cada lançamento.</p>
    ${grupo('saida', 'Saídas')}${grupo('investimento', 'Investimentos')}${grupo('entrada', 'Entradas')}`;
}

// ---------- Ajustar saldo ----------
function scrSaldo() {
  const saldo = M.saldoAtual(S);
  const pend = M.pendentes(S);
  return `${banners()}
    <div class="top">${backBtn('#/inicio')}</div>
    <h1>Ajustar saldo</h1>
    <form class="stack" data-form="ajuste" style="margin-top:12px">
      <div class="card"><div class="label">Saldo atual no app</div><div class="big num">${money(saldo)}</div></div>
      <label class="field"><span>Saldo real da conta hoje</span><input name="real" inputmode="decimal" placeholder="0,00" required></label>
      <p class="small muted">A diferença vira um lançamento "Ajuste de saldo" na categoria Ajustes, com a data de hoje.</p>
      ${pend.length ? `<div class="card alert small">Há ${pend.length} pendente(s) não confirmado(s), que não estão no saldo atual. Se já foram pagos, confirme-os antes de ajustar. <a href="#/pendentes">Ver pendentes</a></div>` : ''}
      <button class="btn primary">Ajustar</button>
    </form>`;
}

// ---------- Painéis (lançamento, edição, orçado, fatura, categoria) ----------
function openModal(m) { ui.modal = m; renderModal(); }
function closeModal() { ui.modal = null; renderModal(); }

function renderModal() {
  const m = ui.modal;
  const el = $('#modal');
  if (!m) { el.innerHTML = ''; document.body.style.overflow = ''; return; }
  let html = '';
  if (m.type === 'novo' || m.type === 'editar') html = draftForm(m);
  else if (m.type === 'retorno') html = retorno(m);
  else if (m.type === 'excluir') html = excluirPanel(m);
  else if (m.type === 'orcado') html = orcadoPanel(m);
  else if (m.type === 'fatura') html = faturaPanel(m);
  else if (m.type === 'categoria') html = categoriaPanel(m);
  else if (m.type === 'confirmar') html = confirmPanel(m);
  el.innerHTML = `<div class="modal-bg" data-act="modal-bg"><div class="modal" role="dialog" aria-modal="true">${html}</div></div>`;
  document.body.style.overflow = 'hidden';
  const f = el.querySelector('[autofocus]');
  if (f) f.focus();
}

const head = title => `<div class="mh"><h2>${title}</h2><button class="x" data-act="close" aria-label="Fechar">×</button></div>`;

function faturaPreview(d) {
  if (d.forma !== 'cartao' || !d.cartao_id) return null;
  const card = M.cartao(S, d.cartao_id);
  if (!card || !d.data) return null;
  return M.faturaInfo(card, d.data);
}

function mesDoDraft(d) {
  if (d.forma === 'cartao' && d.cartao_id) {
    if (d.fatura_id) { const f = M.faturaInfoFromId(S, d.fatura_id); if (f) return f.mes; }
    const f = faturaPreview(d);
    if (f) return f.mes;
  }
  return d.data ? monthOf(d.data) : monthOf(hoje());
}

function draftForm(m) {
  const d = m.d;
  const isEdit = m.type === 'editar';
  const tipos = [['saida', 'Saída'], ['entrada', 'Entrada'], ['investimento', 'Investimento']];
  const cats = M.categorias(S, { tipo: d.tipo }).filter(c => !c.sistema || c.id === d.categoria_id);
  const cards = M.cartoes(S);
  const formaVal = d.forma === 'cartao' ? `cartao:${d.cartao_id || ''}` : d.forma;
  const formas = [...M.FORMAS.filter(f => f.id !== 'cartao').map(f => [f.id, f.nome]), ...(d.tipo === 'entrada' ? [] : cards.map(c => [`cartao:${c.id}`, `Cartão · ${c.nome}`]))];
  if (d.forma === 'ajuste') formas.push(['ajuste', 'Ajuste']);
  const precisaCartao = d.forma === 'cartao' && !d.cartao_id;
  const fprev = faturaPreview(d);
  const mes = mesDoDraft(d);
  const needOrc = M.precisaOrcado(S, d.categoria_id, mes) && !(m.dup && d.dup === 'confirmar');
  const cat = M.categoria(S, d.categoria_id);
  const e = m.errors || {};
  let fatOpts = '';
  if (fprev) {
    const base = fprev.mes;
    fatOpts = [-1, 0, 1, 2].map(k => {
      const mm = addMonthKey(base, k); const fid = `${d.cartao_id}_${mm}`;
      return `<option value="${fid}" ${(d.fatura_id || fprev.id) === fid ? 'selected' : ''}>${cap(monthName(mm))}${k === 0 ? ' (calculada)' : ''}</option>`;
    }).join('');
  }
  const rec = isEdit && m.orig.recorrencia_id ? S.find('Recorrencias', m.orig.recorrencia_id) : null;
  const situacaoPrev = isEdit && m.orig.situacao === 'previsto';
  return `${head(isEdit ? 'Editar lançamento' : 'Confira o lançamento')}
    ${!isEdit && d.texto ? `<p class="muted small">"${esc(d.texto)}" · toque em qualquer item para corrigir.</p>` : ''}
    ${isEdit ? `<p class="small muted">Lançado por ${esc((m.orig.criado_por || '').split('@')[0] || '—')}${m.orig.criado_em ? ' em ' + new Date(m.orig.criado_em).toLocaleDateString('pt-BR') : ''}${rec ? ` · ocorrência ${m.orig.ocorrencia}${rec.total_ocorrencias ? ' de ' + rec.total_ocorrencias : ''} (${rec.repeticao})` : ''}</p>` : ''}
    <form class="stack" data-form="draft" novalidate>
      <div class="seg" role="radiogroup" aria-label="Tipo">${tipos.map(([v, l]) => `<label><input type="radio" name="tipo" value="${v}" ${d.tipo === v ? 'checked' : ''} data-change>${l}</label>`).join('')}</div>
      <label class="field ${e.valor ? 'err' : ''}"><span>Valor${d.repeticao === 'parcelada' ? ' total' : ''}</span><input name="valor" inputmode="decimal" value="${d.valor !== null && d.valor !== undefined ? esc(String(d.valor).replace('.', ',')) : ''}" placeholder="0,00" ${!d.valor ? 'autofocus' : ''}>${e.valor ? `<span class="error">${e.valor}</span>` : ''}</label>
      <label class="field"><span>Descrição</span><input name="descricao" value="${esc(d.descricao || '')}"></label>
      <label class="field ${e.categoria ? 'err' : ''}"><span>Categoria${d.categoriaSugerida && !isEdit ? ' · sugerida' : ''}</span>
        <select name="categoria_id" data-change><option value="">Escolha a categoria</option>${cats.map(c => `<option value="${esc(c.id)}" ${c.id === d.categoria_id ? 'selected' : ''}>${esc(c.nome)}</option>`).join('')}</select>
        ${e.categoria ? `<span class="error">${e.categoria}</span>` : ''}
        ${!d.categoria_id && !isEdit ? `<span class="hint">Categoria não reconhecida. A escolha ensina o app para as próximas vezes.</span>` : ''}</label>
      <label class="field ${e.forma ? 'err' : ''}"><span>Pagamento</span>
        <select name="forma" data-change>${precisaCartao ? `<option value="cartao:" selected>Escolha o cartão</option>` : ''}${formas.map(([v, l]) => `<option value="${esc(v)}" ${v === formaVal ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>
        ${e.forma ? `<span class="error">${e.forma}</span>` : ''}
        ${d.cartoesAmbiguos && precisaCartao ? '<span class="hint">Há mais de um cartão com esse nome. Escolha qual.</span>' : ''}</label>
      <label class="field"><span>${d.forma === 'cartao' ? 'Data da compra' : 'Data'}</span><input type="date" name="data" value="${esc(d.data)}" data-change required></label>
      ${!isEdit ? `<div class="grid2">
        <label class="field"><span>Repetição</span><select name="repeticao" data-change>
          ${[['unica', 'Única'], ['parcelada', 'Parcelada'], ['mensal', 'Mensal'], ['anual', 'Anual']].map(([v, l]) => `<option value="${v}" ${d.repeticao === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        ${d.repeticao !== 'unica' ? `<label class="field ${e.vezes ? 'err' : ''}"><span>${d.repeticao === 'parcelada' ? 'Parcelas' : 'Quantas vezes'}</span><input name="vezes" type="number" min="${d.repeticao === 'parcelada' ? 2 : 1}" max="120" value="${d.vezes ?? ''}" placeholder="${d.repeticao === 'parcelada' ? '2' : 'sem fim'}">${e.vezes ? `<span class="error">${e.vezes}</span>` : `<span class="hint">${d.repeticao === 'parcelada' ? 'Valor total dividido igualmente' : 'Vazio = sem fim (12 meses à frente)'}</span>`}</label>` : '<span></span>'}
      </div>` : ''}
      <div class="card info small">
        <b>Conta no orçamento de ${cap(monthName(mes))}</b><br>
        ${fprev ? `Fatura ${esc(M.cartao(S, d.cartao_id)?.nome || '')} que fecha ${fmtDate((d.fatura_id && M.faturaInfoFromId(S, d.fatura_id)?.data_fechamento) || fprev.data_fechamento)} e vence ${fmtDate((d.fatura_id && M.faturaInfoFromId(S, d.fatura_id)?.data_vencimento) || fprev.data_vencimento)}. O saldo só cai quando a fatura for paga.
          <label class="field" style="margin-top:8px"><span>Fatura</span><select name="fatura_id" data-change>${fatOpts}</select></label>`
        : `${d.tipo === 'entrada' ? 'Entra no saldo' : 'Sai do saldo'} ${d.data > hoje() ? `em ${fmtDate(d.data)} (fica como previsto até lá)` : 'agora'}.`}
      </div>
      ${needOrc ? `<div class="card alert stack"><b>${esc(cat?.nome || '')} não tem orçado em ${monthName(mes)}</b>
        <span class="small">Todo gasto precisa de orçado na categoria. Quanto planejam para ela neste mês? O orçado não muda o saldo atual, só a previsão.</span>
        <label class="field ${e.orcado ? 'err' : ''}"><span>Orçado de ${monthName(mes)}</span><input name="orcado_valor" inputmode="decimal" placeholder="0,00" value="${esc(d.orcado_valor || '')}">${e.orcado ? `<span class="error">${e.orcado}</span>` : ''}</label></div>` : ''}
      ${m.dup ? `<div class="card alert stack"><b>Já existe "${esc(m.dup.descricao)}" previsto para ${fmtDate(m.dup.data)} (${money(m.dup.valor)})</b>
        <label class="check"><input type="radio" name="dup" value="confirmar" ${d.dup !== 'novo' ? 'checked' : ''} data-change> Confirmar o previsto com estes dados</label>
        <label class="check"><input type="radio" name="dup" value="novo" ${d.dup === 'novo' ? 'checked' : ''} data-change> Criar um lançamento novo</label></div>` : ''}
      <div class="btns" style="flex-direction:column">
        ${isEdit ? (situacaoPrev
          ? `<button class="btn primary" name="acao" value="confirmar">Salvar e confirmar</button><button class="btn" name="acao" value="manter">Salvar e manter como previsto</button>`
          : `<button class="btn primary" name="acao" value="salvar">Salvar alterações</button>`)
        : `<button class="btn primary" name="acao" value="salvar">Confirmar</button>`}
        ${isEdit ? `<button type="button" class="btn danger" data-act="excluir" data-id="${esc(m.orig.id)}">Excluir lançamento</button>` : `<button type="button" class="btn" data-act="close">Cancelar</button>`}
      </div>
    </form>`;
}

function readDraft(form, m) {
  const d = m.d;
  const fd = new FormData(form);
  const tipo = fd.get('tipo') || d.tipo;
  if (tipo !== d.tipo) {
    d.tipo = tipo;
    const c = M.categoria(S, d.categoria_id);
    if (c && c.tipo !== tipo) d.categoria_id = '';
    if (tipo === 'entrada' && d.forma === 'cartao') { d.forma = 'pix'; d.cartao_id = ''; }
  } else {
    d.categoria_id = fd.get('categoria_id') || '';
  }
  if (fd.has('valor')) d.valor = parseMoney(fd.get('valor'));
  if (fd.has('descricao')) d.descricao = String(fd.get('descricao')).trim();
  if (fd.has('forma')) {
    const fv = String(fd.get('forma'));
    if (fv.startsWith('cartao:')) {
      const cid = fv.slice(7);
      if (cid !== d.cartao_id) d.fatura_id = '';
      d.forma = 'cartao'; d.cartao_id = cid;
    } else { d.forma = fv; d.cartao_id = ''; d.fatura_id = ''; }
  }
  if (fd.has('data')) { const nd = String(fd.get('data')); if (nd !== d.data) { d.data = nd; if (!d.fatura_manual) d.fatura_id = ''; } }
  if (fd.has('repeticao')) d.repeticao = String(fd.get('repeticao'));
  if (fd.has('vezes')) d.vezes = fd.get('vezes') ? Number(fd.get('vezes')) : null;
  if (fd.has('fatura_id')) {
    const fid = String(fd.get('fatura_id'));
    const calc = faturaPreview(d);
    d.fatura_id = fid;
    d.fatura_manual = !!(calc && fid !== calc.id);
  }
  if (fd.has('orcado_valor')) d.orcado_valor = String(fd.get('orcado_valor'));
  if (fd.has('dup')) d.dup = String(fd.get('dup'));
  return d;
}

function validar(m) {
  const d = m.d, e = {};
  if (!(d.valor > 0)) e.valor = 'Informe o valor.';
  if (!d.categoria_id) e.categoria = 'Escolha a categoria.';
  if (d.forma === 'cartao' && !d.cartao_id) e.forma = 'Escolha o cartão.';
  if (m.type === 'novo' && d.repeticao === 'parcelada' && !(d.vezes >= 2)) e.vezes = 'Informe 2 ou mais parcelas.';
  const mes = mesDoDraft(d);
  if (d.categoria_id && M.precisaOrcado(S, d.categoria_id, mes) && !(m.dup && d.dup === 'confirmar')) {
    const v = parseMoney(d.orcado_valor);
    if (v === null || v < 0) e.orcado = 'Informe o orçado do mês.';
  }
  return e;
}

function salvarDraft(m, acao) {
  const d = m.d;
  if (!d.descricao) d.descricao = M.categoria(S, d.categoria_id)?.nome || 'Lançamento';
  const mes = mesDoDraft(d);
  if (M.precisaOrcado(S, d.categoria_id, mes) && !(m.dup && d.dup === 'confirmar')) M.setOrcado(S, d.categoria_id, mes, parseMoney(d.orcado_valor), false);
  let salvo;
  if (m.type === 'editar') {
    const situacao = acao === 'confirmar' ? 'confirmado' : acao === 'manter' ? 'previsto' : m.orig.situacao;
    salvo = M.salvarEdicao(S, m.orig, { ...d, situacao });
  } else if (m.dup && d.dup !== 'novo') {
    salvo = M.salvarEdicao(S, m.dup, { ...m.dup, valor: d.valor, data: d.data, descricao: m.dup.descricao, situacao: 'confirmado', fatura_manual: m.dup.fatura_manual, fatura_id: m.dup.fatura_id });
  } else {
    salvo = M.salvarNovo(S, d)[0];
  }
  openModal({ type: 'retorno', id: salvo.id, total: d.repeticao === 'parcelada' ? d.vezes : null });
}

function retorno(m) {
  const l = S.find('Lancamentos', m.id);
  if (!l) return head('Salvo') + '<button class="btn primary block" data-act="close">Ok</button>';
  const c = M.categoria(S, l.categoria_id);
  const x = M.catMes(S, l.categoria_id, l.mes_orcamento);
  const card = l.cartao_id ? M.cartao(S, l.cartao_id) : null;
  const fat = l.fatura_id ? M.faturaInfoFromId(S, l.fatura_id) : null;
  const offline = !S.status.online || S.status.authNeeded;
  const est = c && c.tipo !== 'entrada' && x.disponivel < 0;
  let nota = '';
  if (card && fat) nota = `Conta em ${monthName(fat.mes, false)} porque a fatura ${esc(card.nome)} vence em ${fmtDate(fat.data_vencimento)}. O saldo atual não mudou: cai quando a fatura for paga.`;
  else if (l.situacao === 'previsto') nota = `Previsto para ${fmtDate(l.data)}. O saldo atual não mudou.`;
  else nota = `Saldo atual agora: <b>${money(M.saldoAtual(S))}</b>.`;
  return `${head(l.situacao === 'previsto' ? 'Salvo como previsto' : 'Salvo')}
    <p><b>${esc(l.descricao)}</b> · ${money(l.valor)}${m.total ? ` · ${m.total} parcelas` : ''} · ${esc(card ? card.nome : M.formaNome(l.forma))}</p>
    ${c ? `<div class="card ${est ? 'danger' : ''} stack" style="margin:10px 0">
      <div class="label">${esc(c.nome)} · ${monthName(l.mes_orcamento)}</div>
      <div class="kv"><span>Orçado</span><span class="num">${x.orcado !== null ? money(x.orcado) : '—'}</span></div>
      <div class="kv"><span>${c.tipo === 'entrada' ? 'Recebido' : 'Realizado'}</span><span class="num">${money(x.realizado)}</span></div>
      <div class="kv"><span>Previsto</span><span class="num">${money(x.previsto)}</span></div>
      ${c.tipo !== 'entrada' ? `<div class="kv"><span><b>Disponível</b></span><span class="num ${est ? 'neg' : ''}"><b>${money(x.disponivel)}</b></span></div>` : ''}
      ${est ? `<b class="neg">Estourou ${money(-x.disponivel)}</b>` : (c.tipo !== 'entrada' && x.orcado && x.uso >= 0.8 ? `<b>${Math.round(x.uso * 100)}% usado · restam ${money(x.disponivel)}</b>` : '')}
    </div>` : ''}
    <p class="small">${nota}</p>
    ${offline ? '<p class="small muted">Salvo neste aparelho. Será enviado para a planilha quando a conexão voltar.</p>' : ''}
    <div class="btns"><button class="btn" data-act="editar" data-id="${esc(l.id)}">Editar</button><button class="btn primary" data-act="lancar-outro" autofocus>Lançar outro</button></div>`;
}

function excluirPanel(m) {
  const l = S.find('Lancamentos', m.id);
  if (!l) return head('Excluir') + '<p>Lançamento não encontrado.</p>';
  const rec = l.recorrencia_id ? S.find('Recorrencias', l.recorrencia_id) : null;
  return `${head(`Excluir "${esc(l.descricao)}"?`)}
    <form class="stack" data-form="excluir">
      <input type="hidden" name="id" value="${esc(l.id)}">
      ${rec ? `<div class="card stack">
        <label class="check"><input type="radio" name="alcance" value="esta" checked> Só esta ${rec.repeticao === 'parcelada' ? 'parcela' : 'ocorrência'} (${fmtDate(l.data)})</label>
        <label class="check"><input type="radio" name="alcance" value="proximas"> Esta e as próximas${rec.total_ocorrencias ? '' : ' (encerra a repetição)'}</label></div>` : ''}
      <p class="muted">A exclusão é definitiva. Não há lixeira.</p>
      <div class="btns"><button type="button" class="btn" data-act="close">Manter</button><button class="btn danger">Excluir definitivamente</button></div>
    </form>`;
}

function orcadoPanel(m) {
  const c = M.categoria(S, m.cat);
  const x = M.catMes(S, m.cat, m.mes);
  return `${head(`${esc(c.nome)} · ${monthName(m.mes)}`)}
    <div class="card stack" style="margin-bottom:12px">
      <div class="kv"><span>Orçado</span><span class="num">${x.orcado !== null ? money(x.orcado) : '—'}</span></div>
      <div class="kv"><span>${c.tipo === 'entrada' ? 'Recebido' : 'Realizado'}</span><span class="num">${money(x.realizado)}</span></div>
      <div class="kv"><span>Previsto</span><span class="num">${money(x.previsto)}</span></div>
      ${c.tipo !== 'entrada' ? `<div class="kv"><span>Disponível</span><span class="num ${x.disponivel < 0 ? 'neg' : ''}">${money(x.disponivel)}</span></div>` : ''}
    </div>
    <form class="stack" data-form="orcado">
      <input type="hidden" name="cat" value="${esc(m.cat)}"><input type="hidden" name="mes" value="${m.mes}">
      <label class="field"><span>Novo orçado</span><input name="valor" inputmode="decimal" value="${x.orcado !== null ? esc(String(x.orcado).replace('.', ',')) : ''}" placeholder="0,00" autofocus></label>
      <button class="btn primary" name="modo" value="so">Salvar só em ${monthName(m.mes)}</button>
      <button class="btn" name="modo" value="repetir">Salvar e repetir nos próximos 12 meses</button>
      <p class="small muted">Repetir não muda meses que já tinham um valor ajustado à mão.</p>
    </form>`;
}

function faturaPanel(m) {
  const f = M.faturaInfoFromId(S, m.id);
  if (!f) return head('Fatura') + '<p>Fatura não encontrada.</p>';
  const c = M.cartao(S, f.cartao_id);
  const itens = M.faturaItens(S, m.id);
  const total = M.faturaTotal(S, m.id);
  const paga = f.situacao === 'paga';
  const dataPadrao = f.data_vencimento <= hoje() ? f.data_vencimento : hoje();
  return `${head(`Fatura ${esc(c?.nome || '')} · ${monthName(f.mes, false)}`)}
    <p class="small muted">Compras de ${fmtDate(inicioFatura(f, c))} a ${fmtDate(addDays(f.data_fechamento, -1))} · fecha ${fmtDate(f.data_fechamento)} · vence ${fmtDate(f.data_vencimento)} · contam no orçamento de ${monthName(f.mes, false)}</p>
    <div class="list" style="margin:10px 0">${itens.map(lancItem).join('') || '<div class="item muted">Sem itens</div>'}
      <div class="item"><b>Total calculado</b><b class="num">${money(total)}</b></div></div>
    ${paga ? `<div class="card info">Paga em ${fmtDate(f.data_pagamento)}.</div>` : `<form class="stack" data-form="pagar">
      <input type="hidden" name="id" value="${esc(m.id)}">
      <label class="field"><span>Valor cobrado pelo banco</span><input name="valor" inputmode="decimal" value="${esc(String(total).replace('.', ','))}"><span class="hint">Se for diferente do calculado, a diferença vira o item "Ajuste da fatura".</span></label>
      <label class="field"><span>Data do pagamento</span><input type="date" name="data" value="${dataPadrao}"><span class="hint">O saldo cai nesta data. Pode ser antes do vencimento.</span></label>
      <button class="btn primary">Confirmar pagamento</button>
      <p class="small muted">Compra estornada: abra o item e exclua.</p></form>`}`;
}
function inicioFatura(f, c) { const p = parseISO(f.data_fechamento); return dateOf(p.y, p.m - 1, c ? c.dia_fechamento : p.d); }

function categoriaPanel(m) {
  const c = m.id ? M.categoria(S, m.id) : null;
  const pals = c ? S.get('Palavras').filter(p => p.categoria_id === c.id) : [];
  const futuros = c ? S.get('Lancamentos').filter(l => l.categoria_id === c.id && l.situacao === 'previsto' && l.data > hoje()) : [];
  const outras = c ? M.categorias(S, { tipo: c.tipo }).filter(x => x.id !== c.id && !x.sistema) : [];
  return `${head(c ? 'Editar categoria' : 'Nova categoria')}
    <form class="stack" data-form="categoria">
      <input type="hidden" name="id" value="${esc(c?.id || '')}">
      <label class="field"><span>Nome</span><input name="nome" required value="${esc(c?.nome || '')}" ${c ? '' : 'autofocus'}></label>
      <div class="seg" role="radiogroup" aria-label="Tipo">${[['saida', 'Saída'], ['entrada', 'Entrada'], ['investimento', 'Investimento']].map(([v, l]) => `<label><input type="radio" name="tipo" value="${v}" ${(c?.tipo || 'saida') === v ? 'checked' : ''}>${l}</label>`).join('')}</div>
      <label class="check"><input type="checkbox" name="repasse" ${c?.repasse ? 'checked' : ''}> O dinheiro vai para a conta individual de alguém (repasse, como mesada)</label>
      <label class="field"><span>Dia da transferência (só para repasse)</span><input name="dia" type="number" min="1" max="31" value="${c?.dia_transferencia ?? 5}"></label>
      <label class="field"><span>Palavras associadas (separadas por vírgula)</span><input name="palavras" value="${esc(pals.map(p => p.palavra).join(', '))}"><span class="hint">O campo de lançamento usa estas palavras para sugerir a categoria.</span></label>
      ${c ? `<label class="check"><input type="checkbox" name="arquivada" ${c.arquivada ? 'checked' : ''} data-change-cat> Arquivada (some do lançamento e do orçamento, mas fica no histórico)</label>
        ${futuros.length && !c.arquivada ? `<label class="field"><span>Se arquivar: mover os ${futuros.length} previstos futuros para</span><select name="mover"><option value="">Escolha</option>${outras.map(o => `<option value="${esc(o.id)}">${esc(o.nome)}</option>`).join('')}</select></label>` : ''}` : ''}
      ${m.error ? `<div class="banner err">${esc(m.error)}</div>` : ''}
      <button class="btn primary">Salvar</button>
    </form>`;
}

function confirmPanel(m) {
  return `${head(esc(m.title))}<p>${m.text}</p><div class="btns"><button class="btn" data-act="close">Cancelar</button><button class="btn ${m.danger ? 'danger' : 'primary'}" data-act="confirm-yes">${esc(m.yes)}</button></div>`;
}

// ---------- Ações ----------
function novoDraft(texto) {
  const r = interpretar(S, texto);
  const d = { ...r, fatura_id: '', fatura_manual: false, orcado_valor: '', dup: 'confirmar' };
  const dup = previstoParecido(S, d);
  openModal({ type: 'novo', d, dup });
}

function editarLanc(id) {
  const l = S.find('Lancamentos', id);
  if (!l) return;
  const d = { ...l, repeticao: 'unica', vezes: null, orcado_valor: '' };
  openModal({ type: 'editar', d, orig: l });
}

function handleError(e) {
  console.warn(e);
  if (e instanceof AuthError) { S.status.authNeeded = true; }
  else if (e.status === 404) ui.sheetError = 'notfound';
  else if (e.status === 403) ui.sheetError = 'noperm';
  else if (e instanceof TypeError) S.status.online = false;
  else S.status.error = e.message;
  ui.forceRender = true; render();
}

async function sync() {
  if (!S.spreadsheet || !B.hasToken()) { if (S.spreadsheet && !B.hasToken()) { S.status.authNeeded = true; ui.forceRender = true; render(); } return; }
  try {
    await S.flush();
    if (!S.queue.length && !S.status.authNeeded) {
      await S.pull();
      ui.sheetError = null;
      M.estenderRecorrencias(S);
    }
  } catch (e) { handleError(e); }
}

async function abrirPlanilha(sp) {
  ui.busy = true; ui.msg = null; ui.forceRender = true; render();
  try {
    const info = await B.fileInfo(sp.id);
    if (info.trashed) throw Object.assign(new Error('notfound'), { status: 404 });
    if (info.capabilities && info.capabilities.canEdit === false) {
      ui.msg = 'Sua conta pode ver esta planilha, mas não editar. Peça para compartilharem com permissão de Editor.';
      return;
    }
    S.setSpreadsheet({ id: sp.id, name: info.name || sp.name });
    await B.ensureSheets(sp.id);
    await S.pull();
    M.estenderRecorrencias(S);
    const temDados = S.get('Lancamentos').length || (M.cfg(S, 'saldo_inicial') !== '' && M.cfg(S, 'saldo_inicial') !== undefined);
    go(temDados ? '#/inicio' : '#/setup/saldo');
  } catch (e) {
    S.setSpreadsheet(null);
    ui.msg = e.status === 404 ? 'Planilha não encontrada.' : e.status === 403 ? 'Sem permissão para esta planilha.' : `Não foi possível abrir: ${e.message}`;
  } finally { ui.busy = false; ui.forceRender = true; render(); }
}

const actions = {
  async login() {
    ui.busy = true; ui.msg = null; render();
    try {
      if (!B.hasToken()) await B.signIn();
      const u = await B.getUser();
      S.setUser(u);
      ui.found = null;
      go('#/setup/planilha');
    } catch (e) {
      ui.msg = e instanceof AuthError ? 'O login não foi concluído. Se a janela do Google não abriu, permita pop-ups para este site.' : `Erro: ${e.message}`;
    } finally { ui.busy = false; ui.forceRender = true; render(); }
  },
  back(el) {
    if (navStack.length > 1) history.back();
    else { navStack = []; go(el.dataset.href || '#/inicio'); }
  },
  async reconnect() {
    try { await B.signIn(S.user?.email); auth.falhou = false; S.status.authNeeded = false; S.status.error = null; await sync(); }
    catch (e) { toast('A conexão não foi concluída. Tente de novo.'); }
    ui.forceRender = true; render();
  },
  async sync() { S.status.error = null; if (!B.hasToken()) return actions.reconnect(); await sync(); toast('Sincronizado'); },
  async 'create-sheet'() {
    ui.busy = true; ui.msg = null; render();
    try {
      const seeds = M.seedRows(objToRow, S.user);
      const sp = await B.createSpreadsheet(seeds);
      S.setSpreadsheet(sp);
      await S.pull();
      go('#/setup/saldo');
    } catch (e) { ui.msg = `Não foi possível criar a planilha: ${e.message}`; }
    finally { ui.busy = false; ui.forceRender = true; render(); }
  },
  async 'pick-sheet'() {
    try { const sp = await B.pickSpreadsheet(); if (sp) await abrirPlanilha(sp); }
    catch (e) { ui.msg = `Não foi possível abrir o seletor: ${e.message}`; ui.forceRender = true; render(); }
  },
  'open-sheet'(el) { abrirPlanilha({ id: el.dataset.id, name: el.dataset.name }); },
  'notice-ok'(el) { S.notices = S.notices.filter(n => String(n.id) !== el.dataset.id); render(); },
  confirmar(el) { const l = S.find('Lancamentos', el.dataset.id); if (l) { M.confirmar(S, l); toast(`"${l.descricao}" confirmado`); } },
  editar(el) { editarLanc(el.dataset.id); },
  excluir(el) { openModal({ type: 'excluir', id: el.dataset.id }); },
  fatura(el) { openModal({ type: 'fatura', id: el.dataset.id }); },
  'pagar-fatura'(el) {
    const f = M.faturaInfoFromId(S, el.dataset.id);
    const total = M.faturaTotal(S, el.dataset.id);
    M.pagarFatura(S, el.dataset.id, total, f.data_vencimento <= hoje() ? f.data_vencimento : hoje());
    toast('Fatura confirmada');
  },
  orcado(el) { openModal({ type: 'orcado', cat: el.dataset.cat, mes: el.dataset.mes }); },
  categoria(el) { openModal({ type: 'categoria', id: el.dataset.id }); },
  close() { closeModal(); },
  'close-nav'() { closeModal(); },
  'modal-bg'(el, ev) { if (ev.target === el) closeModal(); },
  'lancar-outro'() { closeModal(); const i = $('#cmp'); if (i) { i.value = ''; i.focus(); } else go('#/inicio'); },
  logout() {
    const q = S.queue.length;
    openModal({
      type: 'confirmar', title: 'Sair deste aparelho?', yes: 'Sair e limpar', danger: true,
      text: `Os dados guardados neste aparelho serão apagados. A planilha no Drive não muda.${q ? ` <b>Atenção: ${q} alteração(ões) ainda não foram enviadas e serão perdidas.</b>` : ''}`,
      onYes: () => { B.signOut(); S.reset(); ui.found = null; closeModal(); go('#/login'); },
    });
  },
  'confirm-yes'() { const f = ui.modal?.onYes; if (f) f(); },
};

document.addEventListener('click', ev => {
  const sw = ev.target.closest('a[data-swap]');
  if (sw) { ev.preventDefault(); swap(sw.getAttribute('href')); return; }
  const el = ev.target.closest('[data-act]');
  if (!el) return;
  const fn = actions[el.dataset.act];
  if (!fn) return;
  if (el.dataset.act === 'modal-bg' && ev.target !== el) return;
  if (el.tagName === 'A' && el.dataset.act !== 'close-nav') ev.preventDefault();
  fn(el, ev);
});

document.addEventListener('input', ev => {
  if (ev.target.matches('[data-search]')) {
    ui.search = ev.target.value;
    const r = route();
    const list = $('#lanc-list');
    if (list) list.innerHTML = lancList(r.q.get('mes') || monthOf(hoje()), r.q.get('cat'));
  }
});

document.addEventListener('change', ev => {
  const t = ev.target;
  if (t.matches('[data-change]') && ui.modal && (ui.modal.type === 'novo' || ui.modal.type === 'editar')) {
    readDraft(t.form, ui.modal);
    ui.modal.errors = null;
    renderModal();
  }
});

const forms = {
  composer(fd, form) {
    const t = String(fd.get('t') || '').trim();
    if (!t) return;
    form.reset();
    novoDraft(t);
  },
  draft(fd, form, submitter) {
    const m = ui.modal;
    readDraft(form, m);
    const e = validar(m);
    if (Object.keys(e).length) { m.errors = e; renderModal(); return; }
    salvarDraft(m, submitter?.value || 'salvar');
  },
  excluir(fd) {
    const l = S.find('Lancamentos', fd.get('id'));
    if (l) { M.excluir(S, l, fd.get('alcance') || 'esta'); toast('Lançamento excluído'); }
    closeModal();
  },
  orcado(fd, form, submitter) {
    const v = parseMoney(fd.get('valor'));
    if (v === null || v < 0) { toast('Informe um valor'); return; }
    M.setOrcado(S, fd.get('cat'), fd.get('mes'), v, submitter?.value === 'repetir');
    closeModal(); toast('Orçado salvo');
  },
  pagar(fd) {
    const v = parseMoney(fd.get('valor'));
    if (v === null) { toast('Informe o valor cobrado'); return; }
    M.pagarFatura(S, fd.get('id'), v, String(fd.get('data') || hoje()));
    closeModal(); toast('Pagamento confirmado');
  },
  categoria(fd) {
    const id = String(fd.get('id') || '');
    const nome = String(fd.get('nome') || '').trim();
    if (!nome) return;
    const prev = id ? M.categoria(S, id) : null;
    const arquivar = fd.get('arquivada') === 'on';
    if (prev && arquivar && !prev.arquivada) {
      const futuros = S.get('Lancamentos').filter(l => l.categoria_id === id && l.situacao === 'previsto' && l.data > hoje());
      if (futuros.length) {
        const mover = String(fd.get('mover') || '');
        if (!mover) { ui.modal.error = 'Escolha para qual categoria mover os previstos futuros.'; renderModal(); return; }
        futuros.forEach(l => S.upsert('Lancamentos', { ...l, categoria_id: mover }));
      }
      S.get('Orcamento').filter(o => o.categoria_id === id && o.mes > monthOf(hoje())).forEach(o => S.remove('Orcamento', `${o.categoria_id}|${o.mes}`));
    }
    const novoId = id || `cat_${slug(nome)}_${uid('x').slice(-4)}`;
    const cats = M.categorias(S, { todas: true });
    S.upsert('Categorias', {
      ...(prev || {}), id: novoId, nome, tipo: String(fd.get('tipo') || 'saida'),
      repasse: fd.get('repasse') === 'on', dia_transferencia: fd.get('repasse') === 'on' ? Number(fd.get('dia')) || 5 : null,
      sistema: false, arquivada: arquivar, ordem: prev?.ordem ?? cats.length + 1,
    });
    const novas = new Set(String(fd.get('palavras') || '').split(',').map(normalize).map(s => s.trim()).filter(Boolean));
    S.get('Palavras').filter(p => p.categoria_id === novoId && !novas.has(p.palavra)).forEach(p => S.remove('Palavras', p.palavra));
    novas.forEach(p => { const ex = S.find('Palavras', p); if (!ex || ex.categoria_id !== novoId) S.upsert('Palavras', { palavra: p, categoria_id: novoId, origem: 'inicial', usos: ex?.usos || 0 }); });
    closeModal(); toast('Categoria salva');
  },
  cartao(fd) { salvarCartao(fd); toast('Cartão salvo'); },
  'setup-cartao'(fd, form) { salvarCartao(fd); form.reset(); ui.forceRender = true; render(); },
  'setup-saldo'(fd) {
    const v = parseMoney(fd.get('saldo'));
    if (v === null) { toast('Informe o saldo'); return; }
    S.setConfig('saldo_inicial', v);
    S.setConfig('data_saldo_inicial', hoje());
    go('#/setup/cartoes');
  },
  'setup-orcamento'(fd, form, submitter) {
    const mes = monthOf(hoje());
    const repetir = submitter?.value === 'repetir';
    for (const [k, v] of fd.entries()) {
      if (!k.startsWith('o_')) continue;
      const n = parseMoney(v);
      if (n === null) continue;
      M.setOrcado(S, k.slice(2), mes, n, repetir);
    }
    toast('Orçamento salvo');
    go('#/setup/compartilhar');
  },
  ajuste(fd) {
    const v = parseMoney(fd.get('real'));
    if (v === null) { toast('Informe o saldo real'); return; }
    const dif = M.ajustarSaldo(S, v);
    toast(dif ? `Ajuste de ${money(dif)} lançado` : 'Saldo já estava certo');
    go('#/inicio');
  },
};

function salvarCartao(fd) {
  const id = String(fd.get('id') || '') || `car_${slug(String(fd.get('nome')))}_${uid('x').slice(-4)}`;
  const prev = M.cartao(S, id);
  S.upsert('Cartoes', {
    ...(prev || {}), id, nome: String(fd.get('nome')).trim(), titular: String(fd.get('titular')).trim(),
    dia_fechamento: Math.min(31, Math.max(1, Number(fd.get('fech')))), dia_vencimento: Math.min(31, Math.max(1, Number(fd.get('venc')))),
    ativo: prev ? fd.get('ativo') === 'on' : true,
  });
}

document.addEventListener('submit', ev => {
  const form = ev.target.closest('form[data-form]');
  if (!form) return;
  ev.preventDefault();
  const fn = forms[form.dataset.form];
  if (!fn) return;
  if (!form.checkValidity()) { form.reportValidity(); return; }
  ui.forceRender = true;
  fn(new FormData(form), form, ev.submitter);
});

// ---------- Conexão com o Google ----------
// O Google só entrega uma conexão nova a partir de um toque na tela. Então, quando ela venceu
// (ou está para vencer), o app renova sozinho no primeiro toque, sem pedir nada. Até lá, mostra
// os dados guardados no aparelho. O aviso com "Reconectar" só aparece se a renovação falhar.
const auth = { emCurso: false, falhou: false };
async function renovarConexao() {
  if (DEMO || !S.user || !S.spreadsheet || auth.emCurso || auth.falhou || !B.tokenClient) return;
  if (B.hasToken() && B.minutesLeft() > 10) return;
  auth.emCurso = true;
  try {
    await B.signIn(S.user.email, { silent: true });
    S.status.authNeeded = false; S.status.error = null;
    await sync();
  } catch (e) {
    auth.falhou = !B.hasToken();
    if (auth.falhou) S.status.authNeeded = true;
  } finally { auth.emCurso = false; ui.forceRender = true; render(); }
}
document.addEventListener('pointerup', () => renovarConexao(), true);
document.addEventListener('keydown', ev => { if (ev.key === 'Enter') renovarConexao(); }, true);

// ---------- Início do app ----------
S.subscribe(() => render());
window.addEventListener('hashchange', () => { trackNav(); ui.forceRender = true; closeModal(); render(); window.scrollTo(0, 0); });
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && S.spreadsheet) {
    const last = S.s.lastSync ? Date.parse(S.s.lastSync) : 0;
    if (Date.now() - last > 60000) sync();
  }
});

async function boot() {
  try { await B.init(); } catch (e) { ui.bootError = 'Não foi possível carregar o login do Google. Verifique a internet e recarregue.'; }
  ui.forceRender = true; render();
  if (S.user && S.spreadsheet) {
    if (B.hasToken()) sync();
    else { S.status.authNeeded = true; ui.forceRender = true; render(); }
  }
  if ('serviceWorker' in navigator && !DEMO) {
    // Versão nova instalada: recarrega uma vez para usar os arquivos novos (sem precisar limpar nada).
    const tinha = !!navigator.serviceWorker.controller;
    let recarregou = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!tinha || recarregou || (S.queue.length && !navigator.onLine)) return;
      recarregou = true; location.reload();
    });
    navigator.serviceWorker.register('./sw.js?v=5', { updateViaCache: 'none' }).catch(() => {});
  }
}
boot();
