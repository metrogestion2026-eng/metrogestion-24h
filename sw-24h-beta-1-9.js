const CACHE_NAME = 'gestion-24h-beta-1-9-v6';
const APP_FILES = [
  './beta-1-9-prueba.html',
  './manifest-24h-beta-1-9.json',
  './icono-gestion-24h.svg',
  './icono-gestion-24h-192.png',
  './icono-gestion-24h-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_FILES)));
});

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(
    keys.filter(key => key.startsWith('gestion-24h-') && key !== CACHE_NAME).map(key => caches.delete(key))
  )));
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const requestUrl = new URL(event.request.url);
  if (requestUrl.origin !== self.location.origin) return;
  const allowedPaths = APP_FILES.map(file => new URL(file, self.location.href).pathname);
  if (!allowedPaths.includes(requestUrl.pathname)) return;
  event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request)));
});
