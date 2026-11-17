-- METROGES SINCRO11 / auditoria 16->17 noviembre / unicamente SELECT
-- Instantanea al consultar, no acredita quien hizo los cambios ni cuando.
-- Ninguna llamada a crear_pizarra_diaria ni a funciones mutadoras.
WITH fechas AS (SELECT DATE '2026-11-16' AS origen, DATE '2026-11-17' AS destino),
src AS (
 SELECT r.* FROM public.registros_hotel r
 JOIN public.pizarras p ON p.id=r.pizarra_id
 JOIN fechas f ON p.fecha=f.origen
 WHERE NOT r.cancelado AND NOT r.retirado_hotel_activo
),
dst AS (
 SELECT r.* FROM public.registros_hotel r
 JOIN public.pizarras p ON p.id=r.pizarra_id
 JOIN fechas f ON p.fecha=f.destino
),
fichas AS (
 SELECT s.seguimiento_id, s.id AS viejo, d.id AS nuevo,
 s.estado AS estado_origen,d.estado AS estado_destino,
 s.lugar AS lugar_origen,d.lugar AS lugar_destino,
 s.observaciones AS obs_origen,d.observaciones AS obs_destino,
 s.causa AS causa_origen,d.causa AS causa_destino,
 s.proximo AS proximo_origen,d.proximo AS proximo_destino
 FROM src s LEFT JOIN dst d ON s.seguimiento_id=d.seguimiento_id
),
etapas_origen AS (
 SELECT r.seguimiento_id AS ficha,e.seguimiento_id AS etapa,e.id,
 e.grupo_documental_id,e.posicion,e.nombre,e.estado,e.lugar,e.observaciones,
 (SELECT count(*) FROM public.trabajos_etapa_hotel t WHERE t.etapa_hotel_id=e.id) AS num_trabajos
 FROM src r JOIN public.etapas_hotel e ON e.registro_hotel_id=r.id
),
etapas_destino AS (
 SELECT r.seguimiento_id AS ficha,e.seguimiento_id AS etapa,e.id,
 e.grupo_documental_id,e.posicion,e.nombre,e.estado,e.lugar,e.observaciones,
 (SELECT count(*) FROM public.trabajos_etapa_hotel t WHERE t.etapa_hotel_id=e.id) AS num_trabajos
 FROM dst r JOIN public.etapas_hotel e ON e.registro_hotel_id=r.id
),
etapas AS (
 SELECT a.ficha,a.etapa,a.num_trabajos AS trabajos_origen,
 b.num_trabajos AS trabajos_destino,b.id AS etapa_nueva,
 a.grupo_documental_id AS grupo_origen,b.grupo_documental_id AS grupo_destino,
 (a.nombre IS DISTINCT FROM b.nombre OR a.posicion IS DISTINCT FROM b.posicion) AS cambio_orden_nombre,
 (a.estado IS DISTINCT FROM b.estado OR a.lugar IS DISTINCT FROM b.lugar) AS cambio_estado_lugar,
 (a.observaciones IS DISTINCT FROM b.observaciones) AS cambio_observaciones
 FROM etapas_origen a LEFT JOIN etapas_destino b
 ON a.ficha=b.ficha AND a.etapa=b.etapa
)
SELECT
 (SELECT count(*) FROM src) AS fichas_origen_visibles,
 (SELECT count(*) FROM dst) AS fichas_destino_totales,
 (SELECT count(*) FROM fichas WHERE nuevo IS NOT NULL) AS fichas_conservadas,
 (SELECT count(*) FROM fichas WHERE nuevo IS NULL) AS fichas_perdidas,
 (SELECT count(*) FROM (SELECT seguimiento_id FROM dst GROUP BY seguimiento_id HAVING count(*)>1) x) AS fichas_duplicadas,
 (SELECT count(*) FROM fichas WHERE estado_origen IS DISTINCT FROM estado_destino) AS estados_observados_distintos,
 (SELECT count(*) FROM fichas WHERE lugar_origen IS DISTINCT FROM lugar_destino) AS lugares_observados_distintos,
 (SELECT count(*) FROM fichas WHERE obs_origen IS DISTINCT FROM obs_destino OR causa_origen IS DISTINCT FROM causa_destino OR proximo_origen IS DISTINCT FROM proximo_destino) AS notas_observadas_distintas,
 (SELECT count(*) FROM etapas_origen) AS etapas_origen,
 (SELECT count(*) FROM etapas_destino) AS etapas_destino,
 (SELECT count(*) FROM etapas WHERE etapa_nueva IS NOT NULL) AS etapas_conservadas,
 (SELECT count(*) FROM etapas WHERE etapa_nueva IS NULL) AS etapas_perdidas,
 (SELECT count(*) FROM (SELECT ficha,etapa FROM etapas_destino GROUP BY ficha,etapa HAVING count(*)>1) x) AS etapas_duplicadas,
 (SELECT coalesce(sum(num_trabajos),0) FROM etapas_origen) AS trabajos_origen,
 (SELECT coalesce(sum(num_trabajos),0) FROM etapas_destino) AS trabajos_destino,
 (SELECT count(*) FROM etapas WHERE trabajos_origen IS DISTINCT FROM trabajos_destino) AS etapas_con_recuento_trabajos_distinto,
 (SELECT count(*) FROM etapas WHERE cambio_orden_nombre) AS etapas_orden_nombre_distintos,
 (SELECT count(*) FROM etapas WHERE cambio_estado_lugar) AS etapas_estado_lugar_distintos,
 (SELECT count(*) FROM etapas WHERE cambio_observaciones) AS etapas_observaciones_distintas,
 (SELECT count(*) FROM etapas WHERE grupo_origen IS DISTINCT FROM grupo_destino) AS grupos_documentales_distintos,
 (SELECT count(*) FROM public.documentos_gestion dg WHERE NOT dg.cancelado AND dg.grupo_etapa_id IN (SELECT grupo_origen FROM etapas)) AS documentos_por_grupo_origen,
 (SELECT count(*) FROM public.documentos_gestion dg WHERE NOT dg.cancelado AND dg.grupo_etapa_id IN (SELECT grupo_destino FROM etapas)) AS documentos_por_grupo_destino,
 (SELECT count(*) FROM public.documentos_gestion dg WHERE NOT dg.cancelado AND dg.grupo_etapa_id IN (SELECT grupo_origen FROM etapas WHERE grupo_origen IS DISTINCT FROM grupo_destino)) AS docs_en_grupos_cambiados_origen,
 (SELECT count(*) FROM public.anotaciones_manuales_hotel n WHERE NOT n.cancelada AND n.seguimiento_id IN (SELECT seguimiento_id FROM src)) AS anotaciones_activas_por_seguimiento,
 (SELECT count(*) FROM public.anotaciones_manuales_hotel n WHERE NOT n.cancelada AND n.seguimiento_id IN (SELECT seguimiento_id FROM src) AND n.seguimiento_id IN (SELECT seguimiento_id FROM dst)) AS anotaciones_de_ficha_en_destino,
 (SELECT count(*) FROM dst WHERE vehiculo_sustituido='2633' AND NOT cancelado AND NOT retirado_hotel_activo) AS regresion_2633,
 (SELECT count(*) FROM dst WHERE vehiculo_sustituido='R1515') AS r1515_solo_consulta
FROM fechas;
