const CACHE_NAME = 'gestion-metrogestion-2-0-v36-safe-read-mode';
const APP_FILES = ['./metrogestion-2-0.html','./manifest-metrogestion-2-0.json','./icono-gestion-24h.svg','./icono-gestion-24h-192.png','./icono-gestion-24h-512.png'];

const patchActivationHtml = html => {
  // Activar 24H: no guardar automáticamente salvo retorno técnico de llamada.
  html = html.replace("if (!sessionUserId || root.querySelector('#view-activation').classList.contains('hidden')) return;\n        saveActivationCallDraft(false);","if (!sessionUserId || root.querySelector('#view-activation').classList.contains('hidden')) return;\n        if (Number(localStorage.getItem(callReturnKey) || 0) <= Date.now()) return;\n        saveActivationCallDraft(false);");
  html = html.replace("offerActivationProgress();","if (Number(localStorage.getItem(callReturnKey) || 0) > Date.now()) restoreActivationProgress(); else clearActivationProgress();");
  html = html.replace("const pendingForCurrentUser = progress?.expiresAt > Date.now() &&\n            (!progress.userId || progress.userId === sessionUserId);","const pendingForCurrentUser = Number(localStorage.getItem(callReturnKey) || 0) > Date.now() &&\n            progress?.expiresAt > Date.now() &&\n            (!progress.userId || progress.userId === sessionUserId);");

  // Pizarra: buscador normal, calendario y controles de seguridad.
  html = html.replace(
    '<label>Buscar en la pizarra<input id="hotel-search" class="form-control" placeholder="DFM, matrícula, reserva, UPC, taller, causa o INC"></label>',
    '<label>Buscar en la pizarra<input id="hotel-search" class="form-control" placeholder="DFM, matrícula, reserva, UPC, taller, causa o INC"></label><label>Buscar fecha<input id="hotel-board-date" class="form-control" type="date"></label><div id="hotel-previous-warning" class="card hidden" style="background:#fff1f2;border:3px solid #dc2626;color:#991b1b;font-weight:900;text-align:center;font-size:18px">⚠ PIZARRA ANTERIOR · <span id="hotel-previous-date"></span><div class="text-small" style="margin-top:5px">Comprueba la fecha antes de realizar cualquier corrección.</div></div><div class="card viz-row" style="align-items:center;background:#f8fafc"><label style="display:flex;align-items:center;gap:10px"><input id="hotel-read-mode" type="checkbox" checked style="width:24px;height:24px"> 🔒 Modo lectura</label><span id="hotel-read-mode-help" class="text-small text-muted">Protección activada: no se pueden modificar datos.</span><button id="hotel-back-today" class="btn btn-secondary hidden" type="button">Volver a hoy</button></div>'
  );

  // Histórico: selector de fecha exacta.
  html = html.replace('<label>Mes<input id="hotel-history-month" class="form-control" type="month"></label>','<label>Mes<input id="hotel-history-month" class="form-control" type="month"></label><label>Fecha<input id="hotel-history-date" class="form-control" type="date"></label>');

  // canEditHotel respeta además el modo lectura local. Los lectores nunca pueden desactivarlo.
  html = html.replace(
    "const canEditHotel = () => {",
    "let hotelReadMode = true;\n      const hasHotelEditPermission = () => {"
  );
  html = html.replace(
    "const canViewHotel = () => {",
    "const canEditHotel = () => hasHotelEditPermission() && !hotelReadMode;\n      const canViewHotel = () => {"
  );

  // Eventos del modo lectura. Al entrar siempre vuelve bloqueado.
  html = html.replace(
    "root.querySelector('#hotel-search').addEventListener('input', renderHotel);",
    "root.querySelector('#hotel-search').addEventListener('input', renderHotel);\n      const refreshHotelReadMode = () => {\n        const checkbox=root.querySelector('#hotel-read-mode');\n        const help=root.querySelector('#hotel-read-mode-help');\n        if (!checkbox) return;\n        const allowed=hasHotelEditPermission();\n        if (!allowed) { hotelReadMode=true; checkbox.checked=true; checkbox.disabled=true; help.textContent='Modo lectura permanente · este usuario no tiene permiso de edición.'; }\n        else { checkbox.disabled=false; checkbox.checked=hotelReadMode; help.textContent=hotelReadMode?'Protección activada: no se pueden modificar datos.':'⚠ EDICIÓN ACTIVADA · revisa la fecha antes de guardar cambios.'; }\n      };\n      root.querySelector('#hotel-read-mode')?.addEventListener('change', event => {\n        if (!hasHotelEditPermission()) { hotelReadMode=true; event.target.checked=true; return; }\n        hotelReadMode=event.target.checked;\n        refreshHotelReadMode();\n        renderHotel();\n      });"
  );

  // Al seleccionar fecha se marca visualmente como anterior y se mantiene modo lectura.
  html = html.replace(
    "root.querySelector('#hotel-history-month').addEventListener('change', loadHotelHistoryFromSupabase);",
    "root.querySelector('#hotel-history-month').addEventListener('change', loadHotelHistoryFromSupabase);\n      const setHotelDateSafety = selectedDate => {\n        const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Madrid',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());\n        const historical=Boolean(selectedDate && selectedDate!==today);\n        root.querySelector('#hotel-previous-warning')?.classList.toggle('hidden',!historical);\n        root.querySelector('#hotel-back-today')?.classList.toggle('hidden',!historical);\n        const label=root.querySelector('#hotel-previous-date');\n        if(label) label.textContent=historical?new Date(selectedDate+'T12:00:00').toLocaleDateString('es-ES'):'';\n        hotelReadMode=true; refreshHotelReadMode();\n      };\n      root.querySelector('#hotel-board-date')?.addEventListener('change', event => { setHotelDateSafety(event.target.value); });\n      root.querySelector('#hotel-back-today')?.addEventListener('click', () => { const f=root.querySelector('#hotel-board-date'); if(f) f.value=''; setHotelDateSafety(''); loadHotelFromSupabase(true); });"
  );

  // T anulada: restaurar.
  html = html.replace("${stage.status!=='anulada'?'<option value=\"annul\">Anular T</option>':''}","${stage.status!=='anulada'?'<option value=\"annul\">Anular T</option>':'<option value=\"restore\">Restaurar T</option>'}");
  html = html.replace("const actionClass = {done:'hotel-stage-done',date:'hotel-stage-date',edit:'hotel-stage-edit',annul:'hotel-stage-annul'}[action];","const actionClass = {done:'hotel-stage-done',date:'hotel-stage-date',edit:'hotel-stage-edit',annul:'hotel-stage-annul',restore:'hotel-stage-restore'}[action];");

  // Siempre que se entra en Hotel se reactiva la protección.
  html = html.replace(
    "if (next === 'hotel') {",
    "if (next === 'hotel') { hotelReadMode=true; setTimeout(() => { try { refreshHotelReadMode(); renderHotel(); } catch {} },0);"
  );

  return html;
};

const fetchPatchedHtml = async request => {
  const response=await fetch(request,{cache:'no-store'}); const text=patchActivationHtml(await response.text());
  const patched=new Response(text,{status:response.status,statusText:response.statusText,headers:{'Content-Type':'text/html; charset=utf-8'}});
  const cache=await caches.open(CACHE_NAME); await cache.put(request,patched.clone()); return patched;
};
self.addEventListener('install',event=>event.waitUntil((async()=>{const cache=await caches.open(CACHE_NAME);await cache.addAll(APP_FILES.filter(f=>!f.endsWith('.html')));try{await fetchPatchedHtml(new Request('./metrogestion-2-0.html',{cache:'no-store'}));}catch{}})()));
self.addEventListener('message',event=>{if(event.data&&event.data.type==='SKIP_WAITING')self.skipWaiting();});
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>(key.startsWith('gestion-24h-')||key.startsWith('gestion-metrogestion-'))&&key!==CACHE_NAME).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{if(event.request.method!=='GET')return;const u=new URL(event.request.url);if(u.origin!==self.location.origin)return;const allowed=APP_FILES.map(f=>new URL(f,self.location.href).pathname);if(!allowed.includes(u.pathname))return;if(u.pathname.endsWith('/metrogestion-2-0.html')){event.respondWith(fetchPatchedHtml(event.request).catch(()=>caches.match(event.request)));return;}event.respondWith(caches.match(event.request).then(c=>c||fetch(event.request)));});