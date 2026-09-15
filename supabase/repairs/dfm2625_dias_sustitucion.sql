-- APLICADA el 15/09/2026. Registro de reparación; no requiere despliegue de la app.
-- También se actualizaron únicamente L2775 (6) y P2775 (1668) de MANTENIMENT.
-- Verificados después: fechas y formato conservados, factura y cola coinciden.
BEGIN;
-- Reparación puntual autorizada: PA-2600168 (DFM 2625).
-- MANTENIMENT, fila 2775: L=6 y P=1668; conserva J=10/09 y K=15/09.
-- La sincronización retenía L=2/P=556 como ajustes manuales antiguos.
-- Se usa el importador existente para conservar el protocolo y regenerar su cola.
-- Repetible solo mientras coincidan la identidad, fechas y cálculo verificados.
DO $repair$
DECLARE
  v_sync app_private.manteniment_parada_sync%ROWTYPE;
  v_billing record;
  v_payload jsonb;
BEGIN
  SELECT * INTO STRICT v_sync FROM app_private.manteniment_parada_sync
  WHERE seguimiento_id='d300a8ce-711a-4cfa-9d60-18bf280a5042' FOR UPDATE;
  IF v_sync.sync_id <> '9b9017c8-3482-4f8e-a0b7-67ff98fc728c'
     OR v_sync.fila_manteniment <> 2775
     OR v_sync.tancament <> 'TANCAMENT 9'
     OR v_sync.fecha_corte IS NOT NULL AND v_sync.fecha_corte <> DATE '2026-09-15'
     OR (v_sync.dias_parada_manual, v_sync.km_facturables_manual) NOT IN ((2,556),(6,1668)) THEN
    RAISE EXCEPTION 'El vínculo o los importes han cambiado; no se aplica la reparación.';
  END IF;
  SELECT * INTO STRICT v_billing FROM public.facturacion_dfm_periodos
  WHERE seguimiento_id=v_sync.seguimiento_id AND periodo='2026-09';
  IF v_billing.dfm <> '2625' OR v_billing.numero_parada <> '2600168'
     OR v_billing.tramo_inicio <> DATE '2026-09-10' OR v_billing.tramo_fin <> DATE '2026-09-15'
     OR v_billing.dias_facturables <> 6 OR v_billing.km_facturables <> 1668
     OR v_billing.km_dia <> 278 THEN
    RAISE EXCEPTION 'El cálculo de la parada ya no coincide con el validado.';
  END IF;
  PERFORM app_private.manteniment_importar_paradas('[{"fila":2775,"sync_id":"9b9017c8-3482-4f8e-a0b7-67ff98fc728c","dfm":"2625","matricula":"1614MTP","tipo":"","upc":"IONUT","numero_parada":"PA-2600168","sustituto":"2523","estado":"PARADA","fecha_programada":"2026-09-10","fecha_parada":"2026-09-10","fecha_k":"2026-09-15","dias_parada":6,"marca":"MERCEDES","km_facturables":1668,"tancament":"TANCAMENT 9"}]'::jsonb);
  v_payload := app_private.manteniment_construir_payload_parada(v_sync.seguimiento_id);
  IF (v_payload->>'dias_parada')::integer <> 6 OR (v_payload->>'km_facturables')::numeric <> 1668
     OR v_payload->>'fecha_k' <> '2026-09-15' THEN
    RAISE EXCEPTION 'La sincronización no conserva la corrección.';
  END IF;
END;
$repair$;

COMMIT;
