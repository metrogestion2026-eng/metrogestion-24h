// Metrogestión v39 preview · service worker aislado bajo /v39-preview/.
// Fuerza que cada actualización de v39 tome el control antes de abrir la app.
self.addEventListener('install', event => {
  event.waitUntil(self.skipWaiting());
});
self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
});
self.addEventListener('message', event => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

// Importa una copia exacta de la base v36 y después añade la interfaz v39.
importScripts('./sw-metrogestion-v36-estable.js');
const v39StableFetch = self.fetch.bind(self);
self.fetch = async (input, init) => {
  const response = await v39StableFetch(input, init);
  try {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url, self.location.href);
    if (response.ok && url.origin===self.location.origin && url.pathname.endsWith('/v39-preview/metrogestion-2-0.html')) {
      let html = await response.text();
      html = html.replace('Activar 24H · Beta 2.0 · v36','Metrogestión · v39 · PRUEBAS');
      html = html.replace('Gestión de mantenimientos · Activar 24H','Gestión de Mantenimiento · Metrogestión v39');
      html = html.replace('Utiliza la contraseña creada en Supabase.','');
      if (!html.includes('hotel-v39-integracion.js')) html = html.replace('</body>','<script src="./hotel-v39-integracion.js?v=39-20260813"></script></body>');
      if (!html.includes('hotel-v39-fix-reservas.js')) html = html.replace('</body>','<script src="./hotel-v39-fix-reservas.js?v=39-20260813c"></script></body>');
      if (!html.includes('hotel-v39-editar-parada.js')) html = html.replace('</body>','<script src="./hotel-v39-editar-parada.js?v=39-20260813d"></script></body>');
      if (!html.includes('hotel-v39-t-programadas.js')) html = html.replace('</body>','<script src="./hotel-v39-t-programadas.js?v=39-20260813h"></script></body>');
      if (!html.includes('hotel-v39-asignar-reserva.js')) html = html.replace('</body>','<script src="./hotel-v39-asignar-reserva.js?v=39-20260813g"></script></body>');
      if (!html.includes('hotel-v39-dfm-select.js')) html = html.replace('</body>','<script src="./hotel-v39-dfm-select.js?v=39-20260813i"></script></body>');
      if (!html.includes('hotel-v39-ajustes-operativos.js')) html = html.replace('</body>','<script src="./hotel-v39-ajustes-operativos.js?v=39-20260813j"></script></body>');
      if (!html.includes('hotel-v39-reordenar-t.js')) html = html.replace('</body>','<script src="./hotel-v39-reordenar-t.js?v=39-20260813k"></script></body>');
      if (!html.includes('hotel-v39-permisos-talleres.js')) html = html.replace('</body>','<script src="./hotel-v39-permisos-talleres.js?v=39-20260813m"></script></body>');
      if (!html.includes('hotel-v39-taller-contactos-multiples.js')) html = html.replace('</body>','<script src="./hotel-v39-taller-contactos-multiples.js?v=39-20260813r"></script></body>');
      if (!html.includes('hotel-v39-inicio-fijo.js')) html = html.replace('</body>','<script src="./hotel-v39-inicio-fijo.js?v=39-20260813w"></script></body>');
      if (!html.includes('hotel-v39-ruta-inicio-fix.js')) html = html.replace('</body>','<script src="./hotel-v39-ruta-inicio-fix.js?v=39-20260814a"></script></body>');
      if (!html.includes('hotel-v39-bloque-operativo-13ago.js')) html = html.replace('</body>','<script src="./hotel-v39-bloque-operativo-13ago.js?v=39-20260813s"></script></body>');
      if (!html.includes('hotel-v39-sin-ver-expediente.js')) html = html.replace('</body>','<script src="./hotel-v39-sin-ver-expediente.js?v=39-20260813t"></script></body>');
      if (!html.includes('hotel-v39-nota-admin.js')) html = html.replace('</body>','<script src="./hotel-v39-nota-admin.js?v=39-20260813u"></script></body>');
      if (!html.includes('hotel-v39-reservas-solo-lectura.js')) html = html.replace('</body>','<script src="./hotel-v39-reservas-solo-lectura.js?v=39-20260814b"></script></body>');
      if (!html.includes('hotel-v39-tprog-texto-permiso.js')) html = html.replace('</body>','<script src="./hotel-v39-tprog-texto-permiso.js?v=39-20260814c"></script></body>');
      const headers = new Headers(response.headers);
      headers.set('Content-Type','text/html; charset=utf-8');
      headers.set('Cache-Control','no-store');
      return new Response(html,{status:response.status,statusText:response.statusText,headers});
    }
  } catch (error) {
    console.warn('v39 preview: no se pudo aplicar la capa de integración',error);
  }
  return response;
};
