-- SINCRO 13 · CAS unicamente TRABAJO/K -> fecha_recogida.
-- CANDIDATO SIN DESPLEGAR. Depende del recibo previo de T de esta PR.
-- La evidencia solo puede ser creada por un verificador externo independiente,
-- NO por el token de Apps Script / onEdit / fecha del registro / cliente.
-- No se incluye emisor de evidencia: mientras falte, NO HAY CAMINO OPERATIVO.
BEGIN;

CREATE TABLE IF NOT EXISTS app_private.sincro13_k_evidencias (
 evidencia_id uuid PRIMARY KEY,
 solicitud_id uuid NOT NULL UNIQUE,
 spreadsheet_id text NOT NULL,
 id_fila bigint NOT NULL CHECK (id_fila BETWEEN 1 AND 9007199254740991),
 trabajo_sync_id uuid NOT NULL,
 columna text NOT NULL DEFAULT 'K' CHECK (columna = 'K'),
 valor_base date,
 valor_nuevo date NOT NULL,
 evento_en timestamptz NOT NULL,
 verificado_en timestamptz NOT NULL,
 verificador text NOT NULL CHECK (verificador = 'GOOGLE_INDEPENDIENTE'),
 actor_verificado uuid NOT NULL CHECK (actor_verificado <> '00000000-0000-0000-0000-000000000000'::uuid),
 evidencia_sha256 text NOT NULL CHECK (evidencia_sha256 ~ '^[0-9a-f]{64}$'),
 estado text NOT NULL DEFAULT 'PENDIENTE' CHECK (estado IN ('PENDIENTE','APLICADA','RETENIDA')),
 resultado jsonb,
 consumido_en timestamptz,
 creado_en timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY (spreadsheet_id,id_fila)
   REFERENCES app_private.sincro13_recibos_t(spreadsheet_id,id_fila) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX IF NOT EXISTS sincro13_k_evidencia_pendiente_unica
 ON app_private.sincro13_k_evidencias(spreadsheet_id,id_fila)
 WHERE estado='PENDIENTE';

ALTER TABLE app_private.sincro13_k_evidencias ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON app_private.sincro13_k_evidencias FROM PUBLIC,anon,authenticated,service_role;
-- No se concede INSERT al receptor de T ni a la Edge Function.
-- En laboratorio, el test simula el verificador insertando con dueño SQL.

CREATE OR REPLACE FUNCTION app_private.sincro13_cas_k(
 p_token text,p_evidencia_id uuid,p_solicitud_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO pg_catalog
AS $s13cas$
DECLARE
 v_config record;
 v_ev app_private.sincro13_k_evidencias%rowtype;
 v_rec app_private.sincro13_recibos_t%rowtype;
 v_job app_private.manteniment_t_trabajos%rowtype;
 v_ent app_private.manteniment_entregas_continuidad_alpha75%rowtype;
 v_corte constant timestamptz:=timestamptz '2026-11-15 23:00:00+00';
 v_motivo text;
 v_result jsonb;
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

 -- No derivar K de J ni la fecha del backend como si fuese hecho manual.
 IF v_ev.spreadsheet_id IS DISTINCT FROM v_config.spreadsheet_id
   OR v_ev.columna IS DISTINCT FROM 'K'
   OR v_ev.verificador IS DISTINCT FROM 'GOOGLE_INDEPENDIENTE'
   OR v_ev.actor_verificado IS NULL
   OR v_ev.evidencia_sha256 !~ '^[0-9a-f]{64}$'
   OR v_ev.evento_en < v_corte OR v_ev.evento_en > clock_timestamp()+interval '5 minutes'
   OR v_ev.verificado_en < v_ev.evento_en
   OR v_ev.verificado_en > clock_timestamp()+interval '5 minutes'
 THEN v_motivo:='EVIDENCIA_INSUFICIENTE'; END IF;

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

 IF v_motivo IS NOT NULL THEN
  v_result:=jsonb_build_object(
   'protocolo','sincro13-cas-k-v1','estado','RETENIDA','motivo',v_motivo,
   'id_fila',v_ev.id_fila,'columna','K',
   'autoriza_sincronizar',false,'escritura_operativa_realizada',false);
  UPDATE app_private.sincro13_k_evidencias
    SET estado='RETENIDA',resultado=v_result,consumido_en=clock_timestamp()
    WHERE evidencia_id=p_evidencia_id AND estado='PENDIENTE';
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
    'autoriza_sincronizar',false,'escritura_operativa_realizada',true);
 UPDATE app_private.sincro13_k_evidencias
  SET estado='APLICADA',resultado=v_result,consumido_en=clock_timestamp()
  WHERE evidencia_id=p_evidencia_id AND estado='PENDIENTE';
 RETURN v_result;
END;
$s13cas$;

REVOKE ALL ON FUNCTION app_private.sincro13_cas_k(text,uuid,uuid)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION app_private.sincro13_cas_k(text,uuid,uuid)
 TO service_role;
COMMIT;
