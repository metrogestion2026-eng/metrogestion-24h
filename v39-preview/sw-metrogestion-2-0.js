// Metrogestión v39 preview · service worker aislado bajo /v39-preview/.
self.addEventListener('install', event => { event.waitUntil(self.skipWaiting()); });
self.addEventListener('activate', event => { event.waitUntil(self.clients.claim()); });
self.addEventListener('message', event => { if (event.data === 'SKIP_WAITING') self.skipWaiting(); });

importScripts('./sw-metrogestion-v36-estable.js');
const v39StableFetch = self.fetch.bind(self);

self.fetch = async (input, init) => {
  const response = await v39StableFetch(input, init);
  try {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url, self.location.href);
    if (response.ok && url.origin === self.location.origin && url.pathname.endsWith('/v39-preview/metrogestion-2-0.html')) {
      let html = await response.text();

      // Fecha real de la pizarra.
      html = html.replace("const hotelSourceDate = '03/08/2026';","let hotelSourceDate = 'Cargando pizarra actual…';");
      html = html.replace("activePizarraDate = pizarra.fecha;","activePizarraDate = pizarra.fecha; hotelSourceDate = new Date(pizarra.fecha + 'T12:00:00').toLocaleDateString('es-ES');");
      html = html.replace(
        "root.querySelector('#hotel-date').textContent = 'Pizarra en curso del ' + shownDate + ' · sincronización en tiempo real';",
        "root.querySelector('#hotel-date').textContent = activePizarraDate ? 'Pizarra en curso del ' + shownDate + ' · sincronización en tiempo real' : 'Cargando pizarra actual…';"
      );

      // Pizarra actual: solo movimientos activos. Las reservas liberadas viven en Reservas.
      html = html.replace(
        "hotelUnits = (rows || []).map(mapDbHotelUnit);",
        "hotelUnits = (rows || []).filter(row => row.estado !== 'reserva_liberada').map(mapDbHotelUnit);"
      );

      // IMPORTANTE: se conserva el orden estable original de v36:
      // primero loadVehicleIndex(), después Hotel. No se invierte la carga.

      // Login validado: escribir nunca envía el formulario por sí solo.
      html = html.replace(
        '<form id="login-form" class="card stack" autocomplete="on">',
        '<form id="login-form" class="card stack" autocomplete="off">'
      );
      html = html.replace(
        '<button id="mock-enter" class="btn btn-primary" type="submit">Entrar</button>',
        '<button id="mock-enter" class="btn btn-primary" type="button">Entrar</button>'
      );

      // v39 controla las actualizaciones desde index.html; se desactiva el registro interno heredado.
      html = html.replace("if ('serviceWorker' in navigator) {", "if (false && 'serviceWorker' in navigator) {");

      html = html.replace('</head>','<style>#v39-home-fixed,#update-notice{display:none!important}</style></head>');
      html = html.replace('Activar 24H · Beta 2.0 · v36','Metrogestión · v39 · PRUEBAS');
      html = html.replace('Gestión de mantenimientos · Activar 24H','Gestión de Mantenimiento · Metrogestión v39');
      html = html.replace('Utiliza la contraseña creada en Supabase.','');

      const inject = (name, version) => {
        if (!html.includes(name)) html = html.replace('</body>', `<script src="./${name}?v=${version}"></script></body>`);
      };

      inject('login-v39-boton-explicito.js','39-20260814k24');
      inject('hotel-v39-integracion.js','39-20260813');
      inject('hotel-v39-fix-reservas.js','39-20260814k16');
      inject('hotel-v39-editar-parada.js','39-20260813d');
      inject('hotel-v39-t-programadas.js','39-20260813h');
      inject('hotel-v39-asignar-reserva.js','39-20260813g');
      inject('hotel-v39-dfm-select.js','39-20260813i');
      inject('hotel-v39-ajustes-operativos.js','39-20260813j');
      inject('hotel-v39-reordenar-t.js','39-20260813k');
      inject('hotel-v39-permisos-talleres.js','39-20260813m');
      inject('hotel-v39-taller-contactos-multiples.js','39-20260813r');
      inject('hotel-v39-inicio-fijo.js','39-20260814k');
      inject('hotel-v39-ruta-inicio-fix.js','39-20260814k6');
      inject('hotel-v39-menu-recuperacion.js','39-20260814k10');
      inject('hotel-v39-reservas-modulo.js','39-20260814k15');
      inject('hotel-v39-bloque-operativo-13ago.js','39-20260814k27');
      // Un único botón global Lectura/Edición gobierna toda la pizarra y todas las T.
      inject('hotel-v39-modo-compartido.js','39-20260814k28');
      inject('hotel-v39-sin-ver-expediente.js','39-20260813t');
      inject('hotel-v39-nota-admin.js','39-20260813u');
      inject('hotel-v39-reservas-solo-lectura.js','39-20260814k');
      inject('hotel-v39-pizarra-actual-fix.js','39-20260814k5');
      inject('hotel-v39-historico-dia.js','39-20260814k8');
      inject('hotel-v39-historico-carga.js','39-20260814k8');
      inject('hotel-v39-panel-fuente-unica.js','39-20260814k11');

      const headers = new Headers(response.headers);
      headers.set('Content-Type','text/html; charset=utf-8');
      headers.set('Cache-Control','no-store');
      return new Response(html,{status:response.status,statusText:response.statusText,headers});
    }
  } catch (error) {
    console.warn('v39 preview: no se pudo aplicar la capa de integración', error);
  }
  return response;
};
