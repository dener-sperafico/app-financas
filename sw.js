// Guarda as telas do app no aparelho para abrir sem internet.
// Os dados ficam no próprio app; este arquivo só cuida dos arquivos do site.
const VERSION = 'af-v5';
const FILES = [
  './', './index.html', './manifest.webmanifest', './css/app.css',
  './js/app.js?v=5', './js/config.js?v=5', './js/schema.js?v=5', './js/util.js?v=5', './js/model.js?v=5',
  './js/parser.js?v=5', './js/store.js?v=5', './js/google.js?v=5', './js/mock.js?v=5',
  './icons/icon.svg', './icons/icon-192.png', './icons/icon-180.png',
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
