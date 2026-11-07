-- MG75: UUID identifies a PA/seguimiento; ID_FILA identifies a source row.
-- Candidate: install guards only. No historical repair, queue replay or flag change.
BEGIN;
DO $preflight$
BEGIN
 IF md5(pg_get_functiondef('app_private.bloquear_sync_continuidad_alpha75()'::regprocedure))
     IS DISTINCT FROM '1e357e8cce17d1538f9a69424e0378e2' THEN
  RAISE EXCEPTION 'MG_IDENTIDAD_LOCK_INESPERADO: no se instala sin el bloqueo revisado';
 END IF;
 PERFORM app_private.bloquear_sync_continuidad_alpha75();
 -- Installation does not toggle flags. Keep the output protection in place
 -- until this transaction ends; identity import pause is deliberately separate.
 PERFORM 1 FROM app_private.manteniment_sync_config
 WHERE id=1 AND solo_lectura_manual_protegida IS TRUE AND escritura_segura_manual IS FALSE
 FOR SHARE;
 IF NOT FOUND THEN
  RAISE EXCEPTION 'MG_IDENTIDAD_BARRERAS_ABIERTAS: proteger la salida antes de instalar las guardas';
 END IF;
 IF md5(pg_get_functiondef('app_private.manteniment_importar_paradas(jsonb)'::regprocedure))
      IS DISTINCT FROM 'a892d10d855a412522556f26b062ee48'
 OR md5(pg_get_functiondef('app_private.manteniment_importar_cierres_facturacion(jsonb,timestamptz)'::regprocedure))
      IS DISTINCT FROM '95a4987efdc1ad5aef87daf61d58f1bf'
 OR md5(pg_get_functiondef('app_private.manteniment_encolar_parada(uuid)'::regprocedure))
      IS DISTINCT FROM '27e929588c481dfd2b1713d90c56d229'
 OR md5(pg_get_functiondef('app_private.finalizar_entrega_sync_continuidad_alpha75(jsonb)'::regprocedure))
      IS DISTINCT FROM '7d5e0c880e5fd7c447340ba53f71abce'
 OR md5(pg_get_functiondef('app_private.autorizar_ejecucion_manteniment(text,jsonb)'::regprocedure))
      IS DISTINCT FROM '77109ab696d158879c0434d48aa23ff7' THEN
  RAISE EXCEPTION 'MG_IDENTIDAD_BASE_INESPERADA: no se instala sobre importadores distintos de la base revisada';
 END IF;
END;
$preflight$;
CREATE TEMP TABLE mg75_identidad_function_properties ON COMMIT DROP AS
 SELECT p.oid,to_jsonb(p)-'prosrc' AS properties FROM pg_proc p
 WHERE p.oid=ANY(ARRAY[
  'app_private.manteniment_importar_paradas(jsonb)'::regprocedure,
  'app_private.manteniment_importar_cierres_facturacion(jsonb,timestamptz)'::regprocedure,
  'app_private.manteniment_encolar_parada(uuid)'::regprocedure,
  'app_private.finalizar_entrega_sync_continuidad_alpha75(jsonb)'::regprocedure,
  'app_private.autorizar_ejecucion_manteniment(text,jsonb)'::regprocedure]::oid[]);

CREATE TABLE app_private.manteniment_revision_identidad_alpha75 (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 bloque text NOT NULL CHECK (bloque IN ('paradas','cierres_facturacion')),
 motivo text NOT NULL,
 contexto text NOT NULL DEFAULT '',
 payload jsonb NOT NULL CHECK (jsonb_typeof(payload)='array'),
 payload_sha256 text GENERATED ALWAYS AS
  (app_private.hash_payload_sync_continuidad_alpha75(payload)) STORED,
 alcance jsonb NOT NULL CHECK (jsonb_typeof(alcance)='object'
  AND alcance ?& ARRAY['retener_todo','vehiculos','sync_ids','seguimientos']
  AND jsonb_typeof(alcance->'retener_todo')='boolean'
  AND jsonb_typeof(alcance->'vehiculos')='array'
  AND jsonb_typeof(alcance->'sync_ids')='array'
  AND jsonb_typeof(alcance->'seguimientos')='array'),
 retiene boolean NOT NULL,
 primera_recepcion_en timestamptz NOT NULL DEFAULT clock_timestamp(),
 ultima_recepcion_en timestamptz NOT NULL DEFAULT clock_timestamp(),
 recepciones integer NOT NULL DEFAULT 1 CHECK (recepciones>0),
 resuelta_en timestamptz,
 resolucion jsonb,
 CHECK ((resuelta_en IS NULL)=(resolucion IS NULL)),
 CHECK (resolucion IS NULL OR (jsonb_typeof(resolucion)='object'
   AND length(btrim(coalesce(resolucion->>'motivo','')))>=20
   AND coalesce(resolucion->>'evidencia_sha256','') ~ '^[0-9a-f]{64}$'))
);
COMMENT ON TABLE app_private.manteniment_revision_identidad_alpha75 IS
 'Private complete import snapshots for identity/segment review. No automatic resolution, T crosswalk or operational history repair. Resolution requires explicit evidence; no client resolver is exposed.';
ALTER TABLE app_private.manteniment_revision_identidad_alpha75 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON app_private.manteniment_revision_identidad_alpha75 FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON SEQUENCE app_private.manteniment_revision_identidad_alpha75_id_seq FROM PUBLIC,anon,authenticated,service_role;
CREATE UNIQUE INDEX manteniment_revision_identidad_abierta_alpha75
 ON app_private.manteniment_revision_identidad_alpha75 (bloque,motivo,contexto,payload_sha256)
 WHERE resuelta_en IS NULL;
CREATE INDEX manteniment_revision_identidad_pendiente_alpha75
 ON app_private.manteniment_revision_identidad_alpha75 (bloque)
 WHERE retiene AND resuelta_en IS NULL;

CREATE FUNCTION app_private.normalizar_pa_manteniment_alpha75(p_valor text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $function$
 SELECT regexp_replace(regexp_replace(upper(btrim(coalesce(p_valor,''))),
   '^PA[[:space:]-]*',''),'[[:space:]]+','','g')
$function$;

-- This lookup never identifies a record by physical row or by ID_FILA.
CREATE FUNCTION app_private.identidad_uuid_manteniment_alpha75(p_sync text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,app_private AS $function$
DECLARE v_seguimiento uuid; v_identidades jsonb;
BEGIN
 IF coalesce(p_sync,'') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
  RETURN jsonb_build_object('valida',false,'motivo','UUID_INVALIDO','identidades','[]'::jsonb);
 END IF;
 SELECT s.seguimiento_id INTO v_seguimiento FROM app_private.manteniment_parada_sync s
 WHERE s.sync_id=p_sync::uuid;
 IF NOT FOUND THEN
  RETURN jsonb_build_object('valida',false,'motivo','UUID_DESCONOCIDO','identidades','[]'::jsonb);
 END IF;
 SELECT coalesce(jsonb_agg(x.identidad ORDER BY x.identidad::text),'[]'::jsonb) INTO v_identidades
 FROM (SELECT DISTINCT jsonb_build_object(
   'dfm',app_private.normalizar_dfm_continuidad_alpha75(r.vehiculo_sustituido),
   'matricula',app_private.normalizar_matricula_continuidad_alpha75(r.matricula_sustituido),
   'numero_parada',app_private.normalizar_pa_manteniment_alpha75(r.numero_parada)) AS identidad
   FROM public.registros_hotel r WHERE r.seguimiento_id=v_seguimiento) x;
 RETURN jsonb_build_object('valida',jsonb_array_length(v_identidades)=1
     AND coalesce(v_identidades->0->>'dfm','')<>''
     AND coalesce(v_identidades->0->>'matricula','')<>''
     AND coalesce(v_identidades->0->>'numero_parada','')<>'',
   'seguimiento_id',v_seguimiento,'identidades',v_identidades);
END;
$function$;

-- Compute the ENTIRE partition before the first import write. A contradiction
-- poisons the complete UUID group and every affected vehicle, including the
-- canonical vehicle and prior accounting sources linked to that UUID/tracking.
CREATE FUNCTION app_private.analizar_identidad_manteniment_alpha75(p_items jsonb,p_uuid_obligatorio boolean)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,app_private AS $function$
DECLARE
 v_item jsonb; v_id jsonb; v_pair jsonb; v_canon jsonb; v_extra jsonb;
 v_uuid text; v_bad boolean; v_total boolean:=false;
 v_vehicles jsonb:='[]'; v_syncs jsonb:='[]'; v_tracks jsonb:='[]';
 v_cache jsonb:='{}'; v_continuidad uuid[]; v_pending record;
BEGIN
 FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
  v_uuid:=lower(btrim(coalesce(v_item->>'sync_id','')));
  v_pair:=jsonb_build_object('dfm',app_private.normalizar_dfm_continuidad_alpha75(v_item->>'dfm'),
    'matricula',app_private.normalizar_matricula_continuidad_alpha75(v_item->>'matricula'));
  v_bad:=(v_pair->>'dfm'='' OR v_pair->>'matricula'='');
  v_id:=jsonb_build_object('valida',NOT p_uuid_obligatorio,'identidades','[]'::jsonb);
  IF v_uuid<>'' THEN
   IF v_cache ? v_uuid THEN v_id:=v_cache->v_uuid;
   ELSE
    v_id:=app_private.identidad_uuid_manteniment_alpha75(v_uuid);
    v_cache:=jsonb_set(v_cache,ARRAY[v_uuid],v_id);
   END IF;
  END IF;
  v_bad:=v_bad OR NOT coalesce((v_id->>'valida')::boolean,false);
  IF v_uuid<>'' AND coalesce((v_id->>'valida')::boolean,false) THEN
   v_canon:=v_id->'identidades'->0;
   v_bad:=v_bad OR v_pair <> (v_canon-'numero_parada')
      OR app_private.normalizar_pa_manteniment_alpha75(v_item->>'numero_parada')
          IS DISTINCT FROM v_canon->>'numero_parada';
  END IF;
  v_continuidad:='{}';
  IF NOT p_uuid_obligatorio THEN
   -- Existing continuity protection must retain the whole vehicle too; otherwise
   -- removing a note could insert MANTENIMENT while its old SYNC key is protected.
   v_continuidad:=app_private.seguimientos_cierre_continuidad_alpha75(v_item);
   v_bad:=v_bad OR cardinality(v_continuidad)>0;
  END IF;
  IF NOT v_bad THEN CONTINUE; END IF;
  v_vehicles:=v_vehicles||jsonb_build_array(v_pair);
  IF v_uuid ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
   v_syncs:=v_syncs||jsonb_build_array(v_uuid);
  END IF;
  IF nullif(v_id->>'seguimiento_id','') IS NOT NULL THEN
   v_tracks:=v_tracks||jsonb_build_array(v_id->>'seguimiento_id');
  END IF;
  FOR v_canon IN SELECT value FROM jsonb_array_elements(v_id->'identidades') LOOP
   v_vehicles:=v_vehicles||jsonb_build_array(v_canon-'numero_parada');
  END LOOP;
  v_tracks:=v_tracks||to_jsonb(coalesce(v_continuidad,'{}'::uuid[]));
 END LOOP;
 -- Durable identity partitions survive a later clean/partial snapshot.
 FOR v_pending IN SELECT alcance FROM app_private.manteniment_revision_identidad_alpha75
   WHERE retiene AND resuelta_en IS NULL
     AND motivo IN ('IDENTIDAD_UUID_PA_VEHICULO','IDENTIDAD_O_CONTINUIDAD') LOOP
  v_vehicles:=v_vehicles||coalesce(v_pending.alcance->'vehiculos','[]'::jsonb);
  v_syncs:=v_syncs||coalesce(v_pending.alcance->'sync_ids','[]'::jsonb);
  v_tracks:=v_tracks||coalesce(v_pending.alcance->'seguimientos','[]'::jsonb);
  v_total:=v_total OR coalesce((v_pending.alcance->>'retener_todo')::boolean,false);
 END LOOP;
 -- Include prior source identities and all canonical counterparts. No key is
 -- rewritten and no uncertain source is de-duplicated or marked absent here.
 SELECT coalesce(jsonb_agg(DISTINCT x.pair),'[]') INTO v_extra FROM (
  SELECT jsonb_build_object('dfm',app_private.normalizar_dfm_continuidad_alpha75(f.dfm),
    'matricula',app_private.normalizar_matricula_continuidad_alpha75(f.matricula)) AS pair
  FROM public.facturacion_tancament_cierres f
  WHERE v_syncs ? f.sync_id::text OR v_tracks ? f.seguimiento_id::text
  UNION
  SELECT jsonb_build_object('dfm',app_private.normalizar_dfm_continuidad_alpha75(r.vehiculo_sustituido),
    'matricula',app_private.normalizar_matricula_continuidad_alpha75(r.matricula_sustituido))
  FROM public.registros_hotel r WHERE v_tracks ? r.seguimiento_id::text
 ) x;
 v_vehicles:=v_vehicles||v_extra;
 SELECT coalesce(jsonb_agg(DISTINCT value),'[]'),
   v_total OR coalesce(bool_or(value->>'dfm'='' OR value->>'matricula'=''
    OR (NOT EXISTS (SELECT 1 FROM public.registros_hotel r
      WHERE app_private.normalizar_dfm_continuidad_alpha75(r.vehiculo_sustituido)=value->>'dfm'
        AND app_private.normalizar_matricula_continuidad_alpha75(r.matricula_sustituido)=value->>'matricula')
      AND NOT EXISTS (SELECT 1 FROM public.vehiculos v
      WHERE app_private.normalizar_dfm_continuidad_alpha75(v.dfm)=value->>'dfm'
        AND app_private.normalizar_matricula_continuidad_alpha75(v.matricula)=value->>'matricula'))),false)
 INTO v_vehicles,v_total FROM jsonb_array_elements(v_vehicles);
 SELECT coalesce(jsonb_agg(DISTINCT value),'[]') INTO v_syncs FROM jsonb_array_elements(v_syncs);
 SELECT coalesce(jsonb_agg(DISTINCT value),'[]') INTO v_tracks FROM jsonb_array_elements(v_tracks);
 RETURN jsonb_build_object('retener_todo',v_total,'vehiculos',v_vehicles,
   'sync_ids',v_syncs,'seguimientos',v_tracks);
END;
$function$;

CREATE FUNCTION app_private.item_retenido_identidad_manteniment_alpha75(p_item jsonb,p_alcance jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,app_private AS $function$
 SELECT coalesce((p_alcance->>'retener_todo')::boolean,false)
  OR coalesce((p_alcance->'sync_ids') ? lower(coalesce(p_item->>'sync_id','')),false)
  OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_alcance->'vehiculos') v
    WHERE v.value->>'dfm'=app_private.normalizar_dfm_continuidad_alpha75(p_item->>'dfm')
      AND v.value->>'matricula'=app_private.normalizar_matricula_continuidad_alpha75(p_item->>'matricula'))
$function$;

CREATE FUNCTION app_private.registrar_revision_manteniment_alpha75(
 p_bloque text,p_motivo text,p_contexto text,p_payload jsonb,p_alcance jsonb,p_retiene boolean)
RETURNS void LANGUAGE sql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,app_private AS $function$
 INSERT INTO app_private.manteniment_revision_identidad_alpha75
 (bloque,motivo,contexto,payload,alcance,retiene)
 VALUES(p_bloque,p_motivo,coalesce(p_contexto,''),p_payload,p_alcance,p_retiene)
 ON CONFLICT(bloque,motivo,contexto,payload_sha256) WHERE resuelta_en IS NULL DO UPDATE SET
  ultima_recepcion_en=clock_timestamp(),
  recepciones=manteniment_revision_identidad_alpha75.recepciones+1
$function$;

-- There is deliberately no automatic resolver. Absence of a source row, removal
-- of a note, a new queue revision or a later apparently clean import is not proof
-- that the prior operational history was reconciled.
CREATE FUNCTION app_private.retencion_identidad_manteniment_alpha75(p_seguimiento uuid,p_sync uuid DEFAULT NULL,p_payload jsonb DEFAULT NULL)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,app_private AS $function$
 SELECT EXISTS (SELECT 1 FROM app_private.manteniment_revision_identidad_alpha75 q
 WHERE q.retiene AND q.resuelta_en IS NULL AND (
  coalesce((q.alcance->>'retener_todo')::boolean,false)
  OR (q.alcance->'seguimientos') ? p_seguimiento::text
  OR (q.alcance->'sync_ids') ? p_sync::text
  OR app_private.item_retenido_identidad_manteniment_alpha75(p_payload,q.alcance)
  OR EXISTS (SELECT 1 FROM app_private.manteniment_parada_sync s
    WHERE s.seguimiento_id=p_seguimiento AND (q.alcance->'sync_ids') ? s.sync_id::text)
  OR EXISTS (SELECT 1 FROM app_private.manteniment_parada_outbox o
    WHERE (o.seguimiento_id=p_seguimiento OR o.sync_id=p_sync)
      AND app_private.item_retenido_identidad_manteniment_alpha75(o.payload,q.alcance))
  OR EXISTS (SELECT 1 FROM public.registros_hotel r,
    jsonb_array_elements(q.alcance->'vehiculos') v
    WHERE r.seguimiento_id=p_seguimiento
      AND app_private.normalizar_dfm_continuidad_alpha75(r.vehiculo_sustituido)=v.value->>'dfm'
      AND app_private.normalizar_matricula_continuidad_alpha75(r.matricula_sustituido)=v.value->>'matricula')
 ))
$function$;

-- Replace only the body, preserving OID, owner, ACL and the declared contract.
DO $paradas$
DECLARE v_def text; v_old text; v_new text:=$body$
DECLARE
 v_item jsonb; v_group jsonb; v_alcance jsonb; v_group_scope jsonb;
 v_sync app_private.manteniment_parada_sync%rowtype;
 v_ficha public.registros_hotel%rowtype;
 v_uuid uuid; v_open integer; v_count integer:=0; v_reason text;
 v_j date; v_q text;
BEGIN
 PERFORM app_private.bloquear_sync_continuidad_alpha75();
 IF p_paradas IS NULL THEN RETURN 0; END IF;
 IF jsonb_typeof(p_paradas)<>'array' OR jsonb_array_length(p_paradas)>500 THEN
  RAISE EXCEPTION 'El bloque PARADA no tiene un formato válido';
 END IF;
 v_alcance:=app_private.analizar_identidad_manteniment_alpha75(p_paradas,true);
 IF coalesce((v_alcance->>'retener_todo')::boolean,false) OR jsonb_array_length(v_alcance->'vehiculos')>0 THEN
  PERFORM app_private.registrar_revision_manteniment_alpha75('paradas','IDENTIDAD_UUID_PA_VEHICULO','',p_paradas,v_alcance,true);
 END IF;
 FOR v_uuid,v_group IN
  SELECT (e.value->>'sync_id')::uuid,jsonb_agg(e.value ORDER BY e.ordinality)
  FROM jsonb_array_elements(p_paradas) WITH ORDINALITY e(value,ordinality)
  WHERE NOT app_private.item_retenido_identidad_manteniment_alpha75(e.value,v_alcance)
  GROUP BY (e.value->>'sync_id')::uuid ORDER BY (e.value->>'sync_id')::uuid
 LOOP
  SELECT * INTO v_sync FROM app_private.manteniment_parada_sync WHERE sync_id=v_uuid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'MG_IDENTIDAD_CAMBIADA: UUID desaparecido durante la importación'; END IF;
  v_group_scope:=jsonb_build_object('retener_todo',false,'sync_ids',jsonb_build_array(v_uuid),
    'seguimientos',jsonb_build_array(v_sync.seguimiento_id),'vehiculos','[]'::jsonb);
  -- A segment-only uncertainty belongs to this PA. Unlike a contradictory UUID,
  -- it does not poison a different, independently identified PA of the vehicle.
  IF app_private.seguimiento_con_continuidad_sustitucion_alpha75(v_sync.seguimiento_id) THEN
   FOR v_item IN SELECT value FROM jsonb_array_elements(v_group) LOOP
    INSERT INTO app_private.manteniment_importaciones_retenidas_continuidad_alpha75
     (sync_id,payload_sha256,seguimiento_id,payload)
    VALUES(v_sync.sync_id,app_private.hash_payload_sync_continuidad_alpha75(v_item),v_sync.seguimiento_id,v_item)
    ON CONFLICT(sync_id,payload_sha256) DO UPDATE SET ultima_recepcion_en=clock_timestamp(),
     recepciones=manteniment_importaciones_retenidas_continuidad_alpha75.recepciones+1;
   END LOOP;
   CONTINUE;
  END IF;
  SELECT count(*) INTO v_open FROM jsonb_array_elements(v_group) e
   WHERE upper(btrim(coalesce(e.value->>'estado','')))='PARADA'
     AND nullif(btrim(coalesce(e.value->>'fecha_k','')),'') IS NULL;
  v_reason:=CASE WHEN v_open=0 THEN 'SIN_TRAMO_ABIERTO' WHEN v_open>1 THEN 'VARIOS_TRAMOS_ABIERTOS' END;
  IF v_reason IS NULL THEN
   SELECT value INTO v_item FROM jsonb_array_elements(v_group)
    WHERE upper(btrim(coalesce(value->>'estado','')))='PARADA' AND nullif(btrim(coalesce(value->>'fecha_k','')),'') IS NULL;
   SELECT r.* INTO v_ficha FROM public.registros_hotel r JOIN public.pizarras p ON p.id=r.pizarra_id
    WHERE r.seguimiento_id=v_sync.seguimiento_id
    ORDER BY (p.estado='en_curso') DESC,p.fecha DESC,r.actualizado_en DESC,r.id DESC LIMIT 1 FOR UPDATE OF r;
   IF NOT FOUND OR v_ficha.cancelado OR v_ficha.retirado_hotel_activo
      OR v_ficha.estado IN ('anulado','recuperado','reserva_liberada') THEN v_reason:='CONTEXTO_OPERATIVO_NO_VIGENTE';
   ELSIF app_private.normalizar_dfm_continuidad_alpha75(v_item->>'sustituto')=''
      OR app_private.normalizar_dfm_continuidad_alpha75(v_item->>'sustituto')
          IS DISTINCT FROM app_private.normalizar_dfm_continuidad_alpha75(v_ficha.vehiculo_reserva) THEN
    v_reason:='SUSTITUTO_NO_ACREDITADO';
   END IF;
  END IF;
  IF v_reason IS NOT NULL THEN
   PERFORM app_private.registrar_revision_manteniment_alpha75('paradas',v_reason,v_uuid::text,p_paradas,v_group_scope,true);
   CONTINUE;
  END IF;
  IF app_private.retencion_identidad_manteniment_alpha75(v_sync.seguimiento_id,v_sync.sync_id) THEN CONTINUE; END IF;
  v_j:=nullif(v_item->>'fecha_parada','')::date;
  v_q:=upper(btrim(coalesce(v_item->>'tancament','')));
  IF v_j IS NULL OR (v_q<>'' AND v_q !~ '^TANCAMENT [0-9]{1,3}$') THEN
   RAISE EXCEPTION 'MG_TRAMO_INVALIDO: el tramo abierto requiere J y un TANCAMENT válido';
  END IF;
  -- Accounting context only. I/J/K never recover a vehicle, release a reserve,
  -- establish the original stop date or overwrite the hotel record.
  UPDATE app_private.manteniment_parada_sync SET
   fecha_inicio_tramo=v_j,fecha_programada_parada=nullif(v_item->>'fecha_programada','')::date,
   fecha_corte=NULL,tancament=v_q,
   tancament_supervisado=CASE WHEN v_q IS DISTINCT FROM v_sync.tancament OR v_sync.fecha_corte IS NOT NULL THEN false ELSE v_sync.tancament_supervisado END,
   tancament_supervisado_por=CASE WHEN v_q IS DISTINCT FROM v_sync.tancament OR v_sync.fecha_corte IS NOT NULL THEN NULL ELSE v_sync.tancament_supervisado_por END,
   tancament_supervisado_en=CASE WHEN v_q IS DISTINCT FROM v_sync.tancament OR v_sync.fecha_corte IS NOT NULL THEN NULL ELSE v_sync.tancament_supervisado_en END,
   dias_parada_manual=CASE WHEN v_sync.calculo_periodo_automatico AND NOT v_sync.tancament_supervisado THEN NULL WHEN v_item ? 'dias_parada' THEN nullif(v_item->>'dias_parada','')::integer ELSE v_sync.dias_parada_manual END,
   km_facturables_manual=CASE WHEN v_sync.calculo_periodo_automatico AND NOT v_sync.tancament_supervisado THEN NULL WHEN v_item ? 'km_facturables' THEN nullif(v_item->>'km_facturables','')::numeric ELSE v_sync.km_facturables_manual END,
   fila_manteniment=nullif(v_item->>'fila','')::integer
  WHERE seguimiento_id=v_sync.seguimiento_id;
  v_count:=v_count+1;
 END LOOP;
 RETURN v_count;
END;
$body$;
BEGIN
 v_def:=pg_get_functiondef('app_private.manteniment_importar_paradas(jsonb)'::regprocedure);
 SELECT prosrc INTO v_old FROM pg_proc WHERE oid='app_private.manteniment_importar_paradas(jsonb)'::regprocedure;
 IF position(v_old IN v_def)=0 THEN RAISE EXCEPTION 'MG_IDENTIDAD_CUERPO_NO_ENCONTRADO'; END IF;
 EXECUTE replace(v_def,v_old,v_new);
END;
$paradas$;

-- Preserve the installed calendar and source_key implementation. Only add the
-- precomputed vehicle partition and exclude it explicitly from the final sweep.
DO $cierres$
DECLARE v_def text; v_old text; v_new text;
BEGIN
 v_def:=pg_get_functiondef('app_private.manteniment_importar_cierres_facturacion(jsonb,timestamptz)'::regprocedure);
 v_old:='  v_vinculados uuid[];';
 v_new:=v_old||E'\n  v_alcance_identidad jsonb;\n  v_retenidos_identidad integer:=0;';
 IF position(v_old IN v_def)=0 THEN RAISE EXCEPTION 'MG_IDENTIDAD_CIERRES_DECLARACION'; END IF;
 v_def:=replace(v_def,v_old,v_new);
 v_old:='  create temp table if not exists tmp_facturacion_tancament_keys (';
 v_new:=$insert$
  v_alcance_identidad:=app_private.analizar_identidad_manteniment_alpha75(p_cierres,false);
  IF coalesce((v_alcance_identidad->>'retener_todo')::boolean,false) OR jsonb_array_length(v_alcance_identidad->'vehiculos')>0 THEN
   PERFORM app_private.registrar_revision_manteniment_alpha75('cierres_facturacion','IDENTIDAD_O_CONTINUIDAD','',p_cierres,v_alcance_identidad,true);
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_cierres) e WHERE coalesce(e.value->>'sync_id','')='') THEN
   -- Capture before the legacy calendar skips an open K. No PA inference, no
   -- source-key change, and this diagnostic alone is not a durable delivery hold.
   PERFORM app_private.registrar_revision_manteniment_alpha75('cierres_facturacion','CIERRES_SIN_UUID','',p_cierres,
    jsonb_build_object('retener_todo',false,'vehiculos','[]'::jsonb,'sync_ids','[]'::jsonb,'seguimientos','[]'::jsonb),false);
  END IF;
$insert$||v_old;
 IF position(v_old IN v_def)=0 THEN RAISE EXCEPTION 'MG_IDENTIDAD_CIERRES_PREANALISIS'; END IF;
 v_def:=replace(v_def,v_old,v_new);
 v_old:=$old$    v_vinculados:=app_private.seguimientos_cierre_continuidad_alpha75(v_item);$old$;
 v_new:=$insert$    IF app_private.item_retenido_identidad_manteniment_alpha75(v_item,v_alcance_identidad) THEN
      v_retenidos_identidad:=v_retenidos_identidad+1;
      CONTINUE;
    END IF;
$insert$||v_old;
 IF position(v_old IN v_def)=0 THEN RAISE EXCEPTION 'MG_IDENTIDAD_CIERRES_PARTICION'; END IF;
 v_def:=replace(v_def,v_old,v_new);
 v_old:='    and f.presente_en_manteniment';
 v_new:=v_old||E'\n    and not app_private.item_retenido_identidad_manteniment_alpha75(to_jsonb(f),v_alcance_identidad)\n    and not ((v_alcance_identidad->\'seguimientos\') ? f.seguimiento_id::text)';
 IF position(v_old IN v_def)=0 THEN RAISE EXCEPTION 'MG_IDENTIDAD_CIERRES_BARRIDO'; END IF;
 v_def:=replace(v_def,v_old,v_new);
 v_old:=$old$'retenidos_continuidad',v_retenidos)$old$;
 v_new:=$new$'retenidos_continuidad',v_retenidos,'retenidos_identidad',v_retenidos_identidad)$new$;
 IF position(v_old IN v_def)=0 THEN RAISE EXCEPTION 'MG_IDENTIDAD_CIERRES_RESULTADO'; END IF;
 EXECUTE replace(v_def,v_old,v_new);
END;
$cierres$;

-- Guards precede queue mutation / delivery evidence / authorization. The
-- existing denial reason is part of a closed Edge/Apps Script contract.
DO $gates$
DECLARE v_def text; v_old text; v_new text;
BEGIN
 v_def:=pg_get_functiondef('app_private.manteniment_encolar_parada(uuid)'::regprocedure);
 v_old:=$old$  perform app_private.bloquear_sync_continuidad_alpha75();$old$;
 v_new:=v_old||$new$
  if app_private.retencion_identidad_manteniment_alpha75(p_seguimiento_id) then return; end if;$new$;
 IF (length(v_def)-length(replace(v_def,v_old,'')))/length(v_old)<>1 THEN RAISE EXCEPTION 'MG_IDENTIDAD_ENQUEUE_ANCLA'; END IF;
 v_def:=replace(v_def,v_old,v_new);
 v_old:=$old$  insert into app_private.manteniment_parada_outbox$old$;
 v_new:=$new$  if app_private.retencion_identidad_manteniment_alpha75(p_seguimiento_id,v_sync_id,v_payload) then return; end if;

$new$||v_old;
 IF (length(v_def)-length(replace(v_def,v_old,'')))/length(v_old)<>1 THEN RAISE EXCEPTION 'MG_IDENTIDAD_ENQUEUE_INSERT'; END IF;
 EXECUTE replace(v_def,v_old,v_new);

 v_def:=pg_get_functiondef('app_private.finalizar_entrega_sync_continuidad_alpha75(jsonb)'::regprocedure);
 v_old:=$old$    IF NOT FOUND THEN CONTINUE; END IF;
    v_tipo:=CASE$old$;
 v_new:=$new$    IF NOT FOUND THEN CONTINUE; END IF;
    IF app_private.retencion_identidad_manteniment_alpha75(v_out.seguimiento_id,v_out.sync_id,v_out.payload) THEN CONTINUE; END IF;
    v_tipo:=CASE$new$;
 IF (length(v_def)-length(replace(v_def,v_old,'')))/length(v_old)<>1 THEN RAISE EXCEPTION 'MG_IDENTIDAD_ENTREGA_ANCLA'; END IF;
 EXECUTE replace(v_def,v_old,v_new);

 v_def:=pg_get_functiondef('app_private.autorizar_ejecucion_manteniment(text,jsonb)'::regprocedure);
 v_old:=$old$      ELSIF v_out.estado IS DISTINCT FROM 'pendiente' THEN v_motivo:='ORDEN_RETENIDA_O_CONFIRMADA';$old$;
 v_new:=v_old||$new$
      ELSIF app_private.retencion_identidad_manteniment_alpha75(v_out.seguimiento_id,v_out.sync_id,v_out.payload) THEN v_motivo:='ORDEN_RETENIDA_O_CONFIRMADA';$new$;
 IF (length(v_def)-length(replace(v_def,v_old,'')))/length(v_old)<>1 THEN RAISE EXCEPTION 'MG_IDENTIDAD_AUTORIZAR_ANCLA'; END IF;
 EXECUTE replace(v_def,v_old,v_new);
END;
$gates$;

DO $properties$
BEGIN
 IF EXISTS (SELECT 1 FROM mg75_identidad_function_properties b LEFT JOIN pg_proc p ON p.oid=b.oid
   WHERE p.oid IS NULL OR (to_jsonb(p)-'prosrc') IS DISTINCT FROM b.properties) THEN
  RAISE EXCEPTION 'MG_IDENTIDAD_PROPERTIES_DRIFT: OID, owner, ACL o contrato alterado';
 END IF;
END;
$properties$;

DO $permissions$
DECLARE f record;
BEGIN
 FOR f IN SELECT p.oid::regprocedure AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='app_private' AND p.proname=ANY(ARRAY[
   'normalizar_pa_manteniment_alpha75','identidad_uuid_manteniment_alpha75',
   'analizar_identidad_manteniment_alpha75','item_retenido_identidad_manteniment_alpha75',
   'registrar_revision_manteniment_alpha75','retencion_identidad_manteniment_alpha75'])
 LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',f.signature);
 END LOOP;
END;
$permissions$;
COMMIT;
