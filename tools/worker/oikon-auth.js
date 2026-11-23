// Oikon · servidor de login (Cloudflare Worker)
// Guarda o login do Google para o app não pedir de novo a cada hora.
// Não guarda dados: o refresh token volta para o próprio aparelho, cifrado com uma
// chave derivada do CLIENT_SECRET. Só este Worker consegue abrir.
//
// Variáveis no Cloudflare:
//   CLIENT_ID      (texto)   ID do cliente OAuth
//   CLIENT_SECRET  (segredo) Chave secreta do cliente OAuth
//   ORIGENS        (texto)   origens permitidas, separadas por vírgula

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';

export default {
  async fetch(req, env) {
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
      if (rota === '/entrar') {
        // Troca o código do login (popup do Google) por tokens.
        if (!corpo.code) return json({ erro: 'code' }, 400);
        const volta = String(corpo.redirect_uri || '');
        if (!volta.startsWith(origem + '/')) return json({ erro: 'redirect' }, 400);
        const r = await google(TOKEN_URL, {
          code: corpo.code, client_id: env.CLIENT_ID, client_secret: env.CLIENT_SECRET,
          redirect_uri: volta, grant_type: 'authorization_code',
        });
        if (!r.ok) return json({ erro: r.dados.error || 'google' }, 401);
        const resp = { access_token: r.dados.access_token, expires_in: r.dados.expires_in };
        if (r.dados.refresh_token) resp.sessao = await cifrar(env, r.dados.refresh_token);
        return json(resp);
      }

      if (rota === '/renovar') {
        // Usa a sessão guardada no aparelho para pegar um token novo, sem popup.
        const rt = await decifrar(env, corpo.sessao);
        if (!rt) return json({ erro: 'sessao' }, 401);
        const r = await google(TOKEN_URL, {
          refresh_token: rt, client_id: env.CLIENT_ID, client_secret: env.CLIENT_SECRET, grant_type: 'refresh_token',
        });
        if (!r.ok) return json({ erro: r.dados.error || 'google' }, 401);
        return json({ access_token: r.dados.access_token, expires_in: r.dados.expires_in });
      }

      if (rota === '/sair') {
        const rt = await decifrar(env, corpo.sessao);
        if (rt) await google(REVOKE_URL, { token: rt });
        return json({ ok: true });
      }
    } catch {
      return json({ erro: 'interno' }, 500);
    }
    return json({ erro: 'rota' }, 404);
  },
};

async function google(url, campos) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(campos),
  });
  let dados = {};
  try { dados = await res.json(); } catch { /* corpo vazio */ }
  return { ok: res.ok, dados };
}

// ---- cifra (AES-GCM, chave derivada do CLIENT_SECRET) ----
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
