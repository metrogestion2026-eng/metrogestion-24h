const CACHE_NAME = 'gestion-metrogestion-2-0-v21';
const APP_FILES = [
  './metrogestion-2-0.html',
  './manifest-metrogestion-2-0.json',
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
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(key =>
          (key.startsWith('gestion-24h-') || key.startsWith('gestion-metrogestion-')) &&
          key !== CACHE_NAME
        ).map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const requestUrl = new URL(event.request.url);
  if (requestUrl.origin !== self.location.origin) return;
  const allowedPaths = APP_FILES.map(file => new URL(file, self.location.href).pathname);
  if (!allowedPaths.includes(requestUrl.pathname)) return;

  if (requestUrl.pathname.endsWith('/metrogestion-2-0.html')) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request)));
});
