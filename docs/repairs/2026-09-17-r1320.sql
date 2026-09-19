-- Ejecutar solo tras aplicar alpha76_manteniment_identidad_etapa_actual.
-- Conserva las T duplicadas anuladas, con motivo, y todas las T originales.
BEGIN;
DO $repair$
DECLARE
  v_registro uuid;
  v_seguimiento uuid;
  v_count integer;
BEGIN
  SELECT r.id, r.seguimiento_id INTO STRICT v_registro, v_seguimiento
  FROM public.registros_hotel r JOIN public.pizarras p ON p.id = r.pizarra_id
  WHERE p.estado = 'en_curso' AND r.vehiculo_sustituido = 'R1320'
    AND r.numero_parada = '2600121' AND NOT r.cancelado
  FOR UPDATE OF r;

  -- Adopta las entradas donde realmente están agrupados los trabajos.
  UPDATE app_private.manteniment_t_visitas v
  SET grupo_entrada_id = e.grupo_documental_id,
      grupo_recogida_id = pickup.grupo_documental_id,
      actualizado_en = clock_timestamp()
  FROM app_private.manteniment_t_trabajos w
  JOIN public.trabajos_etapa_hotel t ON t.id = w.trabajo_hotel_id
  JOIN public.etapas_hotel e ON e.id = app_private.manteniment_etapa_actual(
    w.seguimiento_id, t.etapa_hotel_id)
  JOIN public.etapas_hotel pickup ON pickup.registro_hotel_id = e.registro_hotel_id
    AND pickup.etapa_origen_id = e.id AND pickup.tipo_etapa = 'recogida_taller'
    AND NOT pickup.cancelado
  WHERE v.id = w.visita_id AND v.seguimiento_id = v_seguimiento
    AND v.modalidad = 'taller' AND e.tipo_etapa = 'entrada_taller'
    AND NOT e.cancelado;

  PERFORM set_config('app.audit_origin', 'reparacion-duplicados-r1320-20260917', true);
  PERFORM set_config('app.reconciliando_etapas', '1', true);
  SET CONSTRAINTS etapas_hotel_posicion_activa_uq DEFERRED;

  UPDATE public.etapas_hotel e
  SET cancelado = true, estado = 'anulada',
      motivo_cancelacion = 'Duplicada por sincronización: se conserva la visita original de Fridiel y sus trabajos.',
      cancelado_en = clock_timestamp()
  WHERE e.registro_hotel_id = v_registro AND NOT e.cancelado
    AND e.nombre IN ('Entrada FRIDIEL', 'Recogida FRIDIEL')
    AND e.observaciones = 'Generada desde las necesidades pendientes de MANTENIMENT.'
    AND e.creado_en >= '2026-09-17 12:08:00+00'::timestamptz
    AND e.creado_en < '2026-09-17 12:09:00+00'::timestamptz
    AND e.estado = 'pendiente' AND e.fecha_real IS NULL
    AND e.fecha_inicio_real IS NULL AND e.fecha_fin_real IS NULL
    AND NOT EXISTS (SELECT 1 FROM public.trabajos_etapa_hotel t WHERE t.etapa_hotel_id=e.id)
    AND NOT EXISTS (SELECT 1 FROM app_private.manteniment_t_visitas v
      WHERE v.seguimiento_id = v_seguimiento
        AND e.grupo_documental_id IN (v.grupo_entrada_id, v.grupo_recogida_id));
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> 4 THEN
    RAISE EXCEPTION 'Se esperaban exactamente cuatro T vacías duplicadas de R1320; encontradas %', v_count;
  END IF;

  WITH orden AS (
    SELECT id, row_number() OVER (ORDER BY posicion, creado_en, id)::integer AS posicion
    FROM public.etapas_hotel WHERE registro_hotel_id = v_registro AND NOT cancelado
  )
  UPDATE public.etapas_hotel e SET posicion = orden.posicion
  FROM orden WHERE e.id = orden.id AND e.posicion <> orden.posicion;

  PERFORM set_config('app.reconciliando_etapas', '0', true);
  PERFORM app_private.manteniment_encolar_parada(v_seguimiento);
END;
$repair$;

COMMIT;
