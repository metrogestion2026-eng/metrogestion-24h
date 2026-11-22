-- SINCRO11 · LECTURA EXCLUSIVA / NO LANZAR crear_pizarra_diaria
-- Cambio de orden, lugar, estado o fecha tras copiar puede ser edición humana válida.
WITH dates AS (SELECT DATE '2026-11-15' AS src, DATE '2026-11-16' AS dst),
src AS (SELECT r.* FROM public.registros_hotel r JOIN public.pizarras p ON p.id=r.pizarra_id JOIN dates d ON p.fecha=d.src WHERE NOT r.cancelado AND NOT r.retirado_hotel_activo),
dst AS (SELECT r.* FROM public.registros_hotel r JOIN public.pizarras p ON p.id=r.pizarra_id JOIN dates d ON p.fecha=d.dst),
a AS (SELECT s.seguimiento_id AS ficha,e.seguimiento_id AS etapa,e.nombre,e.posicion,
 (SELECT count(*) FROM public.trabajos_etapa_hotel t WHERE t.etapa_hotel_id=e.id) AS n
 FROM src s JOIN public.etapas_hotel e ON e.registro_hotel_id=s.id),
b AS (SELECT s.seguimiento_id AS ficha,e.seguimiento_id AS etapa,e.nombre,e.posicion,
 (SELECT count(*) FROM public.trabajos_etapa_hotel t WHERE t.etapa_hotel_id=e.id) AS n
 FROM dst s JOIN public.etapas_hotel e ON e.registro_hotel_id=s.id),
pairs AS (SELECT a.*,b.etapa AS destino_etapa,b.n AS destino_n,
 (a.nombre IS DISTINCT FROM b.nombre OR a.posicion IS DISTINCT FROM b.posicion) AS detalle_distinto
 FROM a LEFT JOIN b ON a.ficha=b.ficha AND a.etapa=b.etapa)
SELECT (SELECT count(*) FROM src) AS fichas_activas_origen,
 (SELECT count(*) FROM src s WHERE EXISTS (SELECT 1 FROM dst d WHERE d.seguimiento_id=s.seguimiento_id)) AS fichas_copiadas,
 (SELECT count(*) FROM src s WHERE NOT EXISTS (SELECT 1 FROM dst d WHERE d.seguimiento_id=s.seguimiento_id)) AS fichas_perdidas,
 (SELECT count(*) FROM dst) AS fichas_destino,
 (SELECT count(*) FROM dst WHERE NOT cancelado AND NOT retirado_hotel_activo) AS fichas_visibles,
 (SELECT count(*) FROM dst WHERE retirado_hotel_activo) AS fichas_retiradas,
 (SELECT count(*) FROM (SELECT seguimiento_id FROM dst GROUP BY seguimiento_id HAVING count(*)>1) q) AS duplicados_ficha,
 (SELECT count(*) FROM a) AS etapas_origen,
 (SELECT count(*) FROM b) AS etapas_destino,
 (SELECT count(*) FROM pairs WHERE destino_etapa IS NOT NULL) AS etapas_copiadas_por_identidad,
 (SELECT count(*) FROM pairs WHERE destino_etapa IS NULL) AS etapas_perdidas,
 (SELECT count(*) FROM (SELECT ficha,etapa FROM b GROUP BY ficha,etapa HAVING count(*)>1) q) AS duplicados_etapa,
 (SELECT coalesce(sum(n),0) FROM a) AS trabajos_origen,
 (SELECT coalesce(sum(n),0) FROM b) AS trabajos_destino,
 (SELECT count(*) FROM pairs WHERE n IS DISTINCT FROM destino_n) AS cambios_recuento_trabajos,
 (SELECT count(*) FROM pairs WHERE destino_etapa IS NOT NULL AND detalle_distinto) AS cambios_nombre_u_orden_observados,
 (SELECT count(*) FROM dst WHERE vehiculo_sustituido='2633' AND NOT cancelado AND NOT retirado_hotel_activo) AS regresion_2633,
 (SELECT count(*) FROM dst WHERE vehiculo_sustituido='R1515') AS r1515_consulta_sin_tocar
FROM dates;