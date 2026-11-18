-- METROGES / SINCRO 12. DIAGNOSTICO EXCLUSIVAMENTE DE SOLO LECTURA.
-- Base de prueba: metrogestion-pruebas. No relaciona DFM/PA/UUID con ID_FILA.
-- Devuelve solo contadores de estado y existencia de columnas, ningun valor personal.
WITH datos AS (
 SELECT
  (SELECT count(*)::bigint FROM app_private.mg9_filas_identidad) AS filas_t_registradas,
  (SELECT count(*)::bigint FROM app_private.mg9_filas_identidad WHERE estado='ACREDITADA') AS identidades_declaradas_acreditadas,
  (SELECT count(*)::bigint FROM app_private.mg9_cambios_recibidos) AS cambios_recibidos,
  (SELECT count(*)::bigint FROM app_private.mg9_entregas_registradas) AS recibos_de_entrega,
  (SELECT count(*)::bigint FROM app_private.manteniment_t_trabajos) AS trabajos_catalogados,
  (SELECT count(*)::bigint FROM public.usuarios WHERE activo=true AND permisos->>'sincro12_confirmar_lote'='true') AS usuarios_con_permiso_s12
), estructura AS (
 SELECT
  (SELECT count(*) FROM information_schema.columns WHERE table_schema='auth' AND table_name='sessions' AND column_name IN ('id','user_id','aal','not_after'))=4 AS auth_sesiones_campos,
  (SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='usuarios' AND column_name IN ('id','activo','permisos','credenciales_actualizadas_en'))=4 AS usuarios_campos,
  (SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='dispositivos_usuario' AND column_name IN ('id','usuario_id','token_hash','estado'))=4 AS dispositivos_campos,
  (SELECT count(*) FROM information_schema.columns WHERE table_schema='app_private' AND table_name='mg9_filas_identidad' AND column_name IN ('spreadsheet_id','id_fila','estado','trabajo_sync_id','revision'))=5 AS vinculos_staging_campos,
  (SELECT count(*) FROM information_schema.columns WHERE table_schema='app_private' AND table_name='mg9_cambios_recibidos' AND column_name IN ('spreadsheet_id','id_fila','columna','revision'))=4 AS eventos_staging_campos,
  (SELECT count(*) FROM information_schema.columns WHERE table_schema='app_private' AND table_name='manteniment_t_trabajos' AND column_name='fecha_recogida')=1 AS fecha_recogida_disponible,
  (SELECT count(*) FROM information_schema.columns WHERE table_schema='app_private' AND table_name='manteniment_parada_outbox' AND column_name IN ('id_fila','columna'))=2 AS outbox_identifica_t_y_campo
)
SELECT
 datos.*,estructura.*,
 'SOLO_CAPACIDADES_NO_ES_ACREDITACION'::text AS clasificacion,
 false AS evento_manual_real_acreditado,
 false AS vinculo_t_objeto_real_acreditado_por_esta_consulta,
 false AS nonce_consumido_en_transaccion,
 false AS autoriza_sincronizar
FROM datos CROSS JOIN estructura;
