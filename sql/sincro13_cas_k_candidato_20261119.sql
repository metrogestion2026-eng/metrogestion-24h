-- SINCRO 13 · 3/3: receptor CAS de K. Requiere base y aprobación.
-- Orden estricto: sincro13_k_evidencias_base, sincro13_aprobacion_operador_k,
-- este fichero. NO desplegar sin los tres y un verificador independiente.
BEGIN;

CREATE OR REPLACE FUNCTION app_private.sincro13_cas_k(
 p_token text,p_evidencia_id uuid,p_solicitud_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO pg_catalog
AS $s13cas$
DECLARE
 v_config record;
 v_ev app_private.sincro13_k_evidencias%rowtype;
 v_ap app_private.sincro13_aprobaciones_k%rowtype;
 v_rec app_private.sincro13_recibos_t%rowtype;
 v_job app_private.manteniment_t_trabajos%rowtype;
 v_ent app_private.manteniment_entregas_continuidad_alpha75%rowtype;
 v_corte constant timestamptz:=timestamptz '2026-11-15 23:00:00+00';
 v_motivo text;
 v_result jsonb;
 v_hotel record;
 v_hotel_k date;
 v_vehiculo_id uuid;
 v_vehiculos_encontrados bigint;
BEGIN
 SELECT token_activo,token_hash,spreadsheet_id INTO v_config
 FROM app_private.manteniment_sync_config WHERE id=1;
 IF NOT FOUND OR v_config.token_activo IS DISTINCT FROM true
   OR coalesce(v_config.token_hash,'') !~ '^[0-9a-f]{64}$'
   OR coalesce(p_token,'') !~* '^mg_[0-9a-f]{64}$'
   OR encode(extensions.digest(p_token,'sha256'),'hex') IS DISTINCT FROM v_config.token_hash
 THEN RAISE EXCEPTION USING ERRCODE='28000',MESSAGE='S13_CAS_TOKEN_INVALIDO'; END IF;

 SELECT * INTO v_ev FROM app_private.sincro13_k_evidencias
 WHERE evidencia_id=p_evidencia_id FOR UPDATE;
 IF NOT FOUND OR v_ev.solicitud_id IS DISTINCT FROM p_solicitud_id
 THEN RETURN jsonb_build_object('estado','RETENIDA','motivo','EVIDENCIA_NO_AUTORIZADA','autoriza_sincronizar',false);END IF;
 IF v_ev.estado IN ('APLICADA','RETENIDA') THEN
   RETURN v_ev.resultado;
 END IF;

 -- Una lectura Google y un UUID NO prueban autoría ni aceptación. El
 -- administrador principal de Metroges adopta explícitamente ESTE valor
 -- exacto mediante sesión JWT, MFA/dispositivo y la aprobación de S13.
 -- Apps Script/service_role no dispone de permisos para crearla.
 SELECT * INTO v_ap FROM app_private.sincro13_aprobaciones_k
 WHERE evidencia_id=p_evidencia_id FOR UPDATE;
 IF NOT FOUND OR v_ap.estado IS DISTINCT FROM 'APROBADA'
   OR v_ap.aprobado_por IS NULL OR v_ap.sesion_id IS NULL
   OR v_ap.caduca_en <= clock_timestamp()
   OR v_ap.spreadsheet_id IS DISTINCT FROM v_ev.spreadsheet_id
   OR v_ap.id_fila IS DISTINCT FROM v_ev.id_fila
   OR v_ap.trabajo_sync_id IS DISTINCT FROM v_ev.trabajo_sync_id
   OR v_ap.evidencia_sha256 IS DISTINCT FROM v_ev.evidencia_sha256
   OR v_ap.valor_base IS DISTINCT FROM v_ev.valor_base
   OR v_ap.valor_nuevo IS DISTINCT FROM v_ev.valor_nuevo
 THEN v_motivo:='SIN_ADOPCION_EXPLICITA_VIGENTE'; END IF;

 -- No derivar K de J ni la fecha del backend como si fuese hecho manual.
 IF v_motivo IS NULL AND (
    v_ev.spreadsheet_id IS DISTINCT FROM v_config.spreadsheet_id
   OR v_ev.columna IS DISTINCT FROM 'K'
   OR v_ev.verificador IS DISTINCT FROM 'GOOGLE_INDEPENDIENTE'
   OR v_ev.actor_google_verificado IS NOT NULL
   OR v_ev.editor_google_acreditado IS DISTINCT FROM false
   OR v_ev.evidencia_sha256 !~ '^[0-9a-f]{64}$'
   OR v_ev.evento_en < v_corte OR v_ev.evento_en > clock_timestamp()+interval '5 minutes'
   OR v_ev.verificado_en < v_ev.evento_en
   OR v_ev.verificado_en > clock_timestamp()+interval '5 minutes'
 ) THEN v_motivo:='EVIDENCIA_INSUFICIENTE'; END IF;

 IF v_motivo IS NULL THEN
  SELECT * INTO v_rec FROM app_private.sincro13_recibos_t
  WHERE spreadsheet_id=v_ev.spreadsheet_id AND id_fila=v_ev.id_fila
  FOR UPDATE;
  IF NOT FOUND OR v_rec.trabajo_sync_id IS DISTINCT FROM v_ev.trabajo_sync_id
    OR v_rec.estado IS DISTINCT FROM 'PENDIENTE_VERIFICACION_GOOGLE'
    OR v_rec.origen IS DISTINCT FROM 'ORDEN_AUTORIZADA'
  THEN v_motivo:='T_O_TRABAJO_NO_VINCULADOS'; END IF;
 END IF;

 IF v_motivo IS NULL THEN
  SELECT * INTO v_ent FROM app_private.manteniment_entregas_continuidad_alpha75
  WHERE sync_id=v_rec.orden_sync_id AND revision=v_rec.orden_revision;
  IF NOT FOUND OR v_ent.origen IS DISTINCT FROM 'entrega'
    OR v_ent.entregado_en IS NULL OR v_ent.entregado_en < v_corte
    OR NOT EXISTS(
      SELECT 1 FROM jsonb_array_elements(
        CASE WHEN jsonb_typeof(v_ent.payload->'trabajos_crear')='array'
        THEN v_ent.payload->'trabajos_crear' ELSE '[]'::jsonb END
      ) x(value)
      WHERE x.value->>'trabajo_sync_id'=v_ev.trabajo_sync_id::text
        AND upper(btrim(coalesce(x.value->>'dfm',''))) <> 'R1515'
    )
  THEN v_motivo:='ORDEN_NO_ACREDITADA_O_HISTORICA'; END IF;
 END IF;

 IF v_motivo IS NULL THEN
  SELECT * INTO v_job FROM app_private.manteniment_t_trabajos
  WHERE sync_id=v_ev.trabajo_sync_id FOR UPDATE;
  IF NOT FOUND OR v_job.seguimiento_id IS DISTINCT FROM v_ent.seguimiento_id
    OR v_job.trabajo_hotel_id IS NULL
  THEN v_motivo:='OBJETO_DESTINO_NO_ACREDITADO'; END IF;
 END IF;

 -- S13: ambos escritores de OUTBOX usarán el mismo advisory lock.
 -- Lo tomamos DESPUÉS de bloquear la fila técnica FOR UPDATE.
 -- Los triggers de Hotel pueden bloquear el trabajo y encolar después;
 -- obtener aquí el lock global en orden inverso provocaría deadlock.
 -- La cola posterior a nuestro COMMIT requiere retención propia (pendiente).
 IF v_motivo IS NULL THEN
   -- No esperar mientras se conserva bloqueado el trabajo técnico: otro
   -- editor Hotel puede tener la etapa bloqueada y querer este mismo lock.
   IF NOT pg_try_advisory_xact_lock(
      hashtextextended('MG75-CONTINUIDAD-001:manteniment-sync',0)
   ) THEN
     RAISE EXCEPTION USING ERRCODE='55P03',MESSAGE='S13_CAS_COLA_CONCURRENTE';
   END IF;
 END IF;

 IF v_motivo IS NULL AND EXISTS(
  SELECT 1 FROM app_private.manteniment_parada_outbox o
  WHERE o.seguimiento_id=v_job.seguimiento_id AND o.estado='pendiente'
 ) THEN
   -- La outbox heredada no conoce T/columna y podría reponer K.
   -- Hasta disponer de invalidación exacta, no permitir esta escritura.
   v_motivo:='OUTBOX_SIN_T_CAMPO_PENDIENTE';
 END IF;

 IF v_motivo IS NULL AND v_job.fecha_recogida IS DISTINCT FROM v_ev.valor_base
 THEN v_motivo:='BASE_K_CAMBIADA';END IF;

 IF v_motivo IS NULL AND v_job.fecha_realizada IS NOT NULL
   AND v_ev.valor_nuevo < v_job.fecha_realizada
 THEN v_motivo:='RECOGIDA_ANTES_DE_FIN_TRABAJO';END IF;

 -- El catalogo tecnico se recalcula desde Hotel: NO crear una verdad
 -- divergente en K. Se exige que el hecho de recogida YA este adoptado en
 -- la T operativa de Hotel. Solo se cubre el flujo taller de tres hitos;
 -- otras modalidades quedan retenidas hasta tener su mapeo explicito.
 IF v_motivo IS NULL THEN
  SELECT e.id AS etapa_id, e.tipo_etapa, e.fecha_real, e.fecha_fin_real,
    e.cancelado AS etapa_cancelada,
    t.cancelado AS trabajo_cancelado, r.cancelado AS ficha_cancelada,
    r.id AS registro_id,
    r.vehiculo_sustituido
    INTO v_hotel
  FROM public.trabajos_etapa_hotel t
  JOIN public.etapas_hotel e ON e.id=t.etapa_hotel_id
  JOIN public.registros_hotel r ON r.id=e.registro_hotel_id
  WHERE t.id=v_job.trabajo_hotel_id
    AND e.seguimiento_id=v_job.seguimiento_id
    AND r.seguimiento_id=v_job.seguimiento_id
  -- No esperar si otro proceso está actualizando la T de Hotel;
  -- abortar y liberar advisory evita inversión de bloqueos.
  FOR SHARE OF t,e,r NOWAIT;
  IF NOT FOUND OR v_hotel.etapa_cancelada OR v_hotel.trabajo_cancelado
    OR v_hotel.ficha_cancelada
  THEN v_motivo:='HOTEL_TRABAJO_O_ETAPA_NO_VIGENTE';
  ELSIF NOT app_private.usa_flujo_taller_hitos(v_hotel.registro_id)
    OR NOT app_private.es_tipo_entrada_taller_alpha75(v_hotel.tipo_etapa)
  THEN v_motivo:='MODALIDAD_HOTEL_SIN_MAPEO_K';
  ELSE
    v_hotel_k := CASE WHEN v_hotel.fecha_real IS NULL THEN NULL
      ELSE (v_hotel.fecha_real AT TIME ZONE 'Europe/Madrid')::date END;
    IF v_hotel_k IS DISTINCT FROM v_ev.valor_nuevo THEN
      v_motivo:='HOTEL_K_NO_ADOPTADA';
    END IF;
  END IF;
 END IF;


 -- La salida de activos usa vehiculo_id, no seguimiento_id. Solo
 -- usar DFM para localizar su cola auxiliar TRAS acreditar T y Hotel,
 -- NUNCA para identificar una T. La coincidencia debe ser unica.
 IF v_motivo IS NULL THEN
  SELECT count(*), (array_agg(v.id ORDER BY v.id))[1]
    INTO v_vehiculos_encontrados,v_vehiculo_id
  FROM public.vehiculos v
  WHERE upper(btrim(v.dfm))=upper(btrim(v_hotel.vehiculo_sustituido));
  IF v_vehiculos_encontrados IS DISTINCT FROM 1
  THEN v_motivo:='VEHICULO_AUXILIAR_AMBIGUO_O_AUSENTE';
  ELSIF EXISTS (
    SELECT 1 FROM app_private.manteniment_activo_outbox o
    WHERE o.vehiculo_id=v_vehiculo_id AND o.estado='pendiente'
  ) THEN v_motivo:='OUTBOX_ACTIVO_PENDIENTE';
  END IF;
 END IF;

 IF v_motivo IS NOT NULL THEN
  v_result:=jsonb_build_object(
   'protocolo','sincro13-cas-k-v1','estado','RETENIDA','motivo',v_motivo,
   'id_fila',v_ev.id_fila,'columna','K',
   'autoriza_sincronizar',false,'escritura_operativa_realizada',false);
  UPDATE app_private.sincro13_k_evidencias
    SET estado='RETENIDA',resultado=v_result,consumido_en=clock_timestamp()
    WHERE evidencia_id=p_evidencia_id AND estado='PENDIENTE';
  UPDATE app_private.sincro13_aprobaciones_k
    SET estado='RETENIDA',cerrado_en=clock_timestamp()
    WHERE evidencia_id=p_evidencia_id AND estado='APROBADA';
  RETURN v_result;
 END IF;

 -- El SELECT ... FOR UPDATE anterior garantiza comparación y escritura
 -- en la MISMA transacción. Solo cambia K del objeto exacto, no J, etapas,
 -- parada, nota, fecha original, numeración, PDF, outbox o T de Google.
 IF v_job.fecha_recogida IS DISTINCT FROM v_ev.valor_nuevo THEN
   UPDATE app_private.manteniment_t_trabajos
   SET fecha_recogida=v_ev.valor_nuevo,actualizado_en=clock_timestamp()
   WHERE id=v_job.id
     AND fecha_recogida IS NOT DISTINCT FROM v_ev.valor_base;
   IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='S13_CAS_CONCURRENCIA_DESTINO';
   END IF;
 END IF;

 v_result:=jsonb_build_object('protocolo','sincro13-cas-k-v1',
    'estado','APLICADA','motivo','K_ACTUALIZADA_POR_CAS',
    'id_fila',v_ev.id_fila,'columna','K',
    'autoriza_sincronizar',false,'escritura_operativa_realizada',false,
    'escritura_catalogo_tecnico_realizada',true,
    'hotel_k_ya_adoptada',true);
 UPDATE app_private.sincro13_k_evidencias
  SET estado='APLICADA',resultado=v_result,consumido_en=clock_timestamp()
  WHERE evidencia_id=p_evidencia_id AND estado='PENDIENTE';
 UPDATE app_private.sincro13_aprobaciones_k
  SET estado='CONSUMIDA',cerrado_en=clock_timestamp()
  WHERE evidencia_id=p_evidencia_id AND estado='APROBADA';
 RETURN v_result;
END;
$s13cas$;

REVOKE ALL ON FUNCTION app_private.sincro13_cas_k(text,uuid,uuid)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION app_private.sincro13_cas_k(text,uuid,uuid)
 TO service_role;
COMMIT;
