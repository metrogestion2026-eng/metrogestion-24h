BEGIN;

-- MG75-CONTINUIDAD-SUSTITUCION-ENTRE-PA-001 / legacy MANTENIMENT boundary.
-- J/K cannot represent physical possession and the allocation boundary at once.
-- No existing queue, manual fact, flag or spreadsheet is changed on installation.
-- The legacy Apps Script stores delivered payloads locally: a SELECT filter alone
-- is insufficient. Delivery evidence survives outbox replacement and an ACK.
-- Runtime definitions are checked below before the narrowly scoped replacements.

-- The core migration supplies this lock and a fail-closed validation stub.
SELECT app_private.bloquear_sync_continuidad_alpha75();
LOCK TABLE public.registros_hotel, app_private.manteniment_parada_sync,
  app_private.manteniment_parada_outbox IN SHARE ROW EXCLUSIVE MODE;


-- Exact runtime and privilege preconditions. A mismatch aborts this transaction;
-- it never learns a different production definition or changes global flags.
DO $runtime_guard$
DECLARE v record; v_oid oid;
BEGIN
  FOR v IN SELECT * FROM (VALUES
    ('app_private.aplicar_snapshot_manteniment(jsonb,text,uuid,text)','992a216d5739ad6334cdc38837f98a23'),
    ('app_private.aplicar_snapshot_manteniment_7525(jsonb,text,uuid,text)','9674d26e7fbd8204a9473a5e628bdcd2'),
    ('app_private.manteniment_confirmar_comandos(text,jsonb)','b873346ac5887945dac0b6f674cb3c0a'),
    ('app_private.manteniment_construir_payload_parada(uuid)','d91ede52a2d083ce33aaedb3cf35fd0f'),
    ('app_private.manteniment_importar_paradas(jsonb)','990b85b6945b785ea3f1bfc3d508b2a4'),
    ('app_private.recibir_snapshot_manteniment_7525(text,jsonb)','f38b1c222134441f8338e4e949c10ab8'),
    ('public.confirmar_comandos_manteniment(text,jsonb)','bfcf82b05f9e9c3e4846b898d3c2e151'),
    ('app_private.manteniment_preflight_solo_lectura(text,jsonb)','e2fdb5553bcb90cbd7f9baada8bf90c9'),
    ('public.recibir_snapshot_manteniment(text,jsonb)','4c45ec5bd66f0b16c1f0b891016ac272'),
    ('app_private.manteniment_encolar_parada(uuid)','e5471f0afa4761619421f50501d74e10'),
    ('app_private.manteniment_importar_cierres_facturacion(jsonb,timestamptz)','823e6232b5204250a31de63b4a8b00ff')
  ) expected(signature,fingerprint) LOOP
    v_oid:=to_regprocedure(v.signature);
    IF v_oid IS NULL OR md5(pg_get_functiondef(v_oid))<>v.fingerprint
      OR has_function_privilege('anon',v_oid,'EXECUTE')
      OR has_function_privilege('authenticated',v_oid,'EXECUTE')
      OR NOT has_function_privilege('service_role',v_oid,'EXECUTE') THEN
      RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='MG_SYNC_CONTINUIDAD_RUNTIME_DRIFT: '||v.signature;
    END IF;
  END LOOP;
END;
$runtime_guard$;

CREATE TABLE app_private.manteniment_origenes_continuidad_alpha75 (
  seguimiento_id uuid PRIMARY KEY,
  origen text NOT NULL CHECK (origen IN ('post_barrera','legado_consumido','legado_ambiguo')),
  registrado_en timestamptz NOT NULL DEFAULT clock_timestamp(),
  evidencia_inicial jsonb NOT NULL DEFAULT '{}',
  resolucion jsonb,
  resuelto_por uuid,
  resuelto_en timestamptz,
  CONSTRAINT manteniment_continuidad_resolucion_explicita CHECK (
    (resolucion IS NULL AND resuelto_por IS NULL AND resuelto_en IS NULL)
    OR (origen IN ('legado_ambiguo','legado_consumido') AND jsonb_typeof(resolucion)='object'
      AND length(btrim(coalesce(resolucion->>'motivo',''))) >= 20
      AND coalesce(resolucion->>'evidencia_sha256','') ~ '^[0-9a-f]{64}$'
      AND resuelto_por IS NOT NULL AND resuelto_en IS NOT NULL)
  )
);
COMMENT ON TABLE app_private.manteniment_origenes_continuidad_alpha75 IS
  'Private provenance. Legacy uncertainty is never cleared by timestamps, rollover or ACK alone. Explicit reconciliation evidence is an owner-only future operation, not an application bypass.';

CREATE FUNCTION app_private.hash_payload_sync_continuidad_alpha75(p_payload jsonb)
RETURNS text LANGUAGE sql IMMUTABLE STRICT
SET search_path=pg_catalog AS $function$
  SELECT encode(sha256(convert_to(p_payload::text,'UTF8')),'hex');
$function$;

CREATE TABLE app_private.manteniment_entregas_continuidad_alpha75 (
  sync_id uuid NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  seguimiento_id uuid NOT NULL,
  tipo text NOT NULL CHECK (tipo IN ('parada','trabajos')),
  payload jsonb NOT NULL,
  payload_sha256 text GENERATED ALWAYS AS
    (app_private.hash_payload_sync_continuidad_alpha75(payload)) STORED,
  origen text NOT NULL DEFAULT 'entrega' CHECK (origen IN ('entrega','acuse_legado')),
  entregado_en timestamptz,
  ultima_entrega_en timestamptz,
  entregas integer NOT NULL DEFAULT 0 CHECK (entregas >= 0),
  confirmado_en timestamptz,
  confirmacion jsonb,
  PRIMARY KEY(sync_id,revision),
  CHECK ((confirmado_en IS NULL)=(confirmacion IS NULL)),
  CHECK (origen='acuse_legado' OR entregado_en IS NOT NULL)
);
CREATE INDEX manteniment_entregas_continuidad_pendientes_alpha75
  ON app_private.manteniment_entregas_continuidad_alpha75(seguimiento_id)
  WHERE tipo='parada' AND confirmado_en IS NULL;

CREATE TABLE app_private.manteniment_importaciones_retenidas_continuidad_alpha75 (
  sync_id uuid NOT NULL,
  payload_sha256 text NOT NULL,
  seguimiento_id uuid NOT NULL,
  payload jsonb NOT NULL,
  primera_recepcion_en timestamptz NOT NULL DEFAULT clock_timestamp(),
  ultima_recepcion_en timestamptz NOT NULL DEFAULT clock_timestamp(),
  recepciones integer NOT NULL DEFAULT 1 CHECK(recepciones > 0),
  motivo text NOT NULL DEFAULT 'PARADA vinculada: J/K no representan el tramo de continuidad',
  PRIMARY KEY(sync_id,payload_sha256),
  CHECK(payload_sha256=app_private.hash_payload_sync_continuidad_alpha75(payload))
);

ALTER TABLE app_private.manteniment_origenes_continuidad_alpha75 ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_private.manteniment_entregas_continuidad_alpha75 ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_private.manteniment_importaciones_retenidas_continuidad_alpha75 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON app_private.manteniment_origenes_continuidad_alpha75,
  app_private.manteniment_entregas_continuidad_alpha75,
  app_private.manteniment_importaciones_retenidas_continuidad_alpha75
  FROM PUBLIC,anon,authenticated,service_role;

-- Capture identity, not editable creado_en. Absence of a legacy outbox is not
-- evidence of no delivery: old enqueue paths could delete it. A completed exact
-- revision is retained as evidence of that consumption, not as a new delivery.
INSERT INTO app_private.manteniment_origenes_continuidad_alpha75
  (seguimiento_id,origen,evidencia_inicial)
SELECT ids.seguimiento_id,
  CASE WHEN o.estado='confirmado' AND o.confirmado_en IS NOT NULL
      AND s.ultimo_payload_confirmado=o.payload THEN 'legado_consumido'
    ELSE 'legado_ambiguo' END,
  jsonb_build_object('sync',to_jsonb(s),'outbox',to_jsonb(o))
FROM (
  SELECT seguimiento_id FROM public.registros_hotel
  UNION SELECT seguimiento_id FROM app_private.manteniment_parada_sync
  UNION SELECT seguimiento_id FROM app_private.manteniment_parada_outbox
) ids
LEFT JOIN app_private.manteniment_parada_sync s USING(seguimiento_id)
LEFT JOIN app_private.manteniment_parada_outbox o USING(seguimiento_id)
WHERE ids.seguimiento_id IS NOT NULL;

CREATE FUNCTION app_private.registrar_origen_sync_continuidad_alpha75()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,app_private AS $function$
BEGIN
  PERFORM app_private.bloquear_sync_continuidad_alpha75();
  IF TG_OP='UPDATE' AND OLD.seguimiento_id IS DISTINCT FROM NEW.seguimiento_id THEN
    RAISE EXCEPTION USING ERRCODE='23514',
      MESSAGE='MG_SYNC_CONTINUIDAD_SEGUIMIENTO_INMUTABLE: renombrar una PA no acredita un origen nuevo ni resuelve sus órdenes anteriores; requiere revisión específica.';
  END IF;
  INSERT INTO app_private.manteniment_origenes_continuidad_alpha75(seguimiento_id,origen,evidencia_inicial)
  VALUES(NEW.seguimiento_id,'post_barrera',jsonb_build_object('primer_registro_id',NEW.id))
  ON CONFLICT(seguimiento_id) DO NOTHING;
  RETURN NEW;
END;
$function$;
CREATE TRIGGER registrar_origen_sync_continuidad_alpha75
AFTER INSERT OR UPDATE OF seguimiento_id ON public.registros_hotel
FOR EACH ROW EXECUTE FUNCTION app_private.registrar_origen_sync_continuidad_alpha75();

CREATE OR REPLACE FUNCTION app_private.validar_sync_continuidad_alpha75(p_ids uuid[])
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,app_private AS $function$
BEGIN
  PERFORM app_private.bloquear_sync_continuidad_alpha75();
  IF coalesce(cardinality(p_ids),0)=0 OR array_position(p_ids,NULL) IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='MG_SYNC_CONTINUIDAD_IDENTIDAD_INVALIDA';
  END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(p_ids) id
    LEFT JOIN app_private.manteniment_origenes_continuidad_alpha75 o ON o.seguimiento_id=id
    WHERE o.seguimiento_id IS NULL OR (o.origen<>'post_barrera' AND o.resuelto_en IS NULL)
  ) THEN
    RAISE EXCEPTION USING ERRCODE='55000',
      MESSAGE='MG_SYNC_CONTINUIDAD_LEGADO_AMBIGUO: revisar el avance conservado de MANTENIMENT y acreditar su resolución antes de vincular estas PA.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM app_private.manteniment_entregas_continuidad_alpha75 e
    WHERE e.seguimiento_id=ANY(p_ids) AND e.tipo='parada' AND e.confirmado_en IS NULL
  ) THEN
    RAISE EXCEPTION USING ERRCODE='55000',
      MESSAGE='MG_SYNC_CONTINUIDAD_ENTREGA_PENDIENTE: una PARADA ya entregada debe confirmarse o reconciliarse antes de vincular estas PA.';
  END IF;
END;
$function$;

-- Only this exact, narrow envelope avoids the legacy PARADA writer. In
-- particular a client-provided tipo=trabajos does not make a mixed payload safe.
CREATE FUNCTION app_private.payload_solo_trabajos_continuidad_alpha75(p_payload jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE
SET search_path=pg_catalog AS $function$
  SELECT CASE WHEN jsonb_typeof(p_payload) IS DISTINCT FROM 'object' THEN false
    ELSE coalesce(p_payload->'solo_trabajos'='true'::jsonb
    AND jsonb_typeof(p_payload->'trabajos_asignados')='array'
    AND jsonb_typeof(p_payload->'trabajos_crear')='array'
    AND NOT EXISTS(SELECT 1 FROM jsonb_object_keys(p_payload) k
      WHERE k NOT IN ('sync_id','seguimiento_id','numero_parada','solo_trabajos','trabajos_asignados','trabajos_crear')),false) END;
$function$;

CREATE FUNCTION app_private.proteger_outbox_continuidad_alpha75()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,app_private AS $function$
DECLARE v_max integer; v_vinculada boolean;
BEGIN
  PERFORM app_private.bloquear_sync_continuidad_alpha75();
  v_vinculada:=app_private.seguimiento_con_continuidad_sustitucion_alpha75(
    CASE WHEN TG_OP='DELETE' THEN OLD.seguimiento_id ELSE NEW.seguimiento_id END);
  IF TG_OP='DELETE' THEN
    IF v_vinculada THEN RETURN NULL; END IF;
    RETURN OLD;
  END IF;
  IF TG_OP='UPDATE' AND (NEW.sync_id IS DISTINCT FROM OLD.sync_id
      OR NEW.seguimiento_id IS DISTINCT FROM OLD.seguimiento_id) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='MG_SYNC_CONTINUIDAD_IDENTIDAD_OUTBOX_INMUTABLE';
  END IF;
  IF v_vinculada AND NOT app_private.payload_solo_trabajos_continuidad_alpha75(NEW.payload) THEN
    -- Preserve an existing mixed command verbatim. A new incompatible command
    -- is retained with its original payload; dispatch still rejects it.
    IF TG_OP='UPDATE' THEN RETURN NULL; END IF;
    NEW.estado:='retenida_manual';
    NEW.ultimo_error:='Retenida por continuidad entre PA: el protocolo PARADA J/K no admite este vínculo.';
  END IF;
  SELECT max(revision) INTO v_max FROM app_private.manteniment_entregas_continuidad_alpha75
    WHERE sync_id=NEW.sync_id;
  IF TG_OP='INSERT' AND v_max IS NOT NULL AND NEW.revision<=v_max THEN
    NEW.revision:=v_max+1;
  ELSIF TG_OP='UPDATE' AND NEW.estado='pendiente' AND (
      NEW.payload IS DISTINCT FROM OLD.payload OR OLD.estado<>'pendiente')
      AND v_max IS NOT NULL AND NEW.revision<=v_max THEN
    NEW.revision:=v_max+1;
  END IF;
  RETURN NEW;
END;
$function$;
CREATE TRIGGER proteger_outbox_continuidad_alpha75
BEFORE INSERT OR UPDATE OR DELETE ON app_private.manteniment_parada_outbox
FOR EACH ROW EXECUTE FUNCTION app_private.proteger_outbox_continuidad_alpha75();

CREATE FUNCTION app_private.encolar_trabajos_continuidad_alpha75(p_seguimiento_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,app_private AS $function$
DECLARE v_sync uuid; v_pa text; v_asignados jsonb; v_crear jsonb; v_payload jsonb;
BEGIN
  PERFORM app_private.bloquear_sync_continuidad_alpha75();
  -- A mixed historical command is not relabelled or overwritten as work-only.
  IF EXISTS(SELECT 1 FROM app_private.manteniment_parada_outbox o
    WHERE o.seguimiento_id=p_seguimiento_id
      AND NOT app_private.payload_solo_trabajos_continuidad_alpha75(o.payload)) THEN RETURN; END IF;
  v_asignados:=app_private.manteniment_trabajos_asignados(p_seguimiento_id);
  v_crear:=app_private.manteniment_trabajos_por_crear(p_seguimiento_id);
  IF coalesce(jsonb_array_length(v_asignados),0)=0 AND coalesce(jsonb_array_length(v_crear),0)=0 THEN RETURN; END IF;
  SELECT sync_id INTO v_sync FROM app_private.manteniment_parada_sync WHERE seguimiento_id=p_seguimiento_id;
  SELECT r.numero_parada INTO v_pa FROM public.registros_hotel r JOIN public.pizarras p ON p.id=r.pizarra_id
    WHERE r.seguimiento_id=p_seguimiento_id
    ORDER BY (p.estado='en_curso') DESC,p.fecha DESC,r.actualizado_en DESC,r.id DESC LIMIT 1;
  IF v_sync IS NULL OR btrim(coalesce(v_pa,''))='' THEN RETURN; END IF;
  v_payload:=jsonb_build_object('sync_id',v_sync,'seguimiento_id',p_seguimiento_id,
    'numero_parada','PA-'||v_pa,'solo_trabajos',true,
    'trabajos_asignados',coalesce(v_asignados,'[]'),'trabajos_crear',coalesce(v_crear,'[]'));
  INSERT INTO app_private.manteniment_parada_outbox(seguimiento_id,sync_id,revision,estado,payload,actualizado_en,confirmado_en,ultimo_error)
  VALUES(p_seguimiento_id,v_sync,1,'pendiente',v_payload,clock_timestamp(),NULL,'')
  ON CONFLICT(seguimiento_id) DO UPDATE SET payload=excluded.payload,
    revision=manteniment_parada_outbox.revision+1,estado='pendiente',
    actualizado_en=clock_timestamp(),confirmado_en=NULL,ultimo_error='';
END;
$function$;

CREATE FUNCTION app_private.finalizar_entrega_sync_continuidad_alpha75(p_resultado jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,app_private AS $function$
DECLARE v_cmd jsonb; v_out app_private.manteniment_parada_outbox%rowtype;
  v_hash text; v_existing app_private.manteniment_entregas_continuidad_alpha75%rowtype;
  v_commands jsonb:='[]'; v_tipo text; v_retenidas integer:=0; v_en_vuelo integer:=0;
BEGIN
  PERFORM app_private.bloquear_sync_continuidad_alpha75();
  FOR v_cmd IN SELECT value FROM jsonb_array_elements(coalesce(p_resultado->'comandos_manteniment','[]')) LOOP
    IF v_cmd->>'tipo'='alta' THEN v_commands:=v_commands||jsonb_build_array(v_cmd); CONTINUE; END IF;
    SELECT * INTO v_out FROM app_private.manteniment_parada_outbox o
      WHERE o.sync_id=(v_cmd->>'sync_id')::uuid AND o.revision=(v_cmd->>'revision')::integer
        AND o.estado='pendiente' AND o.payload=v_cmd->'payload';
    IF NOT FOUND THEN CONTINUE; END IF;
    v_tipo:=CASE WHEN app_private.payload_solo_trabajos_continuidad_alpha75(v_out.payload) THEN 'trabajos' ELSE 'parada' END;
    IF v_tipo='parada' AND app_private.seguimiento_con_continuidad_sustitucion_alpha75(v_out.seguimiento_id) THEN
      v_retenidas:=v_retenidas+1; CONTINUE;
    END IF;
    v_hash:=app_private.hash_payload_sync_continuidad_alpha75(v_out.payload);
    SELECT * INTO v_existing FROM app_private.manteniment_entregas_continuidad_alpha75
      WHERE sync_id=v_out.sync_id AND revision=v_out.revision;
    IF FOUND AND (v_existing.payload_sha256<>v_hash OR v_existing.seguimiento_id<>v_out.seguimiento_id
        OR v_existing.tipo<>v_tipo OR v_existing.confirmado_en IS NOT NULL) THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='MG_SYNC_CONTINUIDAD_REVISION_REUTILIZADA';
    END IF;
    -- The legacy ACK has no delivery-instance token. Offering the same PARADA
    -- revision twice could leave a second cached copy after the first ACK. A
    -- lost response therefore remains explicitly uncertain; never re-offer it
    -- automatically or assume that the absence of an ACK means no delivery.
    IF v_existing.sync_id IS NOT NULL AND v_tipo='parada' THEN
      v_en_vuelo:=v_en_vuelo+1;
      CONTINUE;
    END IF;
    INSERT INTO app_private.manteniment_entregas_continuidad_alpha75
      (sync_id,revision,seguimiento_id,tipo,payload,entregado_en,ultima_entrega_en,entregas)
    VALUES(v_out.sync_id,v_out.revision,v_out.seguimiento_id,v_tipo,v_out.payload,clock_timestamp(),clock_timestamp(),1)
    ON CONFLICT(sync_id,revision) DO UPDATE SET
      ultima_entrega_en=excluded.ultima_entrega_en,entregas=manteniment_entregas_continuidad_alpha75.entregas+1;
    v_commands:=v_commands||jsonb_build_array(v_cmd||jsonb_build_object('payload_sha256',v_hash));
  END LOOP;
  -- Includes pending commands removed by the lower dispatcher before this gate.
  SELECT greatest(v_retenidas,count(*)::integer) INTO v_retenidas
    FROM app_private.manteniment_parada_outbox o WHERE o.estado IN ('pendiente','retenida_manual')
      AND app_private.seguimiento_con_continuidad_sustitucion_alpha75(o.seguimiento_id)
      AND NOT app_private.payload_solo_trabajos_continuidad_alpha75(o.payload);
  RETURN jsonb_set(p_resultado,'{comandos_manteniment}',v_commands,true)
    ||jsonb_build_object('ordenes_retenidas_continuidad',v_retenidas,
      'ordenes_en_vuelo_continuidad',v_en_vuelo);
END;
$function$;

CREATE FUNCTION app_private.confirmar_entrega_sync_continuidad_alpha75(p_item jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,app_private AS $function$
DECLARE v_e app_private.manteniment_entregas_continuidad_alpha75%rowtype;
  v_out app_private.manteniment_parada_outbox%rowtype; v_created jsonb; v_tipo text;
  v_legacy jsonb; v_legacy_sync jsonb;
BEGIN
  PERFORM app_private.bloquear_sync_continuidad_alpha75();
  SELECT * INTO v_e FROM app_private.manteniment_entregas_continuidad_alpha75
    WHERE sync_id=(p_item->>'sync_id')::uuid AND revision=(p_item->>'revision')::integer FOR UPDATE;
  IF NOT FOUND THEN
    -- A lost response may leave the legacy client replaying an ACK already
    -- committed before installation. Its exact consumed snapshot is sufficient
    -- to recognise that replay, including after the live outbox has advanced.
    SELECT o.evidencia_inicial->'outbox',o.evidencia_inicial->'sync'
      INTO v_legacy,v_legacy_sync
      FROM app_private.manteniment_origenes_continuidad_alpha75 o
      WHERE o.origen='legado_consumido'
        AND o.evidencia_inicial #>> '{outbox,sync_id}'=p_item->>'sync_id'
        AND o.evidencia_inicial #>> '{outbox,revision}'=p_item->>'revision';
    IF FOUND THEN
      v_tipo:=CASE WHEN app_private.payload_solo_trabajos_continuidad_alpha75(v_legacy->'payload') THEN 'trabajos' ELSE 'parada' END;
      IF v_tipo='parada' AND (v_legacy_sync->>'fila_manteniment') IS DISTINCT FROM (p_item->>'fila') THEN
        RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='MG_SYNC_CONTINUIDAD_ACK_LEGADO_CONTRADICTORIO';
      END IF;
      INSERT INTO app_private.manteniment_entregas_continuidad_alpha75
        (sync_id,revision,seguimiento_id,tipo,payload,origen,confirmado_en,confirmacion)
      VALUES((v_legacy->>'sync_id')::uuid,(v_legacy->>'revision')::integer,
        (v_legacy->>'seguimiento_id')::uuid,v_tipo,v_legacy->'payload','acuse_legado',
        (v_legacy->>'confirmado_en')::timestamptz,p_item) RETURNING * INTO v_e;
    END IF;
  END IF;
  IF v_e.sync_id IS NULL THEN
    -- Exact legacy ACKs can be recorded, but cannot clear unknown earlier local
    -- queues. The provenance marker remains ambiguous until explicit review.
    SELECT * INTO v_out FROM app_private.manteniment_parada_outbox o
      WHERE o.sync_id=(p_item->>'sync_id')::uuid AND o.revision=(p_item->>'revision')::integer
        AND o.estado='pendiente';
    IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM app_private.manteniment_origenes_continuidad_alpha75 x
       WHERE x.seguimiento_id=v_out.seguimiento_id AND x.origen IN ('legado_ambiguo','legado_consumido')) THEN
      RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='MG_SYNC_CONTINUIDAD_ACK_SIN_ENTREGA: la revisión no tiene evidencia de entrega; conservar y revisar el avance del cliente.';
    END IF;
    v_tipo:=CASE WHEN app_private.payload_solo_trabajos_continuidad_alpha75(v_out.payload) THEN 'trabajos' ELSE 'parada' END;
    INSERT INTO app_private.manteniment_entregas_continuidad_alpha75(sync_id,revision,seguimiento_id,tipo,payload,origen)
    VALUES(v_out.sync_id,v_out.revision,v_out.seguimiento_id,v_tipo,v_out.payload,'acuse_legado') RETURNING * INTO v_e;
  END IF;
  IF v_e.payload_sha256 IS DISTINCT FROM app_private.hash_payload_sync_continuidad_alpha75(v_e.payload)
      OR (p_item ? 'payload_sha256' AND p_item->>'payload_sha256' IS DISTINCT FROM v_e.payload_sha256)
      OR coalesce(p_item->>'estado','')<>'aplicado'
      OR coalesce(p_item->>'tipo','parada')<>v_e.tipo
      OR (v_e.tipo='parada' AND coalesce(p_item->>'fila','') !~ '^[1-9][0-9]{0,6}$') THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='MG_SYNC_CONTINUIDAD_ACK_INCOMPATIBLE';
  END IF;
  IF v_e.confirmado_en IS NOT NULL THEN
    IF (v_e.confirmacion-'payload_sha256') IS DISTINCT FROM (p_item-'payload_sha256') THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='MG_SYNC_CONTINUIDAD_ACK_CONTRADICTORIO';
    END IF;
    RETURN true;
  END IF;
  IF v_e.tipo='parada' AND app_private.seguimiento_con_continuidad_sustitucion_alpha75(v_e.seguimiento_id) THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='MG_SYNC_CONTINUIDAD_ACK_VINCULADO: conservar y reconciliar la orden aplicada; no se confirma como PARADA compatible.';
  END IF;
  SELECT * INTO v_out FROM app_private.manteniment_parada_outbox WHERE sync_id=v_e.sync_id AND revision=v_e.revision;
  IF FOUND AND (v_out.seguimiento_id<>v_e.seguimiento_id
      OR app_private.hash_payload_sync_continuidad_alpha75(v_out.payload)<>v_e.payload_sha256) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='MG_SYNC_CONTINUIDAD_ACK_HASH_DISTINTO';
  END IF;
  UPDATE app_private.manteniment_entregas_continuidad_alpha75
    SET confirmado_en=clock_timestamp(),confirmacion=p_item
    WHERE sync_id=v_e.sync_id AND revision=v_e.revision;
  UPDATE app_private.manteniment_parada_outbox
    SET estado='confirmado',confirmado_en=clock_timestamp(),intentos=intentos+1
    WHERE sync_id=v_e.sync_id AND revision=v_e.revision AND estado='pendiente';
  IF jsonb_typeof(p_item->'trabajos_creados')='array' THEN
    FOR v_created IN SELECT value FROM jsonb_array_elements(p_item->'trabajos_creados') LOOP
      IF coalesce(v_created->>'trabajo_sync_id','') !~* '^[0-9a-f-]{36}$'
        OR coalesce(v_created->>'fila','') !~ '^[0-9]{1,6}$' THEN
        RAISE EXCEPTION 'La confirmación de una necesidad creada no contiene identificador o fila válidos';
      END IF;
      UPDATE app_private.manteniment_t_trabajos w
      SET fuentes=jsonb_build_array(jsonb_build_object('fila',(v_created->>'fila')::integer,
          'clave_fila',coalesce(v_created->>'clave_fila',''))),actualizado_en=clock_timestamp()
      WHERE w.seguimiento_id=v_e.seguimiento_id AND w.sync_id=(v_created->>'trabajo_sync_id')::uuid;
    END LOOP;
  END IF;
  -- Work-only ACKs never clear a physical PARADA row or replace its last payload.
  -- An older delivered revision may finish after outbox advancement, but cannot
  -- roll back evidence of a newer acknowledged revision.
  IF v_e.tipo='parada' AND NOT EXISTS(
    SELECT 1 FROM app_private.manteniment_entregas_continuidad_alpha75 x
    WHERE x.sync_id=v_e.sync_id AND x.revision>v_e.revision AND x.tipo='parada' AND x.confirmado_en IS NOT NULL
  ) THEN
    UPDATE app_private.manteniment_parada_sync
      SET ultimo_payload_confirmado=v_e.payload,fila_manteniment=(p_item->>'fila')::integer
      WHERE seguimiento_id=v_e.seguimiento_id;
  END IF;
  RETURN true;
END;
$function$;

-- Reviewed runtime replacements; the wrappers, token validation and pauses remain.
CREATE OR REPLACE FUNCTION app_private.manteniment_encolar_parada(p_seguimiento_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'app_private'
AS $function$
declare
  v_payload jsonb;
  v_trabajos jsonb;
  v_trabajos_crear jsonb;
  v_ajuste_24h jsonb;
  v_sync_id uuid;
  v_numero_parada text;
begin
  perform app_private.bloquear_sync_continuidad_alpha75();
  if app_private.seguimiento_con_continuidad_sustitucion_alpha75(p_seguimiento_id) then
    perform app_private.encolar_trabajos_continuidad_alpha75(p_seguimiento_id);
    return;
  end if;
  if exists (
    select 1 from public.vehiculos v
    join lateral (
      select r.vehiculo_sustituido from public.registros_hotel r
      join public.pizarras p on p.id=r.pizarra_id
      where r.seguimiento_id=p_seguimiento_id
      order by (p.estado='en_curso') desc,p.fecha desc,r.actualizado_en desc,r.id desc
      limit 1
    ) ficha on v.dfm=regexp_replace(upper(btrim(ficha.vehiculo_sustituido)),'[[:space:]]+','','g')
    where not v.activo and v.baja_manual_bloquea_sync
  ) then
    delete from app_private.manteniment_parada_outbox where seguimiento_id=p_seguimiento_id;
    return;
  end if;

  v_trabajos := app_private.manteniment_trabajos_asignados(p_seguimiento_id);
  v_trabajos_crear := app_private.manteniment_trabajos_por_crear(p_seguimiento_id);
  v_ajuste_24h := app_private.manteniment_ajuste_24h(p_seguimiento_id);
  v_payload := app_private.manteniment_construir_payload_parada(p_seguimiento_id);

  if v_payload is null then
    if jsonb_array_length(v_trabajos) = 0
       and jsonb_array_length(v_trabajos_crear) = 0
       and v_ajuste_24h is null
    then
      delete from app_private.manteniment_parada_outbox
      where seguimiento_id = p_seguimiento_id;
      return;
    end if;

    select s.sync_id,
           nullif(btrim(coalesce(r.numero_parada, '')), '')
      into v_sync_id, v_numero_parada
    from app_private.manteniment_parada_sync s
    join lateral (
      select h.numero_parada
      from public.registros_hotel h
      join public.pizarras p on p.id = h.pizarra_id
      where h.seguimiento_id = p_seguimiento_id
      order by (p.estado = 'en_curso') desc, p.fecha desc,
               h.actualizado_en desc, h.id desc
      limit 1
    ) r on true
    where s.seguimiento_id = p_seguimiento_id;

    if v_sync_id is null or v_numero_parada is null then return; end if;
    v_payload := jsonb_build_object(
      'sync_id', v_sync_id,
      'seguimiento_id', p_seguimiento_id,
      'numero_parada', 'PA-' || v_numero_parada,
      'solo_trabajos', true,
      'trabajos_asignados', v_trabajos,
      'trabajos_crear', v_trabajos_crear
    );
  else
    v_payload := jsonb_set(v_payload, '{solo_trabajos}', 'false'::jsonb, true);
    v_payload := jsonb_set(v_payload, '{trabajos_asignados}', v_trabajos, true);
    v_payload := jsonb_set(v_payload, '{trabajos_crear}', v_trabajos_crear, true);
    v_sync_id := (v_payload->>'sync_id')::uuid;
  end if;

  if v_ajuste_24h is not null then
    v_payload := jsonb_set(v_payload, '{ajuste_24h}', v_ajuste_24h, true);
  end if;

  insert into app_private.manteniment_parada_outbox(
    seguimiento_id, sync_id, revision, estado, payload,
    actualizado_en, confirmado_en, ultimo_error
  ) values (
    p_seguimiento_id, v_sync_id, 1, 'pendiente', v_payload,
    clock_timestamp(), null, ''
  )
  on conflict (seguimiento_id) do update
  set sync_id = excluded.sync_id,
      revision = app_private.manteniment_parada_outbox.revision + 1,
      estado = 'pendiente',
      payload = excluded.payload,
      actualizado_en = clock_timestamp(),
      confirmado_en = null,
      ultimo_error = '';
end;
$function$;

CREATE OR REPLACE FUNCTION app_private.manteniment_construir_payload_parada(p_seguimiento_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'app_private'
AS $function$
declare
  v_sync app_private.manteniment_parada_sync%rowtype;
  v_ficha record;
  v_resumen record;
  v_periodo public.cierres_facturacion%rowtype;
  v_periodo_sync public.cierres_facturacion%rowtype;
  v_periodo_siguiente public.cierres_facturacion%rowtype;
  v_fecha_k date;
  v_dias integer;
  v_km numeric;
  v_hoy date := (now() at time zone 'Europe/Madrid')::date;
  v_inicio date;
  v_fin date;
  v_anulada boolean;
  v_tancament_payload text;
  v_fecha_parada_payload date;
  v_cierre_periodo_anterior jsonb := null;
begin
  perform app_private.bloquear_sync_continuidad_alpha75();
  if app_private.seguimiento_con_continuidad_sustitucion_alpha75(p_seguimiento_id) then return null; end if;
  select * into v_sync
  from app_private.manteniment_parada_sync
  where seguimiento_id=p_seguimiento_id;
  if not found then return null; end if;

  select r.*,p.fecha as fecha_pizarra
  into v_ficha
  from public.registros_hotel r
  join public.pizarras p on p.id=r.pizarra_id
  where r.seguimiento_id=p_seguimiento_id
  order by (p.estado='en_curso') desc,p.fecha desc,r.actualizado_en desc,r.id desc
  limit 1;
  if not found then return null; end if;

  if btrim(coalesce(v_ficha.vehiculo_reserva,''))='' then
    return null;
  end if;

  select * into v_resumen
  from public.paradas_sustitucion_resumen
  where seguimiento_id=p_seguimiento_id;

  v_anulada := coalesce(v_ficha.cancelado,false) or v_ficha.estado='anulado';
  v_tancament_payload := btrim(coalesce(v_sync.tancament,''));
  v_fecha_parada_payload := coalesce(v_sync.fecha_inicio_tramo,v_ficha.fecha_parada);

  if v_tancament_payload<>'' then
    select c.* into v_periodo_sync
    from public.cierres_facturacion c
    where v_tancament_payload=
          'TANCAMENT '||(split_part(c.periodo,'-',2)::integer)::text
      and (
        v_sync.fecha_inicio_tramo between c.fecha_inicio and c.fecha_cierre
        or v_sync.fecha_corte between c.fecha_inicio and c.fecha_cierre
      )
    order by c.fecha_inicio desc
    limit 1;
  end if;

  if v_periodo_sync.periodo is not null
     and not v_anulada
     and coalesce(v_resumen.fecha_fin_parada,v_hoy+1)>v_periodo_sync.fecha_cierre
  then
    select c.* into v_periodo_siguiente
    from public.cierres_facturacion c
    where c.fecha_inicio>v_periodo_sync.fecha_cierre
      and c.fecha_inicio<=v_hoy
    order by c.fecha_inicio
    limit 1;

    if v_periodo_siguiente.periodo is not null then
      v_cierre_periodo_anterior := jsonb_build_object(
        'tancament',v_tancament_payload,
        'fecha_k',v_periodo_sync.fecha_cierre
      );
      v_tancament_payload :=
        'TANCAMENT '||(split_part(v_periodo_siguiente.periodo,'-',2)::integer)::text;
      v_fecha_parada_payload := v_periodo_siguiente.fecha_inicio;
      v_periodo := v_periodo_siguiente;

      if v_resumen.fecha_fin_parada is not null then
        v_fecha_k := least(v_resumen.fecha_fin_parada,v_periodo_siguiente.fecha_cierre);
      elsif v_hoy>v_periodo_siguiente.fecha_cierre then
        v_fecha_k := v_periodo_siguiente.fecha_cierre;
      else
        v_fecha_k := null;
      end if;
    end if;
  end if;

  if v_tancament_payload='' and not v_anulada then
    select c.* into v_periodo
    from public.cierres_facturacion c
    where v_hoy between c.fecha_inicio and c.fecha_cierre
    order by c.fecha_inicio desc
    limit 1;
    if v_periodo.periodo is not null then
      v_tancament_payload :=
        'TANCAMENT '||(split_part(v_periodo.periodo,'-',2)::integer)::text;
    end if;
  end if;

  if v_cierre_periodo_anterior is null then
    v_fecha_k := case
      when v_ficha.retirado_hotel_activo
           or v_ficha.estado in ('recuperado','reserva_liberada')
        then coalesce(v_sync.fecha_corte,v_ficha.fecha_retirado_hotel::date,v_ficha.fecha_pizarra)
      when btrim(coalesce(v_sync.tancament,''))<>'' then v_sync.fecha_corte
      else null
    end;
  end if;

  if v_periodo.periodo is null and v_tancament_payload<>'' then
    select c.* into v_periodo
    from public.cierres_facturacion c
    where v_tancament_payload=
          'TANCAMENT '||(split_part(c.periodo,'-',2)::integer)::text
      and coalesce(v_fecha_parada_payload,v_hoy) between c.fecha_inicio and c.fecha_cierre
    order by c.fecha_inicio desc
    limit 1;
  end if;

  if v_sync.calculo_periodo_automatico and not v_sync.tancament_supervisado then
    v_inicio := coalesce(v_fecha_parada_payload,v_resumen.fecha_inicio_parada);
    v_fin := least(coalesce(v_fecha_k,v_hoy),coalesce(v_periodo.fecha_cierre,v_hoy),v_hoy);
    v_dias := case when v_inicio is null then 0 else
      greatest(0,v_fin-greatest(v_inicio,coalesce(v_periodo.fecha_inicio,v_inicio))+1)
    end;
    v_km := case when v_resumen.km_dia is not null
      then round(v_dias::numeric*v_resumen.km_dia,2) end;
  else
    if v_sync.dias_parada_manual is not null and v_cierre_periodo_anterior is null then
      v_dias := v_sync.dias_parada_manual;
    elsif v_fecha_k is not null then
      v_dias := greatest(
        0,
        v_fecha_k-greatest(
          coalesce(v_fecha_parada_payload,v_resumen.fecha_inicio_parada,v_ficha.fecha_parada,v_ficha.fecha_pizarra),
          coalesce(v_periodo.fecha_inicio,coalesce(v_fecha_parada_payload,v_resumen.fecha_inicio_parada,v_ficha.fecha_parada,v_ficha.fecha_pizarra))
        )+1
      );
    else
      v_dias := coalesce(v_resumen.dias_parada_total,0);
    end if;
    v_km := coalesce(
      case when v_cierre_periodo_anterior is null then v_sync.km_facturables_manual end,
      case when v_resumen.km_dia is not null then round(v_dias::numeric*v_resumen.km_dia,2) end
    );
  end if;

  return jsonb_strip_nulls(jsonb_build_object(
    'sync_id',v_sync.sync_id,
    'seguimiento_id',p_seguimiento_id,
    'dfm',coalesce(v_ficha.vehiculo_sustituido,''),
    'matricula',coalesce(v_ficha.matricula_sustituido,''),
    'tipo',coalesce(v_ficha.tipo_unidad,''),
    'upc',coalesce(v_ficha.upc,''),
    'numero_parada',case
      when btrim(coalesce(v_ficha.numero_parada,''))='' then ''
      else 'PA-'||btrim(v_ficha.numero_parada)
    end,
    'sustituto',coalesce(v_ficha.vehiculo_reserva,''),
    'estado',case when v_anulada then 'ANULADA' else 'PARADA' end,
    'fecha_programada',v_sync.fecha_programada_parada,
    'fecha_parada',v_fecha_parada_payload,
    'fecha_k',v_fecha_k,
    'dias_parada',v_dias,
    'marca',coalesce(v_ficha.marca,''),
    'km_facturables',v_km,
    'tancament',v_tancament_payload,
    'tancament_supervisado',case
      when v_cierre_periodo_anterior is not null then false
      when btrim(coalesce(v_sync.tancament,''))='' then false
      else v_sync.tancament_supervisado
    end,
    'cierre_periodo_anterior',v_cierre_periodo_anterior
  ));
end;
$function$;

CREATE OR REPLACE FUNCTION app_private.manteniment_importar_paradas(p_paradas jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'app_private'
AS $function$
declare
  v_item jsonb;
  v_sync app_private.manteniment_parada_sync%rowtype;
  v_ficha public.registros_hotel%rowtype;
  v_registro_id uuid;
  v_k date;
  v_q text;
  v_fecha_parada date;
  v_fecha_tramo date;
  v_estado text;
  v_cancelada boolean;
  v_count integer := 0;
begin
  perform app_private.bloquear_sync_continuidad_alpha75();
  if p_paradas is null then return 0; end if;
  if jsonb_typeof(p_paradas) <> 'array' or jsonb_array_length(p_paradas) > 500 then
    raise exception 'El bloque PARADA no tiene un formato válido';
  end if;

  perform set_config('app.manteniment_importando_paradas', '1', true);
  for v_item in select value from jsonb_array_elements(p_paradas)
  loop
    if coalesce(v_item->>'sync_id', '') !~ '^[0-9a-fA-F-]{36}$' then
      raise exception 'Una fila PARADA no contiene un identificador válido';
    end if;

    select * into v_sync
    from app_private.manteniment_parada_sync
    where sync_id = (v_item->>'sync_id')::uuid
    for update;
    if not found then
      raise exception 'Una fila PARADA no pertenece a Metrogestión';
    end if;

    -- Resolve identity from sync_id before inspecting external dates. Both
    -- endpoints retain the received row for review without importing J/K/L/P.
    if app_private.seguimiento_con_continuidad_sustitucion_alpha75(v_sync.seguimiento_id) then
      insert into app_private.manteniment_importaciones_retenidas_continuidad_alpha75
        (sync_id,payload_sha256,seguimiento_id,payload)
      values(v_sync.sync_id,app_private.hash_payload_sync_continuidad_alpha75(v_item),v_sync.seguimiento_id,v_item)
      on conflict(sync_id,payload_sha256) do update set
        ultima_recepcion_en=clock_timestamp(),
        recepciones=manteniment_importaciones_retenidas_continuidad_alpha75.recepciones+1;
      continue;
    end if;

    v_estado := upper(btrim(coalesce(v_item->>'estado', '')));
    if v_estado not in ('PARADA', 'ANULADA') then
      raise exception 'Una fila vinculada debe conservar MANTENIMENT = PARADA o ANULADA';
    end if;

    select r.* into v_ficha
    from public.registros_hotel r
    join public.pizarras p on p.id = r.pizarra_id
    where r.seguimiento_id = v_sync.seguimiento_id
    order by (p.estado = 'en_curso') desc, p.fecha desc, r.actualizado_en desc, r.id desc
    limit 1
    for update of r;
    if not found then
      raise exception 'La PARADA vinculada ya no tiene ficha en Metrogestión';
    end if;

    v_cancelada := coalesce(v_ficha.cancelado, false) or v_ficha.estado = 'anulado';
    if v_cancelada then
      update app_private.manteniment_parada_sync
      set fila_manteniment = nullif(v_item->>'fila', '')::integer
      where seguimiento_id = v_sync.seguimiento_id;

      perform set_config('app.manteniment_importando_paradas', '0', true);
      perform app_private.manteniment_encolar_parada(v_sync.seguimiento_id);
      perform set_config('app.manteniment_importando_paradas', '1', true);
      v_count := v_count + 1;
      continue;
    end if;

    if v_estado <> 'PARADA' then
      raise exception 'Metrogestión mantiene activa esta fila; MANTENIMENT debe conservar PARADA';
    end if;

    v_fecha_tramo := nullif(v_item->>'fecha_parada', '')::date;
    -- J puede ser un cambio de reserva o un corte: no reinicia la parada.
    v_fecha_parada := coalesce(nullif(v_item->>'fecha_inicio_parada','')::date,
      v_sync.fecha_inicio_parada_origen, v_fecha_tramo);
    v_q := upper(btrim(coalesce(v_item->>'tancament', '')));
    if v_q <> '' and v_q !~ '^TANCAMENT [0-9]{1,3}$' then
      raise exception 'TANCAMENT debe ir seguido del número de periodo';
    end if;
    v_k := nullif(v_item->>'fecha_k', '')::date;
    if v_q = '' and v_k is not null and v_fecha_parada is null then
      raise exception 'Antes de recuperar en K debe indicarse la fecha real de parada en J';
    end if;

    update app_private.manteniment_parada_sync
    set fecha_inicio_parada_origen = coalesce(nullif(v_item->>'fecha_inicio_parada','')::date,v_sync.fecha_inicio_parada_origen),
        fecha_inicio_tramo = v_fecha_tramo,
        fecha_programada_parada = nullif(v_item->>'fecha_programada', '')::date,
        fecha_corte = case when v_q <> '' then v_k else null end,
        tancament = v_q,
        tancament_supervisado = case
          when v_q is distinct from v_sync.tancament or v_k is distinct from v_sync.fecha_corte then false
          else v_sync.tancament_supervisado
        end,
        tancament_supervisado_por = case
          when v_q is distinct from v_sync.tancament or v_k is distinct from v_sync.fecha_corte then null
          else v_sync.tancament_supervisado_por
        end,
        tancament_supervisado_en = case
          when v_q is distinct from v_sync.tancament or v_k is distinct from v_sync.fecha_corte then null
          else v_sync.tancament_supervisado_en
        end,
        dias_parada_manual = case
          when v_sync.calculo_periodo_automatico and not v_sync.tancament_supervisado then null
          when v_item ? 'dias_parada' then nullif(v_item->>'dias_parada', '')::integer
          else v_sync.dias_parada_manual
        end,
        km_facturables_manual = case
          when v_sync.calculo_periodo_automatico and not v_sync.tancament_supervisado then null
          when v_item ? 'km_facturables' then nullif(v_item->>'km_facturables', '')::numeric
          else v_sync.km_facturables_manual
        end,
        fila_manteniment = nullif(v_item->>'fila', '')::integer
    where seguimiento_id = v_sync.seguimiento_id;

    update public.registros_hotel r
    set fecha_parada = v_fecha_parada,
        version = coalesce(r.version, 0) + 1,
        actualizado_en = clock_timestamp(),
        modificado_por = coalesce(r.modificado_por, r.creado_por)
    where r.seguimiento_id = v_sync.seguimiento_id
      and not r.cancelado
      and r.fecha_parada is distinct from v_fecha_parada;

    v_registro_id := v_ficha.id;
    if v_q = '' and v_k is not null then
      update public.registros_hotel
      set retirado_hotel_activo = true,
          fecha_retirado_hotel = v_k::timestamp at time zone 'Europe/Madrid',
          estado = case
            when estado not in ('reserva_liberada', 'recuperado') then 'recuperado'
            else estado
          end,
          version = coalesce(version, 0) + 1,
          actualizado_en = clock_timestamp(),
          modificado_por = coalesce(modificado_por, creado_por)
      where id = v_registro_id
        and (
          not retirado_hotel_activo
          or fecha_retirado_hotel::date is distinct from v_k
          or estado not in ('reserva_liberada', 'recuperado')
        );
    end if;

    perform set_config('app.manteniment_importando_paradas', '0', true);
    perform app_private.manteniment_encolar_parada(v_sync.seguimiento_id);
    perform set_config('app.manteniment_importando_paradas', '1', true);
    v_count := v_count + 1;
  end loop;
  perform set_config('app.manteniment_importando_paradas', '0', true);
  return v_count;
end;
$function$;

CREATE OR REPLACE FUNCTION app_private.aplicar_snapshot_manteniment(p_payload jsonb, p_modo text DEFAULT 'programada'::text, p_actor uuid DEFAULT NULL::uuid, p_origen text DEFAULT 'google_apps_script'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'app_private'
AS $function$
declare
  v_payload jsonb := p_payload;
  v_filas jsonb := '[]'::jsonb;
  v_result jsonb;
  v_bloqueadas integer := 0;
  v_paradas integer := 0;
  v_trabajos jsonb := '{}'::jsonb;
  v_comandos jsonb := '[]'::jsonb;
begin
  perform app_private.bloquear_sync_continuidad_alpha75();
  -- MG20: pause both directions before any side effect; missing state is closed.
  if coalesce((select c.pausa_importacion_identidad from app_private.manteniment_sync_config c where c.id = 1), true) then
    raise exception using errcode = '55000',
      message = 'MG_SYNC_PAUSADA_IDENTIDAD: Sincronización detenida hasta completar la revisión de identidad; no reenviar ni confirmar órdenes.';
  end if;

  if jsonb_typeof(p_payload) = 'object' and jsonb_typeof(p_payload->'filas') = 'array' then
    select coalesce(jsonb_agg(f.value order by f.ordinality) filter (where not f.bloqueada), '[]'::jsonb),
           count(*) filter (where f.bloqueada)
      into v_filas, v_bloqueadas
    from (
      select e.value, e.ordinality,
             exists (
               select 1 from public.vehiculos v
               where v.baja_manual_bloquea_sync = true
                 and v.dfm = regexp_replace(upper(btrim(coalesce(e.value->>'dfm', ''))), '[[:space:]]+', '', 'g')
             ) as bloqueada
      from jsonb_array_elements(p_payload->'filas') with ordinality e(value, ordinality)
    ) f;
    v_payload := jsonb_set(p_payload, '{filas}', v_filas, true);
  end if;

  create temp table if not exists tmp_manteniment_cambios_maestro (
    dfm text not null,
    campo text not null,
    cambio_en timestamptz not null,
    primary key (dfm,campo)
  ) on commit drop;
  truncate tmp_manteniment_cambios_maestro;

  insert into tmp_manteniment_cambios_maestro(dfm,campo,cambio_en)
  select
    regexp_replace(upper(btrim(coalesce(f.value->>'dfm',''))), '[[:space:]]+', '', 'g'),
    c.key,
    c.value::timestamptz
  from jsonb_array_elements(v_filas) f(value)
  cross join lateral jsonb_each_text(coalesce(f.value->'cambios_maestro','{}'::jsonb)) c
  where c.key in (
    'matricula','tipo_manteniment','upc','telefono','contrato_texto',
    'fecha_matriculacion','fecha_alta_manteniment','asignacion_manteniment',
    'marca','bastidor'
  )
    and c.value ~ '^\\d{4}-\\d{2}-\\d{2}T'
  on conflict (dfm,campo) do update
  set cambio_en=greatest(tmp_manteniment_cambios_maestro.cambio_en,excluded.cambio_en);

  perform set_config('app.manteniment_importando_altas', '1', true);
  v_result := app_private.aplicar_snapshot_manteniment_base(v_payload, p_modo, p_actor, p_origen);
  if not coalesce((v_result->>'ok')::boolean, false) then
    perform set_config('app.manteniment_importando_altas', '0', true);
    return v_result;
  end if;

  update public.vehiculos v
  set fecha_matriculacion = x.fecha_matriculacion::date
  from jsonb_to_recordset(v_filas) as x(dfm text, fecha_matriculacion text)
  where v.dfm = regexp_replace(upper(btrim(coalesce(x.dfm, ''))), '[[:space:]]+', '', 'g')
    and btrim(coalesce(x.fecha_matriculacion, '')) ~ '^\d{4}-\d{2}-\d{2}$'
    and v.fecha_matriculacion is distinct from x.fecha_matriculacion::date;
  perform set_config('app.manteniment_importando_altas', '0', true);

  v_paradas := app_private.manteniment_importar_paradas(p_payload->'paradas');
  v_trabajos := app_private.manteniment_importar_trabajos(p_payload->'trabajos');

  -- Keep the complete read-only feed apart from predictive order creation.
  -- Legacy scripts already send the overdue/next-month window in trabajos.
  if p_modo <> 'prueba' then
    perform app_private.manteniment_guardar_pendientes_lectura(
      case when p_payload ? 'pendientes' then p_payload->'pendientes' else p_payload->'trabajos' end,
      (p_payload->>'generado_en')::timestamptz,
      p_payload ? 'pendientes'
    );
  end if;


  perform app_private.manteniment_encolar_parada(v.seguimiento_id)
  from public.paradas_sustitucion_resumen v
  join app_private.manteniment_parada_sync s using (seguimiento_id)
  where v.clase_facturacion = 'DFM'
    and v.sustituto is not null
    and v.fecha_fin_parada is null
    and s.fila_manteniment is not null;

  -- Retira órdenes antiguas que quedaron pendientes antes de registrar la baja.
  delete from app_private.manteniment_parada_outbox o
  using public.vehiculos v
  where o.estado='pendiente'
    and v.dfm=regexp_replace(upper(btrim(o.payload->>'dfm')),'[[:space:]]+','','g')
    and not v.activo and v.baja_manual_bloquea_sync
    and not app_private.seguimiento_con_continuidad_sustitucion_alpha75(o.seguimiento_id);

  -- Una baja manual explícita debe llegar a MANTENIMENT aunque la fila ALTA
  -- ya no figure en la fotografía actual. La orden se conserva hasta que el
  -- Apps Script la escriba y confirme, evitando perder la BAJA al archivar.

  select coalesce(jsonb_agg(jsonb_build_object(
    'tipo', c.tipo,
    'vehiculo_id', c.vehiculo_id,
    'sync_id', c.sync_id,
    'revision', c.revision,
    'payload', c.payload
  ) order by c.actualizado_en, c.tipo, c.clave), '[]'::jsonb)
  into v_comandos
  from (
    select 'alta'::text as tipo, o.vehiculo_id, null::uuid as sync_id,
           o.revision, o.payload, o.actualizado_en, o.vehiculo_id::text as clave
    from app_private.manteniment_activo_outbox o
    where o.estado = 'pendiente'
    union all
    select 'parada'::text, null::uuid, o.sync_id,
           o.revision, o.payload, o.actualizado_en, o.sync_id::text
    from app_private.manteniment_parada_outbox o
    where o.estado = 'pendiente'
      and (not app_private.seguimiento_con_continuidad_sustitucion_alpha75(o.seguimiento_id)
        or app_private.payload_solo_trabajos_continuidad_alpha75(o.payload))
    order by actualizado_en, tipo, clave
    limit 200
  ) c;

  if v_bloqueadas > 0 then
    update public.manteniment_sync_ejecuciones
    set detalle = jsonb_set(coalesce(detalle, '{}'::jsonb), '{bajas_manuales_protegidas}', to_jsonb(v_bloqueadas), true),
        mensaje = concat_ws(' ', mensaje, format('%s baja(s) manual(es) protegida(s).', v_bloqueadas))
    where id = (v_result->>'ejecucion_id')::uuid;
  end if;

  -- The installed Apps Script already displays resultado.mensaje.
  -- Include the rejected count there and retain row details in the run log.
  if jsonb_array_length(coalesce(v_trabajos->'vinculos_rechazados','[]'::jsonb)) > 0 then
    v_result := jsonb_set(v_result,'{mensaje}',to_jsonb(concat_ws(' ',v_result->>'mensaje',
      format('%s vínculo(s) de otro vehículo omitido(s); revisar el detalle de sincronización.',
        jsonb_array_length(v_trabajos->'vinculos_rechazados')))),true);
    update public.manteniment_sync_ejecuciones
    set mensaje=v_result->>'mensaje',
        filas_con_avisos=coalesce(filas_con_avisos,0)+jsonb_array_length(v_trabajos->'vinculos_rechazados')
    where id=(v_result->>'ejecucion_id')::uuid;
  end if;

  update public.manteniment_sync_ejecuciones
  set detalle = coalesce(detalle, '{}'::jsonb) || jsonb_build_object(
    'paradas_recibidas', v_paradas,
    'trabajos_predictivos', v_trabajos,
    'comandos_manteniment_pendientes', jsonb_array_length(v_comandos)
  )
  where id = (v_result->>'ejecucion_id')::uuid;

  return v_result || jsonb_build_object(
    'bajas_manuales_protegidas', v_bloqueadas,
    'paradas_recibidas', v_paradas,
    'trabajos_predictivos', v_trabajos,
    'comandos_manteniment', v_comandos
  );
end;
$function$;

CREATE OR REPLACE FUNCTION app_private.aplicar_snapshot_manteniment_7525(p_payload jsonb, p_modo text DEFAULT 'programada'::text, p_actor uuid DEFAULT NULL::uuid, p_origen text DEFAULT 'google_apps_script'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'app_private'
AS $function$
declare
  v_result jsonb;
  v_cierres jsonb;
begin
  perform app_private.bloquear_sync_continuidad_alpha75();
  v_result := app_private.aplicar_snapshot_manteniment(p_payload,p_modo,p_actor,p_origen);
  if not coalesce((v_result->>'ok')::boolean,false) then
    return v_result;
  end if;

  if p_payload ? 'cierres_facturacion' then
    v_cierres := app_private.manteniment_importar_cierres_facturacion(
      p_payload->'cierres_facturacion',
      coalesce(nullif(p_payload->>'generado_en','')::timestamptz,now())
    );
  else
    v_cierres := jsonb_build_object('recibidos',0,'actualizados',0);
  end if;

  update public.manteniment_sync_ejecuciones
  set detalle=coalesce(detalle,'{}'::jsonb)
      || jsonb_build_object('cierres_facturacion',v_cierres)
  where id=(v_result->>'ejecucion_id')::uuid;

  return v_result || jsonb_build_object('cierres_facturacion',v_cierres);
end;
$function$;

CREATE OR REPLACE FUNCTION app_private.recibir_snapshot_manteniment_7525(p_token text, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'app_private', 'extensions'
AS $function$
declare
  v_config app_private.manteniment_sync_config%rowtype;
  v_hash text;
  v_mode text;
  v_result jsonb;
  v_retenidas_parada integer := 0;
  v_retenidas_alta integer := 0;
  v_safe_commands jsonb := '[]'::jsonb;
  v_safe_count integer := 0;
  v_script_version text := btrim(coalesce(p_payload->>'version_script',''));
  v_version_validada constant text := 'alpha75-2026.10.26.1';
begin
  perform app_private.bloquear_sync_continuidad_alpha75();
  select * into v_config
  from app_private.manteniment_sync_config
  where id=1;

  if not found or not v_config.token_activo or v_config.token_hash='' then
    raise exception 'La actualización automática de MANTENIMENT no está activada';
  end if;
  if length(coalesce(p_token,''))<40 then
    raise exception 'Clave de conexión no válida';
  end if;

  v_hash := encode(extensions.digest(p_token,'sha256'),'hex');
  if v_hash is distinct from v_config.token_hash then
    raise exception 'Clave de conexión no válida';
  end if;

  -- No bypass: the identity pause still blocks both directions.
  if coalesce(v_config.pausa_importacion_identidad,true) then
    raise exception using errcode='55000',
      message='MG_SYNC_PAUSADA_IDENTIDAD: Sincronización detenida hasta completar la revisión de identidad; no reenviar ni confirmar órdenes.';
  end if;

  update app_private.manteniment_sync_config
     set ultima_version_script=nullif(v_script_version,''),
         ultima_version_script_en=clock_timestamp(),
         actualizado_en=clock_timestamp()
   where id=1;

  v_mode := lower(btrim(coalesce(p_payload->>'modo','programada')));
  if v_mode not in ('manual','programada','prueba') then
    v_mode := 'programada';
  end if;

  v_result := app_private.aplicar_snapshot_manteniment_7525(
    p_payload,v_mode,null,'google_apps_script'
  );

  if coalesce(v_config.solo_lectura_manual_protegida,false) then
    update app_private.manteniment_parada_outbox
       set estado='retenida_manual',
           ultimo_error='Retenida: MANTENIMENT en modo lectura protegida; requiere revisión antes de escribir sobre datos manuales.',
           actualizado_en=clock_timestamp()
     where estado='pendiente';
    get diagnostics v_retenidas_parada=row_count;

    update app_private.manteniment_activo_outbox
       set estado='retenida_manual',
           ultimo_error='Retenida: MANTENIMENT en modo lectura protegida; requiere revisión antes de escribir sobre datos manuales.',
           actualizado_en=clock_timestamp()
     where estado='pendiente';
    get diagnostics v_retenidas_alta=row_count;

    v_result := jsonb_set(v_result,'{comandos_manteniment}','[]'::jsonb,true);
    v_result := jsonb_set(
      v_result,'{mensaje}',
      to_jsonb(concat_ws(' ',
        nullif(v_result->>'mensaje',''),
        format('Modo lectura protegida: %s orden(es) retenida(s); no se ha escrito automáticamente en MANTENIMENT.',
          v_retenidas_parada+v_retenidas_alta)
      )),true
    );
    v_result := v_result || jsonb_build_object(
      'solo_lectura_manual_protegida',true,
      'escritura_segura_manual',false,
      'version_script_recibida',nullif(v_script_version,''),
      'version_script_validada',v_script_version=v_version_validada,
      'ordenes_retenidas',v_retenidas_parada+v_retenidas_alta
    );

  elsif coalesce(v_config.escritura_segura_manual,false) then
    if v_script_version<>v_version_validada then
      update app_private.manteniment_parada_outbox
         set estado='retenida_manual',
             ultimo_error=format(
               'Retenida: el Apps Script %s no incorpora la estabilización 75.25 validada.',
               coalesce(nullif(v_script_version,''),'sin versión')
             ),
             actualizado_en=clock_timestamp()
       where estado='pendiente';
      get diagnostics v_retenidas_parada=row_count;

      update app_private.manteniment_activo_outbox
         set estado='retenida_manual',
             ultimo_error=format(
               'Retenida: el Apps Script %s no incorpora la estabilización 75.25 validada.',
               coalesce(nullif(v_script_version,''),'sin versión')
             ),
             actualizado_en=clock_timestamp()
       where estado='pendiente';
      get diagnostics v_retenidas_alta=row_count;

      v_result := jsonb_set(v_result,'{comandos_manteniment}','[]'::jsonb,true);
      v_result := jsonb_set(
        v_result,'{mensaje}',
        to_jsonb(concat_ws(' ',
          nullif(v_result->>'mensaje',''),
          format('Escritura segura bloqueada: Apps Script %s no validado; %s orden(es) retenida(s).',
            coalesce(nullif(v_script_version,''),'sin versión'),
            v_retenidas_parada+v_retenidas_alta)
        )),true
      );
    else
      -- ALTA and destructive flows remain retained. Period rollover is not
      -- classified as destructive because it only fills K in the previous
      -- billing segment and creates a new period row.
      update app_private.manteniment_activo_outbox
         set estado='retenida_manual',
             ultimo_error='Retenida por escritura segura: ALTA no se modifica automáticamente.',
             actualizado_en=clock_timestamp()
       where estado='pendiente';
      get diagnostics v_retenidas_alta=row_count;

      update app_private.manteniment_parada_outbox
         set estado='retenida_manual',
             ultimo_error='Retenida por escritura segura: AV24H/reapertura puede borrar o reorganizar datos existentes.',
             actualizado_en=clock_timestamp()
       where estado='pendiente'
         and (
           coalesce(jsonb_typeof(payload->'ajuste_24h'),'null')='object'
           or coalesce((payload #>> '{reversion_t,limpiar_fecha_entrada}')::boolean,false)
           or coalesce((payload #>> '{reversion_t,limpiar_fecha_salida}')::boolean,false)
           or coalesce((payload #>> '{reversion_t,limpiar_k_parada}')::boolean,false)
         );
      get diagnostics v_retenidas_parada=row_count;

      select coalesce(jsonb_agg(cmd),'[]'::jsonb),count(*)::integer
      into v_safe_commands,v_safe_count
      from jsonb_array_elements(coalesce(v_result->'comandos_manteniment','[]'::jsonb)) cmd
      where coalesce(cmd->>'tipo','parada')<>'alta'
        and coalesce(jsonb_typeof(cmd #> '{payload,ajuste_24h}'),'null')<>'object'
        and not coalesce((cmd #>> '{payload,reversion_t,limpiar_fecha_entrada}')::boolean,false)
        and not coalesce((cmd #>> '{payload,reversion_t,limpiar_fecha_salida}')::boolean,false)
        and not coalesce((cmd #>> '{payload,reversion_t,limpiar_k_parada}')::boolean,false);

      v_result := jsonb_set(v_result,'{comandos_manteniment}',v_safe_commands,true);
      v_result := jsonb_set(
        v_result,'{mensaje}',
        to_jsonb(concat_ws(' ',
          nullif(v_result->>'mensaje',''),
          format('Escritura segura 75.25 activa: %s orden(es) apta(s); %s orden(es) destructiva(s)/ALTA retenida(s).',
            v_safe_count,v_retenidas_parada+v_retenidas_alta)
        )),true
      );
    end if;

    v_result := v_result || jsonb_build_object(
      'solo_lectura_manual_protegida',false,
      'escritura_segura_manual',true,
      'version_script_recibida',nullif(v_script_version,''),
      'version_script_validada',v_script_version=v_version_validada,
      'ordenes_retenidas',v_retenidas_parada+v_retenidas_alta,
      'ordenes_seguras',v_safe_count
    );
  end if;

  return app_private.finalizar_entrega_sync_continuidad_alpha75(v_result);
end;
$function$;

CREATE OR REPLACE FUNCTION app_private.manteniment_confirmar_comandos(p_token text, p_confirmaciones jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'app_private', 'extensions'
AS $function$
declare
  v_config app_private.manteniment_sync_config%rowtype;
  v_hash text;
  v_item jsonb;
  v_created jsonb;
  v_seguimiento_id uuid;
  v_payload jsonb;
  v_count integer := 0;
begin
  perform app_private.bloquear_sync_continuidad_alpha75();
  select * into v_config from app_private.manteniment_sync_config where id = 1;
  if not found or not v_config.token_activo or v_config.token_hash = '' then
    raise exception 'La actualización automática de MANTENIMENT no está activada';
  end if;
  v_hash := encode(extensions.digest(p_token, 'sha256'), 'hex');
  if v_hash is distinct from v_config.token_hash then raise exception 'Clave de conexión no válida'; end if;
  -- MG20: pause both directions before any side effect; missing state is closed.
  if coalesce(v_config.pausa_importacion_identidad, true) then
    raise exception using errcode = '55000',
      message = 'MG_SYNC_PAUSADA_IDENTIDAD: Sincronización detenida hasta completar la revisión de identidad; no reenviar ni confirmar órdenes.';
  end if;

  if jsonb_typeof(p_confirmaciones) <> 'array' or jsonb_array_length(p_confirmaciones) > 500 then
    raise exception 'Las confirmaciones no tienen un formato válido';
  end if;

  perform set_config('app.manteniment_importando_altas', '1', true);
  perform set_config('app.manteniment_importando_paradas', '1', true);
  for v_item in select value from jsonb_array_elements(p_confirmaciones)
  loop
    if coalesce(v_item->>'estado', '') <> 'aplicado' then continue; end if;

    if coalesce(v_item->>'tipo', 'parada') = 'alta' then
      update app_private.manteniment_activo_outbox o
      set estado = 'confirmado', confirmado_en = clock_timestamp(), intentos = intentos + 1
      where o.vehiculo_id = (v_item->>'vehiculo_id')::uuid
        and o.revision = (v_item->>'revision')::integer
        and o.estado = 'pendiente';
      if found then
        update public.vehiculos
        set fuente_manteniment_fila = nullif(v_item->>'fila', '')::integer,
            fuente_manteniment_actualizado_en = clock_timestamp()
        where id = (v_item->>'vehiculo_id')::uuid;
        v_count := v_count + 1;
      end if;
    else
      if app_private.confirmar_entrega_sync_continuidad_alpha75(v_item) then
        v_count := v_count + 1;
      end if;
    end if;
  end loop;
  perform set_config('app.manteniment_importando_paradas', '0', true);
  perform set_config('app.manteniment_importando_altas', '0', true);
  return jsonb_build_object('ok', true, 'confirmados', v_count);
end;
$function$;

CREATE OR REPLACE FUNCTION app_private.manteniment_preflight_solo_lectura(p_token text, p_cliente jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  v_config record;
  v_wrapper oid;
  v_receptor oid;
  v_wrapper_sha text;
  v_receptor_sha text;
  v_receptor_ok boolean := false;
  v_archivo_ok boolean := false;
  v_barreras_ok boolean := false;
  v_compatible boolean := false;
  v_motivos jsonb := '[]'::jsonb;
  v_version_script constant text := 'alpha75-2026.10.26.1';
  v_version_preflight constant text := 'alpha75-preflight-2026.10.27.1';
begin
  -- La configuración es privada. SECURITY DEFINER solo permite esta lectura;
  -- ambas funciones están restringidas a service_role y exigen el token activo.
  select token_activo, token_hash, spreadsheet_id,
         solo_lectura_manual_protegida, escritura_segura_manual,
         pausa_importacion_identidad
    into v_config
    from app_private.manteniment_sync_config
   where id = 1;

  if not found
     or v_config.token_activo is distinct from true
     or coalesce(v_config.token_hash, '') !~ '^[0-9a-f]{64}$'
     or coalesce(p_token, '') !~* '^mg_[0-9a-f]{64}$'
     or encode(extensions.digest(p_token, 'sha256'), 'hex')
        is distinct from v_config.token_hash then
    raise exception using errcode = '28000',
      message = 'Clave de conexión no válida.';
  end if;

  if jsonb_typeof(p_cliente) is distinct from 'object' then
    raise exception using errcode = '22023',
      message = 'Metadatos de comprobación no válidos.';
  end if;
  if exists (
       select 1 from jsonb_object_keys(p_cliente) as k(key)
        where k.key not in ('version_script', 'version_preflight',
                            'escritura_segura_manual', 'spreadsheet_id')
     )
     or jsonb_typeof(p_cliente->'version_script') is distinct from 'string'
     or jsonb_typeof(p_cliente->'version_preflight') is distinct from 'string'
     or jsonb_typeof(p_cliente->'spreadsheet_id') is distinct from 'string'
     or jsonb_typeof(p_cliente->'escritura_segura_manual') is distinct from 'boolean'
     or (p_cliente->>'version_script') !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$'
     or (p_cliente->>'version_preflight') !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$'
     or (p_cliente->>'spreadsheet_id') !~ '^[A-Za-z0-9_-]{20,150}$'
     or (p_cliente->>'version_script') ~* 'mg_[0-9a-f]{64}'
     or (p_cliente->>'version_preflight') ~* 'mg_[0-9a-f]{64}' then
    raise exception using errcode = '22023',
      message = 'Metadatos de comprobación no válidos.';
  end if;

  -- Solo catálogo: nunca se ejecutan receptor, importador ni confirmador.
  v_wrapper := to_regprocedure('public.recibir_snapshot_manteniment(text,jsonb)');
  v_receptor := to_regprocedure('app_private.recibir_snapshot_manteniment_7525(text,jsonb)');
  if v_wrapper is not null and v_receptor is not null then
    v_wrapper_sha := encode(extensions.digest(pg_get_functiondef(v_wrapper), 'sha256'), 'hex');
    v_receptor_sha := encode(extensions.digest(pg_get_functiondef(v_receptor), 'sha256'), 'hex');
    v_receptor_ok := coalesce(
      v_wrapper_sha = '2e7bd5cb02bb5f582b9eaa241cc7d2db8b36879fe8b048de71e150aeee9defbd'
      and v_receptor_sha = 'b10b16415091dcb8e62801adb54ad63ed26d053a4ddf33cebb1ad2eee4a948e4'
      and not has_function_privilege('anon', v_wrapper, 'EXECUTE')
      and not has_function_privilege('authenticated', v_wrapper, 'EXECUTE')
      and has_function_privilege('service_role', v_wrapper, 'EXECUTE')
      and not has_function_privilege('anon', v_receptor, 'EXECUTE')
      and not has_function_privilege('authenticated', v_receptor, 'EXECUTE')
      and has_function_privilege('service_role', v_receptor, 'EXECUTE'), false
    );
  end if;

  v_archivo_ok := coalesce(
    nullif(v_config.spreadsheet_id, '') = p_cliente->>'spreadsheet_id', false
  );
  v_barreras_ok := v_config.solo_lectura_manual_protegida is true
    and v_config.escritura_segura_manual is false
    and v_config.pausa_importacion_identidad is true;
  v_compatible := (p_cliente->>'version_script') = v_version_script
    and (p_cliente->>'version_preflight') = v_version_preflight
    and p_cliente->'escritura_segura_manual' = 'true'::jsonb
    and v_archivo_ok and v_receptor_ok;

  if p_cliente->>'version_script' <> v_version_script then
    v_motivos := v_motivos || '["VERSION_SCRIPT_DISTINTA"]'::jsonb;
  end if;
  if p_cliente->>'version_preflight' <> v_version_preflight then
    v_motivos := v_motivos || '["VERSION_PREFLIGHT_DISTINTA"]'::jsonb;
  end if;
  if p_cliente->'escritura_segura_manual' <> 'true'::jsonb then
    v_motivos := v_motivos || '["CLIENTE_SIN_ESCRITURA_SEGURA"]'::jsonb;
  end if;
  if not v_archivo_ok then
    v_motivos := v_motivos || '["ARCHIVO_DISTINTO"]'::jsonb;
  end if;
  if not v_receptor_ok then
    v_motivos := v_motivos || '["RECEPTOR_NO_VERIFICADO"]'::jsonb;
  end if;
  if not v_barreras_ok then
    v_motivos := v_motivos || '["BARRERAS_NO_CERRADAS"]'::jsonb;
  end if;

  return jsonb_build_object(
    'protocolo', 'manteniment-preflight-v1',
    'version_preflight', v_version_preflight,
    'solo_lectura', true,
    'compatible', v_compatible,
    'version_script_recibida', p_cliente->>'version_script',
    'version_script_esperada', v_version_script,
    'version_preflight_recibida', p_cliente->>'version_preflight',
    'cliente_escritura_segura_manual', p_cliente->'escritura_segura_manual',
    'archivo_coincide', v_archivo_ok,
    'receptor_coincide', v_receptor_ok,
    'barreras', jsonb_build_object(
      'solo_lectura_manual_protegida', v_config.solo_lectura_manual_protegida,
      'escritura_segura_manual', v_config.escritura_segura_manual,
      'pausa_importacion_identidad', v_config.pausa_importacion_identidad
    ),
    'barreras_cerradas', v_barreras_ok,
    'sincronizacion_autorizada', false,
    'motivos', v_motivos
  );
end;
$function$;

-- The private functions are callable only by the owning routines/service role.
REVOKE ALL ON FUNCTION app_private.hash_payload_sync_continuidad_alpha75(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION app_private.hash_payload_sync_continuidad_alpha75(jsonb) TO service_role;
REVOKE ALL ON FUNCTION app_private.registrar_origen_sync_continuidad_alpha75() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION app_private.registrar_origen_sync_continuidad_alpha75() TO service_role;
REVOKE ALL ON FUNCTION app_private.validar_sync_continuidad_alpha75(uuid[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION app_private.validar_sync_continuidad_alpha75(uuid[]) TO service_role;
REVOKE ALL ON FUNCTION app_private.payload_solo_trabajos_continuidad_alpha75(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION app_private.payload_solo_trabajos_continuidad_alpha75(jsonb) TO service_role;
REVOKE ALL ON FUNCTION app_private.proteger_outbox_continuidad_alpha75() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION app_private.proteger_outbox_continuidad_alpha75() TO service_role;
REVOKE ALL ON FUNCTION app_private.encolar_trabajos_continuidad_alpha75(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION app_private.encolar_trabajos_continuidad_alpha75(uuid) TO service_role;
REVOKE ALL ON FUNCTION app_private.finalizar_entrega_sync_continuidad_alpha75(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION app_private.finalizar_entrega_sync_continuidad_alpha75(jsonb) TO service_role;
REVOKE ALL ON FUNCTION app_private.confirmar_entrega_sync_continuidad_alpha75(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION app_private.confirmar_entrega_sync_continuidad_alpha75(jsonb) TO service_role;

-- Closed-period snapshots use the same J/K legacy representation and may have
-- no sync_id. Match either its canonical sync identity or the explicit PA/DFM
-- pair from the private ledger; never a DFM alone or a spreadsheet row number.
CREATE FUNCTION app_private.seguimientos_cierre_continuidad_alpha75(p_item jsonb)
RETURNS uuid[] LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,app_private AS $function$
  SELECT coalesce(array_agg(DISTINCT q.seguimiento_id),'{}'::uuid[]) FROM (
    SELECT s.seguimiento_id FROM app_private.manteniment_parada_sync s
      WHERE s.sync_id::text=lower(btrim(coalesce(p_item->>'sync_id','')))
        AND app_private.seguimiento_con_continuidad_sustitucion_alpha75(s.seguimiento_id)
    UNION ALL
    SELECT c.origen_seguimiento_id FROM app_private.sustitucion_continuidades_alpha75 c
      WHERE app_private.normalizar_dfm_continuidad_alpha75(p_item->>'dfm')=c.afectado_dfm
        AND regexp_replace(regexp_replace(upper(btrim(coalesce(p_item->>'numero_parada',''))),'[[:space:]]+','','g'),'^PA-?','')
          =regexp_replace(regexp_replace(upper(btrim(c.origen_numero_parada)),'[[:space:]]+','','g'),'^PA-?','')
    UNION ALL
    SELECT c.destino_seguimiento_id FROM app_private.sustitucion_continuidades_alpha75 c
      WHERE app_private.normalizar_dfm_continuidad_alpha75(p_item->>'dfm')=c.afectado_dfm
        AND regexp_replace(regexp_replace(upper(btrim(coalesce(p_item->>'numero_parada',''))),'[[:space:]]+','','g'),'^PA-?','')
          =regexp_replace(regexp_replace(upper(btrim(c.destino_numero_parada)),'[[:space:]]+','','g'),'^PA-?','')
  ) q;
$function$;

CREATE TABLE app_private.manteniment_cierres_retenidos_continuidad_alpha75 (
  payload_sha256 text PRIMARY KEY,
  seguimientos uuid[] NOT NULL CHECK(cardinality(seguimientos)>0),
  payload jsonb NOT NULL,
  primera_recepcion_en timestamptz NOT NULL DEFAULT clock_timestamp(),
  ultima_recepcion_en timestamptz NOT NULL DEFAULT clock_timestamp(),
  recepciones integer NOT NULL DEFAULT 1 CHECK(recepciones>0),
  motivo text NOT NULL DEFAULT 'TANCAMENT vinculado: el snapshot J/K requiere reconciliar la continuidad entre PA',
  CHECK(payload_sha256=app_private.hash_payload_sync_continuidad_alpha75(payload))
);
ALTER TABLE app_private.manteniment_cierres_retenidos_continuidad_alpha75 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON app_private.manteniment_cierres_retenidos_continuidad_alpha75 FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION app_private.seguimientos_cierre_continuidad_alpha75(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION app_private.seguimientos_cierre_continuidad_alpha75(jsonb) TO service_role;

CREATE OR REPLACE FUNCTION app_private.manteniment_importar_cierres_facturacion(p_cierres jsonb, p_generado_en timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'app_private'
AS $function$
declare
  v_item jsonb;
  v_sync_id uuid;
  v_seguimiento_id uuid;
  v_tancament text;
  v_periodo public.cierres_facturacion%rowtype;
  v_fecha_i date;
  v_fecha_j date;
  v_fecha_k date;
  v_dias integer;
  v_km numeric;
  v_source_key text;
  v_count integer := 0;
  v_retenidos integer := 0;
  v_vinculados uuid[];
begin
  perform app_private.bloquear_sync_continuidad_alpha75();
  if p_cierres is null then
    return jsonb_build_object('recibidos',0,'actualizados',0,'retenidos_continuidad',0);
  end if;
  if jsonb_typeof(p_cierres) <> 'array' then
    raise exception 'cierres_facturacion debe ser un array JSON';
  end if;
  if jsonb_array_length(p_cierres) > 2500 then
    raise exception 'cierres_facturacion supera el máximo de 2500 filas';
  end if;

  create temp table if not exists tmp_facturacion_tancament_keys (
    source_key text primary key,
    periodo text not null
  ) on commit drop;
  truncate tmp_facturacion_tancament_keys;

  for v_item in select value from jsonb_array_elements(p_cierres)
  loop
    if upper(btrim(coalesce(v_item->>'estado',''))) <> 'PARADA' then
      continue;
    end if;

    v_vinculados:=app_private.seguimientos_cierre_continuidad_alpha75(v_item);
    if cardinality(v_vinculados)>0 then
      insert into app_private.manteniment_cierres_retenidos_continuidad_alpha75(payload_sha256,seguimientos,payload)
      values(app_private.hash_payload_sync_continuidad_alpha75(v_item),v_vinculados,v_item)
      on conflict(payload_sha256) do update set ultima_recepcion_en=clock_timestamp(),
        recepciones=manteniment_cierres_retenidos_continuidad_alpha75.recepciones+1;
      v_retenidos:=v_retenidos+1;
      continue;
    end if;

    v_tancament := upper(btrim(coalesce(v_item->>'tancament','')));
    if v_tancament !~ '^TANCAMENT [0-9]+$' then
      raise exception 'TANCAMENT no válido en fila %: %',
        coalesce(v_item->>'fila','?'), v_item->>'tancament';
    end if;

    v_fecha_i := nullif(v_item->>'fecha_programada','')::date;
    v_fecha_j := nullif(v_item->>'fecha_parada','')::date;
    v_fecha_k := nullif(v_item->>'fecha_k','')::date;
    if v_fecha_j is null then
      raise exception 'El cierre de la fila % requiere J',
        coalesce(v_item->>'fila','?');
    end if;

    -- J identifica el tramo y desambigua el año. Si K sigue vacía porque la
    -- recuperación física aún no existe, el cierre contable usa el último día
    -- del periodo, exactamente como TANCAMENT.
    select c.* into v_periodo
    from public.cierres_facturacion c
    where v_fecha_j between c.fecha_inicio and c.fecha_cierre
      and v_tancament =
        'TANCAMENT ' || (split_part(c.periodo,'-',2)::integer)::text
    order by c.fecha_inicio desc
    limit 1;
    if not found then
      if v_fecha_j < (select min(c.fecha_inicio) from public.cierres_facturacion c) then
        -- Histórico anterior al calendario de cierres configurado: se conserva
        -- en MANTENIMENT pero no se incorpora a esta capa contable.
        continue;
      end if;
      raise exception 'No se puede resolver el periodo de % / J=% en fila %',
        v_tancament, v_fecha_j, coalesce(v_item->>'fila','?');
    end if;

    if v_fecha_k is null and v_periodo.fecha_cierre >= (now() at time zone 'Europe/Madrid')::date then
      -- Periodo todavía abierto: no se congela en el histórico contable.
      continue;
    end if;
    v_fecha_k := coalesce(v_fecha_k, v_periodo.fecha_cierre);
    if v_fecha_k < v_fecha_j or v_fecha_k > v_periodo.fecha_cierre then
      raise exception 'Fin contable inválido en fila %: J=% K=% cierre=%',
        coalesce(v_item->>'fila','?'), v_fecha_j, v_fecha_k, v_periodo.fecha_cierre;
    end if;

    v_dias := nullif(v_item->>'dias_parada','')::integer;
    v_km := nullif(v_item->>'km_facturables','')::numeric;
    if v_dias is not null and v_dias < 0 then
      raise exception 'Días negativos en cierre de fila %', coalesce(v_item->>'fila','?');
    end if;
    if v_km is not null and v_km < 0 then
      raise exception 'KM negativos en cierre de fila %', coalesce(v_item->>'fila','?');
    end if;

    v_sync_id := case
      when coalesce(v_item->>'sync_id','') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then (v_item->>'sync_id')::uuid
      else null
    end;
    v_seguimiento_id := null;
    if v_sync_id is not null then
      select s.seguimiento_id into v_seguimiento_id
      from app_private.manteniment_parada_sync s
      where s.sync_id = v_sync_id;
    end if;

    if v_sync_id is not null then
      v_source_key := concat_ws('|',
        'SYNC',v_sync_id::text,v_periodo.periodo,
        v_fecha_j::text,
        upper(btrim(coalesce(v_item->>'sustituto','')))
      );
    else
      v_source_key := concat_ws('|',
        'MANTENIMENT',
        regexp_replace(upper(btrim(coalesce(v_item->>'dfm',''))),'[[:space:]]+','','g'),
        regexp_replace(upper(btrim(coalesce(v_item->>'matricula',''))),'[[:space:]]+','','g'),
        upper(btrim(coalesce(v_item->>'numero_parada',''))),
        upper(btrim(coalesce(v_item->>'sustituto',''))),
        v_periodo.periodo,
        v_fecha_j::text,
        coalesce(v_fecha_i,v_fecha_j)::text
      );
    end if;

    insert into public.facturacion_tancament_cierres (
      source_key,sync_id,seguimiento_id,fila_manteniment,
      dfm,matricula,numero_parada,sustituto,tancament,periodo,
      fecha_programada,fecha_inicio_tramo,fecha_fin_tramo,
      dias_facturables,km_facturables,marca,presente_en_manteniment,
      payload_hash,capturado_en,actualizado_en
    ) values (
      v_source_key,v_sync_id,v_seguimiento_id,
      nullif(v_item->>'fila','')::integer,
      btrim(coalesce(v_item->>'dfm','')),
      btrim(coalesce(v_item->>'matricula','')),
      nullif(btrim(coalesce(v_item->>'numero_parada','')),''),
      nullif(btrim(coalesce(v_item->>'sustituto','')),''),
      v_tancament,v_periodo.periodo,
      v_fecha_i,v_fecha_j,v_fecha_k,
      v_dias,v_km,nullif(btrim(coalesce(v_item->>'marca','')),''),
      true,md5(v_item::text),coalesce(p_generado_en,now()),now()
    )
    on conflict (source_key) do update
    set sync_id=excluded.sync_id,
        seguimiento_id=coalesce(excluded.seguimiento_id,public.facturacion_tancament_cierres.seguimiento_id),
        fila_manteniment=excluded.fila_manteniment,
        dfm=excluded.dfm,
        matricula=excluded.matricula,
        numero_parada=excluded.numero_parada,
        sustituto=excluded.sustituto,
        tancament=excluded.tancament,
        periodo=excluded.periodo,
        fecha_programada=excluded.fecha_programada,
        fecha_inicio_tramo=excluded.fecha_inicio_tramo,
        fecha_fin_tramo=excluded.fecha_fin_tramo,
        dias_facturables=excluded.dias_facturables,
        km_facturables=excluded.km_facturables,
        marca=excluded.marca,
        presente_en_manteniment=true,
        payload_hash=excluded.payload_hash,
        actualizado_en=now();

    insert into tmp_facturacion_tancament_keys(source_key,periodo)
    values (v_source_key,v_periodo.periodo)
    on conflict (source_key) do nothing;

    v_count := v_count + 1;
  end loop;

  update public.facturacion_tancament_cierres f
  set presente_en_manteniment=false,
      actualizado_en=now()
  where f.periodo in (select distinct periodo from tmp_facturacion_tancament_keys)
    and f.presente_en_manteniment
    and not app_private.seguimiento_con_continuidad_sustitucion_alpha75(f.seguimiento_id)
    and cardinality(app_private.seguimientos_cierre_continuidad_alpha75(to_jsonb(f)))=0
    and not exists (
      select 1 from tmp_facturacion_tancament_keys k
      where k.source_key=f.source_key
    );

  return jsonb_build_object('recibidos',jsonb_array_length(p_cierres),'actualizados',v_count,'retenidos_continuidad',v_retenidos);
end;
$function$;

COMMIT;
