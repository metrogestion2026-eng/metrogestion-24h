// Metrogestion v38 - ruta nueva para evitar cache del worker v37 fallido
importScripts('./sw-metrogestion-v36-base.js?v=38');

self.addEventListener('install', function () {
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('message', function (event) {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});
