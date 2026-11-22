-- METROGES · SINCRO 11 · PREFLIGHT T/UUID · SOLO LECTURA.
-- Consulta de censo sobre Supabase metrogestion-pruebas, ninguna escritura.
-- NO habilita, asigna ni acredita vínculos T/UUID: son números de contexto.
WITH censos AS (
 SELECT
   (SELECT count(*) FROM app_private.mg9_filas_identidad)::bigint AS filas_acreditadas_staging,
   (SELECT count(*) FROM app_private.mg9_cambios_recibidos)::bigint AS cambios_staging,
   (SELECT count(*) FROM app_private.mg9_entregas_registradas)::bigint AS entregas_staging,
   (SELECT count(*) FROM app_private.manteniment_t_trabajos)::bigint AS trabajos_servidor,
   (SELECT count(*) FROM app_private.manteniment_t_trabajos
     WHERE fuentes IS NULL OR jsonb_typeof(fuentes) <> 'array'
        OR jsonb_array_length(fuentes)=0)::bigint AS trabajos_sin_fuentes_array,
   (SELECT count(DISTINCT sync_id) FROM app_private.manteniment_t_trabajos)::bigint AS uuid_trabajos_distintos
)
SELECT *, 'SOLO_CENSO_NO_AUTORIZA_SINCRO'::text AS clasificacion,
 false AS autoriza_escrituras FROM censos;