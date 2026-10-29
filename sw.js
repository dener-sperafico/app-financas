// Guarda as telas do app no aparelho para abrir sem internet.
// Os dados ficam no próprio app; este arquivo só cuida dos arquivos do site.
const VERSION = 'af-v4';
const FILES = [
  './', './index.html', './manifest.webmanifest', './css/app.css',
  './js/app.js?v=4', './js/config.js?v=4', './js/schema.js?v=4', './js/util.js?v=4', './js/model.js?v=4',
  './js/parser.js?v=4', './js/store.js?v=4', './js/google.js?v=4', './js/mock.js?v=4',
  './icons/icon.svg', './icons/icon-192.png', './icons/icon-180.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
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
    fetch(e.request, { cache: 'no-cache' }).then(res => {
      const copy = res.clone();
      caches.open(VERSION).then(c => c.put(e.request, copy));
      return res;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('./index.html')))
  );
});
