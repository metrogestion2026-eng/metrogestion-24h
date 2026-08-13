// Metrogestion v39 · capa de inyección sobre la respuesta HTML ya parcheada por v36.
// No se usa sola: debe ejecutarse después de la capa estable.
self.metrogestionApplyV39 = html => {
  let out = String(html || '');
  out = out.replace('Activar 24H · Beta 2.0 · v36','Metrogestión · v39 · DESARROLLO');
  if (!out.includes('hotel-v39-integracion.js')) {
    out = out.replace('</body>','<script src="./hotel-v39-integracion.js?v=39-20260813"></script></body>');
  }
  return out;
};
