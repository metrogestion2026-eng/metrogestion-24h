-- SINCRO13 · adopción de la K manual en T REAL de HOTEL.
-- CANDIDATO: NO INSTALAR ni ejecutar contra Metroges conectado.
-- Control de usuario real con JWT, fase tres hitos, CAS por versión y hora
-- de recogida EXPLICITA. No inventar horas a partir de K (solo fecha).
-- La actualizacion de la etapa conserva los triggers NATIVOS de Hotel:
-- auditoría, fechas de manteniment, revision de cola y estado operativo.
BEGIN;

CREATE TABLE IF NOT EXISTS app_private.sincro13_adopciones_hotel_k (
  evidencia_id uuid PRIMARY KEY
    REFERENCES app_private.sincro13_k_evidencias(evidencia_id) ON DELETE RESTRICT,
  solicitud_id uuid NOT NULL UNIQUE,
  etapa_id uuid NOT NULL,
  etapa_version_antes integer NOT NULL,
  fecha_hora_recogida timestamptz NOT NULL,
  adoptado_por uuid NOT NULL,
  sesion_id uuid NOT NULL,
  adoptado_en timestamptz NOT NULL DEFAULT clock_timestamp(),
  etapa_version_despues integer NOT NULL,
  resultado jsonb NOT NULL
);
ALTER TABLE app_private.sincro13_adopciones_hotel_k ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON app_private.sincro13_adopciones_hotel_k
  FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION app_private.sincro13_adoptar_hotel_k(
  p_evidencia_id uuid,p_solicitud_id uuid,p_etapa_id uuid,
  p_version integer,p_fecha_hora_text text,p_declaracion text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO pg_catalog
AS $s13_adoptar$
DECLARE
  v_evidencia app_private.sincro13_k_evidencias%rowtype;
  v_aprobacion app_private.sincro13_aprobaciones_k%rowtype;
  v_replay app_private.sincro13_adopciones_hotel_k%rowtype;
  v_etapa public.etapas_hotel%rowtype;
  v_registro public.registros_hotel%rowtype;
  v_trabajo public.trabajos_etapa_hotel%rowtype;
  v_catalogo app_private.manteniment_t_trabajos%rowtype;
  v_board text;
  v_estado_ficha text;
  v_vehiculo_id uuid;
  v_count_vehiculos bigint;
  v_sesion uuid;
  v_user uuid:=auth.uid();
  v_fecha timestamptz;
  v_actual public.etapas_hotel%rowtype;
  v_result jsonb;
  v_now timestamptz:=clock_timestamp();
BEGIN
  -- La aprobación humanamente atribuible es la aceptación, nunca
  -- la supuesta identidad de quien editó Google.
  IF v_user IS NULL OR NOT app_private.sesion_auth_activa()
   OR NOT app_private.usuario_activo()
   OR NOT app_private.dispositivo_autorizado()
   OR NOT app_private.es_administrador_principal() THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='S13_HOTEL_ADMIN_NO_AUTORIZADO';
  END IF;

  IF p_evidencia_id IS NULL OR p_solicitud_id IS NULL OR p_etapa_id IS NULL
    OR p_version IS NULL OR p_version < 1
    OR p_declaracion IS DISTINCT FROM 'CONFIRMO_RECOGIDA_HORA_REAL'
    OR coalesce(p_fecha_hora_text,'') !~
       '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{1,3})?(Z|[+-][0-9]{2}:[0-9]{2})$'
    OR coalesce(auth.jwt()->>'session_id','') !~
       '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
  THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='S13_HOTEL_HORA_O_DECISION_INCOMPLETA'; END IF;
  v_fecha:=p_fecha_hora_text::timestamptz;
  v_sesion:=(auth.jwt()->>'session_id')::uuid;
  IF v_fecha>v_now THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='S13_HOTEL_RECOGIDA_FUTURA'; END IF;

  -- Una repetición idéntica devuelve el mismo resultado tras verificar
  -- actor y solicitud. No actualiza fecha, estados ni una segunda T.
  SELECT * INTO v_replay FROM app_private.sincro13_adopciones_hotel_k
    WHERE evidencia_id=p_evidencia_id FOR UPDATE;
  IF FOUND THEN
    IF v_replay.solicitud_id IS DISTINCT FROM p_solicitud_id
      OR v_replay.etapa_id IS DISTINCT FROM p_etapa_id
      OR v_replay.etapa_version_antes IS DISTINCT FROM p_version
      OR v_replay.fecha_hora_recogida IS DISTINCT FROM v_fecha
      OR v_replay.adoptado_por IS DISTINCT FROM v_user
      OR v_replay.sesion_id IS DISTINCT FROM v_sesion
    THEN RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='S13_HOTEL_REINTENTO_CONTRADICTORIO';END IF;
    RETURN v_replay.resultado;
  END IF;

  SELECT * INTO v_evidencia FROM app_private.sincro13_k_evidencias
    WHERE evidencia_id=p_evidencia_id FOR UPDATE;
  IF NOT FOUND OR v_evidencia.estado IS DISTINCT FROM 'PENDIENTE'
    OR v_evidencia.columna IS DISTINCT FROM 'K'
    OR v_evidencia.verificador IS DISTINCT FROM 'GOOGLE_INDEPENDIENTE'
    OR v_evidencia.editor_google_acreditado IS DISTINCT FROM false
    OR v_evidencia.actor_google_verificado IS NOT NULL
    OR v_evidencia.evento_en < timestamptz '2026-11-15 23:00:00+00'
    OR v_evidencia.verificado_en < v_now - interval '90 seconds'
    OR v_evidencia.verificado_en > v_now + interval '5 seconds'
    OR (v_fecha AT TIME ZONE 'Europe/Madrid')::date
      IS DISTINCT FROM v_evidencia.valor_nuevo
  THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='S13_HOTEL_K_EVIDENCIA_NO_VIGENTE'; END IF;

  -- El editor de Google sigue desconocido; T se acredita únicamente por
  -- su recibo de creación posterior al corte + orden entregada y UUID.
  IF NOT EXISTS (
    SELECT 1 FROM app_private.sincro13_recibos_t rec
    JOIN app_private.manteniment_entregas_continuidad_alpha75 ent
      ON ent.sync_id=rec.orden_sync_id AND ent.revision=rec.orden_revision
    WHERE rec.spreadsheet_id=v_evidencia.spreadsheet_id
      AND rec.id_fila=v_evidencia.id_fila
      AND rec.trabajo_sync_id=v_evidencia.trabajo_sync_id
      AND rec.estado='PENDIENTE_VERIFICACION_GOOGLE'
      AND rec.origen='ORDEN_AUTORIZADA'
      AND rec.asignado_en>=timestamptz '2026-11-15 23:00:00+00'
      AND ent.origen='entrega'
      AND ent.entregado_en>=timestamptz '2026-11-15 23:00:00+00'
      AND EXISTS (
        SELECT 1 FROM jsonb_array_elements(
          CASE WHEN jsonb_typeof(ent.payload->'trabajos_crear')='array'
           THEN ent.payload->'trabajos_crear' ELSE '[]'::jsonb END
        ) x(value)
        WHERE x.value->>'trabajo_sync_id'=v_evidencia.trabajo_sync_id::text
          AND coalesce(x.value->>'retener_propuesta','false')<>'true'
          AND upper(btrim(coalesce(x.value->>'dfm',''))) <> 'R1515'
      )
  ) THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='S13_HOTEL_T_NO_ACREDITADA';
  END IF;

  -- La observación K sin cambio de día no autoriza cambiar la hora
  -- de Hotel: Google no contiene una hora que pueda acreditarlo.
  IF v_evidencia.valor_base IS NOT DISTINCT FROM v_evidencia.valor_nuevo THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='S13_HOTEL_K_SIN_CAMBIO';
  END IF;

  SELECT * INTO v_aprobacion FROM app_private.sincro13_aprobaciones_k
    WHERE evidencia_id=p_evidencia_id FOR UPDATE;
  IF NOT FOUND OR v_aprobacion.estado IS DISTINCT FROM 'APROBADA'
    OR v_aprobacion.solicitud_aprobacion_id IS DISTINCT FROM p_solicitud_id
    OR v_aprobacion.aprobado_por IS DISTINCT FROM v_user
    OR v_aprobacion.sesion_id IS DISTINCT FROM v_sesion
    OR v_aprobacion.caduca_en <= v_now
    OR v_aprobacion.trabajo_sync_id IS DISTINCT FROM v_evidencia.trabajo_sync_id
    OR v_aprobacion.id_fila IS DISTINCT FROM v_evidencia.id_fila
    OR v_aprobacion.evidencia_sha256 IS DISTINCT FROM v_evidencia.evidencia_sha256
    OR v_aprobacion.valor_base IS DISTINCT FROM v_evidencia.valor_base
    OR v_aprobacion.valor_nuevo IS DISTINCT FROM v_evidencia.valor_nuevo
  THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='S13_HOTEL_K_SIN_ADOPCION_EXPLICITA'; END IF;

  -- Lock order: stage FIRST, then shared continuity advisory, then
  -- technical job. This matches the triggers on etapas_hotel which take
  -- the stage row lock before the continuity lock and update the catalog.
  SELECT * INTO v_etapa FROM public.etapas_hotel
  WHERE id=p_etapa_id FOR UPDATE;
  IF NOT FOUND OR v_etapa.version IS DISTINCT FROM p_version
    OR v_etapa.cancelado OR v_etapa.estado='anulada'
    OR NOT app_private.es_tipo_entrada_taller_alpha75(v_etapa.tipo_etapa)
  THEN RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='S13_HOTEL_T_CAMBIADA_O_NO_ES_ENTRADA'; END IF;
  IF NOT app_private.usa_flujo_taller_hitos(v_etapa.registro_hotel_id)
    OR v_etapa.fecha_inicio_real IS NULL
    OR v_etapa.fecha_fin_real IS NULL
    OR v_fecha<v_etapa.fecha_fin_real
  THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='S13_HOTEL_HITOS_INCOMPLETOS'; END IF;
  IF (v_etapa.fecha_real AT TIME ZONE 'Europe/Madrid')::date
     IS DISTINCT FROM v_evidencia.valor_base
  THEN RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='S13_HOTEL_K_BASE_CAMBIADA'; END IF;
  -- Reflejar la semántica que YA usa el botón Recogido de taller:
  -- en_curso + sin recogida -> realizada + fecha_real.
  -- Si se corrige una recogida ya registrada, conservar 'realizada'.
  IF (v_etapa.fecha_real IS NULL AND v_etapa.estado IS DISTINCT FROM 'en_curso')
    OR (v_etapa.fecha_real IS NOT NULL AND v_etapa.estado IS DISTINCT FROM 'realizada')
  THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='S13_HOTEL_FASE_INCOHERENTE'; END IF;

  PERFORM app_private.bloquear_sync_continuidad_alpha75();

  SELECT * INTO v_registro FROM public.registros_hotel
  WHERE id=v_etapa.registro_hotel_id FOR SHARE;
  IF NOT FOUND OR v_registro.cancelado OR v_registro.retirado_hotel_activo
    OR v_registro.seguimiento_id IS NULL
  THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='S13_HOTEL_FICHA_NO_VIGENTE'; END IF;

  SELECT p.estado INTO v_board FROM public.pizarras p
  WHERE p.id=v_registro.pizarra_id FOR SHARE;
  IF v_board IS DISTINCT FROM 'en_curso'
    OR NOT EXISTS(SELECT 1 FROM public.hotel_edicion_piloto ep
      WHERE ep.registro_hotel_id=v_registro.id AND ep.activo=true)
  THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='S13_HOTEL_FICHA_FUERA_PILOTO'; END IF;

  SELECT * INTO v_catalogo FROM app_private.manteniment_t_trabajos
  WHERE sync_id=v_evidencia.trabajo_sync_id FOR UPDATE;
  IF NOT FOUND OR v_catalogo.trabajo_hotel_id IS NULL
    OR v_catalogo.seguimiento_id IS DISTINCT FROM v_registro.seguimiento_id
    OR v_catalogo.fecha_recogida IS DISTINCT FROM v_evidencia.valor_base
  THEN RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='S13_HOTEL_TRABAJO_O_K_BASE_CAMBIADO'; END IF;

  SELECT * INTO v_trabajo FROM public.trabajos_etapa_hotel
  WHERE id=v_catalogo.trabajo_hotel_id FOR SHARE;
  IF NOT FOUND OR v_trabajo.cancelado
    OR v_trabajo.etapa_hotel_id IS DISTINCT FROM v_etapa.id
    OR v_etapa.registro_hotel_id IS DISTINCT FROM v_registro.id
  THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='S13_HOTEL_VINCULO_TRABAJO_INCONSISTENTE'; END IF;

  IF EXISTS(SELECT 1 FROM app_private.manteniment_parada_outbox
    WHERE seguimiento_id=v_catalogo.seguimiento_id AND estado='pendiente')
  THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='S13_HOTEL_OUTBOX_PARADA_PENDIENTE'; END IF;

  -- Un vehículo sólo sirve para consultar su outbox auxiliar DESPUÉS
  -- de identificar T/UUID y Hotel. Nunca es referencia de identidad T.
  SELECT count(*),(array_agg(v.id ORDER BY v.id))[1]
    INTO v_count_vehiculos,v_vehiculo_id
  FROM public.vehiculos v
  WHERE upper(btrim(v.dfm))=upper(btrim(v_registro.vehiculo_sustituido));
  IF v_count_vehiculos IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='S13_HOTEL_VEHICULO_NO_UNICO';
  END IF;
  IF EXISTS (
    SELECT 1 FROM app_private.manteniment_activo_outbox a
    WHERE a.vehiculo_id=v_vehiculo_id AND a.estado='pendiente'
  ) THEN RAISE EXCEPTION USING ERRCODE='55000',
    MESSAGE='S13_HOTEL_OUTBOX_ACTIVO_PENDIENTE'; END IF;

  -- Finalizar SOLO esta T siguiendo el contrato del botón de recogida:
  -- 'realizada' y estado_catalogo_codigo, sin tocar J, fecha prevista,
  -- orden, recuperación posterior, km o reserva. Los triggers de Hotel
  -- ejecutan las demás derivaciones operativas auditadas.
  PERFORM set_config('app.request_id',
    'sincro13-k-'||p_solicitud_id::text,true);
  PERFORM set_config('app.audit_origin','metrogestion-sincro13-adopcion-humana',true);
  PERFORM set_config('app.audit_reason',
    'Recogida con hora real declarada por administrador principal, K/T verificadas',true);
  UPDATE public.etapas_hotel
  SET fecha_real=v_fecha,
      estado='realizada',
      estado_catalogo_codigo=CASE
        WHEN estado='realizada' THEN estado_catalogo_codigo ELSE 'realizada'
      END,
      modificado_por=v_user
  WHERE id=v_etapa.id
    AND version=p_version
    AND fecha_real IS NOT DISTINCT FROM v_etapa.fecha_real
  RETURNING * INTO v_actual;
  IF NOT FOUND OR v_actual.estado IS DISTINCT FROM 'realizada'
    OR v_actual.fecha_fin_real IS DISTINCT FROM v_etapa.fecha_fin_real
    OR v_actual.fecha_inicio_real IS DISTINCT FROM v_etapa.fecha_inicio_real
    OR v_actual.cancelado IS DISTINCT FROM v_etapa.cancelado
    OR v_actual.fecha_real IS DISTINCT FROM v_fecha
  THEN RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='S13_HOTEL_T_CAMBIO_CONTRADICTORIO'; END IF;

  -- Mismo cierre operativo que usa el botón de Recogido en Hotel.
  -- No ejecuta ni marca la T posterior de Recuperar.
  PERFORM app_private.sincronizar_situacion_operativa_hotel_alpha75(v_registro.id,true);
  SELECT r.estado INTO v_estado_ficha FROM public.registros_hotel r
  WHERE r.id=v_registro.id;
  IF v_estado_ficha IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='S13_HOTEL_SITUACION_NO_PROYECTADA';
  END IF;

  -- La proyección debe haber quedado actualizada mediante el trigger REAL
  -- de Hotel. Si no, revertir TODA la transacción, sin corregir a ciegas.
  IF NOT EXISTS(
    SELECT 1 FROM app_private.manteniment_t_trabajos w
    WHERE w.id=v_catalogo.id
      AND w.fecha_recogida IS NOT DISTINCT FROM v_evidencia.valor_nuevo
      AND w.fecha_realizada IS NOT DISTINCT FROM v_catalogo.fecha_realizada
  ) THEN RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='S13_HOTEL_PROYECCION_K_INCOMPLETA'; END IF;

  v_result:=jsonb_build_object(
    'protocolo','sincro13-hotel-k-v1',
    'estado','ADOPTADA_EN_HOTEL',
    'evidencia_id',p_evidencia_id,'etapa_id',v_etapa.id,
    'id_fila',v_evidencia.id_fila,'columna','K',
    'dia_google',v_evidencia.valor_nuevo,
    'fecha_hora_recogida',v_fecha,
    'version_antes',p_version,'version_despues',v_actual.version,
    'adoptado_por',v_user,
    'editor_google_acreditado',false,
    'autoriza_sincronizar',false,
    'escritura_operativa_realizada',true,
    'hito_recogido_y_t_realizada',true,
    'estado_t','realizada',
    'estado_ficha',v_estado_ficha,
    'triggers_nativos_ejecutados',true,
    'efectos_secundarios_auditados_por_hotel',true,
    'autoriza_activar_sincro',false);

  UPDATE app_private.sincro13_k_evidencias
    SET estado='APLICADA',resultado=v_result,consumido_en=clock_timestamp()
    WHERE evidencia_id=p_evidencia_id AND estado='PENDIENTE';
  UPDATE app_private.sincro13_aprobaciones_k
    SET estado='CONSUMIDA',cerrado_en=clock_timestamp()
    WHERE evidencia_id=p_evidencia_id AND estado='APROBADA';

  INSERT INTO app_private.sincro13_adopciones_hotel_k
    (evidencia_id,solicitud_id,etapa_id,etapa_version_antes,
     fecha_hora_recogida,adoptado_por,sesion_id,etapa_version_despues,resultado)
  VALUES
    (p_evidencia_id,p_solicitud_id,p_etapa_id,p_version,
     v_fecha,v_user,v_sesion,v_actual.version,v_result);

  RETURN v_result;
END;
$s13_adoptar$;

REVOKE ALL ON FUNCTION app_private.sincro13_adoptar_hotel_k(uuid,uuid,uuid,integer,text,text)
  FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION app_private.sincro13_adoptar_hotel_k(uuid,uuid,uuid,integer,text,text)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.sincro13_adoptar_hotel_k(
  p_evidencia_id uuid,p_solicitud_id uuid,p_etapa_id uuid,
  p_version integer,p_fecha_hora_text text,p_declaracion text
) RETURNS jsonb LANGUAGE sql SECURITY INVOKER
SET search_path TO pg_catalog AS $s13_public$
  SELECT app_private.sincro13_adoptar_hotel_k(
   p_evidencia_id,p_solicitud_id,p_etapa_id,
   p_version,p_fecha_hora_text,p_declaracion);
$s13_public$;
REVOKE ALL ON FUNCTION public.sincro13_adoptar_hotel_k(uuid,uuid,uuid,integer,text,text)
  FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.sincro13_adoptar_hotel_k(uuid,uuid,uuid,integer,text,text)
  TO authenticated;
COMMIT;
