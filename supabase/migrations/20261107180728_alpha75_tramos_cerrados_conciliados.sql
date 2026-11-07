-- MG75-TRAMOS-CERRADOS-001. Install an operator-only reconciliation boundary.
-- Installation never reconciles a case, changes a flag, ACKs or releases a hold.
BEGIN;

DO $preflight$
DECLARE v record;
BEGIN
 FOR v IN SELECT * FROM (VALUES
  ('app_private.bloquear_sync_continuidad_alpha75()','1e357e8cce17d1538f9a69424e0378e2'),
  ('app_private.manteniment_construir_payload_parada(uuid)','d901eb0fdb5f16bae66ab596eb82a459'),
  ('app_private.retencion_identidad_manteniment_alpha75(uuid,uuid,jsonb)','d2269f3424c6c81f4fe0a0d6dc2d4524'),
  ('app_private.manteniment_encolar_parada(uuid)','933de20102ec4c7953fab88014ceeb44'),
  ('app_private.finalizar_entrega_sync_continuidad_alpha75(jsonb)','88ef3bd8752fa1d8ed08147b2148e0c2'),
  ('app_private.autorizar_ejecucion_manteniment(text,jsonb)','379aebbe95b008fe38cd75b9c394899d'),
  ('app_private.proteger_outbox_continuidad_alpha75()','539f7ac61e80d602f6164073380e0239')
 ) x(signature,fingerprint) LOOP
  IF md5(pg_get_functiondef(to_regprocedure(v.signature))) IS DISTINCT FROM v.fingerprint THEN
   RAISE EXCEPTION 'MG_CERRADO_BASE_INESPERADA: %',v.signature;
  END IF;
 END LOOP;
 PERFORM app_private.bloquear_sync_continuidad_alpha75();
 PERFORM 1 FROM app_private.manteniment_sync_config WHERE id=1
  AND solo_lectura_manual_protegida IS TRUE AND escritura_segura_manual IS FALSE FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'MG_CERRADO_SALIDA_NO_PROTEGIDA'; END IF;
END;
$preflight$;

CREATE TEMP TABLE mg75_cerrado_properties ON COMMIT DROP AS
 SELECT oid,to_jsonb(p)-'prosrc' AS properties FROM pg_proc p
 WHERE oid=ANY(ARRAY[
  'app_private.manteniment_construir_payload_parada(uuid)'::regprocedure,
  'app_private.retencion_identidad_manteniment_alpha75(uuid,uuid,jsonb)'::regprocedure]::oid[]);

CREATE TABLE app_private.manteniment_tramos_cerrados_conciliados_alpha75 (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 request_id text NOT NULL UNIQUE CHECK(request_id ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{7,127}$'),
 seguimiento_id uuid NOT NULL UNIQUE,
 sync_id uuid NOT NULL UNIQUE,
 id_filas bigint[] NOT NULL CHECK(cardinality(id_filas) BETWEEN 1 AND 500),
 ultimo_id_fila bigint NOT NULL CHECK(ultimo_id_fila>0 AND ultimo_id_fila=ANY(id_filas)),
 prevision_sha256 text NOT NULL CHECK(prevision_sha256 ~ '^[0-9a-f]{64}$'),
 evidencia jsonb NOT NULL CHECK(jsonb_typeof(evidencia)='object'
  AND evidencia ?& ARRAY['prevision','contexto_aceptado','outbox_obsoleta','disposicion']),
 evidencia_sha256 text GENERATED ALWAYS AS
  (app_private.hash_payload_sync_continuidad_alpha75(evidencia)) STORED,
 operador_sql text NOT NULL DEFAULT session_user,
 creado_en timestamptz NOT NULL DEFAULT clock_timestamp()
);
COMMENT ON TABLE app_private.manteniment_tramos_cerrados_conciliados_alpha75 IS
 'Immutable operator evidence. Complete private source snapshots and their ID_FILA rows, old/accepted context, obsolete mixed outbox and unchanged delivery/ACK evidence. A declared execution reference is contextual, never an inferred cryptographic join. No automatic un-reconciliation or hold resolution.';
ALTER TABLE app_private.manteniment_tramos_cerrados_conciliados_alpha75 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON app_private.manteniment_tramos_cerrados_conciliados_alpha75
 FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION app_private.inmutabilidad_tramos_cerrados_alpha75()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $function$
BEGIN
 RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='MG_CERRADO_EVIDENCIA_INMUTABLE';
END;
$function$;
CREATE TRIGGER manteniment_tramo_cerrado_inmutable
 BEFORE UPDATE OR DELETE ON app_private.manteniment_tramos_cerrados_conciliados_alpha75
 FOR EACH ROW EXECUTE FUNCTION app_private.inmutabilidad_tramos_cerrados_alpha75();
CREATE TRIGGER manteniment_tramo_cerrado_no_truncate
 BEFORE TRUNCATE ON app_private.manteniment_tramos_cerrados_conciliados_alpha75
 FOR EACH STATEMENT EXECUTE FUNCTION app_private.inmutabilidad_tramos_cerrados_alpha75();

-- Existence remains a hold even after the old identity review has been resolved,
-- the current Hotel copy is archived/reopened, or a new outbox is attempted.
CREATE FUNCTION app_private.tramo_cerrado_conciliado_manteniment_alpha75(
 p_seguimiento uuid,p_sync uuid DEFAULT NULL)
RETURNS boolean LANGUAGE sql STABLE SET search_path=pg_catalog,app_private AS $function$
 SELECT EXISTS(SELECT 1 FROM app_private.manteniment_tramos_cerrados_conciliados_alpha75 c
  WHERE c.seguimiento_id=p_seguimiento OR (p_sync IS NOT NULL AND c.sync_id=p_sync))
$function$;

CREATE FUNCTION app_private.campos_contexto_tramo_cerrado_alpha75(p_contexto jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $function$
 SELECT jsonb_build_object(
  'seguimiento_id',p_contexto->'seguimiento_id','sync_id',p_contexto->'sync_id',
  'fecha_programada_parada',p_contexto->'fecha_programada_parada',
  'fecha_inicio_tramo',p_contexto->'fecha_inicio_tramo','fecha_corte',p_contexto->'fecha_corte',
  'tancament',p_contexto->'tancament','dias_parada_manual',p_contexto->'dias_parada_manual',
  'km_facturables_manual',p_contexto->'km_facturables_manual',
  'calculo_periodo_automatico',p_contexto->'calculo_periodo_automatico')
$function$;

-- Pure preview: no row locks, writes, receiver calls or queue generation.
-- The request explicitly names a PA and all of its source IDs. Nothing selects
-- by a physical row, DFM alone, latest-array-position, or an inferred original J.
CREATE FUNCTION app_private.previsualizar_tramo_cerrado_manteniment_alpha75(p_solicitud jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE
SET search_path=pg_catalog,public,app_private SET timezone='UTC' AS $function$
DECLARE
 v_sync app_private.manteniment_parada_sync%rowtype;
 v_out app_private.manteniment_parada_outbox%rowtype;
 v_review app_private.manteniment_revision_identidad_alpha75%rowtype;
 v_ficha record; v_identity jsonb; v_canon jsonb; v_pair jsonb; v_ref jsonb;
 v_execution jsonb; v_sources jsonb:='[]'; v_items jsonb:='[]'; v_item jsonb;
 v_linked_paradas jsonb:='[]'; v_linked_cierres jsonb:='[]';
 v_hotel jsonb; v_deliveries jsonb; v_origins jsonb; v_last jsonb; v_context jsonb; v_preview jsonb;
 v_ids bigint[]; v_requested_ids bigint[]; v_seen_sources bigint[]:='{}';
 v_blocks text[]:='{}'; v_id bigint; v_count integer; v_j date; v_k date; v_i date;
 v_days numeric; v_km numeric; v_track uuid; v_uuid uuid; v_execution_id uuid;
BEGIN
 IF jsonb_typeof(p_solicitud) IS DISTINCT FROM 'object'
  OR (SELECT count(*) FROM jsonb_object_keys(p_solicitud))<>10
  OR NOT (p_solicitud ?& ARRAY['protocolo','request_id','seguimiento_id','sync_id',
   'fuentes','id_filas','ultimo_id_fila','ejecucion_referencia','evidencia_operador','motivo'])
  OR p_solicitud->>'protocolo' IS DISTINCT FROM 'MG75-TRAMOS-CERRADOS-001'
  OR coalesce(p_solicitud->>'request_id','') !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{7,127}$'
  OR coalesce(p_solicitud->>'seguimiento_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  OR coalesce(p_solicitud->>'sync_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  OR coalesce(p_solicitud->>'ejecucion_referencia','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  OR length(btrim(coalesce(p_solicitud->>'motivo',''))) NOT BETWEEN 20 AND 2000
  OR jsonb_typeof(p_solicitud->'fuentes') IS DISTINCT FROM 'array'
  OR jsonb_array_length(p_solicitud->'fuentes')<>2
  OR jsonb_typeof(p_solicitud->'id_filas') IS DISTINCT FROM 'array'
  OR jsonb_array_length(p_solicitud->'id_filas') NOT BETWEEN 1 AND 500
  OR jsonb_typeof(p_solicitud->'ultimo_id_fila') IS DISTINCT FROM 'number'
  OR coalesce(p_solicitud->>'ultimo_id_fila','') !~ '^[1-9][0-9]{0,15}$'
  OR jsonb_typeof(p_solicitud->'evidencia_operador') IS DISTINCT FROM 'object' THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='MG_CERRADO_SOLICITUD_INVALIDA';
 END IF;
 IF p_solicitud #>> '{evidencia_operador,tipo}' IS DISTINCT FROM 'atestacion_sql_privada'
  OR p_solicitud #> '{evidencia_operador,cliente_sin_ejecucion_pendiente}' IS DISTINCT FROM 'true'::jsonb
  OR p_solicitud #> '{evidencia_operador,cliente_inactivo}' IS DISTINCT FROM 'true'::jsonb
  OR p_solicitud #> '{evidencia_operador,barreras_sostenidas}' IS DISTINCT FROM 'true'::jsonb
  OR p_solicitud #> '{evidencia_operador,alcance_fuente_completo_revisado}' IS DISTINCT FROM 'true'::jsonb
  OR coalesce(p_solicitud #>> '{evidencia_operador,barreras_sostenidas_desde}','')
   !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?Z$'
  OR coalesce(p_solicitud #>> '{evidencia_operador,observado_en}','')
   !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?Z$'
  OR coalesce(p_solicitud #>> '{evidencia_operador,evidencia_sha256}','') !~ '^[0-9a-f]{64}$'
  OR length(btrim(coalesce(p_solicitud #>> '{evidencia_operador,referencia}',''))) NOT BETWEEN 8 AND 2000 THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='MG_CERRADO_ATESTACION_REQUERIDA';
 END IF;
 -- Authorization is read-only and has no persisted grant ledger. These times
 -- are explicit operator testimony, not an automatically proven protection
 -- window and not a cryptographic association with the source execution.
 IF (p_solicitud #>> '{evidencia_operador,observado_en}')::timestamptz>statement_timestamp()
  OR (p_solicitud #>> '{evidencia_operador,observado_en}')::timestamptz
   -(p_solicitud #>> '{evidencia_operador,barreras_sostenidas_desde}')::timestamptz<interval '35 seconds' THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='MG_CERRADO_VENTANA_ATESTADA_INSUFICIENTE';
 END IF;
 v_track:=(p_solicitud->>'seguimiento_id')::uuid;
 v_uuid:=(p_solicitud->>'sync_id')::uuid;
 v_execution_id:=(p_solicitud->>'ejecucion_referencia')::uuid;
 IF EXISTS(SELECT 1 FROM app_private.manteniment_tramos_cerrados_conciliados_alpha75
  WHERE seguimiento_id=v_track OR sync_id=v_uuid OR request_id=p_solicitud->>'request_id') THEN
  RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='MG_CERRADO_YA_CONCILIADO: conservar el recibo, no repetir ni reemplazar';
 END IF;
 SELECT * INTO v_sync FROM app_private.manteniment_parada_sync WHERE seguimiento_id=v_track;
 IF NOT FOUND OR v_sync.sync_id<>v_uuid THEN
  RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='MG_CERRADO_IDENTIDAD_SYNC';
 END IF;
 v_identity:=app_private.identidad_uuid_manteniment_alpha75(v_uuid::text);
 IF v_identity->'valida' IS DISTINCT FROM 'true'::jsonb
  OR v_identity->>'seguimiento_id' IS DISTINCT FROM v_track::text THEN
  RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='MG_CERRADO_IDENTIDAD_NO_UNICA';
 END IF;
 v_canon:=v_identity->'identidades'->0;
 SELECT count(DISTINCT r.seguimiento_id) INTO v_count FROM public.registros_hotel r
  WHERE app_private.normalizar_dfm_continuidad_alpha75(r.vehiculo_sustituido)=v_canon->>'dfm'
   AND app_private.normalizar_matricula_continuidad_alpha75(r.matricula_sustituido)=v_canon->>'matricula'
   AND app_private.normalizar_pa_manteniment_alpha75(r.numero_parada)=v_canon->>'numero_parada';
 IF v_count<>1 OR app_private.seguimiento_con_continuidad_sustitucion_alpha75(v_track) THEN
  RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='MG_CERRADO_PA_AMBIGUA_O_CONTINUIDAD';
 END IF;
 SELECT r.*,p.fecha AS fecha_pizarra,p.estado AS estado_pizarra INTO v_ficha
  FROM public.registros_hotel r JOIN public.pizarras p ON p.id=r.pizarra_id
  WHERE r.seguimiento_id=v_track
  ORDER BY (p.estado='en_curso') DESC,p.fecha DESC,r.actualizado_en DESC,r.id DESC LIMIT 1;
 -- Archiving alone is not recovery; an active/reopened newer copy defeats an
 -- older closed one. No Hotel date is overwritten to make the evidence agree.
 IF NOT FOUND OR v_ficha.cancelado IS DISTINCT FROM false
  OR v_ficha.retirado_hotel_activo IS DISTINCT FROM true
  OR v_ficha.estado NOT IN ('recuperado','reserva_liberada') THEN
  RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='MG_CERRADO_HOTEL_NO_CERRADO: archivo o cierre contable no acreditan recuperación';
 END IF;
 SELECT * INTO v_out FROM app_private.manteniment_parada_outbox WHERE seguimiento_id=v_track;
 IF NOT FOUND OR v_out.sync_id<>v_uuid OR v_out.estado<>'retenida_manual'
  OR v_out.confirmado_en IS NOT NULL OR app_private.payload_solo_trabajos_continuidad_alpha75(v_out.payload) THEN
  RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='MG_CERRADO_OUTBOX_NO_REVISABLE';
 END IF;
 SELECT to_jsonb(e) INTO v_execution FROM public.manteniment_sync_ejecuciones e WHERE id=v_execution_id;
 IF v_execution IS NULL OR v_execution->>'estado' IS DISTINCT FROM 'correcta'
  OR v_execution->>'origen' IS DISTINCT FROM 'google_apps_script' THEN
  RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='MG_CERRADO_EJECUCION_REFERENCIA_INVALIDA';
 END IF;

 FOR v_ref IN SELECT value FROM jsonb_array_elements(p_solicitud->'fuentes') LOOP
  IF jsonb_typeof(v_ref) IS DISTINCT FROM 'object'
   OR (SELECT count(*) FROM jsonb_object_keys(v_ref))<>2
   OR NOT (v_ref ?& ARRAY['revision_id','payload_sha256'])
   OR jsonb_typeof(v_ref->'revision_id') IS DISTINCT FROM 'number'
   OR coalesce(v_ref->>'revision_id','') !~ '^[1-9][0-9]{0,15}$'
   OR coalesce(v_ref->>'payload_sha256','') !~ '^[0-9a-f]{64}$' THEN
   RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='MG_CERRADO_REFERENCIA_FUENTE_INVALIDA';
  END IF;
  SELECT * INTO v_review FROM app_private.manteniment_revision_identidad_alpha75
   WHERE id=(v_ref->>'revision_id')::bigint;
  IF NOT FOUND OR v_review.id=ANY(v_seen_sources) OR v_review.bloque=ANY(v_blocks)
   OR v_review.payload_sha256 IS DISTINCT FROM v_ref->>'payload_sha256'
   OR v_review.payload_sha256 IS DISTINCT FROM app_private.hash_payload_sync_continuidad_alpha75(v_review.payload)
   OR NOT ((v_review.bloque='paradas' AND (
      (v_review.motivo='IDENTIDAD_UUID_PA_VEHICULO' AND v_review.contexto='')
      OR (v_review.motivo IN ('SIN_TRAMO_ABIERTO','VARIOS_TRAMOS_ABIERTOS','CONTEXTO_OPERATIVO_NO_VIGENTE','SUSTITUTO_NO_ACREDITADO')
       AND v_review.contexto ~* '^[0-9a-f-]{36}$')))
     OR (v_review.bloque='cierres_facturacion' AND v_review.contexto=''
      AND v_review.motivo IN ('IDENTIDAD_O_CONTINUIDAD','CIERRES_SIN_UUID'))) THEN
   RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='MG_CERRADO_FUENTE_NO_ACREDITADA';
  END IF;
  -- A newer different complete block invalidates the preview. Same-content
  -- diagnostic siblings do not invent a second source or a receipt join.
  IF EXISTS(SELECT 1 FROM app_private.manteniment_revision_identidad_alpha75 q
   WHERE q.bloque=v_review.bloque AND q.ultima_recepcion_en>v_review.ultima_recepcion_en
    AND q.payload_sha256<>v_review.payload_sha256
    AND ((q.contexto='' AND q.motivo IN ('IDENTIDAD_UUID_PA_VEHICULO','IDENTIDAD_O_CONTINUIDAD','CIERRES_SIN_UUID'))
      OR (q.bloque='paradas' AND q.contexto ~* '^[0-9a-f-]{36}$'
       AND q.motivo IN ('SIN_TRAMO_ABIERTO','VARIOS_TRAMOS_ABIERTOS','CONTEXTO_OPERATIVO_NO_VIGENTE','SUSTITUTO_NO_ACREDITADO')))) THEN
   RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='MG_CERRADO_FUENTE_SUPERADA';
  END IF;
  v_seen_sources:=array_append(v_seen_sources,v_review.id);
  v_blocks:=array_append(v_blocks,v_review.bloque);
  v_sources:=v_sources||jsonb_build_array(to_jsonb(v_review));
  FOR v_item IN SELECT value FROM jsonb_array_elements(v_review.payload) LOOP
   v_pair:=jsonb_build_object(
    'dfm',app_private.normalizar_dfm_continuidad_alpha75(v_item->>'dfm'),
    'matricula',app_private.normalizar_matricula_continuidad_alpha75(v_item->>'matricula'),
    'numero_parada',app_private.normalizar_pa_manteniment_alpha75(v_item->>'numero_parada'));
   IF lower(coalesce(v_item->>'sync_id',''))<>v_uuid::text AND v_pair<>v_canon THEN CONTINUE; END IF;
   IF v_pair<>v_canon OR (coalesce(v_item->>'sync_id','')<>'' AND lower(v_item->>'sync_id')<>v_uuid::text)
    OR v_item->>'estado' IS DISTINCT FROM 'PARADA'
    OR jsonb_typeof(v_item->'id_fila') IS DISTINCT FROM 'number'
    OR coalesce(v_item->>'id_fila','') !~ '^[1-9][0-9]{0,15}$'
    OR (v_item->>'id_fila')::numeric>9007199254740991 THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='MG_CERRADO_FILA_IDENTIDAD_NO_ACREDITADA';
   END IF;
   v_id:=(v_item->>'id_fila')::bigint;
   -- A duplicate T elsewhere in this complete source is also ambiguous.
   IF (SELECT count(*) FROM jsonb_array_elements(v_review.payload) e
     WHERE e.value->>'id_fila'=v_id::text)<>1 THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='MG_CERRADO_ID_FILA_DUPLICADO';
   END IF;
   IF EXISTS(SELECT 1 FROM jsonb_array_elements(v_items) e WHERE e.value->>'id_fila'=v_id::text
       AND e.value IS DISTINCT FROM v_item) THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='MG_CERRADO_FUENTES_DISCREPAN';
   END IF;
   IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(v_items) e WHERE e.value=v_item) THEN
    v_items:=v_items||jsonb_build_array(v_item);
   END IF;
   IF coalesce(v_item->>'sync_id','')<>'' THEN
    IF v_review.bloque='paradas' THEN v_linked_paradas:=v_linked_paradas||jsonb_build_array(v_item);
    ELSE v_linked_cierres:=v_linked_cierres||jsonb_build_array(v_item); END IF;
   END IF;
  END LOOP;
 END LOOP;
 IF NOT (v_blocks @> ARRAY['paradas','cierres_facturacion']) OR jsonb_array_length(v_items)=0 THEN
  RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='MG_CERRADO_FALTAN_FUENTES_COMPLETAS';
 END IF;
 -- Both .12 readers include every UUID-linked closed target row with Q.
 -- A one-sided omission must not pass by taking the union of two photographs.
 -- CIERRES may additionally contain historical rows without a UUID.
 IF (SELECT coalesce(jsonb_agg(value ORDER BY (value->>'id_fila')::bigint),'[]'::jsonb)
      FROM jsonb_array_elements(v_linked_paradas)) IS DISTINCT FROM
    (SELECT coalesce(jsonb_agg(value ORDER BY (value->>'id_fila')::bigint),'[]'::jsonb)
      FROM jsonb_array_elements(v_linked_cierres)) THEN
  RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='MG_CERRADO_FUENTES_VINCULADAS_INCOMPLETAS';
 END IF;
 SELECT array_agg((e.value->>'id_fila')::bigint ORDER BY (e.value->>'id_fila')::bigint),
  jsonb_agg(e.value ORDER BY (e.value->>'id_fila')::bigint) INTO v_ids,v_items
 FROM jsonb_array_elements(v_items) e;
 FOR v_ref IN SELECT value FROM jsonb_array_elements(p_solicitud->'id_filas') LOOP
  IF jsonb_typeof(v_ref) IS DISTINCT FROM 'number' OR v_ref::text !~ '^[1-9][0-9]{0,15}$'
   OR v_ref::numeric>9007199254740991 THEN
   RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='MG_CERRADO_IDS_SOLICITADOS_INVALIDOS';
  END IF;
 END LOOP;
 SELECT array_agg(value::text::bigint ORDER BY value::text::bigint) INTO v_requested_ids
 FROM jsonb_array_elements(p_solicitud->'id_filas');
 IF v_requested_ids IS DISTINCT FROM v_ids THEN
  RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='MG_CERRADO_ALCANCE_INCOMPLETO: aportar todos los ID_FILA del episodio';
 END IF;

 FOR v_item IN SELECT value FROM jsonb_array_elements(v_items) LOOP
  IF coalesce(v_item->>'fecha_parada','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
   OR coalesce(v_item->>'fecha_k','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
   OR (coalesce(v_item->>'fecha_programada','')<>'' AND v_item->>'fecha_programada' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$')
   OR coalesce(v_item->>'tancament','') !~ '^TANCAMENT [0-9]{1,3}$'
   OR (coalesce(v_item->>'dias_parada','')<>'' AND jsonb_typeof(v_item->'dias_parada')<>'number')
   OR (coalesce(v_item->>'km_facturables','')<>'' AND jsonb_typeof(v_item->'km_facturables')<>'number') THEN
   RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='MG_CERRADO_TRAMO_NO_CERRADO_O_DATOS_INVALIDOS';
  END IF;
  v_j:=(v_item->>'fecha_parada')::date; v_k:=(v_item->>'fecha_k')::date;
  v_i:=nullif(v_item->>'fecha_programada','')::date;
  v_days:=nullif(v_item->>'dias_parada','')::numeric; v_km:=nullif(v_item->>'km_facturables','')::numeric;
  IF v_k<v_j OR (v_days IS NOT NULL AND (v_days<0 OR v_days<>trunc(v_days) OR v_days>2147483647))
   OR (v_km IS NOT NULL AND v_km<0) THEN
   RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='MG_CERRADO_CRONOLOGIA_O_IMPORTES_INVALIDOS';
  END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(v_items) a,jsonb_array_elements(v_items) b
  WHERE (a.value->>'id_fila')::bigint<(b.value->>'id_fila')::bigint
   AND (a.value->>'fecha_parada')::date<=(b.value->>'fecha_k')::date
   AND (b.value->>'fecha_parada')::date<=(a.value->>'fecha_k')::date) THEN
  RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='MG_CERRADO_TRAMOS_SOLAPADOS';
 END IF;
 SELECT value INTO v_last FROM jsonb_array_elements(v_items)
  ORDER BY (value->>'fecha_parada')::date DESC,(value->>'fecha_k')::date DESC LIMIT 1;
 IF v_last->>'id_fila' IS DISTINCT FROM p_solicitud->>'ultimo_id_fila'
  OR app_private.normalizar_dfm_continuidad_alpha75(v_last->>'sustituto')
    IS DISTINCT FROM app_private.normalizar_dfm_continuidad_alpha75(v_ficha.vehiculo_reserva) THEN
  RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='MG_CERRADO_ULTIMO_TRAMO_O_SUSTITUTO_NO_ACREDITADO';
 END IF;
 v_context:=to_jsonb(v_sync)||jsonb_build_object(
  'fecha_programada_parada',nullif(v_last->>'fecha_programada','')::date,
  'fecha_inicio_tramo',(v_last->>'fecha_parada')::date,'fecha_corte',(v_last->>'fecha_k')::date,
  'tancament',v_last->>'tancament','dias_parada_manual',nullif(v_last->>'dias_parada','')::integer,
  'km_facturables_manual',nullif(v_last->>'km_facturables','')::numeric,'calculo_periodo_automatico',false);
 SELECT jsonb_agg(to_jsonb(r)||jsonb_build_object('pizarra',jsonb_build_object(
  'id',p.id,'fecha',p.fecha,'estado',p.estado)) ORDER BY r.id) INTO v_hotel
  FROM public.registros_hotel r JOIN public.pizarras p ON p.id=r.pizarra_id WHERE r.seguimiento_id=v_track;
 SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY e.revision),'[]') INTO v_deliveries
  FROM app_private.manteniment_entregas_continuidad_alpha75 e WHERE e.sync_id=v_uuid;
 SELECT to_jsonb(o) INTO v_origins FROM app_private.manteniment_origenes_continuidad_alpha75 o
  WHERE o.seguimiento_id=v_track;
 v_preview:=jsonb_build_object(
  'protocolo','MG75-TRAMOS-CERRADOS-001','solicitud',p_solicitud,
  'identidad',v_canon,'fuentes',v_sources,'tramos',v_items,'id_filas',to_jsonb(v_ids),
  'contexto_anterior',to_jsonb(v_sync),'contexto_aceptado',v_context,'outbox_anterior',to_jsonb(v_out),
  'hotel',v_hotel,'entregas',v_deliveries,'origen',v_origins,
  'ejecucion_referencia',jsonb_build_object('registro',v_execution,
   'asociacion','referencia_contextual_declarada; no_union_criptografica_con_revisiones'));
 RETURN jsonb_build_object('prevision',v_preview,
  'huella_prevision',app_private.hash_payload_sync_continuidad_alpha75(v_preview));
END;
$function$;

CREATE FUNCTION app_private.proteger_contexto_tramo_cerrado_alpha75()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,app_private AS $function$
DECLARE v_expected jsonb;
BEGIN
 SELECT evidencia->'contexto_aceptado' INTO v_expected
  FROM app_private.manteniment_tramos_cerrados_conciliados_alpha75
  WHERE seguimiento_id=OLD.seguimiento_id OR sync_id=OLD.sync_id;
 IF NOT FOUND THEN RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END; END IF;
 IF TG_OP='DELETE' OR app_private.campos_contexto_tramo_cerrado_alpha75(to_jsonb(NEW))
    IS DISTINCT FROM app_private.campos_contexto_tramo_cerrado_alpha75(v_expected) THEN
  RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='MG_CERRADO_CONTEXTO_CONCILIADO: revisión explícita, no reapertura automática';
 END IF;
 RETURN NEW;
END;
$function$;
CREATE TRIGGER manteniment_tramo_cerrado_contexto
 BEFORE UPDATE OR DELETE ON app_private.manteniment_parada_sync
 FOR EACH ROW EXECUTE FUNCTION app_private.proteger_contexto_tramo_cerrado_alpha75();

CREATE FUNCTION app_private.proteger_outbox_tramo_cerrado_alpha75()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,app_private AS $function$
DECLARE v_record app_private.manteniment_tramos_cerrados_conciliados_alpha75%rowtype;
BEGIN
 SELECT * INTO v_record FROM app_private.manteniment_tramos_cerrados_conciliados_alpha75
  WHERE seguimiento_id=CASE WHEN TG_OP='DELETE' THEN OLD.seguimiento_id ELSE NEW.seguimiento_id END
   OR sync_id=CASE WHEN TG_OP='DELETE' THEN OLD.sync_id ELSE NEW.sync_id END
   OR (TG_OP='UPDATE' AND (seguimiento_id=OLD.seguimiento_id OR sync_id=OLD.sync_id));
 IF NOT FOUND THEN RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END; END IF;
 IF TG_OP<>'UPDATE' OR NEW.estado<>'retenida_manual'
  OR (to_jsonb(NEW)-ARRAY['estado','ultimo_error','actualizado_en'])
    IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['estado','ultimo_error','actualizado_en']) THEN
  RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='MG_CERRADO_OUTBOX_OBSOLETA: conservar payload y revisión sin aplicar';
 END IF;
 NEW.ultimo_error:='Tramo cerrado conciliado; propuesta obsoleta no aplicada. Evidencia '||v_record.evidencia_sha256;
 RETURN NEW;
END;
$function$;
CREATE TRIGGER manteniment_tramo_cerrado_outbox
 BEFORE INSERT OR UPDATE OR DELETE ON app_private.manteniment_parada_outbox
 FOR EACH ROW EXECUTE FUNCTION app_private.proteger_outbox_tramo_cerrado_alpha75();

CREATE FUNCTION app_private.aplicar_tramo_cerrado_manteniment_alpha75(p_solicitud jsonb)
RETURNS jsonb LANGUAGE plpgsql
SET search_path=pg_catalog,public,app_private SET timezone='UTC' AS $function$
DECLARE v_request jsonb; v_preview jsonb; v_receipt uuid; v_accepted jsonb; v_evidence jsonb;
 v_now timestamptz:=clock_timestamp(); v_current jsonb; v_flags jsonb; v_count integer; v_hash text;
BEGIN
 IF current_setting('transaction_isolation')<>'serializable' THEN
  RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='MG_CERRADO_REQUIERE_SERIALIZABLE';
 END IF;
 IF jsonb_typeof(p_solicitud) IS DISTINCT FROM 'object'
  OR coalesce(p_solicitud->>'huella_prevision','') !~ '^[0-9a-f]{64}$' THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='MG_CERRADO_CAS_REQUERIDO';
 END IF;
 v_request:=p_solicitud-'huella_prevision';
 -- Validate the entire request before casts used by locks.
 v_preview:=app_private.previsualizar_tramo_cerrado_manteniment_alpha75(v_request);
 PERFORM app_private.bloquear_sync_continuidad_alpha75();
 SELECT to_jsonb(c) INTO v_flags FROM app_private.manteniment_sync_config c
  WHERE id=1 AND solo_lectura_manual_protegida IS TRUE AND escritura_segura_manual IS FALSE FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'MG_CERRADO_SALIDA_NO_PROTEGIDA'; END IF;
 PERFORM 1 FROM app_private.manteniment_revision_identidad_alpha75 q
  WHERE id IN (SELECT (value->>'revision_id')::bigint FROM jsonb_array_elements(v_request->'fuentes'))
  ORDER BY id FOR SHARE;
 PERFORM 1 FROM public.manteniment_sync_ejecuciones WHERE id=(v_request->>'ejecucion_referencia')::uuid FOR SHARE;
 PERFORM 1 FROM app_private.manteniment_parada_sync WHERE seguimiento_id=(v_request->>'seguimiento_id')::uuid FOR UPDATE;
 PERFORM 1 FROM app_private.manteniment_parada_outbox WHERE seguimiento_id=(v_request->>'seguimiento_id')::uuid FOR UPDATE;
 PERFORM 1 FROM public.registros_hotel r JOIN public.pizarras p ON p.id=r.pizarra_id
  WHERE r.seguimiento_id=(v_request->>'seguimiento_id')::uuid ORDER BY r.id FOR SHARE OF r,p;
 PERFORM 1 FROM app_private.manteniment_entregas_continuidad_alpha75
  WHERE sync_id=(v_request->>'sync_id')::uuid ORDER BY revision FOR SHARE;
 PERFORM 1 FROM app_private.manteniment_origenes_continuidad_alpha75
  WHERE seguimiento_id=(v_request->>'seguimiento_id')::uuid FOR SHARE;
 v_preview:=app_private.previsualizar_tramo_cerrado_manteniment_alpha75(v_request);
 IF v_preview->>'huella_prevision' IS DISTINCT FROM p_solicitud->>'huella_prevision' THEN
  RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='MG_CERRADO_CAS_CAMBIADO: conservar y volver a revisar';
 END IF;
 v_accepted:=v_preview #> '{prevision,contexto_aceptado}';
 v_accepted:=v_accepted||jsonb_build_object('actualizado_en',v_now);
 v_evidence:=jsonb_build_object('prevision',v_preview->'prevision','contexto_aceptado',v_accepted,
  'outbox_obsoleta',v_preview #> '{prevision,outbox_anterior}',
  'disposicion','PARADA_HISTORICA_CERRADA; OUTBOX_RETENIDA_NO_APLICADA; TRABAJOS_NO_CONCILIADOS');
 -- Insert the durable guard BEFORE the context UPDATE fires its enqueue trigger.
 INSERT INTO app_private.manteniment_tramos_cerrados_conciliados_alpha75
  (request_id,seguimiento_id,sync_id,id_filas,ultimo_id_fila,prevision_sha256,evidencia)
 VALUES(v_request->>'request_id',(v_request->>'seguimiento_id')::uuid,(v_request->>'sync_id')::uuid,
  ARRAY(SELECT value::text::bigint FROM jsonb_array_elements(v_preview #> '{prevision,id_filas}')),
  (v_request->>'ultimo_id_fila')::bigint,p_solicitud->>'huella_prevision',v_evidence)
 RETURNING id,evidencia_sha256 INTO v_receipt,v_hash;
 UPDATE app_private.manteniment_parada_sync SET
  fecha_programada_parada=(v_accepted->>'fecha_programada_parada')::date,
  fecha_inicio_tramo=(v_accepted->>'fecha_inicio_tramo')::date,fecha_corte=(v_accepted->>'fecha_corte')::date,
  tancament=v_accepted->>'tancament',dias_parada_manual=(v_accepted->>'dias_parada_manual')::integer,
  km_facturables_manual=(v_accepted->>'km_facturables_manual')::numeric,calculo_periodo_automatico=false,
  actualizado_en=v_now
 WHERE seguimiento_id=(v_request->>'seguimiento_id')::uuid;
 GET DIAGNOSTICS v_count=ROW_COUNT;
 IF v_count<>1 THEN RAISE EXCEPTION 'MG_CERRADO_CONTEXTO_NO_UNICO'; END IF;
 SELECT to_jsonb(s) INTO v_current FROM app_private.manteniment_parada_sync s
  WHERE seguimiento_id=(v_request->>'seguimiento_id')::uuid;
 IF v_current IS DISTINCT FROM v_accepted THEN RAISE EXCEPTION 'MG_CERRADO_CONTEXTO_EFECTO_INESPERADO'; END IF;
 UPDATE app_private.manteniment_parada_outbox SET estado='retenida_manual',
  ultimo_error='Tramo cerrado conciliado; propuesta obsoleta no aplicada. Evidencia '||v_hash,
  actualizado_en=v_now
 WHERE seguimiento_id=(v_request->>'seguimiento_id')::uuid;
 GET DIAGNOSTICS v_count=ROW_COUNT;
 IF v_count<>1 THEN RAISE EXCEPTION 'MG_CERRADO_OUTBOX_NO_UNICA'; END IF;
 -- No ACK, Hotel/T, source import, accounting sweep, flag change, historical
 -- delivery rewrite or identity-review resolution exists in this operation.
 IF (SELECT to_jsonb(c) FROM app_private.manteniment_sync_config c WHERE id=1) IS DISTINCT FROM v_flags THEN
  RAISE EXCEPTION 'MG_CERRADO_BARRERAS_ALTERADAS';
 END IF;
 RETURN jsonb_build_object('protocolo','MG75-TRAMOS-CERRADOS-001','conciliacion_id',v_receipt,
  'seguimiento_id',v_request->>'seguimiento_id','sync_id',v_request->>'sync_id',
  'evidencia_sha256',v_hash,'outbox','retenida_manual','aplicada_en_hoja',false,'identidad_resuelta',false);
END;
$function$;

-- Preserve signatures, OIDs, owners, ACL and volatility of the reviewed runtime.
DO $gates$
DECLARE v_def text; v_old text; v_new text;
BEGIN
 v_def:=pg_get_functiondef('app_private.manteniment_construir_payload_parada(uuid)'::regprocedure);
 v_old:='  perform app_private.bloquear_sync_continuidad_alpha75();';
 v_new:=v_old||E'\n  if app_private.tramo_cerrado_conciliado_manteniment_alpha75(p_seguimiento_id) then return null; end if;';
 IF (length(v_def)-length(replace(v_def,v_old,'')))/length(v_old)<>1 THEN
  RAISE EXCEPTION 'MG_CERRADO_GENERADOR_ANCLA';
 END IF;
 EXECUTE replace(v_def,v_old,v_new);
 v_def:=pg_get_functiondef('app_private.retencion_identidad_manteniment_alpha75(uuid,uuid,jsonb)'::regprocedure);
 v_old:=' SELECT EXISTS (SELECT 1 FROM app_private.manteniment_revision_identidad_alpha75 q';
 v_new:=' SELECT app_private.tramo_cerrado_conciliado_manteniment_alpha75(p_seguimiento,p_sync)'||E'\n OR EXISTS (SELECT 1 FROM app_private.manteniment_revision_identidad_alpha75 q';
 IF (length(v_def)-length(replace(v_def,v_old,'')))/length(v_old)<>1 THEN
  RAISE EXCEPTION 'MG_CERRADO_RETENCION_ANCLA';
 END IF;
 EXECUTE replace(v_def,v_old,v_new);
 IF EXISTS(SELECT 1 FROM mg75_cerrado_properties b LEFT JOIN pg_proc p USING(oid)
  WHERE p.oid IS NULL OR (to_jsonb(p)-'prosrc') IS DISTINCT FROM b.properties) THEN
  RAISE EXCEPTION 'MG_CERRADO_PROPERTIES_DRIFT';
 END IF;
END;
$gates$;

DO $permissions$
DECLARE f record;
BEGIN
 FOR f IN SELECT p.oid::regprocedure AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='app_private' AND p.proname=ANY(ARRAY[
   'inmutabilidad_tramos_cerrados_alpha75','tramo_cerrado_conciliado_manteniment_alpha75',
   'campos_contexto_tramo_cerrado_alpha75','previsualizar_tramo_cerrado_manteniment_alpha75',
   'proteger_contexto_tramo_cerrado_alpha75','proteger_outbox_tramo_cerrado_alpha75',
   'aplicar_tramo_cerrado_manteniment_alpha75'])
 LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',f.signature); END LOOP;
END;
$permissions$;
COMMIT;
