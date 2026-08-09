const CACHE_NAME = 'gestion-metrogestion-2-0-v36-explicit-save';
const APP_FILES = [
  './metrogestion-2-0.html',
  './manifest-metrogestion-2-0.json',
  './icono-gestion-24h.svg',
  './icono-gestion-24h-192.png',
  './icono-gestion-24h-512.png'
];

const patchActivationHtml = html => {
  // Una activación no se guarda por escribir, avanzar pasos, ocultar o cerrar la app.
  // Solo permitimos una copia técnica temporal cuando se acaba de abrir el teléfono/My TruckPoint.
  html = html.replace(
    "if (!sessionUserId || root.querySelector('#view-activation').classList.contains('hidden')) return;\n        saveActivationCallDraft(false);",
    "if (!sessionUserId || root.querySelector('#view-activation').classList.contains('hidden')) return;\n        if (Number(localStorage.getItem(callReturnKey) || 0) <= Date.now()) return;\n        saveActivationCallDraft(false);"
  );

  // Al iniciar sesión no ofrecer borradores automáticos antiguos. Si se vuelve inmediatamente
  // de una llamada, recuperamos únicamente esa copia técnica temporal.
  html = html.replace(
    "offerActivationProgress();",
    "if (Number(localStorage.getItem(callReturnKey) || 0) > Date.now()) restoreActivationProgress(); else clearActivationProgress();"
  );

  // Si se pulsa Nueva activación, no debe aparecer ningún borrador antiguo salvo el retorno
  // técnico de una llamada todavía vigente.
  html = html.replace(
    "const pendingForCurrentUser = progress?.expiresAt > Date.now() &&\n            (!progress.userId || progress.userId === sessionUserId);",
    "const pendingForCurrentUser = Number(localStorage.getItem(callReturnKey) || 0) > Date.now() &&\n            progress?.expiresAt > Date.now() &&\n            (!progress.userId || progress.userId === sessionUserId);"
  );

  return html;
};

const fetchPatchedHtml = async request => {
  const response = await fetch(request, { cache: 'no-store' });
  const text = patchActivationHtml(await response.text());
  const patched = new Response(text, {
    status: response.status,
    statusText: response.statusText,
    headers: { 'Content-Type': 'text/html; charset=utf-8' }
  });
  const cache = await caches.open(CACHE_NAME);
  await cache.put(request, patched.clone());
  return patched;
};

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(APP_FILES.filter(file => !file.endsWith('.html')));
    try {
      const request = new Request('./metrogestion-2-0.html', { cache: 'no-store' });
      await fetchPatchedHtml(request);
    } catch {}
  })());
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
      fetchPatchedHtml(event.request)
        .catch(() => caches.match(event.request))
    );
    return;
  }

  event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request)));
});
