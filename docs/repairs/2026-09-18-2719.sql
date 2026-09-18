-- Limpieza autorizada de duplicados del 2719, parada 2600125.
-- Traslada trabajos a las T originales y elimina las copias, también en sus
-- pizarras diarias. No desactiva auditoría ni elimina documentos.
BEGIN;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '90s';
DO $repair$
DECLARE
  v_follow uuid;
  v_registro uuid;
  v_count integer;
BEGIN
  SELECT r.id,r.seguimiento_id INTO STRICT v_registro,v_follow
  FROM public.registros_hotel r JOIN public.pizarras p ON p.id=r.pizarra_id
  WHERE p.estado='en_curso' AND r.vehiculo_sustituido='2719'
    AND r.numero_parada='2600125' AND NOT r.cancelado
  FOR UPDATE OF r;
  IF v_follow <> '69b57b1d-95be-451b-a6fe-fac274ba430e'::uuid THEN
    RAISE EXCEPTION 'Ha cambiado el seguimiento del 2719';
  END IF;
  PERFORM r.id FROM public.registros_hotel r WHERE r.seguimiento_id=v_follow ORDER BY r.id FOR UPDATE;
  PERFORM e.id FROM public.etapas_hotel e JOIN public.registros_hotel r ON r.id=e.registro_hotel_id
    WHERE r.seguimiento_id=v_follow ORDER BY e.id FOR UPDATE OF e;
  SELECT count(*) INTO v_count FROM public.etapas_hotel WHERE registro_hotel_id=v_registro;
  IF v_count <> 17 THEN RAISE EXCEPTION 'Ha cambiado la ficha: % T en vez de 17',v_count; END IF;

  PERFORM set_config('app.audit_origin','limpieza-duplicados-2719-20260918',true);
  PERFORM set_config('app.reconciliando_etapas','1',true);
  SET CONSTRAINTS etapas_hotel_posicion_activa_uq DEFERRED;

  CREATE TEMP TABLE tmp_2719_fichas ON COMMIT DROP AS
    SELECT id FROM public.registros_hotel WHERE seguimiento_id=v_follow;
  CREATE TEMP TABLE tmp_2719_etapas ON COMMIT DROP AS
  SELECT e.id AS origen, destino.id AS destino, e.registro_hotel_id, e.cancelado
  FROM public.etapas_hotel e JOIN tmp_2719_fichas f ON f.id=e.registro_hotel_id
  JOIN LATERAL (
    SELECT t.id FROM public.etapas_hotel t
    WHERE t.registro_hotel_id=e.registro_hotel_id AND t.id<>e.id
      AND CASE
        WHEN e.nombre IN ('Entrada 12M','Entrada 18M 150,000','Entrada AUTO DISTRIBUCIÓN','Pendiente de taller · ACT')
          THEN t.grupo_documental_id='b507da59-a1b3-ae05-ac2f-43abc698e675'::uuid
        WHEN e.nombre IN ('Recogida 12M','Recogida 18M 150,000','Recogida AUTO DISTRIBUCIÓN')
          THEN t.grupo_documental_id='c7584eb8-0523-0cbc-5e20-799dc4821f06'::uuid
        WHEN e.nombre IN ('Pendiente de taller · ITV','Pendiente de taller · 44TN','Trámite · ITV','Trámite · 44TN')
          THEN t.grupo_documental_id='424c5a57-4ab1-e9eb-b4bd-06c9e948d564'::uuid
        WHEN e.nombre='Pendiente de taller · EXTINTOR'
          THEN t.nombre='Trámite · EXTINTOR' AND NOT t.cancelado
        ELSE false
      END
    ORDER BY t.cancelado,t.creado_en,t.id LIMIT 1
  ) destino ON true;
  SELECT count(*) INTO v_count FROM tmp_2719_etapas WHERE registro_hotel_id=v_registro;
  IF v_count<>12 THEN RAISE EXCEPTION 'Se esperaban 12 T duplicadas en la ficha actual; encontradas %',v_count; END IF;
  IF EXISTS (SELECT 1 FROM public.etapas_hotel e JOIN tmp_2719_etapas m ON m.origen=e.id
    WHERE e.fecha_real IS NOT NULL OR e.fecha_inicio_real IS NOT NULL OR e.fecha_fin_real IS NOT NULL
      OR e.estado NOT IN ('pendiente','anulada')
      OR (e.observaciones NOT LIKE 'Generada desde las necesidades pendientes de MANTENIMENT.%'
        AND e.observaciones NOT LIKE 'Necesidad detectada en MANTENIMENT%')) THEN
    RAISE EXCEPTION 'Una T duplicada contiene actividad o notas que requieren revisión';
  END IF;
  IF EXISTS (SELECT 1 FROM public.documentos_gestion d JOIN tmp_2719_etapas m ON m.origen=d.etapa_hotel_id)
    OR EXISTS (SELECT 1 FROM public.reservas_pendientes_resueltos d JOIN tmp_2719_etapas m ON m.origen=d.etapa_hotel_id)
    OR EXISTS (SELECT 1 FROM app_private.reservas_pendientes_reaperturas d JOIN tmp_2719_etapas m ON m.origen=d.etapa_hotel_id)
    OR EXISTS (SELECT 1 FROM public.anotaciones_generadas_hotel_anuladas d JOIN tmp_2719_etapas m ON m.origen=d.etapa_origen_id) THEN
    RAISE EXCEPTION 'Han aparecido nuevos vínculos en las T duplicadas; no se elimina ninguno';
  END IF;

  -- Referencias antiguas, ya sustituidas por las fuentes vigentes de ITV/44TN/EXT.
  DELETE FROM app_private.manteniment_t_trabajos WHERE seguimiento_id=v_follow
    AND sync_id IN ('10016dca-b2b5-4c08-8469-09b348a0de79','7221048e-f2e4-4221-9436-e9cfa3542d00','68b55e8a-2307-430e-90b0-24d7aee8da6b');

  -- Las copias ya anuladas solo contienen trabajos automáticos sin datos reales.
  IF EXISTS (SELECT 1 FROM public.trabajos_etapa_hotel t JOIN tmp_2719_etapas m ON m.origen=t.etapa_hotel_id
    WHERE t.cancelado AND m.cancelado AND
      (t.observaciones <> 'Generado automáticamente desde MANTENIMENT.' OR t.km_averia IS NOT NULL
        OR coalesce(t.expediente,'')<>'' OR coalesce(t.diagnostico_real,'')<>'' OR coalesce(t.peritaje_estado,'')<>'')) THEN
    RAISE EXCEPTION 'Un trabajo anulado tiene información adicional';
  END IF;
  DELETE FROM public.trabajos_etapa_hotel t USING tmp_2719_etapas m
    WHERE t.etapa_hotel_id=m.origen AND t.cancelado AND m.cancelado;
  UPDATE public.trabajos_etapa_hotel t SET etapa_hotel_id=m.destino
    FROM tmp_2719_etapas m WHERE t.etapa_hotel_id=m.origen;
  -- Retirar primero las recogidas duplicadas: cada entrada solo admite una
  -- recogida activa y no se pueden reasignar varias a la original.
  DELETE FROM public.etapas_hotel e USING tmp_2719_etapas m
    WHERE e.id=m.origen AND e.tipo_etapa='recogida_taller';
  UPDATE public.etapas_hotel e SET etapa_origen_id=m.destino
    FROM tmp_2719_etapas m WHERE e.etapa_origen_id=m.origen;

  -- Una única visita operativa de Autodis y una única visita de ITV/44TN.
  UPDATE app_private.manteniment_t_trabajos
  SET visita_id='c10da85c-1e45-4e33-9a4f-d1556554e328', taller='AUTODIS',
      grupo_etapa_id='b507da59-a1b3-ae05-ac2f-43abc698e675',
      clave_trabajo=CASE WHEN sync_id='5d24750c-651f-4ec3-b0d9-ffa69b244df2' THEN 'F:AUTODIS|H:MCD'
        WHEN sync_id='cafb8225-f439-45b5-ab3b-0fa000329b06' THEN 'F:AUTODIS|H:ACT' ELSE clave_trabajo END,
      actualizado_en=clock_timestamp()
  WHERE seguimiento_id=v_follow AND designacion IN ('MCD','ACT');
  UPDATE app_private.manteniment_t_trabajos
  SET visita_id='6d89fe6c-8d7b-4f7f-ae11-bec7177d8f22',
      grupo_etapa_id='424c5a57-4ab1-e9eb-b4bd-06c9e948d564',actualizado_en=clock_timestamp()
  WHERE seguimiento_id=v_follow AND designacion IN ('ITV','44TN');
  UPDATE app_private.manteniment_t_trabajos SET taller='TM',clave_trabajo='F:TM|H:EXTINTOR',actualizado_en=clock_timestamp()
  WHERE seguimiento_id=v_follow AND sync_id='d2a23b78-d9f8-48c3-ab11-f376306feb7d';

  UPDATE app_private.manteniment_t_visitas SET modalidad='taller',taller='AUTODIS',clave_visita='TALLER|F:AUTODIS',
    grupo_entrada_id='b507da59-a1b3-ae05-ac2f-43abc698e675',grupo_recogida_id='c7584eb8-0523-0cbc-5e20-799dc4821f06',actualizado_en=clock_timestamp()
  WHERE id='c10da85c-1e45-4e33-9a4f-d1556554e328' AND seguimiento_id=v_follow;
  UPDATE app_private.manteniment_t_visitas SET clave_visita='TRAMITE|F:APPLUS VILAFRANCA',
    grupo_entrada_id='424c5a57-4ab1-e9eb-b4bd-06c9e948d564',grupo_recogida_id=NULL,actualizado_en=clock_timestamp()
  WHERE id='6d89fe6c-8d7b-4f7f-ae11-bec7177d8f22' AND seguimiento_id=v_follow;
  UPDATE app_private.manteniment_t_visitas SET taller='TM',clave_visita='TRAMITE|F:TM',
    grupo_entrada_id='d59b0bec-1d8e-4016-9f5f-e96bd0fc6b17',grupo_recogida_id=NULL,actualizado_en=clock_timestamp()
  WHERE id='0ae1ad72-8fb9-4d05-9280-d26dfdf26351' AND seguimiento_id=v_follow;
  DELETE FROM app_private.manteniment_t_visitas v WHERE v.seguimiento_id=v_follow
    AND NOT EXISTS (SELECT 1 FROM app_private.manteniment_t_trabajos w WHERE w.visita_id=v.id);

  DELETE FROM public.etapas_hotel e USING tmp_2719_etapas m WHERE e.id=m.origen;
  WITH orden AS (
    SELECT e.id,row_number() OVER (PARTITION BY e.registro_hotel_id ORDER BY e.posicion,e.creado_en,e.id)::integer AS posicion
    FROM public.etapas_hotel e JOIN tmp_2719_fichas f ON f.id=e.registro_hotel_id WHERE NOT e.cancelado
  ) UPDATE public.etapas_hotel e SET posicion=o.posicion FROM orden o WHERE e.id=o.id AND e.posicion<>o.posicion;
  UPDATE public.etapas_hotel SET lugar='TM' WHERE registro_hotel_id=v_registro AND grupo_documental_id='d59b0bec-1d8e-4016-9f5f-e96bd0fc6b17';

  IF EXISTS (SELECT 1 FROM app_private.manteniment_t_trabajos w WHERE w.seguimiento_id=v_follow
    AND w.trabajo_hotel_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.trabajos_etapa_hotel t WHERE t.id=w.trabajo_hotel_id)) THEN
    RAISE EXCEPTION 'Quedaría un trabajo de sincronización sin vínculo';
  END IF;
  IF (SELECT count(*) FROM public.etapas_hotel WHERE registro_hotel_id=v_registro)<>5
    OR EXISTS (SELECT 1 FROM public.etapas_hotel WHERE registro_hotel_id=v_registro AND cancelado) THEN
    RAISE EXCEPTION 'La ficha final no tiene las cinco T esperadas';
  END IF;
  PERFORM set_config('app.reconciliando_etapas','0',true);
  PERFORM app_private.manteniment_encolar_parada(v_follow);
END;
$repair$;
COMMIT;
