-- SINCRO 13 · receptor PRIVADO de recibos de nuevas T.
-- CANDIDATA NO DESPLEGADA. Nunca modifica MANTENIMENT, TANCAMENT,
-- mg9_filas_identidad, outbox ni objetos de Hotel.
-- Recibo técnico ≠ prueba independiente de Google ≠ autoría humana.
BEGIN;

CREATE TABLE IF NOT EXISTS app_private.sincro13_lotes_t (
  orden_sync_id uuid NOT NULL,
  orden_revision integer NOT NULL CHECK (orden_revision > 0),
  spreadsheet_id text NOT NULL,
  request_id uuid NOT NULL UNIQUE,
  payload_sha256 text NOT NULL CHECK (payload_sha256 ~ '^[0-9a-f]{64}$'),
  huella_lote text NOT NULL CHECK (huella_lote ~ '^[0-9a-f]{64}$'),
  cantidad integer NOT NULL CHECK (cantidad BETWEEN 1 AND 8),
  recibido_en timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (orden_sync_id, orden_revision)
);
CREATE TABLE IF NOT EXISTS app_private.sincro13_recibos_t (
  spreadsheet_id text NOT NULL,
  id_fila bigint NOT NULL CHECK (id_fila BETWEEN 1 AND 9007199254740991),
  trabajo_sync_id uuid NOT NULL,
  orden_sync_id uuid NOT NULL,
  orden_revision integer NOT NULL,
  asignado_en timestamptz NOT NULL,
  origen text NOT NULL DEFAULT 'ORDEN_AUTORIZADA'
    CHECK (origen = 'ORDEN_AUTORIZADA'),
  estado text NOT NULL DEFAULT 'PENDIENTE_VERIFICACION_GOOGLE'
    CHECK (estado = 'PENDIENTE_VERIFICACION_GOOGLE'),
  recibido_en timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (spreadsheet_id, id_fila),
  UNIQUE (spreadsheet_id, trabajo_sync_id),
  FOREIGN KEY (orden_sync_id, orden_revision)
    REFERENCES app_private.sincro13_lotes_t(orden_sync_id, orden_revision)
    ON DELETE RESTRICT
);

ALTER TABLE app_private.sincro13_lotes_t ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_private.sincro13_recibos_t ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON app_private.sincro13_lotes_t FROM PUBLIC, anon, authenticated;
REVOKE ALL ON app_private.sincro13_recibos_t FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION app_private.sincro13_registrar_recibo_t(
  p_token text, p_solicitud jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO pg_catalog
AS $s13$
DECLARE
  v_config record;
  v_entrega app_private.manteniment_entregas_continuidad_alpha75%rowtype;
  v_trabajo app_private.manteniment_t_trabajos%rowtype;
  v_ref jsonb; v_r jsonb; v_work jsonb;
  v_orden uuid; v_revision integer; v_t bigint; v_uuid uuid;
  v_fecha timestamptz; v_huella text; v_cantidad integer;
  v_n integer; v_lote app_private.sincro13_lotes_t%rowtype;
  v_recibo app_private.sincro13_recibos_t%rowtype;
  v_corte constant timestamptz := timestamptz '2026-11-15 23:00:00+00';
BEGIN
  SELECT token_activo, token_hash, spreadsheet_id INTO v_config
  FROM app_private.manteniment_sync_config WHERE id=1;
  IF NOT FOUND OR v_config.token_activo IS DISTINCT FROM true
    OR coalesce(v_config.token_hash, '') !~ '^[0-9a-f]{64}$'
    OR coalesce(p_token, '') !~* '^mg_[0-9a-f]{64}$'
    OR encode(extensions.digest(p_token, 'sha256'), 'hex') IS DISTINCT FROM v_config.token_hash
  THEN RAISE EXCEPTION USING ERRCODE='28000', MESSAGE='S13_AUTH_DENEGADA'; END IF;

  IF jsonb_typeof(p_solicitud) IS DISTINCT FROM 'object'
    OR NOT (p_solicitud ?& ARRAY['version_ejecucion','spreadsheet_id','request_id','orden','recibos'])
    OR (SELECT count(*) FROM jsonb_object_keys(p_solicitud)) <> 5
    OR p_solicitud->>'version_ejecucion' IS DISTINCT FROM 'MG75-EJECUCION-ORDEN-001'
    OR p_solicitud->>'spreadsheet_id' IS DISTINCT FROM v_config.spreadsheet_id
    OR coalesce(p_solicitud->>'request_id','') !~*
      '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    OR jsonb_typeof(p_solicitud->'recibos') IS DISTINCT FROM 'array'
    OR jsonb_typeof(p_solicitud->'orden') IS DISTINCT FROM 'object'
  THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='S13_SOBRE_INVALIDO'; END IF;

  v_cantidad := jsonb_array_length(p_solicitud->'recibos');
  IF v_cantidad NOT BETWEEN 1 AND 8 THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='S13_CANTIDAD_INVALIDA';
  END IF;

  v_ref := p_solicitud->'orden';
  IF NOT app_private.referencia_ejecucion_manteniment_valida(v_ref)
    OR v_ref->>'tipo' NOT IN ('trabajos','parada')
  THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='S13_ORDEN_INVALIDA'; END IF;
  v_orden := (v_ref->>'sync_id')::uuid;
  v_revision := (v_ref->>'revision')::integer;

  -- Bloqueo de lectura para que ACK/entrega no cambien a mitad de este cotejo.
  -- No se actualiza ni se confirma aquí ninguna orden operativa.
  SELECT * INTO v_entrega
  FROM app_private.manteniment_entregas_continuidad_alpha75
  WHERE sync_id = v_orden AND revision = v_revision
  FOR UPDATE;
  IF NOT FOUND
    OR v_entrega.origen IS DISTINCT FROM 'entrega'
    OR v_entrega.entregado_en IS NULL OR v_entrega.entregado_en < v_corte
    OR v_entrega.tipo IS DISTINCT FROM v_ref->>'tipo'
    OR v_entrega.payload_sha256 IS DISTINCT FROM v_ref->>'payload_sha256'
    OR v_entrega.payload_sha256 IS DISTINCT FROM
       encode(sha256(convert_to(v_entrega.payload::text, 'UTF8')), 'hex')
    OR jsonb_typeof(v_entrega.payload->'trabajos_crear') IS DISTINCT FROM 'array'
  THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='S13_ENTREGA_NO_ACREDITADA'; END IF;

  v_huella := encode(sha256(convert_to((p_solicitud-'request_id')::text,'UTF8')),'hex');

  FOR v_r IN SELECT value FROM jsonb_array_elements(p_solicitud->'recibos') LOOP
    IF jsonb_typeof(v_r) IS DISTINCT FROM 'object'
      OR NOT (v_r ?& ARRAY['id_fila','trabajo_sync_id','creado_en','origen','estado'])
      OR (SELECT count(*) FROM jsonb_object_keys(v_r)) <> 5
      OR jsonb_typeof(v_r->'id_fila') IS DISTINCT FROM 'number'
      OR coalesce(v_r->>'id_fila','') !~ '^[1-9][0-9]{0,15}$'
      OR coalesce(v_r->>'trabajo_sync_id','') !~*
         '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      OR coalesce(v_r->>'creado_en','') !~
         '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$'
      OR v_r->>'origen' IS DISTINCT FROM 'ORDEN_AUTORIZADA'
      OR v_r->>'estado' IS DISTINCT FROM 'PENDIENTE_COTEJO_OBJETO'
    THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='S13_RECIBO_INVALIDO'; END IF;

    v_t := (v_r->>'id_fila')::bigint;
    IF v_t NOT BETWEEN 1 AND 9007199254740991 THEN
      RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='S13_T_INVALIDA';
    END IF;
    v_uuid := (v_r->>'trabajo_sync_id')::uuid;
    v_fecha := (v_r->>'creado_en')::timestamptz;
    IF to_char(v_fecha AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
         IS DISTINCT FROM v_r->>'creado_en'
       OR v_fecha < v_corte OR v_fecha > clock_timestamp() + interval '5 minutes'
    THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='S13_FECHA_INVALIDA'; END IF;

    SELECT count(*), max(x.item) INTO v_n, v_work
    FROM jsonb_array_elements(v_entrega.payload->'trabajos_crear') AS x(item)
    WHERE x.item->>'trabajo_sync_id' = v_uuid::text;
    IF v_n <> 1 OR v_work->>'trabajo_sync_id' IS NULL
       OR v_work->>'trabajo_hotel_id' IS NULL
       OR v_work->>'retener_propuesta' = 'true'
       OR upper(btrim(coalesce(v_work->>'dfm',''))) = 'R1515'
    THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='S13_TRABAJO_NO_ACREDITADO'; END IF;

    SELECT * INTO v_trabajo
    FROM app_private.manteniment_t_trabajos WHERE sync_id = v_uuid;
    IF NOT FOUND OR v_trabajo.trabajo_hotel_id IS NULL
      OR v_trabajo.trabajo_hotel_id::text IS DISTINCT FROM v_work->>'trabajo_hotel_id'
      OR v_trabajo.seguimiento_id IS DISTINCT FROM v_entrega.seguimiento_id
    THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='S13_DESTINO_INCONSISTENTE'; END IF;
  END LOOP;

  -- Una orden futura tiene como máximo UN lote T; un reintento idéntico no
  -- duplica la emisión. Request ID reutilizado para otra orden es inválido.
  INSERT INTO app_private.sincro13_lotes_t
    (orden_sync_id,orden_revision,spreadsheet_id,request_id,payload_sha256,huella_lote,cantidad)
  VALUES
    (v_orden,v_revision,v_config.spreadsheet_id,(p_solicitud->>'request_id')::uuid,
     v_ref->>'payload_sha256',v_huella,v_cantidad)
  ON CONFLICT (orden_sync_id,orden_revision) DO NOTHING;

  SELECT * INTO v_lote FROM app_private.sincro13_lotes_t
  WHERE orden_sync_id=v_orden AND orden_revision=v_revision FOR UPDATE;
  IF NOT FOUND OR v_lote.spreadsheet_id IS DISTINCT FROM v_config.spreadsheet_id
    OR v_lote.payload_sha256 IS DISTINCT FROM v_ref->>'payload_sha256'
    OR v_lote.huella_lote IS DISTINCT FROM v_huella OR v_lote.cantidad <> v_cantidad
  THEN RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='S13_LOTE_CONTRADICTORIO'; END IF;

  FOR v_r IN SELECT value FROM jsonb_array_elements(p_solicitud->'recibos') LOOP
    v_t := (v_r->>'id_fila')::bigint;
    v_uuid := (v_r->>'trabajo_sync_id')::uuid;
    v_fecha := (v_r->>'creado_en')::timestamptz;
    INSERT INTO app_private.sincro13_recibos_t
      (spreadsheet_id,id_fila,trabajo_sync_id,orden_sync_id,orden_revision,asignado_en)
    VALUES (v_config.spreadsheet_id,v_t,v_uuid,v_orden,v_revision,v_fecha)
    ON CONFLICT (spreadsheet_id,id_fila) DO NOTHING;

    SELECT * INTO v_recibo FROM app_private.sincro13_recibos_t
    WHERE spreadsheet_id=v_config.spreadsheet_id AND id_fila=v_t FOR UPDATE;
    IF NOT FOUND OR v_recibo.trabajo_sync_id IS DISTINCT FROM v_uuid
      OR v_recibo.orden_sync_id IS DISTINCT FROM v_orden
      OR v_recibo.orden_revision IS DISTINCT FROM v_revision
      OR v_recibo.asignado_en IS DISTINCT FROM v_fecha
      OR v_recibo.estado IS DISTINCT FROM 'PENDIENTE_VERIFICACION_GOOGLE'
    THEN RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='S13_RECIBO_CONTRADICTORIO'; END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'protocolo','sincro13-recibos-nuevos-v1',
    'request_id',p_solicitud->'request_id',
    'spreadsheet_id',p_solicitud->'spreadsheet_id',
    'recibidos',v_cantidad,
    'estado','PENDIENTE_VERIFICACION_GOOGLE',
    'autoriza_sincronizar',false);
END;
$s13$;

REVOKE ALL ON FUNCTION app_private.sincro13_registrar_recibo_t(text,jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app_private.sincro13_registrar_recibo_t(text,jsonb)
  TO service_role;

-- Invoker público, concedido ÚNICAMENTE al rol interno de la Edge Function.
-- No exponer una función SECURITY DEFINER directamente en public.
CREATE OR REPLACE FUNCTION public.sincro13_registrar_recibo_t(
  p_token text,p_solicitud jsonb
) RETURNS jsonb LANGUAGE sql SECURITY INVOKER
SET search_path TO pg_catalog
AS $wrapper$
  SELECT app_private.sincro13_registrar_recibo_t(p_token,p_solicitud);
$wrapper$;
REVOKE ALL ON FUNCTION public.sincro13_registrar_recibo_t(text,jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sincro13_registrar_recibo_t(text,jsonb)
  TO service_role;
COMMIT;
