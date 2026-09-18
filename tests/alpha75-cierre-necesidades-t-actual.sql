-- Ejecutar como un bloque completo, después de aplicar la migración.
-- Utiliza las fichas de la reparación como fixtures y revierte todas las pruebas.
BEGIN;
CREATE TEMP TABLE tmp_cierre_pruebas(prueba text, ok boolean) ON COMMIT DROP;
DO $test$
DECLARE
  v_gp app_private.manteniment_t_trabajos%rowtype;
  v_repuesto app_private.manteniment_t_trabajos%rowtype;
  v_stage uuid;
  v_original uuid;
  v_count integer;
  v_revision integer;
BEGIN
  SELECT * INTO STRICT v_gp FROM app_private.manteniment_t_trabajos
  WHERE sync_id='2bb782b8-9e9c-4b83-87c4-91ae4ae9be67';
  SELECT etapa_hotel_id INTO v_original FROM public.trabajos_etapa_hotel WHERE id=v_gp.trabajo_hotel_id;
  v_stage := app_private.manteniment_etapa_actual(v_gp.seguimiento_id,v_original);
  IF v_stage=v_original THEN RAISE EXCEPTION 'La prueba necesita una T copiada'; END IF;
  UPDATE app_private.manteniment_t_trabajos SET fecha_realizada=NULL,fecha_recogida=NULL WHERE id=v_gp.id;
  SELECT count(*) INTO v_count FROM jsonb_array_elements(app_private.manteniment_trabajos_asignados(v_gp.seguimiento_id)) x
  WHERE x->>'trabajo_sync_id'=v_gp.sync_id::text AND x->>'fecha_salida'='2026-09-17';
  IF v_count<>2 THEN RAISE EXCEPTION 'El cierre de la T debe alcanzar las dos necesidades GP'; END IF;
  INSERT INTO tmp_cierre_pruebas VALUES ('La T realizada cierra todas sus filas aunque el vínculo aún no tenga K',true);

  SELECT revision INTO v_revision FROM app_private.manteniment_parada_outbox WHERE seguimiento_id=v_gp.seguimiento_id;
  UPDATE public.etapas_hotel SET fecha_real='2026-09-16 22:30:00+00' WHERE id=v_stage;
  IF NOT EXISTS (SELECT 1 FROM app_private.manteniment_t_trabajos WHERE id=v_gp.id
      AND fecha_realizada='2026-09-17' AND fecha_recogida='2026-09-17') THEN
    RAISE EXCEPTION 'El trigger no resolvió la T copiada o la fecha de Madrid';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM app_private.manteniment_parada_outbox WHERE seguimiento_id=v_gp.seguimiento_id
      AND revision>v_revision AND estado='pendiente') THEN RAISE EXCEPTION 'No se encoló la ficha padre'; END IF;
  INSERT INTO tmp_cierre_pruebas VALUES ('La copia diaria actualiza el vínculo y encola la ficha correcta',true);

  SELECT * INTO STRICT v_repuesto FROM app_private.manteniment_t_trabajos
  WHERE sync_id='2cbe9c3e-58a3-49d6-a5cf-0007bae0937d';
  SELECT app_private.manteniment_etapa_actual(w.seguimiento_id,t.etapa_hotel_id) INTO v_stage
  FROM app_private.manteniment_t_trabajos w JOIN public.trabajos_etapa_hotel t ON t.id=w.trabajo_hotel_id WHERE w.id=v_repuesto.id;
  UPDATE app_private.manteniment_t_trabajos SET fecha_realizada='2026-03-06',fecha_recogida=NULL WHERE id=v_repuesto.id;
  UPDATE public.etapas_hotel SET fecha_real='2026-09-17 06:26:01+00' WHERE id=v_stage;
  IF NOT EXISTS (SELECT 1 FROM app_private.manteniment_t_trabajos WHERE id=v_repuesto.id
      AND fecha_realizada='2026-03-06' AND fecha_recogida='2026-09-17') THEN
    RAISE EXCEPTION 'REPUESTOS debe conservar la fecha de pedido y cerrar K';
  END IF;
  INSERT INTO tmp_cierre_pruebas VALUES ('REPUESTOS conserva J y recibe K al completar su gestión',true);
END;
$test$;

DO $test$
DECLARE v_count integer;
BEGIN
  SELECT count(*) INTO v_count
  FROM app_private.manteniment_t_trabajos w
  JOIN public.trabajos_etapa_hotel t ON t.id=w.trabajo_hotel_id
  JOIN public.etapas_hotel e ON e.id=app_private.manteniment_etapa_actual(w.seguimiento_id,t.etapa_hotel_id)
  LEFT JOIN app_private.manteniment_t_visitas v ON v.id=w.visita_id
  CROSS JOIN LATERAL jsonb_array_elements(app_private.manteniment_trabajos_asignados(w.seguimiento_id)) x
  WHERE x->>'trabajo_sync_id'=w.sync_id::text AND e.estado<>'realizada'
    AND w.fecha_recogida IS NULL AND e.tipo_etapa NOT IN ('entrada_taller','recogida_taller')
    AND x->>'fecha_salida' IS NOT NULL;
  IF v_count<>0 THEN RAISE EXCEPTION 'Una T pendiente recibió cierre inferido'; END IF;
  INSERT INTO tmp_cierre_pruebas VALUES ('Las T pendientes no reciben una fecha de cierre inferida',true);

  SELECT count(*) INTO v_count
  FROM app_private.manteniment_t_trabajos w
  JOIN public.trabajos_etapa_hotel t ON t.id=w.trabajo_hotel_id
  JOIN public.etapas_hotel e ON e.id=app_private.manteniment_etapa_actual(w.seguimiento_id,t.etapa_hotel_id)
  CROSS JOIN LATERAL jsonb_array_elements(app_private.manteniment_trabajos_asignados(w.seguimiento_id)) x
  WHERE x->>'trabajo_sync_id'=w.sync_id::text AND (e.cancelado OR e.estado='anulada' OR t.cancelado);
  IF v_count<>0 THEN RAISE EXCEPTION 'Un trabajo o una T anulada se envía como cerrado'; END IF;
  INSERT INTO tmp_cierre_pruebas VALUES ('Las T y trabajos anulados permanecen excluidos',true);

  IF EXISTS (SELECT 1 FROM jsonb_array_elements(app_private.manteniment_trabajos_asignados('af2ec954-77c4-42b4-9072-92ce2c08867e')) x
      WHERE x->>'trabajo_sync_id'='dcfe3d6f-67d1-4876-be1f-55604748fe9a' AND x->>'fecha_salida' IS NOT NULL) THEN
    RAISE EXCEPTION 'Se inventó una fecha para una T sin fecha real';
  END IF;
  INSERT INTO tmp_cierre_pruebas VALUES ('No se inventa fecha para una T histórica sin fechas',true);

  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(app_private.manteniment_trabajos_asignados('af2ec954-77c4-42b4-9072-92ce2c08867e')) x
      WHERE x->>'trabajo_sync_id'='833d0f0c-f9ac-4bc4-ac92-168468ee0759' AND x->>'fecha_salida'='2026-09-09') THEN
    RAISE EXCEPTION 'Una entrada sin recogida no recibe cierre';
  END IF;
  INSERT INTO tmp_cierre_pruebas VALUES ('Una visita sin recogida cierra al realizar su T',true);
END;
$test$;
DO $test$
DECLARE v_stage uuid; v_pickup uuid; v_work uuid; v_group uuid; v_count integer;
BEGIN
  SELECT w.id,app_private.manteniment_etapa_actual(w.seguimiento_id,t.etapa_hotel_id),v.grupo_recogida_id
    INTO STRICT v_work,v_stage,v_group
  FROM app_private.manteniment_t_trabajos w
  JOIN public.trabajos_etapa_hotel t ON t.id=w.trabajo_hotel_id
  JOIN app_private.manteniment_t_visitas v ON v.id=w.visita_id
  WHERE w.sync_id='60a2c742-f03d-44b8-b8a3-4293150e5d13';
  UPDATE app_private.manteniment_t_trabajos SET fecha_realizada=NULL,fecha_recogida=NULL WHERE id=v_work;
  UPDATE public.etapas_hotel SET fecha_real='2026-09-15 06:21:01+00' WHERE id=v_stage;
  IF NOT EXISTS (SELECT 1 FROM app_private.manteniment_t_trabajos WHERE id=v_work
      AND fecha_realizada='2026-09-15' AND fecha_recogida IS NULL) THEN
    RAISE EXCEPTION 'La entrada ordinaria de taller no debe completar K';
  END IF;
  SELECT e.id INTO STRICT v_pickup FROM public.etapas_hotel e
  WHERE e.registro_hotel_id=(SELECT registro_hotel_id FROM public.etapas_hotel WHERE id=v_stage)
    AND e.grupo_documental_id=v_group AND NOT e.cancelado;
  UPDATE public.etapas_hotel SET fecha_real='2026-09-17 06:27:01+00' WHERE id=v_pickup;
  IF NOT EXISTS (SELECT 1 FROM app_private.manteniment_t_trabajos WHERE id=v_work
      AND fecha_realizada='2026-09-15' AND fecha_recogida='2026-09-17') THEN
    RAISE EXCEPTION 'La recogida de taller debe completar K sin cambiar J';
  END IF;
  INSERT INTO tmp_cierre_pruebas VALUES ('Taller conserva entrada J y recogida K separadas',true);

  SELECT e.id INTO STRICT v_stage
  FROM app_private.manteniment_t_trabajos w
  JOIN public.trabajos_etapa_hotel t ON t.id=w.trabajo_hotel_id
  JOIN public.etapas_hotel e ON e.id=app_private.manteniment_etapa_actual(w.seguimiento_id,t.etapa_hotel_id)
  JOIN public.registros_hotel r ON r.id=e.registro_hotel_id
  WHERE r.vehiculo_sustituido='2719' AND w.designacion IN ('ITV','44TN')
    AND NOT e.cancelado AND NOT t.cancelado
  GROUP BY e.id HAVING count(*)=2;
  UPDATE public.etapas_hotel SET estado='realizada',estado_catalogo_codigo='realizada',
    fecha_real='2026-09-17 08:00:00+00',fecha_fin_real='2026-09-17 08:00:00+00'
  WHERE id=v_stage;
  SELECT count(*) INTO v_count FROM app_private.manteniment_t_trabajos w
  JOIN public.trabajos_etapa_hotel t ON t.id=w.trabajo_hotel_id
  WHERE app_private.manteniment_etapa_actual(w.seguimiento_id,t.etapa_hotel_id)=v_stage
    AND w.designacion IN ('ITV','44TN') AND w.fecha_recogida='2026-09-17';
  IF v_count<>2 THEN RAISE EXCEPTION 'No se cerraron todos los trabajos agrupados'; END IF;
  INSERT INTO tmp_cierre_pruebas VALUES ('Realizar una T de ITV y 44TN cierra las dos necesidades',true);
END;
$test$;
SET CONSTRAINTS ALL IMMEDIATE;
SELECT jsonb_agg(to_jsonb(t)) AS pruebas FROM tmp_cierre_pruebas t;
ROLLBACK;
