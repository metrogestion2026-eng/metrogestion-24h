-- Corrección limitada a GP y REPUESTOS de 2723, parada 2600173.
-- Las T de trámite/gestión constan realizadas el 17/09/2026.
-- La salida faltaba en el vínculo de sincronización y en K de tres filas.
BEGIN;

DO $repair$
DECLARE
  v_follow constant uuid := '1724ea90-9bd3-4ffd-86bc-ddf05f71de4c';
  v_count integer;
BEGIN
  PERFORM 1 FROM app_private.manteniment_t_trabajos
  WHERE seguimiento_id = v_follow
    AND sync_id IN ('2bb782b8-9e9c-4b83-87c4-91ae4ae9be67',
                    '2cbe9c3e-58a3-49d6-a5cf-0007bae0937d')
  FOR UPDATE;

  SELECT count(*) INTO v_count
  FROM app_private.manteniment_t_trabajos w
  JOIN public.trabajos_etapa_hotel t ON t.id = w.trabajo_hotel_id
  JOIN public.etapas_hotel e ON e.id = app_private.manteniment_etapa_actual(
    w.seguimiento_id, t.etapa_hotel_id)
  JOIN public.registros_hotel r ON r.id = e.registro_hotel_id
  WHERE w.seguimiento_id = v_follow
    AND w.sync_id IN ('2bb782b8-9e9c-4b83-87c4-91ae4ae9be67',
                      '2cbe9c3e-58a3-49d6-a5cf-0007bae0937d')
    AND w.designacion IN ('GP', 'REPUESTOS')
    AND w.fecha_realizada IS NULL AND w.fecha_recogida IS NULL
    AND r.vehiculo_sustituido = '2723' AND r.numero_parada = '2600173'
    AND r.estado = 'recuperado'
    AND NOT t.cancelado AND NOT e.cancelado AND e.estado = 'realizada'
    AND e.tipo_etapa IN ('TRÁMITE', 'GESTIÓN')
    AND (coalesce(e.fecha_real, e.fecha_fin_real) AT TIME ZONE 'Europe/Madrid')::date
        = DATE '2026-09-17';
  IF v_count <> 2 THEN
    RAISE EXCEPTION '2723: la identidad, estado o fecha de las dos T ha cambiado';
  END IF;

  UPDATE app_private.manteniment_t_trabajos
  SET fecha_realizada = DATE '2026-09-17', fecha_recogida = DATE '2026-09-17',
      actualizado_en = clock_timestamp()
  WHERE seguimiento_id = v_follow
    AND sync_id IN ('2bb782b8-9e9c-4b83-87c4-91ae4ae9be67',
                    '2cbe9c3e-58a3-49d6-a5cf-0007bae0937d');

  SELECT count(*) INTO v_count
  FROM jsonb_array_elements(app_private.manteniment_trabajos_asignados(v_follow)) x
  WHERE x->>'trabajo_sync_id' IN ('2bb782b8-9e9c-4b83-87c4-91ae4ae9be67',
                                 '2cbe9c3e-58a3-49d6-a5cf-0007bae0937d')
    AND x->>'fecha_entrada' = '2026-09-17'
    AND x->>'fecha_salida' = '2026-09-17';
  IF v_count <> 3 THEN
    RAISE EXCEPTION '2723: se esperaban tres necesidades con fecha de cierre';
  END IF;
  PERFORM app_private.manteniment_encolar_parada(v_follow);
END;
$repair$;

COMMIT;
