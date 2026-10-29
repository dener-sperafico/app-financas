// Guarda as telas do app no aparelho para abrir sem internet.
// Os dados ficam no próprio app; este arquivo só cuida dos arquivos do site.
const VERSION = 'af-v15';
const FILES = [
  './', './index.html', './manifest.webmanifest', './css/app.css?v=15',
  './js/app.js?v=15', './js/config.js?v=15', './js/schema.js?v=15', './js/util.js?v=15', './js/model.js?v=15',
  './js/parser.js?v=15', './js/store.js?v=15', './js/google.js?v=15', './js/mock.js?v=15', './js/icones.js?v=15',
  './icons/oikon.svg', './icons/icon-192.png', './icons/icon-180.png',
  './fonts/mulish-400.woff2', './fonts/mulish-600.woff2', './fonts/mulish-700.woff2', './fonts/mulish-800.woff2',
  './fonts/outfit-500.woff2', './fonts/outfit-600.woff2',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES.map(f => new Request(f, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

// Arquivos do próprio site: tenta a rede primeiro (para pegar atualizações) e cai no cache sem internet.
// Chamadas ao Google nunca passam pelo cache.
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  e.respondWith(
    // Abertura da página (navegação) precisa de um pedido novo: o navegador não deixa reaproveitar o original.
    fetch(e.request.mode === 'navigate' ? new Request(e.request.url, { cache: 'no-cache', credentials: 'same-origin' }) : e.request, e.request.mode === 'navigate' ? undefined : { cache: 'no-cache' }).then(res => {
      const copy = res.clone();
      caches.open(VERSION).then(c => c.put(e.request, copy));
      return res;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('./index.html')))
  );
});
