BEGIN;

-- MG75-EJECUCION-ORDEN-001. Installation changes functions only. It neither
-- opens flags nor imports snapshots, delivers commands or resolves old queues.
-- authorize is SELECT-only; the separate strict ACK delegates the existing
-- confirmation transaction. Neither operation is a lease on a Google sheet.
DO $prerequisites$
DECLARE v record; v_oid oid;
BEGIN
  FOR v IN SELECT * FROM (VALUES
    ('public.recibir_snapshot_manteniment(text,jsonb)','4c45ec5bd66f0b16c1f0b891016ac272'),
    ('app_private.manteniment_preflight_solo_lectura(text,jsonb)','c28c101730aa37a28b1980c66cf7669d'),
    ('app_private.recibir_snapshot_manteniment_7525(text,jsonb)','9ef91b0ca340e408e4bfc460b88b6f97'),
    ('app_private.manteniment_confirmar_comandos(text,jsonb)','0843f77fe66256f5fcd7e08db2baff87'),
    ('public.confirmar_comandos_manteniment(text,jsonb)','bfcf82b05f9e9c3e4846b898d3c2e151')
  ) expected(signature,fingerprint) LOOP
    v_oid:=to_regprocedure(v.signature);
    IF v_oid IS NULL OR md5(pg_get_functiondef(v_oid)) IS DISTINCT FROM v.fingerprint
      OR has_function_privilege('anon',v_oid,'EXECUTE')
      OR has_function_privilege('authenticated',v_oid,'EXECUTE')
      OR NOT has_function_privilege('service_role',v_oid,'EXECUTE')
      OR EXISTS (
        SELECT 1 FROM pg_proc p,
          LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
        WHERE p.oid=v_oid AND (a.grantee NOT IN (p.proowner,'service_role'::regrole)
          OR a.privilege_type<>'EXECUTE' OR (a.grantee<>p.proowner AND a.is_grantable))
      ) THEN
      RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='MG_SYNC_EJECUCION_RUNTIME_DRIFT: '||v.signature;
    END IF;
  END LOOP;
  IF to_regclass('app_private.manteniment_entregas_continuidad_alpha75') IS NULL
    OR to_regclass('app_private.sustitucion_continuidades_alpha75') IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='MG_SYNC_EJECUCION_BARRERA_AUSENTE';
  END IF;
END;
$prerequisites$;

CREATE FUNCTION app_private.exigir_capacidad_ejecucion_manteniment(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER
SET search_path=pg_catalog AS $function$
BEGIN
  IF jsonb_typeof(p_payload) IS DISTINCT FROM 'object'
    OR p_payload->'version_ejecucion' IS DISTINCT FROM '"MG75-EJECUCION-ORDEN-001"'::jsonb THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='MG_SYNC_EJECUTOR_NO_COMPATIBLE: actualizar el ejecutor antes de intercambiar fotografías u órdenes.';
  END IF;
  RETURN p_payload;
END;
$function$;

CREATE FUNCTION app_private.normalizar_entregas_ejecucion_manteniment(p_resultado jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE SECURITY INVOKER
SET search_path=pg_catalog AS $function$
  SELECT CASE WHEN jsonb_typeof(p_resultado->'comandos_manteniment') IS DISTINCT FROM 'array' THEN p_resultado
    ELSE jsonb_set(p_resultado,'{comandos_manteniment}',coalesce((
      SELECT jsonb_agg(CASE WHEN cmd->>'tipo'='parada'
        AND app_private.payload_solo_trabajos_continuidad_alpha75(cmd->'payload')
        THEN cmd||jsonb_build_object('tipo','trabajos') ELSE cmd END ORDER BY ordinal)
      FROM jsonb_array_elements(p_resultado->'comandos_manteniment') WITH ORDINALITY AS x(cmd,ordinal)
    ),'[]'::jsonb),true) END;
$function$;

-- Add the capability guard to the existing SQL wrapper, preserving owner,
-- ACL, language and every pg_proc property except its body. The preflight still
-- means installation compatibility, never execution permission. Its one pinned
-- wrapper fingerprint changes atomically with the exact guarded wrapper.
DO $negotiate$
DECLARE
  v_wrapper oid:='public.recibir_snapshot_manteniment(text,jsonb)'::regprocedure;
  v_preflight oid:='app_private.manteniment_preflight_solo_lectura(text,jsonb)'::regprocedure;
  v_wrapper_properties jsonb; v_preflight_properties jsonb;
  v_before text; v_after text; v_sha text; v_cap_sha text; v_envelope_sha text;
BEGIN
  SELECT to_jsonb(p)-'prosrc' INTO v_wrapper_properties FROM pg_proc p WHERE oid=v_wrapper;
  SELECT to_jsonb(p)-'prosrc' INTO v_preflight_properties FROM pg_proc p WHERE oid=v_preflight;
  v_before:=pg_get_functiondef(v_wrapper);
  v_after:=replace(v_before,
    'select app_private.recibir_snapshot_manteniment_7525(p_token,p_payload);',
    'select app_private.normalizar_entregas_ejecucion_manteniment(app_private.recibir_snapshot_manteniment_7525(p_token,app_private.exigir_capacidad_ejecucion_manteniment(p_payload)));');
  IF v_after=v_before THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='MG_SYNC_EJECUCION_WRAPPER_DRIFT';
  END IF;
  EXECUTE v_after;
  IF pg_get_functiondef(v_wrapper) IS DISTINCT FROM v_after THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='MG_SYNC_EJECUCION_WRAPPER_READBACK';
  END IF;
  v_sha:=encode(sha256(convert_to(v_after,'UTF8')),'hex');
  v_before:=pg_get_functiondef(v_preflight);
  v_after:=replace(v_before,
    '2e7bd5cb02bb5f582b9eaa241cc7d2db8b36879fe8b048de71e150aeee9defbd',v_sha);
  IF v_after=v_before THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='MG_SYNC_EJECUCION_PREFLIGHT_DRIFT';
  END IF;
  v_cap_sha:=md5(pg_get_functiondef('app_private.exigir_capacidad_ejecucion_manteniment(jsonb)'::regprocedure));
  v_envelope_sha:=md5(pg_get_functiondef('app_private.normalizar_entregas_ejecucion_manteniment(jsonb)'::regprocedure));
  v_after:=replace(v_after,'v_receptor_ok := coalesce(',
    'v_receptor_ok := coalesce(md5(pg_get_functiondef(to_regprocedure(''app_private.exigir_capacidad_ejecucion_manteniment(jsonb)''))) = '
    ||quote_literal(v_cap_sha)||' and md5(pg_get_functiondef(to_regprocedure(''app_private.normalizar_entregas_ejecucion_manteniment(jsonb)''))) = '
    ||quote_literal(v_envelope_sha)||' and ');
  EXECUTE v_after;
  IF pg_get_functiondef(v_preflight) IS DISTINCT FROM v_after
    OR (SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE oid=v_wrapper) IS DISTINCT FROM v_wrapper_properties
    OR (SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE oid=v_preflight) IS DISTINCT FROM v_preflight_properties THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='MG_SYNC_EJECUCION_PROPERTIES_DRIFT';
  END IF;
END;
$negotiate$;

CREATE FUNCTION app_private.referencia_ejecucion_manteniment_valida(p_ref jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER
SET search_path=pg_catalog AS $function$
BEGIN
  IF jsonb_typeof(p_ref) IS DISTINCT FROM 'object' THEN RETURN false; END IF;
  IF NOT (p_ref ?& ARRAY['tipo','sync_id','revision','payload_sha256'])
    OR (SELECT count(*) FROM jsonb_object_keys(p_ref))<>4
    OR p_ref->'tipo' NOT IN ('"parada"'::jsonb,'"trabajos"'::jsonb)
    OR jsonb_typeof(p_ref->'sync_id') IS DISTINCT FROM 'string'
    OR (p_ref->>'sync_id') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    OR jsonb_typeof(p_ref->'revision') IS DISTINCT FROM 'number'
    OR (p_ref->>'revision') !~ '^[1-9][0-9]{0,9}$'
    OR jsonb_typeof(p_ref->'payload_sha256') IS DISTINCT FROM 'string'
    OR (p_ref->>'payload_sha256') !~ '^[0-9a-f]{64}$' THEN RETURN false; END IF;
  RETURN (p_ref->>'revision')::numeric<=2147483647;
END;
$function$;

CREATE FUNCTION app_private.autorizar_ejecucion_manteniment(p_token text,p_solicitud jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog AS $function$
DECLARE
  v_config record; v_preflight jsonb; v_orden jsonb; v_ref jsonb; v_item jsonb;
  v_out app_private.manteniment_parada_outbox%rowtype;
  v_entrega app_private.manteniment_entregas_continuidad_alpha75%rowtype;
  v_motivo text:='AUTORIZADA'; v_tipo text; v_huella text;
  v_ahora timestamptz:=statement_timestamp(); v_permitida boolean;
BEGIN
  SELECT token_activo,token_hash,spreadsheet_id,pausa_importacion_identidad,
    solo_lectura_manual_protegida,escritura_segura_manual
    INTO v_config FROM app_private.manteniment_sync_config WHERE id=1;
  IF NOT FOUND OR v_config.token_activo IS DISTINCT FROM true
    OR coalesce(v_config.token_hash,'') !~ '^[0-9a-f]{64}$'
    OR coalesce(p_token,'') !~* '^mg_[0-9a-f]{64}$'
    OR encode(extensions.digest(p_token,'sha256'),'hex') IS DISTINCT FROM v_config.token_hash THEN
    RAISE EXCEPTION USING ERRCODE='28000',MESSAGE='Clave de conexión no válida.';
  END IF;
  IF jsonb_typeof(p_solicitud) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Solicitud de ejecución no válida.';
  END IF;
  IF NOT (p_solicitud ?& ARRAY['version_script','version_ejecucion','escritura_segura_manual','spreadsheet_id','request_id','alcance','orden'])
    OR (SELECT count(*) FROM jsonb_object_keys(p_solicitud))<>7
    OR jsonb_typeof(p_solicitud->'version_script') IS DISTINCT FROM 'string'
    OR (p_solicitud->>'version_script') !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$'
    OR (p_solicitud->>'version_script') ~* 'mg_[0-9a-f]{64}'
    OR jsonb_typeof(p_solicitud->'version_ejecucion') IS DISTINCT FROM 'string'
    OR (p_solicitud->>'version_ejecucion') !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$'
    OR (p_solicitud->>'version_ejecucion') ~* 'mg_[0-9a-f]{64}'
    OR jsonb_typeof(p_solicitud->'escritura_segura_manual') IS DISTINCT FROM 'boolean'
    OR jsonb_typeof(p_solicitud->'spreadsheet_id') IS DISTINCT FROM 'string'
    OR (p_solicitud->>'spreadsheet_id') !~ '^[A-Za-z0-9_-]{20,150}$'
    OR jsonb_typeof(p_solicitud->'request_id') IS DISTINCT FROM 'string'
    OR (p_solicitud->>'request_id') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    OR jsonb_typeof(p_solicitud->'alcance') IS DISTINCT FROM 'array'
    OR jsonb_typeof(p_solicitud->'orden') IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Solicitud de ejecución no válida.';
  END IF;
  IF jsonb_array_length(p_solicitud->'alcance') NOT BETWEEN 1 AND 200
    OR (SELECT count(*)<>count(DISTINCT value) FROM jsonb_array_elements(p_solicitud->'alcance')) THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Alcance de ejecución no válido.';
  END IF;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_solicitud->'alcance') LOOP
    IF NOT app_private.referencia_ejecucion_manteniment_valida(v_item) THEN
      RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Referencia de alcance no válida.';
    END IF;
  END LOOP;
  v_orden:=p_solicitud->'orden'; v_ref:=v_orden-'payload';
  IF jsonb_typeof(v_orden->'payload') IS DISTINCT FROM 'object'
    OR NOT app_private.referencia_ejecucion_manteniment_valida(v_ref) THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Orden de ejecución no válida.';
  END IF;

  -- A client-selected finite list is an additional restriction, not a grant.
  -- All reads below share this STABLE call's snapshot. No advisory/row locks,
  -- no receiver invocation and no delivery/queue/config timestamps are changed.
  IF p_solicitud->'version_ejecucion' IS DISTINCT FROM '"MG75-EJECUCION-ORDEN-001"'::jsonb THEN
    v_motivo:='EJECUTOR_NO_COMPATIBLE';
  ELSIF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_solicitud->'alcance') WHERE value=v_ref) THEN
    v_motivo:='FUERA_DE_ALCANCE';
  ELSE
    v_preflight:=app_private.manteniment_preflight_solo_lectura(p_token,jsonb_build_object(
      'version_script',p_solicitud->'version_script','version_preflight','alpha75-preflight-2026.10.27.1',
      'escritura_segura_manual',p_solicitud->'escritura_segura_manual','spreadsheet_id',p_solicitud->'spreadsheet_id'));
    IF v_preflight->'compatible' IS DISTINCT FROM 'true'::jsonb THEN
      v_motivo:='INSTALACION_NO_COMPATIBLE';
    ELSIF v_config.pausa_importacion_identidad IS DISTINCT FROM false
      OR v_config.solo_lectura_manual_protegida IS DISTINCT FROM false
      OR v_config.escritura_segura_manual IS DISTINCT FROM true THEN
      v_motivo:='BARRERAS_CERRADAS';
    ELSE
      SELECT * INTO v_out FROM app_private.manteniment_parada_outbox
        WHERE sync_id=(v_ref->>'sync_id')::uuid AND revision=(v_ref->>'revision')::integer;
      SELECT * INTO v_entrega FROM app_private.manteniment_entregas_continuidad_alpha75
        WHERE sync_id=(v_ref->>'sync_id')::uuid AND revision=(v_ref->>'revision')::integer;
      IF v_out.sync_id IS NULL THEN v_motivo:='ORDEN_NO_VIGENTE';
      ELSIF v_out.estado IS DISTINCT FROM 'pendiente' THEN v_motivo:='ORDEN_RETENIDA_O_CONFIRMADA';
      ELSIF v_entrega.sync_id IS NULL OR v_entrega.origen<>'entrega'
        OR v_entrega.entregado_en IS NULL OR v_entrega.entregas<1 THEN v_motivo:='ENTREGA_NO_ACREDITADA';
      ELSIF v_entrega.confirmado_en IS NOT NULL THEN v_motivo:='ORDEN_YA_CONFIRMADA';
      ELSE
        v_tipo:=CASE WHEN app_private.payload_solo_trabajos_continuidad_alpha75(v_out.payload) THEN 'trabajos' ELSE 'parada' END;
        v_huella:=encode(sha256(convert_to(v_out.payload::text,'UTF8')),'hex');
        -- Compare complete JSONB as well as both stored server hashes. JSON
        -- transport may serialize numeric 300.00 as 300: their JSONB values
        -- are equal, but jsonb::text hashes differ. The delivered hash is an
        -- opaque server reference, never a hash of the client's serialization.
        IF v_out.payload IS DISTINCT FROM v_orden->'payload'
          OR v_entrega.payload IS DISTINCT FROM v_orden->'payload'
          OR v_entrega.seguimiento_id IS DISTINCT FROM v_out.seguimiento_id
          OR v_entrega.tipo IS DISTINCT FROM v_tipo OR v_tipo IS DISTINCT FROM v_ref->>'tipo'
          OR v_entrega.payload_sha256 IS DISTINCT FROM v_ref->>'payload_sha256'
          OR v_huella IS DISTINCT FROM v_ref->>'payload_sha256'
          OR encode(sha256(convert_to(v_entrega.payload::text,'UTF8')),'hex') IS DISTINCT FROM v_ref->>'payload_sha256'
          OR NOT EXISTS(SELECT 1 FROM app_private.manteniment_parada_sync s
            WHERE s.seguimiento_id=v_out.seguimiento_id AND s.sync_id=v_out.sync_id) THEN
          v_motivo:='ORDEN_NO_COINCIDE';
        ELSIF v_tipo='parada' AND EXISTS(SELECT 1 FROM app_private.sustitucion_continuidades_alpha75 c
          WHERE c.origen_seguimiento_id=v_out.seguimiento_id OR c.destino_seguimiento_id=v_out.seguimiento_id) THEN
          v_motivo:='CONTINUIDAD_RETENIDA';
        ELSIF (v_out.payload->'solo_trabajos'='true'::jsonb AND v_tipo<>'trabajos')
          OR coalesce(v_out.payload->'ajuste_24h','null'::jsonb)<>'null'::jsonb
          OR v_out.payload #> '{reversion_t,limpiar_fecha_entrada}'='true'::jsonb
          OR v_out.payload #> '{reversion_t,limpiar_fecha_salida}'='true'::jsonb
          OR v_out.payload #> '{reversion_t,limpiar_k_parada}'='true'::jsonb THEN
          v_motivo:='OPERACION_NO_PERMITIDA';
        ELSIF EXISTS(SELECT 1 FROM public.vehiculos v
          WHERE v.dfm=regexp_replace(upper(btrim(v_out.payload->>'dfm')),'[[:space:]]+','','g')
            AND v.activo IS false AND v.baja_manual_bloquea_sync IS true) THEN
          v_motivo:='BAJA_MANUAL_PROTEGIDA';
        END IF;
      END IF;
    END IF;
  END IF;
  v_permitida:=v_motivo='AUTORIZADA';
  RETURN jsonb_build_object(
    'protocolo','manteniment-ejecucion-v1','version_ejecucion',p_solicitud->'version_ejecucion',
    'version_script',p_solicitud->'version_script','solo_lectura',true,
    'request_id',p_solicitud->'request_id','spreadsheet_id',p_solicitud->'spreadsheet_id',
    'alcance',p_solicitud->'alcance','orden',v_ref,'autorizada',v_permitida,'motivo',v_motivo,
    'autorizado_en',to_char(v_ahora AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'expira_en',to_char((v_ahora+CASE WHEN v_permitida THEN interval '30 seconds' ELSE interval '0 seconds' END)
      AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
END;
$function$;

CREATE FUNCTION public.autorizar_ejecucion_manteniment(p_token text,p_solicitud jsonb)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER
SET search_path=pg_catalog AS $function$
  SELECT app_private.autorizar_ejecucion_manteniment(p_token,p_solicitud);
$function$;

CREATE FUNCTION app_private.confirmar_ejecucion_manteniment(p_token text,p_solicitud jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog AS $function$
DECLARE
  v_config record; v_ack jsonb; v_ref jsonb;
  v_entrega app_private.manteniment_entregas_continuidad_alpha75%rowtype;
BEGIN
  SELECT token_activo,token_hash,spreadsheet_id INTO v_config
    FROM app_private.manteniment_sync_config WHERE id=1;
  IF NOT FOUND OR v_config.token_activo IS DISTINCT FROM true
    OR coalesce(v_config.token_hash,'') !~ '^[0-9a-f]{64}$'
    OR coalesce(p_token,'') !~* '^mg_[0-9a-f]{64}$'
    OR encode(extensions.digest(p_token,'sha256'),'hex') IS DISTINCT FROM v_config.token_hash THEN
    RAISE EXCEPTION USING ERRCODE='28000',MESSAGE='Clave de conexión no válida.';
  END IF;
  IF jsonb_typeof(p_solicitud) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Acuse de ejecución no válido.';
  END IF;
  IF NOT (p_solicitud ?& ARRAY['version_ejecucion','spreadsheet_id','request_id','confirmacion'])
    OR (SELECT count(*) FROM jsonb_object_keys(p_solicitud))<>4
    OR p_solicitud->'version_ejecucion' IS DISTINCT FROM '"MG75-EJECUCION-ORDEN-001"'::jsonb
    OR jsonb_typeof(p_solicitud->'spreadsheet_id') IS DISTINCT FROM 'string'
    OR (p_solicitud->>'spreadsheet_id') !~ '^[A-Za-z0-9_-]{20,150}$'
    OR p_solicitud->>'spreadsheet_id' IS DISTINCT FROM v_config.spreadsheet_id
    OR jsonb_typeof(p_solicitud->'request_id') IS DISTINCT FROM 'string'
    OR (p_solicitud->>'request_id') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    OR jsonb_typeof(p_solicitud->'confirmacion') IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Acuse de ejecución no válido.';
  END IF;
  v_ack:=p_solicitud->'confirmacion';
  v_ref:=jsonb_build_object('tipo',v_ack->'tipo','sync_id',v_ack->'sync_id',
    'revision',v_ack->'revision','payload_sha256',v_ack->'payload_sha256');
  IF NOT app_private.referencia_ejecucion_manteniment_valida(v_ref)
    OR v_ack->'estado' IS DISTINCT FROM '"aplicado"'::jsonb
    OR EXISTS(SELECT 1 FROM jsonb_object_keys(v_ack) k WHERE k NOT IN (
      'tipo','sync_id','revision','payload_sha256','estado','fila','trabajos_asignados',
      'ajustes_24h','filas_archivo_enlazadas','trabajos_creados')) THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Referencia de acuse no válida.';
  END IF;

  -- No execute authorization is required to acknowledge a durable, already
  -- applied receipt. Keep the existing advisory-lock order and legacy pause
  -- semantics. The immutable delivery, not a newer outbox, identifies the ACK.
  PERFORM app_private.bloquear_sync_continuidad_alpha75();
  SELECT * INTO v_entrega FROM app_private.manteniment_entregas_continuidad_alpha75
    WHERE sync_id=(v_ref->>'sync_id')::uuid AND revision=(v_ref->>'revision')::integer;
  IF NOT FOUND OR v_entrega.origen<>'entrega' OR v_entrega.entregado_en IS NULL
    OR v_entrega.tipo IS DISTINCT FROM v_ref->>'tipo'
    OR v_entrega.payload_sha256 IS DISTINCT FROM v_ref->>'payload_sha256'
    OR v_entrega.payload_sha256 IS DISTINCT FROM encode(sha256(convert_to(v_entrega.payload::text,'UTF8')),'hex') THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='MG_SYNC_EJECUCION_ACK_SIN_ENTREGA_EXACTA';
  END IF;
  IF v_entrega.confirmado_en IS NULL THEN
    -- A new confirmation still obeys the legacy pause and all its guards.
    PERFORM app_private.manteniment_confirmar_comandos(p_token,jsonb_build_array(v_ack));
    SELECT * INTO v_entrega FROM app_private.manteniment_entregas_continuidad_alpha75
      WHERE sync_id=(v_ref->>'sync_id')::uuid AND revision=(v_ref->>'revision')::integer;
  ELSIF (v_entrega.confirmacion-'payload_sha256') IS DISTINCT FROM (v_ack-'payload_sha256') THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='MG_SYNC_CONTINUIDAD_ACK_CONTRADICTORIO';
  END IF;
  -- Reading an already committed, identical receipt is safe even if the pause
  -- was closed after its commit. This path never invokes the mutating legacy
  -- confirmer or changes queue/timestamps, and cannot credit a different ACK.
  IF v_entrega.confirmado_en IS NULL
    OR (v_entrega.confirmacion-'payload_sha256') IS DISTINCT FROM (v_ack-'payload_sha256')
    OR v_entrega.payload_sha256 IS DISTINCT FROM v_ref->>'payload_sha256' THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='MG_SYNC_EJECUCION_ACK_NO_CONFIRMADO';
  END IF;
  RETURN jsonb_build_object('protocolo','manteniment-acuse-ejecucion-v1',
    'version_ejecucion',p_solicitud->'version_ejecucion','request_id',p_solicitud->'request_id',
    'spreadsheet_id',p_solicitud->'spreadsheet_id','confirmada',true,'orden',v_ref);
END;
$function$;

CREATE FUNCTION public.confirmar_ejecucion_manteniment(p_token text,p_solicitud jsonb)
RETURNS jsonb LANGUAGE sql VOLATILE SECURITY INVOKER
SET search_path=pg_catalog AS $function$
  SELECT app_private.confirmar_ejecucion_manteniment(p_token,p_solicitud);
$function$;

REVOKE ALL ON FUNCTION app_private.exigir_capacidad_ejecucion_manteniment(jsonb),
  app_private.normalizar_entregas_ejecucion_manteniment(jsonb),
  app_private.referencia_ejecucion_manteniment_valida(jsonb),
  app_private.autorizar_ejecucion_manteniment(text,jsonb),public.autorizar_ejecucion_manteniment(text,jsonb),
  app_private.confirmar_ejecucion_manteniment(text,jsonb),public.confirmar_ejecucion_manteniment(text,jsonb)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION app_private.exigir_capacidad_ejecucion_manteniment(jsonb),
  app_private.normalizar_entregas_ejecucion_manteniment(jsonb),
  app_private.referencia_ejecucion_manteniment_valida(jsonb),
  app_private.autorizar_ejecucion_manteniment(text,jsonb),public.autorizar_ejecucion_manteniment(text,jsonb),
  app_private.confirmar_ejecucion_manteniment(text,jsonb),public.confirmar_ejecucion_manteniment(text,jsonb)
  TO service_role;
COMMENT ON FUNCTION public.autorizar_ejecucion_manteniment(text,jsonb) IS
  'MG75-EJECUCION-ORDEN-001: SELECT-only current eligibility for one explicitly selected delivered revision; 30-second attempt, not a lease or a Google transaction.';
COMMENT ON FUNCTION public.confirmar_ejecucion_manteniment(text,jsonb) IS
  'MG75-EJECUCION-ORDEN-001: exact ACK receipt; new confirmation obeys the legacy pause, exact committed replay is read without mutation. Does not authorize another write.';

COMMIT;
