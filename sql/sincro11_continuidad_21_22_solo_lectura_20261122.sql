-- METROGES SINCRO11 · 21->22 NOV 2026 · SOLO SELECT
-- Las diferencias de estado no prueban autoría ni pérdida. Jamás llamar a crear_pizarra_diaria.
-- Fecha de la consulta documentada: 22/11/2026. El sistema puede haber cambiado después.
WITH src AS (
 SELECT r.* FROM public.registros_hotel r JOIN public.pizarras p ON p.id=r.pizarra_id
 WHERE p.fecha=DATE '2026-11-21'
), dst AS (
 SELECT r.* FROM public.registros_hotel r JOIN public.pizarras p ON p.id=r.pizarra_id
 WHERE p.fecha=DATE '2026-11-22'
), salida AS (
 SELECT s.seguimiento_id,s.cancelado,s.retirado_hotel_activo,d.id destino,
 (s.estado IS DISTINCT FROM d.estado) estado_distinto,
 (s.lugar IS DISTINCT FROM d.lugar) lugar_distinto
 FROM src s LEFT JOIN dst d ON d.seguimiento_id=s.seguimiento_id
), es AS (
 SELECT r.seguimiento_id ficha,e.seguimiento_id etapa,e.id,e.grupo_documental_id,
 (SELECT count(*) FROM public.trabajos_etapa_hotel t WHERE t.etapa_hotel_id=e.id) trabajos
 FROM src r JOIN public.etapas_hotel e ON e.registro_hotel_id=r.id
), ed AS (
 SELECT r.seguimiento_id ficha,e.seguimiento_id etapa,e.id,e.grupo_documental_id,
 (SELECT count(*) FROM public.trabajos_etapa_hotel t WHERE t.etapa_hotel_id=e.id) trabajos
 FROM dst r JOIN public.etapas_hotel e ON e.registro_hotel_id=r.id
), ep AS (
 SELECT a.ficha,a.etapa,a.trabajos origen,b.trabajos destino,b.id id_destino,
 a.grupo_documental_id grupo_origen,b.grupo_documental_id grupo_destino
 FROM es a LEFT JOIN ed b ON b.ficha=a.ficha AND b.etapa=a.etapa
)
SELECT
 (SELECT count(*) FROM src) fichas_21,
 (SELECT count(*) FROM dst) fichas_22,
 (SELECT count(*) FROM salida WHERE destino IS NOT NULL) fichas_conservadas,
 (SELECT count(*) FROM salida WHERE destino IS NULL) fichas_ausentes,
 (SELECT count(*) FROM salida WHERE destino IS NULL AND NOT cancelado AND NOT retirado_hotel_activo) salidas_injustificadas,
 (SELECT count(*) FROM (SELECT seguimiento_id FROM dst GROUP BY 1 HAVING count(*)>1)x) fichas_duplicadas,
 (SELECT count(*) FROM salida WHERE destino IS NOT NULL AND estado_distinto) fichas_estado_distinto,
 (SELECT count(*) FROM salida WHERE destino IS NOT NULL AND lugar_distinto) fichas_lugar_distinto,
 (SELECT count(*) FROM es) etapas_21,
 (SELECT count(*) FROM ed) etapas_22,
 (SELECT count(*) FROM ep WHERE id_destino IS NOT NULL) etapas_conservadas,
 (SELECT count(*) FROM ep WHERE id_destino IS NULL AND ficha IN (SELECT seguimiento_id FROM dst)) etapas_perdidas_ficha_continuada,
 (SELECT count(*) FROM (SELECT ficha,etapa FROM ed GROUP BY 1,2 HAVING count(*)>1)x) etapas_duplicadas,
 (SELECT count(*) FROM ep WHERE id_destino IS NOT NULL AND origen IS DISTINCT FROM destino) recuentos_trabajos_distintos,
 (SELECT count(*) FROM ep WHERE id_destino IS NOT NULL AND grupo_origen IS DISTINCT FROM grupo_destino) grupos_cambiados
;

-- Comprobación de contenido operativo completo de trabajos, no solo recuentos.
-- Se excluyen UUID físicos y campos de auditoría técnicos; la comparación sigue por ficha+etapa.
WITH filas AS (
 SELECT p.fecha,r.seguimiento_id ficha,e.seguimiento_id etapa,
 jsonb_build_object(
  'tipo',t.tipo_trabajo,'categoria',t.categoria_tecnica,'motivo',t.motivo_entrada,
  'diagnostico',t.diagnostico_real,'km',t.km_averia,'expediente',t.expediente,
  'descripcion',t.descripcion,'peritaje',t.peritaje_estado,
  'observaciones',t.observaciones,'cancelado',t.cancelado,
  'motivo_cancelacion',t.motivo_cancelacion) contenido
 FROM public.pizarras p JOIN public.registros_hotel r ON r.pizarra_id=p.id
 JOIN public.etapas_hotel e ON e.registro_hotel_id=r.id
 JOIN public.trabajos_etapa_hotel t ON t.etapa_hotel_id=e.id
 WHERE p.fecha IN (DATE '2026-11-21',DATE '2026-11-22')
), agrupado AS (
 SELECT fecha,ficha,etapa,count(*) n,
 md5(string_agg(contenido::text,'|' ORDER BY contenido::text)) huella
 FROM filas GROUP BY fecha,ficha,etapa
), etapas AS (
 SELECT p.fecha,r.seguimiento_id ficha,e.seguimiento_id etapa
 FROM public.pizarras p JOIN public.registros_hotel r ON r.pizarra_id=p.id
 JOIN public.etapas_hotel e ON e.registro_hotel_id=r.id
 WHERE p.fecha IN (DATE '2026-11-21',DATE '2026-11-22')
)
SELECT count(*) etapas_continuadas,sum(coalesce(a.n,0)) trabajos_origen,
sum(coalesce(b.n,0)) trabajos_destino,
count(*) FILTER(WHERE a.huella IS DISTINCT FROM b.huella) etapas_contenido_distinto
FROM etapas x JOIN etapas y ON x.ficha=y.ficha AND x.etapa=y.etapa AND y.fecha=DATE '2026-11-22'
LEFT JOIN agrupado a ON a.ficha=x.ficha AND a.etapa=x.etapa AND a.fecha=DATE '2026-11-21'
LEFT JOIN agrupado b ON b.ficha=y.ficha AND b.etapa=y.etapa AND b.fecha=DATE '2026-11-22'
WHERE x.fecha=DATE '2026-11-21';

-- Verificar objeto documental existente; NO prueba apertura desde navegador ni permisos.
WITH grupos AS (
 SELECT DISTINCT e.grupo_documental_id FROM public.pizarras p
 JOIN public.registros_hotel r ON r.pizarra_id=p.id
 JOIN public.etapas_hotel e ON e.registro_hotel_id=r.id
 WHERE p.fecha=DATE '2026-11-22'
), docs AS (
 SELECT d.id,d.storage_bucket,d.storage_path
 FROM public.documentos_gestion d JOIN grupos g ON g.grupo_documental_id=d.grupo_etapa_id
 WHERE NOT d.cancelado
)
SELECT count(*) documentos, count(*) FILTER(WHERE o.id IS NOT NULL) localizados,
count(*) FILTER(WHERE o.id IS NULL) ausentes
FROM docs d LEFT JOIN storage.objects o
ON o.bucket_id=d.storage_bucket AND o.name=d.storage_path
AND COALESCE(o.is_delete_marker,false)=false;
