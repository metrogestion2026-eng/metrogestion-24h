// Wrapper v36: conserva el service worker estable y añade la trazabilidad visual del Hotel.
const metrogestionNativeFetch = self.fetch.bind(self);

const patchHotelLastModification = html => {
  html = html.replace(
    "let hotelMetricFilter = 'all';",
    "let hotelMetricFilter = 'all';\n      const hotelUserName = id => users.find(account => String(account.id) === String(id || ''))?.name || (String(id || '') === String(sessionUserId || '') ? sessionUser : 'Usuario');\n      const formatHotelModifiedAt = value => {\n        if (!value) return '';\n        const date = new Date(value);\n        if (Number.isNaN(date.getTime())) return '';\n        const today = new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Madrid',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());\n        const day = new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Madrid',year:'numeric',month:'2-digit',day:'2-digit'}).format(date);\n        const time = date.toLocaleTimeString('es-ES',{timeZone:'Europe/Madrid',hour:'2-digit',minute:'2-digit'});\n        return day === today ? 'hoy ' + time : new Date(day + 'T12:00:00').toLocaleDateString('es-ES') + ' ' + time;\n      };"
  );

  html = html.replace(
    "temporaryReason:row.motivo_sustitucion_temporal || '', temporaryLimit:row.fecha_limite_sustitucion || '',",
    "temporaryReason:row.motivo_sustitucion_temporal || '', temporaryLimit:row.fecha_limite_sustitucion || '',\n        modifiedAt:row.actualizado_en || row.creado_en || '', modifiedBy:row.modificado_por || row.creado_por || '',"
  );

  html = html.replace(
    "${editPanel}\n        </article>`;",
    "${editPanel}\n          <div class=\"text-small\" style=\"margin-top:4px;padding:9px 10px;border-top:2px solid #cbd5e1;background:#f8fafc;border-radius:8px;text-align:right;color:#334155\"><strong>Última modificación:</strong> ${escapeHtml(formatHotelModifiedAt(unit.modifiedAt) || 'sin fecha')} · <strong>${escapeHtml(hotelUserName(unit.modifiedBy))}</strong></div>\n        </article>`;"
  );

  return html;
};

self.fetch = async (input, init) => {
  const response = await metrogestionNativeFetch(input, init);
  try {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url, self.location.href);
    if (response.ok && url.origin === self.location.origin && url.pathname.endsWith('/metrogestion-2-0.html')) {
      const text = await response.text();
      const headers = new Headers(response.headers);
      headers.set('Content-Type','text/html; charset=utf-8');
      headers.set('Cache-Control','no-store');
      return new Response(patchHotelLastModification(text), {
        status:response.status,
        statusText:response.statusText,
        headers
      });
    }
  } catch (error) {
    console.warn('No se pudo aplicar la trazabilidad visual del Hotel', error);
  }
  return response;
};

importScripts('./sw-metrogestion-core.js');
