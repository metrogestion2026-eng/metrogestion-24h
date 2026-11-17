-- METROGES · SINCRO 12 · CENSO DE PUENTES EXACTOS POR COLUMNA T.
-- SOLO LECTURA. Sin valores privados ni identificadores individuales en salida.
-- El estado ACREDITADA de staging NO prueba por sí solo un evento humano.
-- No usar `fila_manteniment`, DFM, PA, UUID en nota ni posición física como identidad.
WITH t_registradas AS (
 SELECT f.spreadsheet_id, f.id_fila, f.estado, f.clase, f.trabajo_sync_id,
        t.sync_id AS trabajo_en_servidor,
        t.trabajo_hotel_id,
        h.id AS trabajo_en_hotel
 FROM app_private.mg9_filas_identidad AS f
 LEFT JOIN app_private.manteniment_t_trabajos AS t
   ON t.sync_id = f.trabajo_sync_id
 LEFT JOIN public.trabajos_etapa_hotel AS h
   ON h.id = t.trabajo_hotel_id
), resumen AS (
 SELECT
  count(*)::bigint AS filas_t_en_staging,
  count(*) FILTER (WHERE estado = 'ACREDITADA')::bigint AS staging_declarado_acreditado,
  count(*) FILTER (WHERE clase = 'TRABAJO')::bigint AS clase_trabajo,
  count(*) FILTER (WHERE trabajo_sync_id IS NULL)::bigint AS sin_vinculo_trabajo,
  count(*) FILTER (WHERE trabajo_sync_id IS NOT NULL
                     AND trabajo_en_servidor IS NULL)::bigint AS trabajo_no_existente,
  count(*) FILTER (WHERE trabajo_en_servidor IS NOT NULL
                     AND trabajo_en_hotel IS NULL)::bigint AS puente_hotel_ausente,
  count(*) FILTER (WHERE estado='ACREDITADA' AND clase='TRABAJO'
                     AND trabajo_en_servidor IS NOT NULL
                     AND trabajo_en_hotel IS NOT NULL)::bigint AS candidatos_esquema_no_autorizados
 FROM t_registradas
)
SELECT *,
  (SELECT count(*)::bigint FROM app_private.mg9_cambios_recibidos) AS cambios_staging,
  (SELECT count(*)::bigint FROM app_private.mg9_entregas_registradas) AS entregas_staging,
  (SELECT count(*)::bigint FROM app_private.manteniment_t_trabajos) AS trabajos_totales,
  'SOLO_DIAGNOSTICO_PUENTE_T_NO_EVENTO_HUMANO'::text AS resultado,
  false AS autoriza_sincronizar
FROM resumen;
