// Retire obsolete offline pages without touching account or business storage.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith('gestion-24h-') || key.startsWith('gestion-metrogestion-')) await caches.delete(key);
    }
    await self.registration.unregister();
  })());
});
