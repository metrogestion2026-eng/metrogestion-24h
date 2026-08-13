// Metrogestión v39 preview · service worker aislado bajo /v39-preview/.
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
      if (!html.includes('hotel-v39-integracion.js')) html = html.replace('</body>','<script src="./hotel-v39-integracion.js?v=39-20260813"></script></body>');
      if (!html.includes('hotel-v39-fix-reservas.js')) html = html.replace('</body>','<script src="./hotel-v39-fix-reservas.js?v=39-20260813c"></script></body>');
      if (!html.includes('hotel-v39-editar-parada.js')) html = html.replace('</body>','<script src="./hotel-v39-editar-parada.js?v=39-20260813d"></script></body>');
      if (!html.includes('hotel-v39-t-programadas.js')) html = html.replace('</body>','<script src="./hotel-v39-t-programadas.js?v=39-20260813h"></script></body>');
      if (!html.includes('hotel-v39-plegables.js')) html = html.replace('</body>','<script src="./hotel-v39-plegables.js?v=39-20260813f"></script></body>');
      if (!html.includes('hotel-v39-asignar-reserva.js')) html = html.replace('</body>','<script src="./hotel-v39-asignar-reserva.js?v=39-20260813g"></script></body>');
      if (!html.includes('hotel-v39-dfm-select.js')) html = html.replace('</body>','<script src="./hotel-v39-dfm-select.js?v=39-20260813i"></script></body>');
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
