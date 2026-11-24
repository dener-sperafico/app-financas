// Oikon · servidor de login (Cloudflare Worker)
// Guarda o login do Google para o app não pedir de novo a cada hora, e controla quem pode usar.
// Não guarda dados financeiros: o refresh token volta para o próprio aparelho, cifrado com uma
// chave derivada do CLIENT_SECRET. Só este Worker consegue abrir.
//
// Variáveis no Cloudflare:
//   CLIENT_ID            (texto)   ID do cliente OAuth
//   CLIENT_SECRET        (segredo) Chave secreta do cliente OAuth
//   ORIGENS              (texto)   origens permitidas, separadas por vírgula
//   ADMIN_EMAIL          (texto)   e-mail de quem libera o acesso
//   LIBERADOS_INICIAIS   (texto)   e-mails já liberados no primeiro uso, separados por vírgula (opcional)
//   RESEND_KEY           (segredo) chave do Resend para avisar pedidos por e-mail (opcional)
// Ligação (binding) KV:
//   ACESSOS              lista de pessoas. Sem ela, o servidor não restringe ninguém.

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const APP_URL = 'https://dener-sperafico.github.io/app-financas/';

export default {
  async fetch(req, env, ctx) {
    const origem = req.headers.get('Origin') || '';
    const permitidas = (env.ORIGENS || '').split(',').map(s => s.trim()).filter(Boolean);
    const ok = permitidas.includes(origem);
    const cors = {
      'Access-Control-Allow-Origin': ok ? origem : 'null',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
      'Vary': 'Origin',
    };
    const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (!ok) return json({ erro: 'origem' }, 403);
    if (req.method !== 'POST') return json({ erro: 'metodo' }, 405);

    let corpo;
    try { corpo = await req.json(); } catch { return json({ erro: 'corpo' }, 400); }
    const rota = new URL(req.url).pathname;

    try {
      await semear(env);

      if (rota === '/entrar') {
        // Troca o código do login (tela do Google) por tokens e confere se a pessoa está liberada.
        if (!corpo.code) return json({ erro: 'code' }, 400);
        const volta = String(corpo.redirect_uri || '');
        if (!volta.startsWith(origem + '/')) return json({ erro: 'redirect' }, 400);
        const r = await google(TOKEN_URL, {
          code: corpo.code, client_id: env.CLIENT_ID, client_secret: env.CLIENT_SECRET,
          redirect_uri: volta, grant_type: 'authorization_code',
        });
        if (!r.ok) return json({ erro: r.dados.error || 'google' }, 401);
        const quemE = await quem(r.dados.access_token);
        if (!quemE) return json({ erro: 'email' }, 401);
        const sessao = r.dados.refresh_token ? await cifrar(env, JSON.stringify({ rt: r.dados.refresh_token, e: quemE.email })) : undefined;
        const st = await situacao(env, ctx, quemE.email, quemE.nome);
        if (st !== 'liberado') return json({ erro: 'aguardando', email: quemE.email, sessao }, 403);
        return json({ access_token: r.dados.access_token, expires_in: r.dados.expires_in, sessao, ...(await extras(env, quemE.email)) });
      }

      if (rota === '/renovar') {
        // Usa a sessão guardada no aparelho para pegar um token novo, sem janela do Google.
        const s = await abrirSessao(env, corpo.sessao);
        if (!s) return json({ erro: 'sessao' }, 401);
        if (s.e) {
          const st = await situacao(env, ctx, s.e, '');
          if (st !== 'liberado') return json({ erro: 'aguardando', email: s.e }, 403);
        }
        const r = await google(TOKEN_URL, {
          refresh_token: s.rt, client_id: env.CLIENT_ID, client_secret: env.CLIENT_SECRET, grant_type: 'refresh_token',
        });
        if (!r.ok) return json({ erro: r.dados.error || 'google' }, 401);
        const resp = { access_token: r.dados.access_token, expires_in: r.dados.expires_in };
        if (!s.e) {
          // Sessão criada antes do controle de acesso: quem já usava continua liberado.
          const quemE = await quem(r.dados.access_token);
          if (quemE) {
            await garantirLiberado(env, quemE.email, quemE.nome);
            s.e = quemE.email;
            resp.sessao = await cifrar(env, JSON.stringify({ rt: s.rt, e: s.e }));
          }
        }
        return json({ ...resp, ...(s.e ? await extras(env, s.e) : {}) });
      }

      if (rota === '/sair') {
        const s = await abrirSessao(env, corpo.sessao);
        if (s) await google(REVOKE_URL, { token: s.rt });
        return json({ ok: true });
      }

      if (rota.startsWith('/admin/')) {
        const s = await abrirSessao(env, corpo.sessao);
        if (!s || !s.e || !ehAdmin(env, s.e)) return json({ erro: 'admin' }, 403);
        if (!env.ACESSOS) return json({ erro: 'sem-lista' }, 500);

        if (rota === '/admin/lista') return json({ pessoas: await listar(env) });

        if (rota === '/admin/salvar') {
          const email = limpar(corpo.email);
          if (!email) return json({ erro: 'email' }, 400);
          const antigo = limpar(corpo.antigo);
          let base = {};
          if (antigo) {
            base = (await env.ACESSOS.getWithMetadata('p:' + antigo)).metadata || {};
            if (antigo !== email) await env.ACESSOS.delete('p:' + antigo);
          } else {
            base = (await env.ACESSOS.getWithMetadata('p:' + email)).metadata || {};
          }
          const liberado = ehAdmin(env, email) ? true : corpo.liberado !== false;
          await gravar(env, email, { ...base, l: liberado, n: false, t: base.t || agora() });
          return json({ pessoas: await listar(env) });
        }

        if (rota === '/admin/excluir') {
          const email = limpar(corpo.email);
          if (!email || ehAdmin(env, email)) return json({ erro: 'email' }, 400);
          await env.ACESSOS.delete('p:' + email);
          return json({ pessoas: await listar(env) });
        }
      }
    } catch {
      return json({ erro: 'interno' }, 500);
    }
    return json({ erro: 'rota' }, 404);
  },
};

// ---- Pessoas (KV) ----
// Cada pessoa é uma chave "p:<email>" com os dados nos metadados:
// l = liberado, n = pedido novo (ainda não visto), nome, t = desde quando.
const agora = () => new Date().toISOString();
const limpar = e => {
  const s = String(e || '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? s : '';
};
const ehAdmin = (env, email) => !!email && email === limpar(env.ADMIN_EMAIL);
const gravar = (env, email, meta) => env.ACESSOS.put('p:' + email, '', { metadata: { l: !!meta.l, n: !!meta.n, nome: String(meta.nome || '').slice(0, 80), t: meta.t || agora() } });

async function listar(env) {
  const out = [];
  let cursor;
  do {
    const r = await env.ACESSOS.list({ prefix: 'p:', cursor });
    for (const k of r.keys) {
      const m = k.metadata || {};
      out.push({ email: k.name.slice(2), nome: m.nome || '', liberado: !!m.l, novo: !!m.n, desde: m.t || '' });
    }
    cursor = r.list_complete ? null : r.cursor;
  } while (cursor);
  return out;
}

// Retorna 'liberado' ou 'aguardando'. Quem não está na lista vira um pedido novo (e o admin é avisado).
async function situacao(env, ctx, email, nome) {
  if (!env.ACESSOS || ehAdmin(env, email)) return 'liberado';
  const { metadata } = await env.ACESSOS.getWithMetadata('p:' + email);
  if (metadata) return metadata.l ? 'liberado' : 'aguardando';
  await gravar(env, email, { l: false, n: true, nome });
  if (env.RESEND_KEY && env.ADMIN_EMAIL) ctx.waitUntil(avisar(env, email, nome));
  return 'aguardando';
}

async function garantirLiberado(env, email, nome) {
  if (!env.ACESSOS) return;
  const { metadata } = await env.ACESSOS.getWithMetadata('p:' + email);
  if (!metadata) await gravar(env, email, { l: true, n: false, nome });
}

// Admin recebe junto com o token se é admin e quantos pedidos novos esperam.
async function extras(env, email) {
  if (!ehAdmin(env, email) || !env.ACESSOS) return {};
  const pessoas = await listar(env);
  return { admin: true, pendentes: pessoas.filter(p => p.novo).length };
}

// Primeiro uso: libera a lista inicial (uma vez só).
let semeado = false;
async function semear(env) {
  if (semeado || !env.ACESSOS) return;
  if (!(await env.ACESSOS.get('semente'))) {
    const lista = String(env.LIBERADOS_INICIAIS || '').split(',').map(limpar).filter(Boolean);
    for (const email of lista) await gravar(env, email, { l: true, n: false });
    await env.ACESSOS.put('semente', agora());
  }
  semeado = true;
}

async function avisar(env, email, nome) {
  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + env.RESEND_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'Oikon <onboarding@resend.dev>',
        to: [limpar(env.ADMIN_EMAIL)],
        subject: `Pedido de acesso ao Oikon: ${email}`,
        text: `${nome ? nome + ' (' + email + ')' : email} entrou com o Google e está esperando liberação.\n\nPara liberar, abra o Oikon em Mais › Admin:\n${APP_URL}#/admin`,
      }),
    });
  } catch { /* aviso é opcional */ }
}

// ---- Google ----
async function google(url, campos) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(campos),
  });
  let dados = {};
  try { dados = await res.json(); } catch { dados = {}; }
  return { ok: res.ok, dados };
}

async function quem(accessToken) {
  const res = await fetch('https://www.googleapis.com/drive/v3/about?fields=user(displayName,emailAddress)', {
    headers: { Authorization: 'Bearer ' + accessToken },
  });
  if (!res.ok) return null;
  const u = (await res.json()).user || {};
  const email = limpar(u.emailAddress);
  return email ? { email, nome: u.displayName || '' } : null;
}

// ---- Sessão (AES-GCM, chave derivada do CLIENT_SECRET) ----
// Formato novo: {"rt":..., "e": email}. Sessões antigas guardam só o refresh token.
async function abrirSessao(env, sessao) {
  const txt = await decifrar(env, sessao);
  if (!txt) return null;
  if (txt.startsWith('{')) {
    try { const o = JSON.parse(txt); return o.rt ? { rt: o.rt, e: limpar(o.e) } : null; } catch { return null; }
  }
  return { rt: txt, e: '' };
}

const enc = new TextEncoder();
const dec = new TextDecoder();
let chaveCache = null;

async function chave(env) {
  if (chaveCache) return chaveCache;
  const base = await crypto.subtle.importKey('raw', enc.encode(env.CLIENT_SECRET), 'HKDF', false, ['deriveKey']);
  chaveCache = await crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: enc.encode('oikon-sessao'), info: enc.encode('v1') },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
  );
  return chaveCache;
}

async function cifrar(env, texto) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const c = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await chave(env), enc.encode(texto)));
  const tudo = new Uint8Array(iv.length + c.length);
  tudo.set(iv); tudo.set(c, iv.length);
  return 'v1.' + b64(tudo);
}

async function decifrar(env, sessao) {
  if (typeof sessao !== 'string' || !sessao.startsWith('v1.')) return null;
  try {
    const tudo = unb64(sessao.slice(3));
    const p = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: tudo.slice(0, 12) }, await chave(env), tudo.slice(12));
    return dec.decode(p);
  } catch { return null; }
}

function b64(u8) {
  let s = ''; for (const b of u8) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function unb64(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(s + '==='.slice((s.length + 3) % 4));
  return Uint8Array.from(bin, c => c.charCodeAt(0));
}
