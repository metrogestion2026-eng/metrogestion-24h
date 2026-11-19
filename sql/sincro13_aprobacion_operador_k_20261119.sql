-- SINCRO13 · Aprobación expresa de K por administrador principal.
-- CANDIDATA NO INSTALADA. No permite fabricar lecturas Google ni guardar Hotel.
-- La aprobación reconoce ADOPCIÓN por operador, NO AUTORÍA de edición en Sheets.
BEGIN;

CREATE TABLE IF NOT EXISTS app_private.sincro13_aprobaciones_k (
  evidencia_id uuid PRIMARY KEY REFERENCES app_private.sincro13_k_evidencias(evidencia_id) ON DELETE RESTRICT,
  solicitud_aprobacion_id uuid NOT NULL UNIQUE,
  spreadsheet_id text NOT NULL,
  id_fila bigint NOT NULL CHECK (id_fila BETWEEN 1 AND 9007199254740991),
  trabajo_sync_id uuid NOT NULL,
  evidencia_sha256 text NOT NULL CHECK (evidencia_sha256 ~ '^[0-9a-f]{64}$'),
  valor_base date,
  valor_nuevo date NOT NULL,
  aprobado_por uuid NOT NULL,
  sesion_id uuid NOT NULL,
  aprobado_en timestamptz NOT NULL DEFAULT clock_timestamp(),
  caduca_en timestamptz NOT NULL,
  estado text NOT NULL DEFAULT 'APROBADA'
    CHECK (estado IN ('APROBADA','CONSUMIDA','RETENIDA')),
  cerrado_en timestamptz
);

ALTER TABLE app_private.sincro13_aprobaciones_k ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON app_private.sincro13_aprobaciones_k FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION app_private.sincro13_aprobar_correccion_k(
  p_evidencia_id uuid,
  p_solicitud_id uuid,
  p_contraste jsonb,
  p_declaracion text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO pg_catalog
AS $s13_aprobar$
DECLARE
  v_ev app_private.sincro13_k_evidencias%rowtype;
  v_ap app_private.sincro13_aprobaciones_k%rowtype;
  v_uid uuid := auth.uid();
  v_sesion uuid;
  v_ahora timestamptz := clock_timestamp();
BEGIN
  -- Estos controles son los instalados en Metroges. La sesión debe estar
  -- vigente y el dispositivo permitido; no basta con 'authenticated' ni JWT
  -- de usuario inactivo. service_role y Apps Script NO pueden llamar.
  IF v_uid IS NULL OR NOT app_private.sesion_auth_activa()
      OR NOT app_private.usuario_activo()
      OR NOT app_private.dispositivo_autorizado()
      OR NOT app_private.es_administrador_principal() THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='S13_APROBACION_NO_AUTORIZADA';
  END IF;

  IF coalesce(auth.jwt()->>'session_id','') !~
       '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
     OR p_solicitud_id IS NULL OR p_evidencia_id IS NULL
     OR p_declaracion IS DISTINCT FROM 'ADOPTO_CORRECCION_K_VERIFICADA'
     OR jsonb_typeof(p_contraste) IS DISTINCT FROM 'object'
     OR NOT (p_contraste ?& ARRAY[
       'id_fila','trabajo_sync_id','columna','valor_base',
       'valor_nuevo','evidencia_sha256'])
     OR (SELECT count(*) FROM jsonb_object_keys(p_contraste)) <> 6
  THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='S13_CONTRASTE_INCOMPLETO'; END IF;
  v_sesion := (auth.jwt()->>'session_id')::uuid;

  SELECT * INTO v_ev FROM app_private.sincro13_k_evidencias
  WHERE evidencia_id=p_evidencia_id FOR UPDATE;
  IF NOT FOUND OR v_ev.estado <> 'PENDIENTE'
    OR v_ev.columna <> 'K'
    OR v_ev.verificador <> 'GOOGLE_INDEPENDIENTE'
    OR v_ev.evento_en < timestamptz '2026-11-15 23:00:00+00'
    OR v_ev.verificado_en < v_ahora - interval '5 minutes'
    OR v_ev.verificado_en > v_ahora + interval '5 minutes'
  THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='S13_EVIDENCIA_NO_VIGENTE'; END IF;

  -- Contraste exacto de los datos visibles al administrador. No se acepta
  -- pulsar sobre un mero UUID sin reconocer T, trabajo, campo y fechas.
  IF p_contraste->'id_fila' IS DISTINCT FROM to_jsonb(v_ev.id_fila)
     OR p_contraste->>'trabajo_sync_id' IS DISTINCT FROM v_ev.trabajo_sync_id::text
     OR p_contraste->>'columna' IS DISTINCT FROM 'K'
     OR p_contraste->'valor_base' IS DISTINCT FROM coalesce(to_jsonb(v_ev.valor_base),'null'::jsonb)
     OR p_contraste->'valor_nuevo' IS DISTINCT FROM to_jsonb(v_ev.valor_nuevo)
     OR p_contraste->>'evidencia_sha256' IS DISTINCT FROM v_ev.evidencia_sha256
  THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='S13_APROBACION_DATOS_DISTINTOS'; END IF;

  INSERT INTO app_private.sincro13_aprobaciones_k (
    evidencia_id,solicitud_aprobacion_id,spreadsheet_id,id_fila,
    trabajo_sync_id,evidencia_sha256,valor_base,valor_nuevo,
    aprobado_por,sesion_id,aprobado_en,caduca_en
  ) VALUES (
    v_ev.evidencia_id,p_solicitud_id,v_ev.spreadsheet_id,v_ev.id_fila,
    v_ev.trabajo_sync_id,v_ev.evidencia_sha256,v_ev.valor_base,v_ev.valor_nuevo,
    v_uid,v_sesion,v_ahora,v_ahora + interval '5 minutes'
  )
  ON CONFLICT (evidencia_id) DO NOTHING;

  SELECT * INTO v_ap FROM app_private.sincro13_aprobaciones_k
    WHERE evidencia_id=p_evidencia_id FOR UPDATE;
  IF NOT FOUND OR v_ap.estado <> 'APROBADA'
    OR v_ap.solicitud_aprobacion_id IS DISTINCT FROM p_solicitud_id
    OR v_ap.aprobado_por IS DISTINCT FROM v_uid
    OR v_ap.sesion_id IS DISTINCT FROM v_sesion
    OR v_ap.evidencia_sha256 IS DISTINCT FROM v_ev.evidencia_sha256
    OR v_ap.valor_base IS DISTINCT FROM v_ev.valor_base
    OR v_ap.valor_nuevo IS DISTINCT FROM v_ev.valor_nuevo
    OR v_ap.caduca_en <= v_ahora
  THEN RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='S13_APROBACION_CONTRADICTORIA'; END IF;

  RETURN jsonb_build_object(
    'protocolo','sincro13-adopcion-k-v1',
    'evidencia_id',p_evidencia_id,'solicitud_id',p_solicitud_id,
    'id_fila',v_ev.id_fila,'columna','K',
    'aprobada_por',v_uid,'adopcion_expresa',true,
    'edicion_original_atribuida',false,
    'google_releido_en_este_rpc',false,
    'autoriza_sincronizar',false,
    'estado','APROBADA');
END;
$s13_aprobar$;

-- No exponer el privilegio de la función interna salvo a usuarios con JWT.
REVOKE ALL ON FUNCTION app_private.sincro13_aprobar_correccion_k(uuid,uuid,jsonb,text)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION app_private.sincro13_aprobar_correccion_k(uuid,uuid,jsonb,text)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.sincro13_aprobar_correccion_k(
  p_evidencia_id uuid,p_solicitud_id uuid,p_contraste jsonb,p_declaracion text
) RETURNS jsonb LANGUAGE sql SECURITY INVOKER
SET search_path TO pg_catalog
AS $s13_public$
  SELECT app_private.sincro13_aprobar_correccion_k(
    p_evidencia_id,p_solicitud_id,p_contraste,p_declaracion);
$s13_public$;
REVOKE ALL ON FUNCTION public.sincro13_aprobar_correccion_k(uuid,uuid,jsonb,text)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.sincro13_aprobar_correccion_k(uuid,uuid,jsonb,text)
  TO authenticated;
COMMIT;
