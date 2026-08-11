// Metrogestion v37 - cargador seguro sobre la base estable v36
importScripts('./sw-metrogestion-v36-base.js?v=37.1');

self.addEventListener('install', function () {
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('message', function (event) {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
