-- SINCRO 14 / 21-11-2026
-- STAGING-ONLY. Endurecer el receptor de snapshot SIN activar sincronizacion.
-- No modifica hojas, vehiculos, paradas, colas ni flags. Cambia SOLO el cuerpo
-- de app_private.recibir_snapshot_manteniment(text,jsonb) usando un ancla exacta.
-- Antes del cambio la ruta ejecuta aplicar_snapshot_manteniment y actualiza
-- outboxes incluso si la proteccion manual esta activada.
-- El preflight_manteniment es OTRA RPC y no resulta afectado.
-- Guard: despues de validar token + pausa, ANTES de UPDATE config y snapshot.
--
-- NO ejecutar en produccion hasta revision y prueba E2E.
DO $s14_guard$
DECLARE
  v_source text;
  v_new text;
  v_anchor constant text := '  update app_private.manteniment_sync_config';
  v_guard constant text := $guard$
  -- SINCRO14: el estado protegido no constituye permiso para escribir ni para
  -- reclasificar la cola. Las pruebas lectoras usan preflight_manteniment.
  IF v_config.solo_lectura_manual_protegida IS DISTINCT FROM FALSE
     OR v_config.escritura_segura_manual IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'S14_BLOQUEO_SOLO_LECTURA: snapshot rechazado antes de cualquier efecto; cola sin cambios.';
  END IF;

$guard$;
BEGIN
  SELECT pg_catalog.pg_get_functiondef(
      'app_private.recibir_snapshot_manteniment(text,jsonb)'::pg_catalog.regprocedure
    ) INTO STRICT v_source;

  IF position('S14_BLOQUEO_SOLO_LECTURA' IN v_source) > 0 THEN
    RAISE EXCEPTION 'S14_ALREADY_INSTALLED: no repetir el parche';
  END IF;
  IF (length(v_source)-length(replace(v_source,v_anchor,''))) <> length(v_anchor) THEN
    RAISE EXCEPTION 'S14_SOURCE_CHANGED: el marcador del primer UPDATE no es unico';
  END IF;
  IF position('v_hash is distinct from v_config.token_hash' IN lower(v_source)) = 0
    OR position('MG_SYNC_PAUSADA_IDENTIDAD' IN v_source)=0
    OR position('v_result := app_private.aplicar_snapshot_manteniment' IN v_source)=0
  THEN
    RAISE EXCEPTION 'S14_SOURCE_CHANGED: faltan controles de la funcion recibida';
  END IF;
  IF position('v_result := app_private.aplicar_snapshot_manteniment' IN v_source)
       < position(v_anchor IN v_source)
  THEN
    RAISE EXCEPTION 'S14_SOURCE_UNSAFE: el snapshot se procesa antes del ancla';
  END IF;
  v_new := replace(v_source,v_anchor,v_guard||v_anchor);
  EXECUTE v_new;
  IF position('S14_BLOQUEO_SOLO_LECTURA' IN
      pg_catalog.pg_get_functiondef(
        'app_private.recibir_snapshot_manteniment(text,jsonb)'::pg_catalog.regprocedure
      )) = 0
  THEN
    RAISE EXCEPTION 'S14_NOT_INSTALLED: prueba de compilacion fallida';
  END IF;
END
$s14_guard$;

-- Lectura de comprobacion: no se cambian parametros ni privilegios existentes.
SELECT
  position('S14_BLOQUEO_SOLO_LECTURA' IN pg_catalog.pg_get_functiondef(
    'app_private.recibir_snapshot_manteniment(text,jsonb)'::pg_catalog.regprocedure
  )) > 0 AS barrera_instalada,
  (SELECT solo_lectura_manual_protegida FROM app_private.manteniment_sync_config WHERE id=1) AS proteccion_sigue_activa,
  (SELECT escritura_segura_manual FROM app_private.manteniment_sync_config WHERE id=1) AS escritura_sigue_bloqueada;
