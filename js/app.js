// App de finanças do casal — telas e navegação.
import { GoogleBackend, AuthError } from './google.js?v=17';
import { MockBackend } from './mock.js?v=17';
import { Store } from './store.js?v=17';
import { objToRow } from './schema.js?v=17';
import * as M from './model.js?v=17';
import { interpretar, previstoParecido } from './parser.js?v=17';
import { ic, icCategoria } from './icones.js?v=17';
import {
  formatarReais, todayISO, monthOf, monthName, lastDayOfMonth, dateOf, parseISO, addDays, monthShort, fmtDate, money, esc, parseMoney, addMonthKey, daysBetween, round2, uid, slug, normalize,
} from './util.js?v=17';

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
const backBtn = fallback => `<button class="back" data-act="back" data-href="${fallback}">${ic('chevron-left')}Voltar</button>`;
const DESK = () => matchMedia('(min-width: 960px)').matches;


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
  const desk = DESK();
  const hasComposer = ['inicio', 'lancamentos'].includes(r.name);
  $('#main').className = 'shell' + (hasComposer && !desk ? ' with-composer' : '');
  $('#main').innerHTML = screen(r);
  const showNav = !['login', 'setup'].includes(r.name);
  $('#nav').innerHTML = showNav ? nav(r) : '';
  const routeKey = r.name + (desk ? ':desk' : '');
  if (ui.lastRoute !== routeKey) {
    $('#composer').innerHTML = hasComposer && !desk ? composer() : '';
    ui.lastRoute = routeKey;
  }
  if (r.name === 'inicio' && S.user && S.spreadsheet && !ui.modal && !tutorialVisto() && !ui.tutorialAberto) {
    ui.tutorialAberto = true;
    setTimeout(() => { if (!ui.modal) openModal({ type: 'tutorial', passo: 0 }); }, 300);
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
  const naMais = ['mais', 'cartoes', 'cartao', 'categorias', 'saldo', 'setup'].includes(r.name);
  const ativo = {
    inicio: r.name === 'inicio' || r.name === 'pendentes',
    lancamentos: r.name === 'lancamentos',
    mes: r.name === 'mes',
    mais: naMais,
    cartoes: ['cartoes', 'cartao'].includes(r.name),
    categorias: r.name === 'categorias',
    config: ['mais', 'saldo', 'setup'].includes(r.name),
  };
  const item = (chave, rotulo, href, icone, cls = '') => `<a href="${href}" class="ir ${cls} ${ativo[chave] ? 'on' : ''}" ${ativo[chave] ? 'aria-current="page"' : ''}><span class="pil">${ic(icone)}</span><span>${rotulo}</span></a>`;
  const q = S.queue.length;
  const estado = !S.status.online ? 'Sem internet' : S.syncing ? 'Salvando…' : q ? `${q} ${q === 1 ? 'alteração aguardando' : 'alterações aguardando'} envio` : 'Tudo salvo na planilha';
  return `<nav class="tabs" aria-label="Navegação principal">
    <a class="marca so-desk" href="#/inicio" aria-label="Oikon, início"><img src="icons/oikon.svg" alt=""><span>Oikon</span></a>
    ${item('inicio', 'Início', '#/inicio', 'house')}
    ${item('lancamentos', 'Lançamentos', '#/lancamentos', 'list')}
    ${item('mes', 'Mês', '#/mes', 'calendar-range')}
    ${item('cartoes', 'Cartões', '#/cartoes', 'credit-card', 'so-desk')}
    ${item('categorias', 'Categorias', '#/categorias', 'tag', 'so-desk')}
    ${item('config', 'Configurações', '#/mais', 'settings', 'so-desk')}
    ${item('mais', 'Mais', '#/mais', 'ellipsis', 'so-cel')}
    <div class="rodape so-desk"><span>${esc(S.spreadsheet?.name || '')}</span><span>${estado}</span></div>
  </nav>`;
}

// Campo único (8.2). No celular fica fixo no rodapé; no computador, no topo do conteúdo (noTopo).
function composer(noTopo = false) {
  return `<div class="composer ${noTopo ? 'no-topo' : ''}"><form data-form="composer" autocomplete="off">
    <label for="cmp" class="sr-only">Lançar um gasto ou entrada</label>
    <input id="cmp" name="t" placeholder="mercado 150 pix" enterkeyhint="send" autocomplete="off">
    <button type="submit" class="btn primary icone" aria-label="Lançar" disabled>${ic('arrow-right')}</button></form></div>`;
}

function toast(msg) {
  ui.toast = msg; render();
  clearTimeout(ui._tt); ui._tt = setTimeout(() => { ui.toast = null; $('#toast').innerHTML = ''; }, 3200);
}

// ---------- Avisos no topo (8.10, 8.17) ----------
const aviso = (tipo, icone, texto, acao = '') => `<div class="banner ${tipo}" role="${tipo === 'err' ? 'alert' : 'status'}">${icone ? ic(icone) : ''}<span>${texto}</span>${acao}</div>`;

function banners() {
  const out = [];
  const st = S.status, q = S.queue.length;
  if (DEMO) out.push(aviso('', 'circle-dot', 'Modo demonstração: os dados ficam só neste navegador.'));
  if (ui.sheetError === 'notfound') out.push(aviso('err', '', 'Não encontrei a planilha. Ela foi apagada, foi para a lixeira ou deixou de ser compartilhada com você.', '<a class="btn" href="#/mais">Ver opções</a>'));
  if (ui.sheetError === 'noperm') out.push(aviso('err', '', 'Sua conta pode ver a planilha, mas não editar. Peça para compartilharem com permissão de edição.'));
  if (!st.online) out.push(aviso('warn', 'cloud-off', 'Sem internet. O que você lançar fica guardado e vai para a planilha depois.'));
  else if (st.authNeeded && auth.falhou) out.push(aviso('warn', 'cloud-off', `A conexão com o Google venceu${q ? `. ${q} ${q === 1 ? 'alteração espera' : 'alterações esperam'} o envio` : ''}.`, '<button class="btn" data-act="reconnect">Reconectar</button>'));
  else if (st.error && /pausa/.test(st.error)) out.push(aviso('warn', 'refresh-cw', cap(st.error) + '.'));
  else if (st.error) out.push(aviso('err', '', 'Não consegui salvar na planilha. Seus dados estão guardados aqui.', '<button class="btn" data-act="sync">Tentar de novo</button>'));
  else if (q && S.syncing) out.push(aviso('', 'refresh-cw', `Enviando ${q} ${q === 1 ? 'alteração' : 'alterações'} para a planilha…`));
  S.notices.forEach(n => out.push(aviso('', '', esc(n.text), `<button class="btn" data-act="notice-ok" data-id="${n.id}">Entendi</button>`)));
  if (S.s.invalid) out.push(aviso('warn', '', `${S.s.invalid} ${S.s.invalid === 1 ? 'linha da planilha foi ignorada por estar incompleta' : 'linhas da planilha foram ignoradas por estarem incompletas'}.`));
  return out.join('');
}

// ---------- Entrar ----------
const GOOGLE_G = '<svg viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>';

function scrLogin() {
  return `<div class="login">
    <h1 class="assinatura"><img src="icons/oikon.svg" alt=""><span>Oikon</span></h1>
    <p class="frase">O dinheiro da casa, claro e simples.</p>
    ${ui.bootError ? aviso('err', '', esc(ui.bootError)) : ''}
    <button class="btn primary block btn-google" data-act="login" ${ui.busy ? 'disabled' : ''}><span class="g">${GOOGLE_G}</span>${ui.busy ? 'Entrando…' : 'Entrar com Google'}</button>
    ${ui.msg ? aviso('err', '', esc(ui.msg)) : ''}
    <p class="small muted">Seus dados ficam numa planilha no seu Google Drive.</p>
    ${DEMO ? '<p class="small muted">Modo demonstração: nada é enviado ao Google.</p>' : ''}
  </div>`;
}

function steps(cur) {
  const i = STEPS.indexOf(cur);
  const configurado = S.spreadsheet && S.get('Lancamentos').length;
  return `${configurado && navStack.length > 1 ? `<div class="top">${backBtn('#/mais')}</div>` : ''}<div class="steps" role="img" aria-label="Etapa ${i + 1} de ${STEPS.length}">${STEPS.map((_, k) => `<i class="${k < i ? 'feito' : k === i ? 'atual' : ''}"></i>`).join('')}</div>`;
}




// ---------- Primeiro acesso ----------
const STEPS = ['planilha', 'saldo', 'cartoes', 'orcamento', 'compartilhar'];

function scrSetup(step) {
  if (step !== 'planilha' && !S.spreadsheet) step = 'planilha';
  const skip = next => `<a class="btn link" href="#/setup/${next}">Pular por agora</a>`;
  if (step === 'planilha') {
    if (ui.found === null && !ui.busy) loadFound();
    const found = ui.found || [];
    return `${steps('planilha')}
      <div class="top"><h1>Vamos montar a casa</h1></div>
      <p class="apoio" style="margin-bottom:var(--esp-5)">Leva uns cinco minutos. Primeiro: onde ficam os dados?</p>
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
        ${campoValor('saldo', `Saldo em ${fmtDate(hoje(), true)}`, v === undefined ? '' : v, true)}
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
  const fat = faturasAbertas();
  const desk = DESK();
  const atencao = res.linhas.filter(x => x.categoria.tipo !== 'entrada' && !x.categoria.sistema && x.orcado && x.uso >= 0.8)
    .sort((a, b) => b.uso - a.uso);
  const ultimos = S.get('Lancamentos').filter(l => l.situacao === 'confirmado').slice().sort((a, b) => (b.criado_em || '').localeCompare(a.criado_em || '')).slice(0, 5);
  const semSaldo = M.cfg(S, 'saldo_inicial') === '' || M.cfg(S, 'saldo_inicial') === undefined;
  const semOrc = !S.get('Orcamento').some(o => o.mes === mes);
  const porCategoria = res.linhas.filter(x => x.categoria.tipo === 'saida' && !x.categoria.sistema && x.orcado)
    .sort((a, b) => (b.disponivel < 0) - (a.disponivel < 0) || b.uso - a.uso).slice(0, 5);
  return `${desk ? composer(true) : ''}${banners()}
    <div class="cabecalho"><img class="marca-ic" src="icons/oikon.svg" alt="Oikon"><span class="chip">Casa · ${cap(monthName(mes, false))}</span></div>
    ${semSaldo || semOrc ? `<div class="card info stack" style="margin-bottom:var(--esp-4)"><b>Falta pouco para a casa ficar pronta</b>
      ${semSaldo ? '<a href="#/setup/saldo">Informar quanto tem na conta</a>' : ''}
      ${semOrc ? `<a href="#/setup/orcamento">Orçar ${monthName(mes, false)}</a>` : ''}
      ${!M.cartoes(S).length ? '<a href="#/setup/cartoes">Cadastrar os cartões</a>' : ''}</div>` : ''}
    <div class="inicio-grade">
      ${destaque(fd, res, mes)}
      <div class="grid2 metricas">
        <a class="card metrica" href="#/saldo"><span class="label">Saldo na conta</span><span class="big num ${saldo < 0 ? 'neg' : ''}">${money(saldo)}</span><span class="apoio">Só o que já aconteceu</span></a>
        <a class="card metrica" href="#/cartoes"><span class="label">Fatura do cartão</span><span class="big num">${money(fat.total)}</span><span class="apoio">${fat.n === 1 ? `Vence ${fmtDate(fat.venc)}` : fat.n ? `${fat.n} cartões` : 'Nenhuma aberta'}</span></a>
      </div>
      <section class="col6">
        <h2 class="section-title">Para confirmar ${pend.length ? `<span class="contador">${pend.length}</span>` : ''}${pend.length > 3 ? '<a class="btn link r" href="#/pendentes">Ver todos</a>' : ''}</h2>
        ${pend.length ? `<div class="list">${pend.slice(0, 3).map(pendItem).join('')}</div>`
          : '<p class="apoio">Nada para confirmar. Pode ir fazer outra coisa da vida.</p>'}
        ${atencao.length ? `<div class="stack" style="margin-top:var(--esp-4)">${atencao.slice(0, 3).map(x => x.disponivel < 0
          ? aviso('err', '', `${esc(x.categoria.nome)} passou ${money(-x.disponivel)} do orçado este mês.`)
          : aviso('warn', '', `${esc(x.categoria.nome)} está perto do limite: sobram ${money(x.disponivel)} até o fim do mês.`)).join('')}</div>` : ''}
      </section>
      <section class="col6 so-desk-b">
        <h2 class="section-title">Mês por categoria <a class="btn link r" href="#/mes">Ver o mês</a></h2>
        <div class="list">${porCategoria.map(x => linhaCategoria(x, mes)).join('') || '<p class="apoio">Nenhuma categoria com orçado neste mês.</p>'}</div>
      </section>
      <section class="col12">
        <h2 class="section-title">Atalhos</h2>
        <div class="chips">
          <a class="chip" href="#/cartoes">${ic('credit-card')}Faturas dos cartões</a>
          <a class="chip" href="#/mes">${ic('calendar-range')}Orçamento do mês</a>
          <a class="chip" href="#/pendentes">${ic('check')}Para confirmar</a>
          <a class="chip" href="#/saldo">${ic('sliders-horizontal')}Ajustar saldo</a>
        </div>
        <h2 class="section-title">Últimos lançamentos</h2>
        ${ultimos.length ? `<div class="list">${ultimos.map(l => lancItem(l, { data: true })).join('')}</div>`
          : '<div class="vazio">' + ic('list') + '<p>Nada lançado ainda. Escreva no campo abaixo, por exemplo: <b>mercado 150 pix</b>.</p></div>'}
      </section>
    </div>`;
}

// Bloco de destaque (8.4): quanto deve sobrar no fim do mês. Agrupa também o orçamento das saídas (decisão de 28/10).
function destaque(fd, res, mes) {
  const neg = fd.total < 0;
  const partes = [];
  if (fd.faturas) partes.push(`${fd.faturas === faturasAbertas().total ? 'a fatura' : 'as faturas'} de ${money(fd.faturas)}`);
  if (fd.pagar) partes.push(`${money(fd.pagar)} em contas previstas`);
  if (fd.reservado) partes.push(`os ${money(fd.reservado)} ainda orçados`);
  const pesos = [['A fatura do cartão é', fd.faturas], ['As contas previstas são', fd.pagar], ['O orçado que ainda pode ser gasto é', fd.reservado]].sort((a, b) => b[1] - a[1]);
  const exp = neg ? `${pesos[0][0]} o que mais pesa no mês.` : partes.length ? `Já conta ${partes.length > 1 ? partes.slice(0, -1).join(', ') + ' e ' + partes.at(-1) : partes[0]}.` : 'Conta o saldo de hoje e o que ainda está previsto.';
  const sa = res.saidas;
  const usado = round2(sa.realizado + sa.previsto);
  return `<a class="destaque" href="#/mes" data-act="composicao">
    <span class="rot">No fim do mês, deve ${neg ? 'faltar' : 'sobrar'}</span>
    <span class="valor ${neg ? 'neg' : ''}">${formatarReais(Math.abs(fd.total), { inteiro: true })}</span>
    <span class="exp">${exp}</span>
    ${sa.orcado ? `<span class="saidas">
      <span class="orc-linha"><span class="t">Saídas de ${monthName(mes, false)}</span><span class="num">${money(usado)} de ${money(sa.orcado)}</span></span>
      ${barra(sa.realizado, sa.previsto, sa.orcado)}
      <span class="small muted">Ainda cabe ${money(sa.livre)} no orçado${sa.estouradas ? ` · ${sa.estouradas} ${sa.estouradas === 1 ? 'categoria passou' : 'categorias passaram'} ${money(sa.acima)}` : ''}</span>
    </span>` : ''}
  </a>`;
}

// Soma da próxima fatura em aberto de cada cartão (lançado + estimativa pelo orçado).
function faturasAbertas() {
  let total = 0, n = 0, venc = '';
  M.cartoes(S).forEach(c => {
    const f = M.faturasDoCartao(S, c.id).find(x => x.situacao !== 'paga' && x.previsao > 0);
    if (f) { total += f.previsao; n++; venc = f.data_vencimento; }
  });
  return { total: round2(total), n, venc };
}

// Barra de orçamento (8.9): realizado cheio, previsto mais claro; estourado em vermelho.
function barra(real, prev, orc) {
  const total = (real || 0) + (prev || 0);
  const over = orc !== null && orc !== undefined && orc > 0 && total > orc + 0.005;
  const base = over ? total : (orc || total || 1);
  const pr = Math.max(0, Math.min(100, ((real || 0) / base) * 100));
  const pp = Math.max(0, Math.min(100 - pr, ((prev || 0) / base) * 100));
  return `<span class="bar ${over ? 'over' : ''}" aria-hidden="true"><i style="width:${pr}%"></i><i class="prev" style="width:${pp}%"></i></span>`;
}

// Linha de categoria do mês (8.9 dentro de um item 8.6).
function linhaCategoria(x, mes) {
  const c = x.categoria;
  const entrada = c.tipo === 'entrada';
  const usado = round2(x.realizado + x.previsto);
  const est = !entrada && x.orcado !== null && x.disponivel < 0;
  const rodape = entrada
    ? (x.orcado !== null ? `Falta receber: ${money(Math.max(0, x.orcado - x.realizado))}` : 'Sem orçado neste mês')
    : x.orcado === null ? 'Sem orçado neste mês'
    : est ? `<span class="neg">${money(-x.disponivel)} acima</span>` : `Disponível: ${money(x.disponivel)}`;
  return `<a class="item" href="#/mes/${mes}/${esc(c.id)}">${icCategoria(c)}
    <span class="meio"><span class="orc-linha"><span class="t">${esc(c.nome)}${c.repasse ? ' <span class="badge prev">repasse</span>' : ''}</span><span class="num">${money(usado)}${x.orcado !== null ? ` de ${money(x.orcado)}` : ''}</span></span>
    ${x.orcado !== null || usado ? barra(x.realizado, x.previsto, x.orcado) : ''}
    <span class="s">${rodape}</span></span></a>`;
}

// Item pendente (8.6, variação pendente): tocar abre a edição; o botão confirma como está.
function pendItem(p) {
  if (p.kind === 'fatura') {
    const c = M.cartao(S, p.item.cartao_id);
    return `<div class="item">
      <button class="abrir" data-act="fatura" data-id="${esc(p.item.id)}">${ic('credit-card')}<span class="meio"><span class="t">Fatura ${esc(c ? c.nome : '')}</span><span class="s">${monthName(p.item.mes, false)} · venceu ${fmtDate(p.item.data_vencimento)}</span></span></button>
      <span class="r"><span class="num">${money(p.item.total)}</span><button class="btn pequeno" data-act="pagar-fatura" data-id="${esc(p.item.id)}">${ic('check')}Confirmar</button></span></div>`;
  }
  const l = p.item;
  const c = M.categoria(S, l.categoria_id);
  const dias = Math.max(0, daysBetween(l.data, hoje()));
  return `<div class="item">
    <button class="abrir" data-act="editar" data-id="${esc(l.id)}">${icCategoria(c)}<span class="meio"><span class="t">${esc(l.descricao)}</span><span class="s">${fmtDate(l.data)} · ${dias ? `há ${dias} ${dias === 1 ? 'dia' : 'dias'}` : 'hoje'} · ${esc(M.formaNome(l.forma))}</span></span></button>
    <span class="r"><span class="num ${l.tipo === 'entrada' ? 'pos' : ''}">${formatarReais(l.tipo === 'entrada' ? l.valor : l.valor, { sinal: l.tipo === 'entrada' })}</span><button class="btn pequeno" data-act="confirmar" data-id="${esc(l.id)}">${ic('check')}Confirmar</button></span></div>`;
}

function lancItem(l, { data = false } = {}) {
  const c = M.categoria(S, l.categoria_id);
  const card = l.cartao_id ? M.cartao(S, l.cartao_id) : null;
  const naFila = S.queue.some(q => q.sheet === 'Lancamentos' && q.key === l.id);
  const pend = l.situacao === 'previsto' && l.data <= hoje();
  const badge = pend ? '<span class="badge pend">para confirmar</span>' : l.situacao === 'previsto' ? '<span class="badge prev">previsto</span>' : '';
  const sub = [];
  if (data) sub.push(fmtDate(l.data));
  if (c) sub.push(c.nome);
  sub.push(card ? `${card.nome} · fatura de ${monthShort(l.mes_orcamento)}` : M.formaNome(l.forma));
  if (l.ocorrencia) {
    const rec = S.find('Recorrencias', l.recorrencia_id);
    sub.push(rec && rec.total_ocorrencias ? `${l.ocorrencia} de ${rec.total_ocorrencias}` : rec?.repeticao === 'anual' ? 'todo ano' : 'todo mês');
  }
  const quem = variasPessoas() && l.criado_por ? `<span class="quem" title="${esc(l.criado_por)}">${esc(l.criado_por.charAt(0).toUpperCase())}</span>` : '';
  return `<button class="item" data-act="editar" data-id="${esc(l.id)}">${icCategoria(c)}
    <span class="meio"><span class="t">${esc(l.descricao)}</span><span class="s">${esc(sub.join(' · '))}</span></span>
    ${quem}
    <span class="r"><span class="num ${l.tipo === 'entrada' ? 'pos' : ''}">${naFila ? `<span class="sr-only">aguardando envio</span>${ic('refresh-cw', 'mini')}` : ''}${formatarReais(l.valor, { sinal: l.tipo === 'entrada' })}</span>${badge}</span></button>`;
}

// O app mostra quem lançou só quando mais de uma pessoa usa a planilha.
function variasPessoas() {
  const quem = new Set(S.get('Lancamentos').map(l => l.criado_por).filter(Boolean));
  return quem.size > 1;
}

const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

// Card único: quanto deve sobrar no fim do mês, de onde vem esse número e como estão as saídas.
const lastDay = mes => lastDayOfMonth(mes);



// ---------- Lançamentos ----------
function scrLancamentos(q) {
  const mes = q.get('mes') || monthOf(hoje());
  const cat = q.get('cat');
  const f = q.get('f') || 'todos';
  const link = (m, ff = f) => `#/lancamentos?mes=${m}${cat ? '&cat=' + cat : ''}${ff !== 'todos' ? '&f=' + ff : ''}`;
  const FILTROS = [['todos', 'Todos'], ['saidas', 'Saídas'], ['entradas', 'Entradas'], ['cartao', 'Cartão'], ['previstos', 'Previstos']];
  return `${DESK() ? composer(true) : ''}${banners()}
    <div class="top">${cat ? backBtn(`#/mes/${mes}`) : ''}<h1>Lançamentos</h1></div>
    ${seletorMes(mes, m => link(m))}
    ${cat ? aviso('', '', `Só a categoria <b>${esc(M.categoria(S, cat)?.nome || '')}</b>, pelo mês do orçamento.`, `<a class="btn" href="#/lancamentos?mes=${mes}">Ver todas</a>`) : ''}
    <label class="field busca" style="margin-bottom:var(--esp-3)"><span class="sr-only">Buscar</span><span class="caixa">${ic('search')}<input data-search placeholder="Buscar" value="${esc(ui.search)}"></span></label>
    <div class="filtros" role="group" aria-label="Filtrar">${FILTROS.map(([k, n]) => `<a class="filtro ${f === k ? 'on' : ''}" href="${link(mes, k)}" data-swap ${f === k ? 'aria-current="true"' : ''}>${n}</a>`).join('')}</div>
    <div id="lanc-list">${lancList(mes, cat, f)}</div>`;
}

function lancList(mes, cat, f = 'todos') {
  const s = normalize(ui.search);
  let ls = S.get('Lancamentos').filter(l => (cat ? l.categoria_id === cat && l.mes_orcamento === mes : monthOf(l.data) === mes));
  if (f === 'saidas') ls = ls.filter(l => l.tipo !== 'entrada');
  if (f === 'entradas') ls = ls.filter(l => l.tipo === 'entrada');
  if (f === 'cartao') ls = ls.filter(l => l.forma === 'cartao');
  if (f === 'previstos') ls = ls.filter(l => l.situacao === 'previsto');
  if (s) ls = ls.filter(l => normalize(`${l.descricao} ${M.categoria(S, l.categoria_id)?.nome || ''}`).includes(s));
  ls.sort((a, b) => b.data.localeCompare(a.data) || (b.criado_em || '').localeCompare(a.criado_em || ''));
  if (!ls.length) {
    return s || f !== 'todos' ? '<div class="vazio">' + ic('search') + '<p>Nada encontrado com esse filtro.</p></div>'
      : `<div class="vazio">${ic('list')}<p>Nada lançado em ${monthName(mes, false)} ainda.</p><button class="btn" data-act="focar-campo">Lançar o primeiro gasto</button></div>`;
  }
  const pend = ls.filter(l => l.situacao === 'previsto' && l.data <= hoje() && !(l.forma === 'cartao' && l.recorrencia_id));
  const resto = ls.filter(l => !pend.includes(l));
  const dias = [];
  resto.forEach(l => { const g = dias.at(-1); if (g && g.data === l.data) g.itens.push(l); else dias.push({ data: l.data, itens: [l] }); });
  return (pend.length ? `<h2 class="dia">Para confirmar</h2><div class="list">${pend.map(l => lancItem(l, { data: true })).join('')}</div>` : '')
    + dias.map(g => `<h2 class="dia">${rotuloDia(g.data)}</h2><div class="list">${g.itens.map(l => lancItem(l)).join('')}</div>`).join('');
}

// "Hoje", "Ontem", "seg., 26 out."
function rotuloDia(iso) {
  const h = hoje();
  if (iso === h) return 'Hoje';
  if (iso === addDays(h, -1)) return 'Ontem';
  if (iso === addDays(h, 1)) return 'Amanhã';
  const { y, m, d } = parseISO(iso);
  return new Date(y, m - 1, d).toLocaleDateString('pt-BR', { weekday: 'short', day: 'numeric', month: 'short' }).replace(' de ', ' ');
}

// Seletor de mês em chip, com setas (8.8). A troca de mês não empilha no Voltar.
function seletorMes(mes, href, sub = '') {
  return `<div class="seletor-mes"><a href="${href(addMonthKey(mes, -1))}" data-swap aria-label="Mês anterior">${ic('chevron-left')}</a>
    <span class="t">${sub ? `<b>${sub}</b>` : ''}${cap(monthName(mes))}</span>
    <a href="${href(addMonthKey(mes, 1))}" data-swap aria-label="Mês seguinte">${ic('chevron-right')}</a></div>`;
}

function scrPendentes() {
  const pend = M.pendentes(S);
  return `${banners()}
    <div class="top">${backBtn('#/inicio')}</div>
    <h1 class="section-title" style="margin-top:0">Para confirmar ${pend.length ? `<span class="contador">${pend.length}</span>` : ''}</h1>
    <p class="apoio" style="margin-bottom:var(--esp-4)">A data já passou e ainda não foram confirmados. Continuam contando na previsão até vocês decidirem. Para adiar, edite a data; para cancelar, exclua.</p>
    ${pend.length ? `<div class="list">${pend.map(pendItem).join('')}</div>` : `<div class="vazio">${ic('check')}<p>Nada para confirmar. Pode ir fazer outra coisa da vida.</p></div>`}`;
}

function scrMes(mes) {
  const res = M.resumoMes(S, mes);
  const grupo = (tipo, titulo) => {
    const todas = res.linhas.filter(x => x.categoria.tipo === tipo && (!x.categoria.sistema || x.realizado || x.previsto));
    const vazias = todas.filter(x => x.orcado === null && !x.realizado && !x.previsto);
    const ls = todas.filter(x => !vazias.includes(x))
      .sort((a, b) => (b.disponivel < 0) - (a.disponivel < 0) || (b.uso === Infinity ? 9 : b.uso) - (a.uso === Infinity ? 9 : a.uso));
    if (!todas.length) return '';
    const semOrc = vazias.length ? `<p class="small muted" style="margin-top:var(--esp-3)">Sem orçado neste mês: ${vazias.map(x => `<a href="#/mes/${mes}/${esc(x.categoria.id)}">${esc(x.categoria.nome)}</a>`).join(' · ')}</p>` : '';
    return `<h2 class="section-title">${titulo}</h2>${ls.length ? `<div class="list">${ls.map(x => linhaCategoria(x, mes)).join('')}</div>` : ''}${semOrc}`;
  };
  return `${banners()}
    <div class="top"><h1>Mês</h1></div>
    ${seletorMes(mes, m => `#/mes/${m}`)}
    ${resumoCard(res, mes)}
    <p class="small muted" style="margin-top:var(--esp-3)">Compras no cartão contam no mês da fatura. A sobra do orçado não passa para o mês seguinte. Toque numa categoria para ver os lançamentos dela.</p>
    ${grupo('saida', 'Saídas')}${grupo('investimento', 'Investimentos')}${grupo('entrada', 'Entradas')}`;
}

// Resumo do mês: o que foi planejado, o que já aconteceu e o que ainda está previsto.
function resumoCard(res, mes) {
  const n = v => formatarReais(v).replace(/R\$\s?/, '');
  const row = (rot, o, r, p) => `<tr><th scope="row">${rot}</th><td>${n(o)}</td><td>${n(r)}</td><td>${n(p)}</td></tr>`;
  const sa = res.saidas;
  return `<div class="card stack">
    <h2>Resumo de ${monthName(mes, false)} <span class="small muted" style="font-weight:400">(R$)</span></h2>
    <table class="resumo">
      <thead><tr><th><span class="sr-only">Grupo</span></th><th scope="col">Orçado</th><th scope="col">Realizado</th><th scope="col">Previsto</th></tr></thead>
      <tbody>
        ${row('Entradas', res.entradas.orcado, res.entradas.realizado, res.entradas.previsto)}
        ${row('Saídas', sa.orcado, sa.realizado, sa.previsto)}
        ${row('Guardado', res.guardadoOrcado, res.guardado, res.guardadoPrevisto)}
      </tbody>
    </table>
    <div class="calc">
      <div class="kv"><span>Sobra planejada <span class="small muted">(pelo orçado)</span></span><span class="num ${res.sobraOrcada < 0 ? 'neg' : ''}">${money(res.sobraOrcada)}</span></div>
      <div class="kv"><span>Sobra projetada <span class="small muted">(contando o que passou do orçado)</span></span><span class="num ${res.sobraProjetada < 0 ? 'neg' : ''}">${money(res.sobraProjetada)}</span></div>
      <div class="kv"><span>Ainda cabe gastar nas saídas</span><span class="num">${money(sa.livre)}</span></div>
      ${sa.estouradas ? `<div class="kv"><span class="neg">${sa.estouradas} ${sa.estouradas === 1 ? 'categoria passou' : 'categorias passaram'} do orçado</span><span class="num neg">${money(sa.acima)}</span></div>` : ''}
    </div>
  </div>`;
}

function scrMesCategoria(mes, catId) {
  const c = M.categoria(S, catId);
  if (!c) return `<div class="top">${backBtn(`#/mes/${mes}`)}</div><p>Categoria não encontrada.</p>`;
  const x = M.catMes(S, catId, mes);
  const entrada = c.tipo === 'entrada';
  const est = !entrada && x.orcado !== null && x.disponivel < 0;
  const ls = S.get('Lancamentos').filter(l => l.categoria_id === catId && l.mes_orcamento === mes)
    .sort((a, b) => a.data.localeCompare(b.data));
  const pend = ls.filter(l => l.situacao === 'previsto' && l.data <= hoje() && !(l.forma === 'cartao' && l.recorrencia_id));
  const prev = ls.filter(l => l.situacao === 'previsto' && !pend.includes(l));
  const conf = ls.filter(l => l.situacao === 'confirmado').reverse();
  const bloco = (t, arr) => arr.length ? `<h2 class="section-title">${t} <span class="contador" style="background:var(--cor-lavanda)">${arr.length}</span></h2><div class="list">${arr.map(l => lancItem(l, { data: true })).join('')}</div>` : '';
  const rotulo = entrada ? 'Falta receber' : x.orcado === null ? 'Sem orçado' : est ? 'Acima do orçado' : 'Disponível';
  const valor = entrada ? money(Math.max(0, (x.orcado || 0) - x.realizado)) : x.orcado === null ? money(x.realizado + x.previsto) : money(Math.abs(x.disponivel));
  return `${banners()}
    <div class="top">${backBtn(`#/mes/${mes}`)}<button class="btn" data-act="orcado" data-cat="${esc(catId)}" data-mes="${mes}">${ic('pencil')}${x.orcado === null ? 'Definir orçado' : 'Alterar orçado'}</button></div>
    <div class="row" style="justify-content:flex-start;margin-bottom:var(--esp-3)">${icCategoria(c)}<h1>${esc(c.nome)}</h1>${c.repasse ? '<span class="badge prev">repasse</span>' : ''}</div>
    ${seletorMes(mes, m => `#/mes/${m}/${esc(catId)}`)}
    <div class="card stack">
      <div class="row"><div><div class="label">${rotulo}</div><div class="num ${est ? 'neg' : ''}" style="font-size:var(--txt-numero-g);line-height:1.1">${valor}</div></div>
        ${est ? '<span class="badge est">estourou</span>' : ''}</div>
      ${x.orcado !== null ? barra(x.realizado, x.previsto, x.orcado) : ''}
      <div class="grid3">
        <div><div class="small muted">Orçado</div><div class="num">${x.orcado !== null ? money(x.orcado) : '—'}</div></div>
        <div><div class="small muted">${entrada ? 'Recebido' : 'Realizado'}</div><div class="num">${money(x.realizado)}</div></div>
        <div><div class="small muted">Previsto</div><div class="num">${money(x.previsto)}</div></div>
      </div>
      ${x.orcado === null && !entrada ? `<p class="small muted">${esc(c.nome)} não tem valor orçado em ${monthName(mes, false)}. Quer definir agora?</p>` : ''}
    </div>
    ${bloco('Para confirmar', pend)}${bloco('Previstos', prev)}${bloco(entrada ? 'Recebidos' : 'Realizados', conf)}
    ${!ls.length ? `<div class="vazio">${icCategoria(c)}<p>Nada lançado em ${esc(c.nome)} em ${monthName(mes, false)}.</p></div>` : ''}`;
}


// ---------- Pendentes ----------

// ---------- Mês ----------

// Resumo do mês: o que foi planejado, o que já aconteceu e o que ainda está previsto.

// ---------- Categoria no mês ----------

// ---------- Mais ----------
function scrMais() {
  const q = S.queue.length;
  const ir = (href, icone, t) => `<a class="item" href="${href}">${ic(icone)}<span class="meio"><span class="t">${t}</span></span>${ic('chevron-right')}</a>`;
  return `${banners()}
    <div class="top"><h1>Mais</h1></div>
    <div class="stack">
      <div class="card stack"><div class="label">Planilha conectada</div>
        <div><b>${esc(S.spreadsheet?.name || '')}</b><br><span class="small muted">Quem acessa é definido no compartilhamento do Google Drive.</span></div>
        <div class="small muted">${S.s.lastSync ? `Última sincronização: ${new Date(S.s.lastSync).toLocaleString('pt-BR')}` : 'Ainda não sincronizou'}${q ? ` · ${q} ${q === 1 ? 'alteração espera' : 'alterações esperam'} o envio` : ''}</div>
        <div class="btns">${sheetLink('Abrir no Google Drive')}<button class="btn" data-act="sync">${ic('refresh-cw')}Sincronizar agora</button></div>
      </div>
      <div class="list">
        ${ir('#/cartoes', 'credit-card', 'Cartões e faturas')}
        ${ir('#/categorias', 'tag', 'Categorias')}
        ${ir('#/saldo', 'sliders-horizontal', 'Ajustar saldo real')}
        ${ir('#/setup/orcamento', 'calendar-range', 'Orçar o mês atual')}
        ${ir('#/setup/compartilhar', 'user-round', 'Usar junto com o cônjuge')}
        <button class="item" data-act="tutorial" data-passo="0">${ic('circle-help')}<span class="meio"><span class="t">Como o Oikon organiza o dinheiro</span><span class="s">Orçado, previsto, realizado e a previsão do mês</span></span>${ic('chevron-right')}</button>
        <button class="item" data-act="tutorial" data-passo="5">${ic('smartphone')}<span class="meio"><span class="t">Como usar no dia a dia</span><span class="s">Inclui como colocar na tela inicial do celular</span></span>${ic('chevron-right')}</button>
      </div>
      <div class="card stack"><div class="label">Conta neste aparelho</div><div>${esc(S.user?.email || '')}</div>
        <button class="btn danger" data-act="logout">${ic('log-out')}Sair e limpar os dados deste aparelho</button>
        <div class="small muted">A planilha no Drive não muda.</div></div>
    </div>`;
}

function sheetLink(label) {
  if (!S.spreadsheet) return '';
  if (DEMO) return '<p class="small muted">(No modo demonstração não há planilha real.)</p>';
  return `<a class="btn" target="_blank" rel="noopener" href="https://docs.google.com/spreadsheets/d/${esc(S.spreadsheet.id)}/edit">${label}</a>`;
}

function scrCartoes() {
  const cs = M.cartoes(S, true);
  return `${banners()}
    <div class="top">${backBtn('#/mais')}</div>
    <h1 style="margin-bottom:var(--esp-4)">Cartões e faturas</h1>
    <div class="stack">
      ${cs.length ? cs.map(c => {
        const prox = M.faturasDoCartao(S, c.id).find(f => f.situacao !== 'paga' && f.previsao > 0);
        return `<a class="card stack" href="#/cartao/${esc(c.id)}" style="gap:var(--esp-2)">
          <div class="row"><h2>${esc(c.nome)}${c.ativo ? '' : ' <span class="badge envio">fora de uso</span>'}</h2>${ic('chevron-right')}</div>
          <span class="small muted">${esc(c.titular)} · fecha dia ${c.dia_fechamento} · vence dia ${c.dia_vencimento}</span>
          ${prox ? `<span class="label">Fatura de ${monthName(prox.mes, false)}</span><span class="big num">${money(prox.previsao)}</span>
            <span class="small muted">${money(prox.total)} lançado${prox.estimativa ? ` · ${money(prox.estimativa)} estimado pelo orçado` : ''}</span>` : '<span class="small muted">Nenhuma fatura aberta.</span>'}
        </a>`;
      }).join('') : `<div class="vazio">${ic('credit-card')}<p>Nenhum cartão cadastrado. Gastos no cartão precisam dele para saber em qual fatura e mês contam.</p></div>`}
      ${cardForm(null, 'cartao')}
    </div>`;
}

function scrCartao(id) {
  const c = M.cartao(S, id);
  if (!c) return `<div class="top">${backBtn('#/cartoes')}</div><p>Cartão não encontrado.</p>`;
  const todas = M.faturasDoCartao(S, id);
  // Ordem cronológica. Das pagas, mostra só as duas mais recentes; as anteriores ficam atrás de um link.
  const pagas = todas.filter(f => f.situacao === 'paga');
  const ocultas = ui.faturasAntigas === id ? [] : pagas.slice(0, Math.max(0, pagas.length - 2));
  const fats = todas.filter(f => !ocultas.includes(f));
  const cats = M.categoriasDoCartao(S, id);
  return `${banners()}
    <div class="top">${backBtn('#/cartoes')}</div>
    <h1>${esc(c.nome)}</h1>
    <p class="small muted" style="margin-top:var(--esp-1)">${esc(c.titular)} · fecha dia ${c.dia_fechamento} · vence dia ${c.dia_vencimento}</p>
    <h2 class="section-title">Faturas</h2>
    ${ocultas.length ? `<button class="btn link" data-act="faturas-antigas" data-id="${esc(id)}">Ver faturas anteriores (${ocultas.length})</button>` : ''}
    ${fats.length ? `<div class="list">${fats.map(f => {
      const paga = f.situacao === 'paga';
      const vencida = !paga && f.data_vencimento <= hoje() && f.total > 0;
      return `<button class="item" data-act="fatura" data-id="${esc(f.id)}">${ic('credit-card')}
        <span class="meio"><span class="t">${cap(monthName(f.mes))}${vencida ? ' <span class="badge pend">para confirmar</span>' : ''}</span>
          <span class="s">fecha ${fmtDate(f.data_fechamento)} · vence ${fmtDate(f.data_vencimento)}${paga ? ` · paga em ${fmtDate(f.data_pagamento)}` : ''}</span></span>
        <span class="r"><span class="num">${money(paga ? f.total : f.previsao)}</span>${f.estimativa ? `<span class="small muted">${money(f.total)} lançado · ${money(f.estimativa)} estimado</span>` : paga ? '<span class="badge ok">paga</span>' : ''}</span></button>`;
    }).join('')}</div>` : `<div class="vazio">${ic('credit-card')}<p>Nenhuma compra neste cartão ainda.</p></div>`}
    ${cats.length ? `<p class="small muted" style="margin-top:var(--esp-3)">Faturas abertas somam o que já foi lançado e o orçado ainda não gasto de: ${cats.map(x => esc(x.nome)).join(', ')}.</p>` : ''}
    <div class="secao">${cardForm(c, 'cartao')}</div>
    <p class="small muted" style="margin-top:var(--esp-3)">Cartão com compras não pode ser apagado: desligue "Cartão em uso" para tirá-lo das opções.</p>`;
}

function scrCategorias() {
  const TIPO = { saida: 'Saída', entrada: 'Entrada', investimento: 'Investimento' };
  const grupo = (tipo, titulo) => {
    const cs = M.categorias(S, { tipo, todas: true }).filter(c => !c.sistema);
    return `<h2 class="section-title">${titulo}</h2><div class="list">${cs.map(c => `<button class="item" data-act="categoria" data-id="${esc(c.id)}">${icCategoria(c)}
      <span class="meio"><span class="t">${esc(c.nome)} <span class="badge prev">${TIPO[c.tipo]}</span>${c.repasse ? ' <span class="badge prev">repasse</span>' : ''}${c.arquivada ? ' <span class="badge envio">arquivada</span>' : ''}</span>
      <span class="s">${formaPrevistaNome(c) ? `pago em ${esc(formaPrevistaNome(c))} · ` : ''}${esc(S.get('Palavras').filter(p => p.categoria_id === c.id).map(p => p.palavra).slice(0, 6).join(', ') || 'sem palavras')}</span></span>${ic('chevron-right')}</button>`).join('') || '<p class="apoio">Nenhuma.</p>'}</div>`;
  };
  return `${banners()}
    <div class="top">${backBtn('#/mais')}<button class="btn primary" data-act="categoria" data-id="">${ic('plus')}Nova categoria</button></div>
    <h1>Categorias</h1>
    <p class="apoio" style="margin-top:var(--esp-2)">As palavras são o que o campo de lançamento usa para sugerir a categoria. Elas também são aprendidas a cada lançamento.</p>
    ${grupo('saida', 'Saídas')}${grupo('investimento', 'Investimentos')}${grupo('entrada', 'Entradas')}`;
}

function scrSaldo() {
  const saldo = M.saldoAtual(S);
  const pend = M.pendentes(S);
  return `${banners()}
    <div class="top">${backBtn('#/inicio')}</div>
    <h1>Ajustar saldo</h1>
    <form class="stack" data-form="ajuste" style="margin-top:var(--esp-4)">
      <div class="card metrica"><span class="label">Saldo atual no Oikon</span><span class="big num">${money(saldo)}</span></div>
      ${campoValor('real', 'Quanto tem na conta hoje', '', true)}
      <p class="small muted">A diferença vira um lançamento "Ajuste de saldo" na categoria Ajustes, com a data de hoje.</p>
      ${pend.length ? aviso('warn', '', `Há ${pend.length} ${pend.length === 1 ? 'lançamento' : 'lançamentos'} para confirmar, fora do saldo atual. Se já foram pagos, confirme antes de ajustar. <a href="#/pendentes">Ver</a>`) : ''}
      <button class="btn primary">Ajustar saldo</button>
    </form>`;
}

// Campo de valor (8.13): Outfit, alinhado à direita, prefixo R$, teclado numérico.
function campoValor(nome, rotulo, valor = '', obrigatorio = false, extra = '') {
  return `<label class="field valor ${extra}"><span>${rotulo}</span><span class="caixa"><input name="${nome}" inputmode="decimal" placeholder="0,00" value="${valor !== null && valor !== undefined && valor !== '' ? esc(String(valor).replace('.', ',')) : ''}" ${obrigatorio ? 'required' : ''}></span></label>`;
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



// ---------- Categorias ----------

function formaPrevistaNome(c) {
  const fp = M.formaPrevista(S, c.id);
  if (!fp) return '';
  return fp.forma === 'cartao' ? (M.cartao(S, fp.cartao_id)?.nome || '') : M.formaNome(fp.forma);
}

// ---------- Ajustar saldo ----------

// ---------- Painéis (lançamento, edição, orçado, fatura, categoria) ----------
function openModal(m) { ui.modal = m; renderModal(); }
function closeModal() { ui.modal = null; renderModal(); }

function renderModal() {
  const m = ui.modal;
  const el = $('#modal');
  if (!m) { el.innerHTML = ''; document.body.style.overflow = ''; return; }
  let html = '';
  if (m.type === 'novo') html = interpretacao(m);
  else if (m.type === 'editar') html = draftForm(m);
  else if (m.type === 'excluir') html = excluirPanel(m);
  else if (m.type === 'orcado') html = orcadoPanel(m);
  else if (m.type === 'fatura') html = faturaPanel(m);
  else if (m.type === 'categoria') html = categoriaPanel(m);
  else if (m.type === 'confirmar') html = confirmPanel(m);
  else if (m.type === 'composicao') html = composicaoPanel();
  else if (m.type === 'tutorial') html = tutorialPanel(m);
  const novo = !el.firstChild;
  el.innerHTML = `<div class="modal-bg" data-act="modal-bg"><div class="modal" role="dialog" aria-modal="true" aria-labelledby="mh-t" ${novo ? '' : 'style="animation:none"'}>${html}</div></div>`;
  if (!novo) el.querySelector('.modal-bg').style.animation = 'none';
  document.body.style.overflow = 'hidden';
  // Foco só ao abrir o painel ou um campo, nunca a cada redesenho (não rouba o clique da pessoa).
  if (novo || m._focar) {
    const f = el.querySelector('[data-foco], [autofocus]') || el.querySelector('.x');
    if (f) f.focus({ preventScroll: true });
    const caixa = el.querySelector('.modal'); if (caixa) caixa.scrollTop = 0;
    m._focar = false;
  }
}

const head = title => `<div class="mh"><h2 id="mh-t">${title}</h2><button class="x" data-act="close" aria-label="Fechar">${ic('x')}</button></div>`;

// Interpretação do lançamento (8.3): o que o app entendeu, em chips editáveis, antes de salvar.
function interpretacao(m) {
  const d = m.d;
  const e = m.errors || {};
  const cat = M.categoria(S, d.categoria_id);
  const card = d.forma === 'cartao' ? M.cartao(S, d.cartao_id) : null;
  const precisaCartao = d.forma === 'cartao' && !d.cartao_id;
  const fprev = faturaPreview(d);
  const mes = mesDoDraft(d);
  const needOrc = M.precisaOrcado(S, d.categoria_id, mes) && !(m.dup && d.dup === 'confirmar');
  const aberto = m.aberto !== undefined ? m.aberto
    : !(d.valor > 0) ? 'valor' : !d.categoria_id ? 'categoria' : precisaCartao ? 'forma' : null;
  const fatId = d.fatura_id || (fprev && fprev.id) || '';
  const fatMes = fatId ? (M.faturaInfoFromId(S, fatId)?.mes || mes) : mes;
  const REP = { unica: 'Só desta vez', parcelada: `${d.vezes || 2} parcelas`, mensal: d.vezes ? `${d.vezes} meses` : 'Todo mês', anual: d.vezes ? `${d.vezes} anos` : 'Todo ano' };
  const TIPOS = { saida: 'Gasto', entrada: 'Entrada', investimento: 'Investimento' };
  const chip = (campo, rotulo, falta = false) => `<button type="button" class="chip ed ${falta ? 'falta' : ''} ${aberto === campo ? 'aberto' : ''}" data-act="abrir" data-campo="${campo}" aria-expanded="${aberto === campo}">${rotulo}${falta ? '' : ic('pencil')}</button>`;
  const oculto = (n, v) => `<input type="hidden" name="${n}" value="${esc(v ?? '')}">`;
  // Campos fechados vão escondidos, para o formulário sempre ter tudo.
  const campos = {
    valor: () => `${campoValor('valor', d.repeticao === 'parcelada' ? 'Valor total' : 'Valor', d.valor, false, e.valor ? 'err' : '').replace('<input ', '<input data-foco ')}${e.valor ? `<span class="error" role="alert">${e.valor}</span>` : ''}
      <label class="field"><span>Descrição</span><input name="descricao" value="${esc(d.descricao || '')}"></label>`,
    tipo: () => `<div class="seg" role="radiogroup" aria-label="Tipo">${Object.entries(TIPOS).map(([v, l]) => `<label><input type="radio" name="tipo" value="${v}" ${d.tipo === v ? 'checked' : ''} data-change>${l}</label>`).join('')}</div>`,
    categoria: () => {
      const cats = M.categorias(S, { tipo: d.tipo }).filter(c => !c.sistema || c.id === d.categoria_id);
      return `<label class="field ${e.categoria ? 'err' : ''}"><span>Categoria</span>
        <select name="categoria_id" data-change data-foco><option value="">Escolha a categoria</option>${cats.map(c => `<option value="${esc(c.id)}" ${c.id === d.categoria_id ? 'selected' : ''}>${esc(c.nome)}</option>`).join('')}</select>
        ${e.categoria ? `<span class="error" role="alert">${e.categoria}</span>` : !d.categoria_id ? `<span class="hint">${d.descricao ? `Não reconheci "${esc(d.descricao.toLowerCase())}". Qual é a categoria? (Vou lembrar da próxima vez.)` : 'Qual é a categoria?'}</span>` : ''}</label>`;
    },
    forma: () => {
      const formas = [...M.FORMAS.filter(f => f.id !== 'cartao').map(f => [f.id, f.nome]), ...(d.tipo === 'entrada' ? [] : M.cartoes(S).map(c => [`cartao:${c.id}`, `Cartão · ${c.nome}`]))];
      if (d.forma === 'ajuste') formas.push(['ajuste', 'Ajuste']);
      const val = d.forma === 'cartao' ? `cartao:${d.cartao_id || ''}` : d.forma;
      return `<label class="field ${e.forma ? 'err' : ''}"><span>Pagamento</span>
        <select name="forma" data-change data-foco>${precisaCartao ? '<option value="cartao:" selected>Escolha o cartão</option>' : ''}${formas.map(([v, l]) => `<option value="${esc(v)}" ${v === val ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>
        ${e.forma ? `<span class="error" role="alert">${e.forma}</span>` : d.cartoesAmbiguos && precisaCartao ? '<span class="hint">Há mais de um cartão com esse nome. Escolha qual.</span>' : ''}</label>`;
    },
    data: () => `<label class="field"><span>${d.forma === 'cartao' ? 'Data da compra' : 'Data'}</span><input type="date" name="data" value="${esc(d.data)}" data-change data-foco></label>`,
    fatura: () => {
      const base = fprev ? fprev.mes : fatMes;
      return `<label class="field"><span>Fatura</span><select name="fatura_id" data-change data-foco>${[-1, 0, 1, 2].map(k => {
        const mm = addMonthKey(base, k); const fid = `${d.cartao_id}_${mm}`;
        return `<option value="${fid}" ${fatId === fid ? 'selected' : ''}>${cap(monthName(mm))}${k === 0 ? ' (calculada)' : ''}</option>`;
      }).join('')}</select><span class="hint">A compra conta no orçamento do mês da fatura.</span></label>`;
    },
    repeticao: () => `<div class="grid2">
      <label class="field"><span>Repetição</span><select name="repeticao" data-change data-foco>${[['unica', 'Só desta vez'], ['parcelada', 'Parcelada'], ['mensal', 'Todo mês'], ['anual', 'Todo ano']].map(([v, l]) => `<option value="${v}" ${d.repeticao === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      ${d.repeticao !== 'unica' ? `<label class="field ${e.vezes ? 'err' : ''}"><span>${d.repeticao === 'parcelada' ? 'Parcelas' : 'Quantas vezes'}</span><input name="vezes" type="number" min="${d.repeticao === 'parcelada' ? 2 : 1}" max="120" value="${d.vezes ?? ''}" placeholder="${d.repeticao === 'parcelada' ? '2' : 'sem fim'}" data-change>${e.vezes ? `<span class="error" role="alert">${e.vezes}</span>` : ''}</label>` : '<span></span>'}
    </div>`,
  };
  const escondidos = {
    valor: () => oculto('valor', d.valor !== null && d.valor !== undefined ? String(d.valor).replace('.', ',') : '') + oculto('descricao', d.descricao),
    tipo: () => oculto('tipo', d.tipo),
    categoria: () => oculto('categoria_id', d.categoria_id),
    forma: () => oculto('forma', d.forma === 'cartao' ? `cartao:${d.cartao_id || ''}` : d.forma),
    data: () => oculto('data', d.data),
    fatura: () => (card ? oculto('fatura_id', fatId) : ''),
    repeticao: () => oculto('repeticao', d.repeticao) + (d.repeticao !== 'unica' ? oculto('vezes', d.vezes ?? '') : ''),
  };
  const dataRot = d.data === hoje() ? 'Hoje' : d.data === addDays(hoje(), -1) ? 'Ontem' : fmtDate(d.data);
  const chips = [
    chip('tipo', TIPOS[d.tipo]),
    cat ? chip('categoria', esc(cat.nome)) : chip('categoria', 'Escolher categoria', true),
    precisaCartao ? chip('forma', 'Escolher o cartão', true) : chip('forma', esc(card ? card.nome : M.formaNome(d.forma))),
    chip('data', dataRot),
    card ? chip('fatura', `Fatura de ${monthName(fatMes, false)}`) : '',
    chip('repeticao', REP[d.repeticao] || 'Só desta vez'),
  ].join('');
  return `${head('Confira o lançamento')}
    <form class="stack interp" data-form="draft" novalidate>
      <div>
        <button type="button" class="valor-t num" data-act="abrir" data-campo="valor" aria-label="Alterar valor e descrição">${d.valor > 0 ? money(d.valor) : 'R$ —'}</button>
        <div class="desc-t">${esc(d.descricao || cat?.nome || 'Lançamento')}${d.repeticao === 'parcelada' && d.vezes && d.valor ? ` · ${d.vezes}× de ${money(round2(d.valor / d.vezes))}` : ''}</div>
      </div>
      <div class="chips">${chips}</div>
      ${aberto && campos[aberto] ? `<div class="stack">${campos[aberto]()}</div>` : ''}
      ${Object.keys(escondidos).filter(k => k !== aberto).map(k => escondidos[k]()).join('')}
      ${avisoCategoria(d, mes)}
      ${needOrc ? `<div class="card alert stack"><b>${esc(cat?.nome || '')} não tem valor orçado em ${monthName(mes, false)}. Quer definir agora?</b>
        <span class="small">Todo gasto precisa de orçado na categoria. O orçado não muda o saldo, só a previsão.</span>
        ${campoValor('orcado_valor', `Orçado de ${monthName(mes, false)}`, d.orcado_valor, false, e.orcado ? 'err' : '')}${e.orcado ? `<span class="error" role="alert">${e.orcado}</span>` : ''}</div>` : ''}
      ${m.dup ? `<div class="card info stack"><b>Já existe "${esc(m.dup.descricao)}" previsto para ${fmtDate(m.dup.data)} (${money(m.dup.valor)})</b>
        <label class="check"><input type="radio" name="dup" value="confirmar" ${d.dup !== 'novo' ? 'checked' : ''} data-change> Confirmar o previsto com estes dados</label>
        <label class="check"><input type="radio" name="dup" value="novo" ${d.dup === 'novo' ? 'checked' : ''} data-change> Criar um lançamento novo</label></div>` : ''}
      <div class="btns col">
        <button class="btn primary block" name="acao" value="salvar">Confirmar</button>
        <button type="button" class="btn link" data-act="close">Cancelar</button>
      </div>
    </form>`;
}

// Retorno da categoria antes de salvar (R9, R10): como ela fica com este lançamento.
function avisoCategoria(d, mes) {
  const c = M.categoria(S, d.categoria_id);
  if (!c || c.sistema || !(d.valor > 0)) return '';
  const x = M.catMes(S, c.id, mes);
  const orc = x.orcado ?? parseMoney(d.orcado_valor);
  if (orc === null || orc === undefined) return '';
  const usado = round2(x.realizado + x.previsto + d.valor);
  const mesTxt = monthName(mes, false);
  if (c.tipo === 'entrada') return aviso('ok', '', `${esc(c.nome)}: ${money(usado)} de ${money(orc)} previstos em ${mesTxt}.`);
  const resto = round2(orc - usado);
  if (resto < 0) return aviso('err', '', `${esc(c.nome)} vai passar ${money(-resto)} do orçado em ${mesTxt}.`);
  if (orc > 0 && usado / orc >= 0.8) return aviso('warn', '', `${esc(c.nome)} fica perto do limite: sobram ${money(resto)} em ${mesTxt}.`);
  return aviso('', '', `${esc(c.nome)}: ${money(usado)} de ${money(orc)} usados em ${mesTxt}.`);
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
  closeModal();
  if (m.type === 'novo') { const i = $('#cmp'); if (i) { i.value = ''; i.form.querySelector('button').disabled = true; } }
  toast(m.type === 'editar' ? 'Alterações salvas.' : textoAnotado(salvo, d));
}

// Textos da seção 11.2 do design system.
function textoAnotado(l, d) {
  if (!l) return 'Anotado.';
  const desc = String(l.descricao || '').toLowerCase();
  const card = l.cartao_id ? M.cartao(S, l.cartao_id) : null;
  if (card) return `Anotado na fatura de ${monthName(l.mes_orcamento, false)} do ${card.nome}.`;
  const prev = l.situacao === 'previsto' ? `, previsto para ${fmtDate(l.data)}` : '';
  if (l.tipo === 'entrada') return `${prev ? 'Anotado' : 'Entrou'}: ${desc}, ${money(l.valor)}${prev}.`;
  const onde = { pix: 'no Pix', debito: 'no débito', dinheiro: 'em dinheiro', boleto: 'no boleto' }[l.forma] || '';
  const vezes = d && d.repeticao === 'parcelada' ? ` em ${d.vezes} vezes` : '';
  return `Anotado: ${desc}, ${money(l.valor)}${onde ? ' ' + onde : ''}${vezes}${prev}.`;
}

function excluirPanel(m) {
  const l = S.find('Lancamentos', m.id);
  if (!l) return head('Excluir') + '<p>Lançamento não encontrado.</p>';
  const rec = l.recorrencia_id ? S.find('Recorrencias', l.recorrencia_id) : null;
  return `${head('Excluir este lançamento?')}
    <form class="stack" data-form="excluir">
      <input type="hidden" name="id" value="${esc(l.id)}">
      <p><b>${esc(l.descricao)}</b> · <span class="num">${money(l.valor)}</span> · ${fmtDate(l.data)}</p>
      ${rec ? `<div class="stack">
        <label class="check"><input type="radio" name="alcance" value="esta" checked> Só esta ${rec.repeticao === 'parcelada' ? 'parcela' : 'vez'} (${fmtDate(l.data)})</label>
        <label class="check"><input type="radio" name="alcance" value="proximas"> Esta e as próximas${rec.total_ocorrencias ? '' : ' (encerra a repetição)'}</label></div>` : ''}
      <p class="apoio">Não dá para desfazer depois.</p>
      <div class="btns"><button type="button" class="btn" data-act="close">Manter</button><button class="btn danger cheio">${ic('trash-2')}Excluir</button></div>
    </form>`;
}

function orcadoPanel(m) {
  const c = M.categoria(S, m.cat);
  const x = M.catMes(S, m.cat, m.mes);
  return `${head(`${esc(c.nome)} · ${monthName(m.mes, false)}`)}
    <form class="stack" data-form="orcado">
      <input type="hidden" name="cat" value="${esc(m.cat)}"><input type="hidden" name="mes" value="${m.mes}">
      ${campoValor('valor', `Orçado de ${monthName(m.mes, false)}`, x.orcado).replace('<input ', '<input data-foco ')}
      <p class="small muted">${c.tipo === 'entrada' ? 'Recebido' : 'Realizado'} ${money(x.realizado)} · previsto ${money(x.previsto)}. O orçado não muda o saldo, só a previsão.</p>
      <button class="btn primary" name="modo" value="so">Salvar só em ${monthName(m.mes, false)}</button>
      <button class="btn" name="modo" value="repetir">Salvar e copiar para os próximos 12 meses</button>
      <p class="small muted">Copiar não muda meses que já tinham um valor ajustado à mão.</p>
    </form>`;
}

function faturaPanel(m) {
  const f = M.faturaInfoFromId(S, m.id);
  if (!f) return head('Fatura') + '<p>Fatura não encontrada.</p>';
  const c = M.cartao(S, f.cartao_id);
  const itens = M.faturaItens(S, m.id);
  const total = M.faturaTotal(S, m.id);
  const est = M.estimativaFatura(S, m.id);
  const estTotal = round2(est.reduce((t, x) => t + x.valor, 0));
  const paga = f.situacao === 'paga';
  const dataPadrao = f.data_vencimento <= hoje() ? f.data_vencimento : hoje();
  return `${head(`Fatura ${esc(c?.nome || '')} · ${monthName(f.mes, false)}`)}
    <div class="num" style="font-size:var(--txt-numero-g);line-height:1.1">${money(round2(total + estTotal))}</div>
    <p class="small muted" style="margin:var(--esp-1) 0 var(--esp-4)">Compras de ${fmtDate(inicioFatura(f, c))} a ${fmtDate(addDays(f.data_fechamento, -1))} · fecha ${fmtDate(f.data_fechamento)} · vence ${fmtDate(f.data_vencimento)} · contam no orçamento de ${monthName(f.mes, false)}</p>
    <div class="list">${itens.map(l => lancItem(l, { data: true })).join('') || '<p class="apoio">Nenhuma compra lançada ainda.</p>'}
      <div class="item total"><span class="meio"><span class="t">${est.length ? 'Lançado até agora' : 'Total calculado'}</span></span><span class="r"><span class="num">${money(total)}</span></span></div></div>
    ${est.length ? `<h3 class="section-title">Estimado pelo orçado</h3>
      <div class="list">${est.map(x => `<div class="item">${icCategoria(x.categoria)}<span class="meio"><span class="t">${esc(x.categoria.nome)}</span><span class="s">orçado ainda não gasto em ${monthName(f.mes, false)}</span></span><span class="r"><span class="num apoio">${money(x.valor)}</span><span class="small muted">estimado</span></span></div>`).join('')}
        <div class="item total"><span class="meio"><span class="t">Fatura prevista</span></span><span class="r"><span class="num">${money(round2(total + estTotal))}</span></span></div></div>
      <p class="small muted" style="margin-top:var(--esp-3)">A estimativa diminui conforme as compras são lançadas e some quando a fatura fecha. A forma prevista de cada categoria fica em Categorias.</p>` : ''}
    ${paga ? aviso('ok', 'check', `Paga em ${fmtDate(f.data_pagamento)}.`) : f.data_fechamento > hoje() ? `<p class="small muted" style="margin-top:var(--esp-3)">A fatura fecha em ${fmtDate(f.data_fechamento)}. O pagamento é confirmado depois disso.</p>` : `<form class="stack secao" data-form="pagar">
      <input type="hidden" name="id" value="${esc(m.id)}">
      ${campoValor('valor', 'Valor cobrado pelo banco', total).replace('</label>', '<span class="hint">Se for diferente do calculado, a diferença vira o item "Ajuste da fatura".</span></label>')}
      <label class="field"><span>Data do pagamento</span><input type="date" name="data" value="${dataPadrao}"><span class="hint">O saldo cai nesta data. Pode ser antes do vencimento.</span></label>
      <button class="btn primary">Confirmar pagamento</button>
      <p class="small muted">Compra estornada: abra o item e exclua.</p></form>`}`;
}

function confirmPanel(m) {
  return `${head(esc(m.title))}<p style="margin-bottom:var(--esp-5)">${m.text}</p><div class="btns"><button class="btn" data-act="close">Cancelar</button><button class="btn ${m.danger ? 'danger cheio' : 'primary'}" data-act="confirm-yes">${esc(m.yes)}</button></div>`;
}

// Composição do fechamento (toque no bloco de destaque).
function composicaoPanel() {
  const fd = M.fechamentoDetalhe(S);
  const linha = (rot, v, sinal) => v ? `<div class="kv"><span>${sinal} ${rot}</span><span class="num">${money(v)}</span></div>` : '';
  return `${head(`Como chega em ${fmtDate(fd.fim)}`)}
    <div class="calc">
      <div class="kv"><span>Saldo na conta hoje</span><span class="num">${money(fd.saldo)}</span></div>
      ${linha('A receber', fd.receber, '+')}
      ${linha('Contas previstas', fd.pagar, '−')}
      ${linha('Faturas a pagar', fd.faturas, '−')}
      ${linha('Orçado que ainda pode ser gasto', fd.reservado, '−')}
      <div class="kv total"><span>= No fim do mês, deve ${fd.total < 0 ? 'faltar' : 'sobrar'}</span><span class="num ${fd.total < 0 ? 'neg' : ''}">${money(Math.abs(fd.total))}</span></div>
    </div>
    <div class="btns" style="margin-top:var(--esp-5)"><a class="btn" href="#/mes">${ic('calendar-range')}Ver o mês</a><a class="btn" href="#/pendentes">${ic('check')}Para confirmar</a></div>`;
}


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
      ${campoValor('valor', d.repeticao === 'parcelada' ? 'Valor total' : 'Valor', d.valor, false, e.valor ? 'err' : '')}${e.valor ? `<span class="error" role="alert">${e.valor}</span>` : ''}
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
        ${isEdit ? `<button type="button" class="btn danger" data-act="excluir" data-id="${esc(m.orig.id)}">${ic('trash-2')}Excluir lançamento</button>` : `<button type="button" class="btn" data-act="close">Cancelar</button>`}
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
    const nova = fd.get('categoria_id') || '';
    if (nova !== d.categoria_id && d.formaAuto && !d.id) {
      const fp = M.formaPrevista(S, nova);
      if (fp && d.tipo !== 'entrada') { d.forma = fp.forma; d.cartao_id = fp.cartao_id; d.fatura_id = ''; d.formaTrocada = true; }
    }
    d.categoria_id = nova;
  }
  if (fd.has('valor')) d.valor = parseMoney(fd.get('valor'));
  if (fd.has('descricao')) d.descricao = String(fd.get('descricao')).trim();
  if (fd.has('forma') && !d.formaTrocada) {
    const fv = String(fd.get('forma'));
    if (fv !== (d.forma === 'cartao' ? `cartao:${d.cartao_id || ''}` : d.forma)) d.formaAuto = false;
    if (fv.startsWith('cartao:')) {
      const cid = fv.slice(7);
      if (cid !== d.cartao_id) d.fatura_id = '';
      d.forma = 'cartao'; d.cartao_id = cid;
    } else { d.forma = fv; d.cartao_id = ''; d.fatura_id = ''; }
  }
  if (fd.has('data')) { const nd = String(fd.get('data')); if (nd !== d.data) { d.data = nd; if (!d.fatura_manual) d.fatura_id = ''; } }
  if (fd.has('repeticao')) d.repeticao = String(fd.get('repeticao'));
  if (fd.has('vezes')) d.vezes = fd.get('vezes') ? Number(fd.get('vezes')) : null;
  if (fd.has('fatura_id') && !d.formaTrocada) {
    const fid = String(fd.get('fatura_id'));
    const calc = faturaPreview(d);
    d.fatura_id = fid;
    d.fatura_manual = !!(calc && fid !== calc.id);
  }
  if (fd.has('orcado_valor')) d.orcado_valor = String(fd.get('orcado_valor'));
  if (fd.has('dup')) d.dup = String(fd.get('dup'));
  d.formaTrocada = false;
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
      ${(c?.tipo || 'saida') !== 'entrada' ? `<label class="field"><span>Forma de pagamento prevista</span><select name="forma_prevista">
        <option value="">Sem previsão</option>
        ${M.cartoes(S).map(k => `<option value="cartao:${esc(k.id)}" ${c?.forma_prevista === `cartao:${k.id}` ? 'selected' : ''}>Cartão · ${esc(k.nome)}</option>`).join('')}
        ${M.FORMAS.filter(f => f.id !== 'cartao').map(f => `<option value="${f.id}" ${c?.forma_prevista === f.id ? 'selected' : ''}>${f.nome}</option>`).join('')}
      </select><span class="hint">Onde o gasto costuma ser pago. O lançamento já vem com ela, e o orçado ainda não gasto aparece como estimativa na fatura do cartão.</span></label>` : ''}
      <label class="field"><span>Palavras associadas (separadas por vírgula)</span><input name="palavras" value="${esc(pals.map(p => p.palavra).join(', '))}"><span class="hint">O campo de lançamento usa estas palavras para sugerir a categoria.</span></label>
      ${c ? `<label class="check"><input type="checkbox" name="arquivada" ${c.arquivada ? 'checked' : ''} data-change-cat> Arquivada (some do lançamento e do orçamento, mas fica no histórico)</label>
        ${futuros.length && !c.arquivada ? `<label class="field"><span>Se arquivar: mover os ${futuros.length} previstos futuros para</span><select name="mover"><option value="">Escolha</option>${outras.map(o => `<option value="${esc(o.id)}">${esc(o.nome)}</option>`).join('')}</select></label>` : ''}` : ''}
      ${m.error ? `<div class="banner err">${esc(m.error)}</div>` : ''}
      <button class="btn primary">Salvar</button>
    </form>`;
}


// ---------- Tutorial do primeiro acesso ----------
// Aparece uma vez por aparelho, depois de entrar e conectar a planilha. Pode ser revisto em Mais › Como usar o Oikon.
const TUTORIAL_KEY = 'af_tutorial_v2'; // v2: ganhou a parte "Como o Oikon pensa"; quem viu a v1 vê de novo uma vez
const tutorialVisto = () => { try { return localStorage.getItem(TUTORIAL_KEY) === '1'; } catch { return true; } };
const marcarTutorial = () => { try { localStorage.setItem(TUTORIAL_KEY, '1'); } catch { /* ignora */ } };
const instalado = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
function plataforma() {
  const ua = navigator.userAgent || '';
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'ios';
  if (/Android/.test(ua)) return 'android';
  return 'computador';
}
// Android/Chrome avisa quando o app pode ser instalado; guardamos o aviso para o botão "Instalar".
window.addEventListener('beforeinstallprompt', ev => { ev.preventDefault(); ui.instalar = ev; if (ui.modal?.type === 'tutorial') renderModal(); });
window.addEventListener('appinstalled', () => { ui.instalar = null; if (ui.modal?.type === 'tutorial') renderModal(); });

function passoInstalar() {
  const p = plataforma();
  const passo = (n, html) => `<li><span class="n">${n}</span><span>${html}</span></li>`;
  if (instalado()) return { icone: 'smartphone', titulo: 'O Oikon já está na sua tela inicial', texto: '<p>Você está usando o Oikon pelo ícone, como um app. É só abrir por ele daqui em diante.</p>' };
  if (p === 'ios') {
    return {
      icone: 'smartphone', titulo: 'Coloque o Oikon na tela inicial',
      texto: `<p>Assim ele abre como um app, sem barra do navegador. No Safari:</p>
        <ol class="passos">
          ${passo(1, `Toque nos três pontos ${ic('ellipsis', 'mini')}ao lado do endereço e depois em ${ic('share', 'mini')}<b>Compartilhar</b>. Em versões anteriores ao iOS 26, o ${ic('share', 'mini')}<b>Compartilhar</b> fica direto na barra de baixo.`)}
          ${passo(2, `Role a lista e toque em ${ic('square-plus', 'mini')}<b>Adicionar à Tela de Início</b>.`)}
          ${passo(3, 'Se aparecer a opção de abrir como app da web, deixe ligada. Toque em <b>Adicionar</b>.')}
        </ol>
        <p class="small muted">Na primeira vez que abrir pelo ícone, entre com o Google de novo: o iPhone guarda o app separado do Safari.</p>`,
    };
  }
  if (p === 'android') {
    return {
      icone: 'smartphone', titulo: 'Coloque o Oikon na tela inicial',
      texto: `<p>Assim ele abre como um app, sem barra do navegador.</p>
        ${ui.instalar ? `<button class="btn primary block" data-act="instalar">${ic('download')}Instalar o Oikon</button><p class="small muted" style="margin-top:var(--esp-2)">Se preferir, o caminho manual é este:</p>` : ''}
        <ol class="passos">
          ${passo(1, `No Chrome, toque nos três pontos ${ic('ellipsis-vertical', 'mini')}no canto de cima.`)}
          ${passo(2, `Toque em ${ic('download', 'mini')}<b>Instalar app</b>. Se não aparecer, use <b>Adicionar à tela inicial</b>.`)}
          ${passo(3, 'Confirme em <b>Instalar</b>. O ícone do Oikon aparece com os seus apps.')}
        </ol>`,
    };
  }
  return {
    icone: 'monitor', titulo: 'No celular, use pela tela inicial',
    texto: `<p>No computador, é só usar pelo navegador. Para lançar rápido no dia a dia, abra o Oikon no celular e coloque na tela inicial:</p>
      <ul class="passos simples">
        <li><b>iPhone (Safari):</b> ⋯ › Compartilhar › Adicionar à Tela de Início.</li>
        <li><b>Android (Chrome):</b> ⋮ › Instalar app.</li>
      </ul>
      ${ui.instalar ? `<button class="btn block" data-act="instalar">${ic('download')}Instalar também neste computador</button>` : ''}`,
  };
}

function passosTutorial() {
  const kv = (rot, v, cls = '') => `<div class="kv ${cls}"><span>${rot}</span><span class="num">${v}</span></div>`;
  const METODO = 'Como o Oikon pensa', USO = 'No dia a dia';
  return [
    {
      grupo: METODO, icone: 'calendar-range', titulo: 'Primeiro o plano, depois o dia a dia',
      texto: `<p>O Oikon funciona como envelopes. No começo do mês, você divide o que vai entrar entre as categorias da casa. O valor de cada categoria é o <b>orçado</b>.</p>
        <div class="exemplo calc"><span class="small muted">Exemplo</span>
          ${kv('Entradas do mês', 'R$ 10.000,00')}
          ${kv('− Moradia', 'R$ 2.500,00')}${kv('− Contas fixas', 'R$ 3.000,00')}${kv('− Mercado', 'R$ 1.200,00')}
          ${kv('− Transporte e lazer', 'R$ 1.400,00')}${kv('− Guardar', 'R$ 1.500,00')}
          ${kv('= Sobra planejada', 'R$ 400,00', 'total')}</div>
        <p>O orçado é um plano: ele não tira dinheiro da conta. O dinheiro só sai quando o gasto acontece.</p>`,
    },
    {
      grupo: METODO, icone: 'list', titulo: 'Orçado, previsto e realizado',
      texto: `<p>Cada categoria acompanha três números:</p>
        <ul class="passos simples">
          <li><b>Orçado:</b> quanto você decidiu que ela pode usar no mês.</li>
          <li><b>Previsto:</b> o que já se sabe que vai sair, com data. Conta de luz, parcela, assinatura.</li>
          <li><b>Realizado:</b> o que já aconteceu.</li>
        </ul>
        <div class="exemplo"><span class="small muted">Exemplo</span>
          <span class="orc-linha"><span class="t">Mercado</span><span class="num">R$ 800,00 de R$ 1.200,00</span></span>
          ${barra(700, 100, 1200)}
          <span class="small muted">R$ 700,00 realizados · R$ 100,00 previstos · <b>disponível: R$ 400,00</b></span></div>
        <p>Disponível é o orçado menos o realizado e o previsto. É quanto ainda cabe naquela categoria.</p>`,
    },
    {
      grupo: METODO, icone: 'arrow-down-to-line', titulo: 'Quanto deve sobrar no fim do mês',
      texto: `<p>É o número grande da tela inicial. A conta é esta:</p>
        <div class="exemplo calc">
          ${kv('Saldo na conta hoje', '')}${kv('+ O que ainda vai entrar', '')}${kv('− Contas previstas e faturas', '')}${kv('− Orçado que ainda pode ser gasto', '')}
          ${kv('= No fim do mês, deve sobrar', '', 'total')}</div>
        <p>O Oikon conta que você vai gastar todo o orçado. Se gastar menos, sobra mais. Assim a previsão não promete dinheiro que pode não existir.</p>
        <p>O <b>Saldo na conta</b>, logo abaixo, mostra só o que já aconteceu.</p>`,
    },
    {
      grupo: METODO, icone: 'piggy-bank', titulo: 'Guarde primeiro, e cada mês recomeça',
      texto: `<p>Reserva e investimentos também são categorias orçadas. Com o guardar dentro do plano, ele não depende do que sobrar no fim do mês.</p>
        <p>O que uma categoria não gastar não passa para o mês seguinte: fica como sobra na conta. Cada mês começa com um plano novo.</p>
        <p>Se uma categoria passar do orçado, o Oikon mostra quanto passou. Dá para aumentar o orçado dela ou tirar de outra.</p>`,
    },
    {
      grupo: METODO, icone: 'credit-card', titulo: 'O cartão conta no mês da fatura',
      texto: `<p>A compra no cartão entra no orçado do mês em que a fatura vence, que é quando o dinheiro sai da conta.</p>
        <div class="exemplo"><span class="small muted">Exemplo</span><span>Compra de 28/10 num cartão que fecha dia 13 e vence dia 23: entra na fatura de 23/11 e no orçado de <b>novembro</b>.</span></div>
        <p>Cada categoria pode ter um cartão previsto, como Mercado no cartão do dia a dia. A fatura futura mostra o que já foi lançado mais uma estimativa pelo orçado que ainda não foi gasto.</p>`,
    },
    {
      grupo: USO, icone: 'arrow-right', titulo: 'Lance em uma frase',
      texto: `<p>Escreva no campo de baixo do jeito que falaria:</p>
        <div class="exemplo"><span class="frase-ex">mercado 150 pix</span><span class="chips"><span class="chip ed">R$ 150,00</span><span class="chip ed">Mercado</span><span class="chip ed">Pix</span><span class="chip ed">Hoje</span></span></div>
        <p>O Oikon entende valor, categoria, pagamento e data. Você confere antes de salvar e ele aprende com cada correção. Outros exemplos: <b>gasolina 200 nubank</b>, <b>salário 5000</b>, <b>tênis 600 nubank 3x</b>.</p>`,
    },
    {
      grupo: USO, icone: 'check', titulo: 'Confirme o que já aconteceu',
      texto: `<p>Contas previstas, como luz ou aluguel, aparecem em <b>Para confirmar</b> quando a data chega. Toque em <b>Confirmar</b> se foi como esperado, ou abra para mudar valor e data.</p>
        <p>Assinaturas e parcelas no cartão se confirmam sozinhas quando a fatura fecha.</p>`,
    },
    { grupo: USO, ...passoInstalar() },
  ];
}

function tutorialPanel(m) {
  const passos = passosTutorial();
  const i = Math.min(m.passo || 0, passos.length - 1);
  const p = passos[i];
  const ultimo = i === passos.length - 1;
  const doGrupo = passos.filter(x => x.grupo === p.grupo);
  const posGrupo = doGrupo.indexOf(p) + 1;
  return `<div class="mh"><div class="steps" role="img" aria-label="Passo ${i + 1} de ${passos.length}">${passos.map((_, k) => `<i class="${k < i ? 'feito' : k === i ? 'atual' : ''}"></i>`).join('')}</div>
      ${ultimo ? `<button class="x" data-act="tutorial-fim" aria-label="Fechar">${ic('x')}</button>` : '<button class="btn link" data-act="tutorial-fim">Pular</button>'}</div>
    <div class="tutorial">
      <span class="tut-ic">${ic(p.icone)}</span>
      <span class="grupo">${p.grupo} · ${posGrupo} de ${doGrupo.length}</span>
      <h2 id="mh-t">${p.titulo}</h2>
      <div class="stack">${p.texto}</div>
    </div>
    <div class="btns" style="margin-top:var(--esp-6)">
      ${i > 0 ? `<button class="btn" data-act="tutorial-passo" data-passo="${i - 1}">${ic('chevron-left')}Voltar</button>` : ''}
      ${ultimo ? `<button class="btn primary" data-act="tutorial-fim" data-foco>Começar a usar</button>` : `<button class="btn primary" data-act="tutorial-passo" data-passo="${i + 1}" data-foco>Próximo${ic('arrow-right')}</button>`}
    </div>`;
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
    const ESTRUTURA = '2';
    if (localStorage.getItem('af_estrutura') !== ESTRUTURA) {
      await B.ensureSheets(S.spreadsheet.id);
      localStorage.setItem('af_estrutura', ESTRUTURA);
    }
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
  async sync() { S.status.error = null; if (!B.hasToken()) return actions.reconnect(); await sync(); if (!S.status.error && !S.queue.length) toast('Tudo salvo na planilha.'); },
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
  confirmar(el) { const l = S.find('Lancamentos', el.dataset.id); if (l) { M.confirmar(S, l); toast(`Confirmado: ${l.descricao.toLowerCase()}, ${money(l.valor)}.`); } },
  abrir(el) {
    const m = ui.modal; if (!m) return;
    const form = el.closest('form'); if (form) readDraft(form, m);
    const atual = m.aberto !== undefined ? m.aberto : null;
    m.aberto = atual === el.dataset.campo ? null : el.dataset.campo;
    m._focar = true; m.errors = null;
    renderModal();
  },
  composicao() { openModal({ type: 'composicao' }); },
  tutorial(el) { openModal({ type: 'tutorial', passo: Number(el?.dataset?.passo || 0) }); },
  'tutorial-passo'(el) { ui.modal.passo = Number(el.dataset.passo); ui.modal._focar = true; renderModal(); },
  'tutorial-fim'() { marcarTutorial(); closeModal(); },
  async instalar() { const ev = ui.instalar; if (!ev) return; ev.prompt(); try { await ev.userChoice; } catch { /* ignora */ } ui.instalar = null; renderModal(); },
  'focar-campo'() { const i = $('#cmp'); if (i) i.focus(); },
  editar(el) { editarLanc(el.dataset.id); },
  excluir(el) { openModal({ type: 'excluir', id: el.dataset.id }); },
  fatura(el) { openModal({ type: 'fatura', id: el.dataset.id }); },
  'faturas-antigas'(el) { ui.faturasAntigas = el.dataset.id; ui.forceRender = true; render(); },
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
  'modal-bg'(el, ev) { if (ev.target === el) { if (ui.modal?.type === 'tutorial') marcarTutorial(); closeModal(); } },
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
  if (el.closest('.modal') && el.tagName === 'A' && !el.dataset.act) closeModal();
  fn(el, ev);
});

document.addEventListener('input', ev => {
  if (ev.target.matches('[data-search]')) {
    ui.search = ev.target.value;
    const r = route();
    const list = $('#lanc-list');
    if (list) list.innerHTML = lancList(r.q.get('mes') || monthOf(hoje()), r.q.get('cat'), r.q.get('f') || 'todos');
  }
  if (ev.target.id === 'cmp') { const b = ev.target.form?.querySelector('button'); if (b) b.disabled = !ev.target.value.trim(); }
});

// Teclado: Esc fecha o painel; "/" ou "n" leva ao campo de lançamento (8.2, 8.12).
document.addEventListener('keydown', ev => {
  if (ev.key === 'Escape' && ui.modal) { ev.preventDefault(); if (ui.modal.type === 'tutorial') marcarTutorial(); closeModal(); return; }
  const t = ev.target;
  const digitando = t && (['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName) || t.isContentEditable);
  if (!digitando && !ui.modal && !ev.ctrlKey && !ev.metaKey && !ev.altKey && (ev.key === '/' || ev.key === 'n' || ev.key === 'N')) {
    const i = $('#cmp');
    if (i) { ev.preventDefault(); i.focus(); }
  }
});
// Troca entre celular e computador (960px): redesenha com a navegação certa.
matchMedia('(min-width: 960px)').addEventListener('change', () => { ui.forceRender = true; render(); });

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
    novoDraft(t); // o campo só é limpo depois de confirmar (8.2)
  },
  draft(fd, form, submitter) {
    const m = ui.modal;
    readDraft(form, m);
    const e = validar(m);
    if (Object.keys(e).length) {
      m.errors = e;
      if (m.type === 'novo') { m.aberto = e.valor ? 'valor' : e.categoria ? 'categoria' : e.forma ? 'forma' : e.vezes ? 'repeticao' : m.aberto; m._focar = true; }
      renderModal(); return;
    }
    salvarDraft(m, submitter?.value || 'salvar');
  },
  excluir(fd) {
    const l = S.find('Lancamentos', fd.get('id'));
    if (l) { M.excluir(S, l, fd.get('alcance') || 'esta'); toast('Lançamento excluído.'); }
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
      forma_prevista: String(fd.get('forma_prevista') ?? prev?.forma_prevista ?? ''),
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
    if (v === null) { toast('Informe quanto tem na conta hoje.'); return; }
    const dif = M.ajustarSaldo(S, v);
    toast(dif ? `Saldo atualizado para ${money(v)}.` : 'O saldo já estava certo.');
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
  } finally {
    auth.emCurso = false;
    // Redesenha depois que o toque terminou, para não engolir o clique que disparou a renovação.
    setTimeout(() => { ui.forceRender = true; render(); }, 0);
  }
}
document.addEventListener('click', () => { renovarConexao(); }, true);
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
    navigator.serviceWorker.register('./sw.js?v=17', { updateViaCache: 'none' }).catch(() => {});
  }
}
boot();
