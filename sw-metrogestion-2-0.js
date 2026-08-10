const CACHE_NAME = 'gestion-metrogestion-2-0-v36-history-date-restore-t';
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

  // HISTÓRICO: selector de fecha exacta además de mes y buscador libre.
  html = html.replace(
    '<label>Mes<input id="hotel-history-month" class="form-control" type="month"></label>',
    '<label>Mes<input id="hotel-history-month" class="form-control" type="month"></label><label>Fecha<input id="hotel-history-date" class="form-control" type="date"></label>'
  );

  // Al elegir una fecha, cargar automáticamente el mes correspondiente y mostrar la jornada completa.
  html = html.replace(
    "root.querySelector('#hotel-history-month').addEventListener('change', loadHotelHistoryFromSupabase);",
    "root.querySelector('#hotel-history-month').addEventListener('change', () => { const dateField=root.querySelector('#hotel-history-date'); if(dateField) dateField.value=''; loadHotelHistoryFromSupabase(); });\n      root.querySelector('#hotel-history-date')?.addEventListener('change', async event => {\n        const selectedDate = event.target.value;\n        if (!selectedDate) { renderHotelHistory(); return; }\n        const monthField = root.querySelector('#hotel-history-month');\n        const selectedMonth = selectedDate.slice(0,7);\n        if (monthField.value !== selectedMonth || hotelHistoryLoadedMonth !== selectedMonth) {\n          monthField.value = selectedMonth;\n          await loadHotelHistoryFromSupabase();\n        } else {\n          renderHotelHistory();\n        }\n        root.querySelector('#hotel-history-list')?.scrollIntoView({behavior:'smooth',block:'start'});\n      });"
  );

  // El filtro por fecha tiene prioridad: seleccionando un día aparecen TODOS los registros de esa jornada.
  html = html.replace(
    "const query = root.querySelector('#hotel-history-search').value.toLowerCase().trim();\n        const rows = hotelHistoryRows.filter(unit => !query || [",
    "const query = root.querySelector('#hotel-history-search').value.toLowerCase().trim();\n        const selectedDate = root.querySelector('#hotel-history-date')?.value || '';\n        const rows = hotelHistoryRows.filter(unit => (!selectedDate || unit.historyDate === selectedDate) && (!query || ["
  );
  html = html.replace(
    "].join(' ').toLowerCase().includes(query));\n        list.innerHTML = rows.map(unit => {",
    "].join(' ').toLowerCase().includes(query)));\n        list.innerHTML = rows.map(unit => {"
  );

  // T ANULADA: ofrecer Restaurar T en el selector de acciones.
  html = html.replace(
    "${stage.status!=='anulada'?'<option value=\"annul\">Anular T</option>':''}",
    "${stage.status!=='anulada'?'<option value=\"annul\">Anular T</option>':'<option value=\"restore\">Restaurar T</option>'}"
  );
  html = html.replace(
    "${stage.status!=='anulada'?`<button class=\"hotel-stage-hidden-action hotel-stage-annul\" data-id=\"${escapeHtml(unit.id)}\" data-stage=\"${index}\" type=\"button\">Anular</button>`:''}",
    "${stage.status!=='anulada'?`<button class=\"hotel-stage-hidden-action hotel-stage-annul\" data-id=\"${escapeHtml(unit.id)}\" data-stage=\"${index}\" type=\"button\">Anular</button>`:`<button class=\"hotel-stage-hidden-action hotel-stage-restore\" data-id=\"${escapeHtml(unit.id)}\" data-stage=\"${index}\" type=\"button\">Restaurar</button>`}"
  );
  html = html.replace(
    "const actionClass = {done:'hotel-stage-done',date:'hotel-stage-date',edit:'hotel-stage-edit',annul:'hotel-stage-annul'}[action];",
    "const actionClass = {done:'hotel-stage-done',date:'hotel-stage-date',edit:'hotel-stage-edit',annul:'hotel-stage-annul',restore:'hotel-stage-restore'}[action];"
  );

  // Restaurar deja la T nuevamente pendiente, sin fecha real ni motivo de anulación.
  html = html.replace(
    "root.querySelectorAll('.hotel-stage-date').forEach(button => button.addEventListener('click', () => {",
    "root.querySelectorAll('.hotel-stage-restore').forEach(button => button.addEventListener('click', async () => {\n          const unit = hotelUnits.find(item => item.id === button.dataset.id);\n          if (!unit || !canEditHotel()) return;\n          const stage = unit.stages[Number(button.dataset.stage)];\n          if (!stage) return;\n          if (!window.confirm('¿Restaurar esta T y dejarla nuevamente pendiente?')) return;\n          button.disabled = true;\n          const { error } = await supabaseClient.from('etapas_hotel').update({\n            estado:'pendiente', fecha_real:null, motivo_anulacion:'', modificado_por:sessionUserId,\n            actualizado_en:new Date().toISOString()\n          }).eq('id',stage.id);\n          if (error) window.alert('No se pudo restaurar la T: ' + error.message);\n          await loadHotelFromSupabase(false);\n        }));\n        root.querySelectorAll('.hotel-stage-date').forEach(button => button.addEventListener('click', () => {"
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
