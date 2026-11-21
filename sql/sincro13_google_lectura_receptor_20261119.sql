-- SINCRO13 · CANDIDATA SIN DESPLEGAR.
-- Receptor de observación Google emitida SOLO por el lector independiente.
-- Nunca identifica al editor original, no actualiza Hotel ni MANTENIMENT.
-- NO habilitar hasta configurar secreto exclusivo y OAuth Google solo lectura.
BEGIN;

CREATE TABLE IF NOT EXISTS app_private.sincro13_verificador_config (
 id smallint PRIMARY KEY CHECK (id=1),
 habilitado boolean NOT NULL DEFAULT false,
 secreto_sha256 text CHECK (secreto_sha256 ~ '^[0-9a-f]{64}$'),
 actualizado_en timestamptz NOT NULL DEFAULT clock_timestamp()
);
INSERT INTO app_private.sincro13_verificador_config(id,habilitado,secreto_sha256)
VALUES (1,false,NULL) ON CONFLICT (id) DO NOTHING;
ALTER TABLE app_private.sincro13_verificador_config ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON app_private.sincro13_verificador_config FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION app_private.sincro13_recibir_lectura_google_k(
 p_clave text,p_lectura jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO pg_catalog
AS $s13lect$
DECLARE
 cfg app_private.sincro13_verificador_config%rowtype;
 sc record;
 rec app_private.sincro13_recibos_t%rowtype;
 entregada app_private.manteniment_entregas_continuidad_alpha75%rowtype;
 trabajo app_private.manteniment_t_trabajos%rowtype;
 ex app_private.sincro13_k_evidencias%rowtype;
 v_t bigint; v_work uuid; v_req uuid; v_date date;
 v_stamp timestamptz; v_hash text;
 v_corte constant timestamptz:=timestamptz '2026-11-15 23:00:00+00';
BEGIN
 SELECT * INTO cfg FROM app_private.sincro13_verificador_config WHERE id=1;
 IF NOT FOUND OR cfg.habilitado IS DISTINCT FROM true
   OR coalesce(cfg.secreto_sha256,'') !~ '^[0-9a-f]{64}$'
   OR coalesce(p_clave,'') !~ '^s13g_[0-9a-f]{64}$'
   OR encode(extensions.digest(p_clave,'sha256'),'hex') IS DISTINCT FROM cfg.secreto_sha256
 THEN RAISE EXCEPTION USING ERRCODE='28000',MESSAGE='S13_LECTOR_NO_AUTORIZADO'; END IF;

 IF jsonb_typeof(p_lectura) IS DISTINCT FROM 'object'
 OR NOT (p_lectura ?& ARRAY[
  'protocolo','solicitud_id','spreadsheet_id','id_fila','trabajo_sync_id',
  'columna','valor_nuevo','observado_en','lecturas_independientes',
  'editor_google_acreditado','escritura_realizada'])
 OR (SELECT count(*) FROM jsonb_object_keys(p_lectura))<>11
 OR p_lectura->>'protocolo' IS DISTINCT FROM 'sincro13-google-k-lectura-v1'
 OR p_lectura->>'columna' IS DISTINCT FROM 'K'
 OR p_lectura->'lecturas_independientes' IS DISTINCT FROM '2'::jsonb
 OR p_lectura->'editor_google_acreditado' IS DISTINCT FROM 'false'::jsonb
 OR p_lectura->'escritura_realizada' IS DISTINCT FROM 'false'::jsonb
 OR jsonb_typeof(p_lectura->'id_fila') IS DISTINCT FROM 'number'
 OR coalesce(p_lectura->>'id_fila','') !~ '^[1-9][0-9]{0,15}$'
 OR coalesce(p_lectura->>'solicitud_id','') !~
  '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
 OR coalesce(p_lectura->>'trabajo_sync_id','') !~
  '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
 OR coalesce(p_lectura->>'valor_nuevo','') !~
  '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
 OR coalesce(p_lectura->>'observado_en','') !~
  '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$'
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='S13_LECTURA_INVALIDA'; END IF;

 v_t:=(p_lectura->>'id_fila')::bigint;
 v_req:=(p_lectura->>'solicitud_id')::uuid;
 v_work:=(p_lectura->>'trabajo_sync_id')::uuid;
 v_date:=(p_lectura->>'valor_nuevo')::date;
 v_stamp:=(p_lectura->>'observado_en')::timestamptz;
 IF v_t>9007199254740991
  OR to_char(v_date,'YYYY-MM-DD') IS DISTINCT FROM p_lectura->>'valor_nuevo'
  OR to_char(v_stamp AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
     IS DISTINCT FROM p_lectura->>'observado_en'
  OR v_stamp < clock_timestamp()-interval '90 seconds'
  OR v_stamp > clock_timestamp()+interval '5 seconds'
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='S13_LECTURA_CADUCADA_O_INVALIDA'; END IF;

 SELECT spreadsheet_id INTO sc FROM app_private.manteniment_sync_config WHERE id=1;
 IF NOT FOUND OR p_lectura->>'spreadsheet_id' IS DISTINCT FROM sc.spreadsheet_id
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='S13_HOJA_NO_AUTORIZADA'; END IF;

 -- Receipt T de una orden futura existente. No crear T ni deducirla.
 SELECT * INTO rec FROM app_private.sincro13_recibos_t
 WHERE spreadsheet_id=sc.spreadsheet_id AND id_fila=v_t FOR SHARE;
 IF NOT FOUND OR rec.trabajo_sync_id IS DISTINCT FROM v_work
  OR rec.estado IS DISTINCT FROM 'PENDIENTE_VERIFICACION_GOOGLE'
  OR rec.origen IS DISTINCT FROM 'ORDEN_AUTORIZADA'
  OR rec.asignado_en < v_corte
 THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='S13_T_TRABAJO_NO_ACREDITADOS'; END IF;

 SELECT * INTO entregada FROM app_private.manteniment_entregas_continuidad_alpha75
 WHERE sync_id=rec.orden_sync_id AND revision=rec.orden_revision;
 IF NOT FOUND OR entregada.origen IS DISTINCT FROM 'entrega'
  OR entregada.entregado_en IS NULL OR entregada.entregado_en < v_corte
  OR NOT EXISTS(
   SELECT 1 FROM jsonb_array_elements(
    CASE WHEN jsonb_typeof(entregada.payload->'trabajos_crear')='array'
     THEN entregada.payload->'trabajos_crear' ELSE '[]'::jsonb END
   ) x(value)
   WHERE x.value->>'trabajo_sync_id'=v_work::text
     AND coalesce(x.value->>'retener_propuesta','false')<>'true'
     AND upper(btrim(coalesce(x.value->>'dfm',''))) <> 'R1515'
  )
 THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='S13_ORDEN_SIN_VINCULO_POSITIVO'; END IF;

 SELECT * INTO trabajo FROM app_private.manteniment_t_trabajos
 WHERE sync_id=v_work FOR SHARE;
 IF NOT FOUND OR trabajo.seguimiento_id IS DISTINCT FROM entregada.seguimiento_id
 OR trabajo.trabajo_hotel_id IS NULL
 THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='S13_TRABAJO_SIN_DESTINO'; END IF;

 -- Observación de Google, nunca fecha real de edición: no puede probar autor.
 -- El hash liga la solicitud de lectura y sus valores, no una firma de humano.
 v_hash:=encode(sha256(convert_to(p_lectura::text,'UTF8')),'hex');
 SELECT * INTO ex FROM app_private.sincro13_k_evidencias
 WHERE solicitud_id=v_req FOR UPDATE;
 IF FOUND THEN
  IF ex.evidencia_sha256 IS DISTINCT FROM v_hash
    OR ex.id_fila IS DISTINCT FROM v_t
    OR ex.trabajo_sync_id IS DISTINCT FROM v_work
    OR ex.valor_nuevo IS DISTINCT FROM v_date
  THEN RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='S13_LECTURA_REPLAY_CONTRADICTORIO'; END IF;
 ELSE
  IF trabajo.fecha_recogida IS NOT DISTINCT FROM v_date THEN
   RETURN jsonb_build_object('protocolo','sincro13-evidencia-k-v1',
     'estado','SIN_CAMBIO','id_fila',v_t,'autoriza_sincronizar',false);
  END IF;
  INSERT INTO app_private.sincro13_k_evidencias(
   evidencia_id,solicitud_id,spreadsheet_id,id_fila,trabajo_sync_id,
   columna,valor_base,valor_nuevo,evento_en,verificado_en,verificador,
   actor_google_verificado,editor_google_acreditado,evidencia_sha256
  ) VALUES(
   gen_random_uuid(),v_req,sc.spreadsheet_id,v_t,v_work,
   'K',trabajo.fecha_recogida,v_date,v_stamp,clock_timestamp(),
   'GOOGLE_INDEPENDIENTE',NULL,false,v_hash
  ) ON CONFLICT(solicitud_id) DO NOTHING;
  SELECT * INTO ex FROM app_private.sincro13_k_evidencias
  WHERE solicitud_id=v_req FOR UPDATE;
  IF NOT FOUND OR ex.evidencia_sha256 IS DISTINCT FROM v_hash
    OR ex.id_fila IS DISTINCT FROM v_t
    OR ex.trabajo_sync_id IS DISTINCT FROM v_work
    OR ex.valor_nuevo IS DISTINCT FROM v_date
    OR ex.valor_base IS DISTINCT FROM trabajo.fecha_recogida
  THEN RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='S13_LECTURA_REPLAY_CONTRADICTORIO'; END IF;
 END IF;

 RETURN jsonb_build_object('protocolo','sincro13-evidencia-k-v1',
  'estado',CASE WHEN ex.estado='PENDIENTE' THEN 'PENDIENTE_ADOPCION' ELSE ex.estado END,
  'evidencia_id',ex.evidencia_id,
  'solicitud_id',v_req,'id_fila',v_t,
  'trabajo_sync_id',v_work,'columna','K',
  'valor_base',ex.valor_base,'valor_nuevo',ex.valor_nuevo,
  'evidencia_sha256',ex.evidencia_sha256,
  'editor_google_acreditado',false,
  'autoriza_sincronizar',false,'escritura_realizada',false);
END;
$s13lect$;

REVOKE ALL ON FUNCTION app_private.sincro13_recibir_lectura_google_k(text,jsonb)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION app_private.sincro13_recibir_lectura_google_k(text,jsonb)
 TO service_role;

CREATE OR REPLACE FUNCTION public.sincro13_recibir_lectura_google_k(
 p_clave text,p_lectura jsonb
) RETURNS jsonb LANGUAGE sql SECURITY INVOKER
SET search_path TO pg_catalog
AS $s13bridge$
 SELECT app_private.sincro13_recibir_lectura_google_k(p_clave,p_lectura);
$s13bridge$;
REVOKE ALL ON FUNCTION public.sincro13_recibir_lectura_google_k(text,jsonb)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sincro13_recibir_lectura_google_k(text,jsonb)
 TO service_role;
COMMIT;
