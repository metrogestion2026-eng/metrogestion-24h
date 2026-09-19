-- Reparación de los datos heredados, después de corregir identidad y agrupación.
-- Las T retiradas están vacías en todas sus copias. No se borran trabajos,
-- documentos ni auditoría. Aborta si cambia cualquiera de esas condiciones.
BEGIN;
SET LOCAL lock_timeout='10s';
SET LOCAL statement_timeout='90s';
DO $repair$
DECLARE
  v_follow uuid;
  v_registro uuid;
  v_n integer;
BEGIN
  SELECT r.id,r.seguimiento_id INTO STRICT v_registro,v_follow
  FROM public.registros_hotel r JOIN public.pizarras p ON p.id=r.pizarra_id
  WHERE p.estado='en_curso' AND r.vehiculo_sustituido='R1487'
    AND r.numero_parada='2600152' AND NOT r.cancelado FOR UPDATE OF r;
  IF v_follow<>'5e172b9a-29c5-402f-864d-0724eb8c8af9'::uuid THEN
    RAISE EXCEPTION 'Ha cambiado el seguimiento de R1487';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('manteniment-visita:'||v_follow::text,0));
  PERFORM e.id FROM public.etapas_hotel e JOIN public.registros_hotel r ON r.id=e.registro_hotel_id
    WHERE r.seguimiento_id=v_follow ORDER BY e.id FOR UPDATE OF e;
  SELECT count(*) INTO v_n FROM public.etapas_hotel WHERE registro_hotel_id=v_registro;
  IF v_n<>18 THEN RAISE EXCEPTION 'La ficha ha cambiado: % T',v_n; END IF;

  CREATE TEMP TABLE tmp_r1487_retirar ON COMMIT DROP AS
  SELECT e.id,e.tipo_etapa,e.registro_hotel_id FROM public.etapas_hotel e
  JOIN public.registros_hotel r ON r.id=e.registro_hotel_id
  WHERE r.seguimiento_id=v_follow AND e.seguimiento_id IN (
    '4e2169e5-7e35-479b-9385-23b79d4c6a7b'::uuid, -- GP ya agrupado
    '3a4fefbb-336d-4a8f-8e41-d5cae4661070', -- BPW ya agrupado
    'fbc28f04-9562-4c00-91da-28f1e3928ee3', -- MCD ya agrupado
    '63ba67c6-c26f-4b45-b8b8-165e1a398109', -- recogida ITV anulada
    'c303f1a2-6890-46d1-99a2-0c5088cc3f70', -- entrada DIRECAUTO duplicada
    'd1122020-607e-4334-807c-84d23457d5c1', -- recogida DIRECAUTO duplicada
    '3a5fb4d0-11d4-444d-bf7a-65008184eaf3', -- entrada FRIGICOLL duplicada
    'd6add7ba-aea3-4c23-bcdf-91d4cfc7e239', -- recogida FRIGICOLL duplicada
    '04e3ef93-d221-4ea7-9ff2-03083a0d15f3', -- LKT duplicada
    '42d11238-9587-4cdb-80c7-57010edc6572', -- ITV duplicada
    'c63cf57c-c5f3-4ae6-b69f-1322c086bae7' -- MCD pendiente duplicada
  );
  IF (SELECT count(*) FROM tmp_r1487_retirar WHERE registro_hotel_id=v_registro)<>11 THEN
    RAISE EXCEPTION 'Las once T sobrantes ya no coinciden';
  END IF;
  IF EXISTS (SELECT 1 FROM public.etapas_hotel e JOIN tmp_r1487_retirar m ON m.id=e.id
    WHERE e.fecha_real IS NOT NULL OR e.fecha_inicio_real IS NOT NULL OR e.fecha_fin_real IS NOT NULL
      OR e.fecha_prevista IS NOT NULL OR e.estado NOT IN ('pendiente','anulada'))
    OR EXISTS (SELECT 1 FROM public.trabajos_etapa_hotel t JOIN tmp_r1487_retirar m ON m.id=t.etapa_hotel_id)
    OR EXISTS (SELECT 1 FROM public.documentos_gestion d JOIN tmp_r1487_retirar m ON m.id=d.etapa_hotel_id)
    OR EXISTS (SELECT 1 FROM public.reservas_pendientes_resueltos d JOIN tmp_r1487_retirar m ON m.id=d.etapa_hotel_id)
    OR EXISTS (SELECT 1 FROM app_private.reservas_pendientes_reaperturas d JOIN tmp_r1487_retirar m ON m.id=d.etapa_hotel_id)
    OR EXISTS (SELECT 1 FROM public.anotaciones_generadas_hotel_anuladas d JOIN tmp_r1487_retirar m ON m.id=d.etapa_origen_id) THEN
    RAISE EXCEPTION 'Una T sobrante tiene datos o vínculos: no se elimina';
  END IF;

  PERFORM set_config('app.audit_origin','reparacion-identidad-r1487-20260919',true);
  PERFORM set_config('app.reconciliando_etapas','1',true);
  SET CONSTRAINTS etapas_hotel_posicion_activa_uq DEFERRED;
  DELETE FROM public.etapas_hotel e USING tmp_r1487_retirar m
    WHERE e.id=m.id AND m.tipo_etapa='recogida_taller';
  DELETE FROM public.etapas_hotel e USING tmp_r1487_retirar m WHERE e.id=m.id;

  -- F actual: DIRECAUTO, FRIGICOLL, UPC y APPLUS VILAFRANCA.
  UPDATE public.etapas_hotel e SET
    lugar=CASE e.seguimiento_id WHEN 'a9830d28-60a9-4b42-92ee-996dc104e342' THEN 'FRIGICOLL'
      WHEN 'a0e6704f-d48a-42bf-9d6e-63532bfccfc5' THEN 'FRIGICOLL'
      WHEN '101d646a-c2d2-4a44-a3c4-1cc6ae145163' THEN 'UPC' ELSE 'APPLUS VILAFRANCA' END,
    nombre=CASE e.seguimiento_id WHEN 'a9830d28-60a9-4b42-92ee-996dc104e342' THEN 'Entrada FRIGICOLL'
      WHEN 'a0e6704f-d48a-42bf-9d6e-63532bfccfc5' THEN 'Recogida FRIGICOLL' ELSE e.nombre END,
    taller_id=CASE WHEN e.seguimiento_id='101d646a-c2d2-4a44-a3c4-1cc6ae145163' THEN NULL ELSE e.taller_id END,
    centro_taller_id=CASE WHEN e.seguimiento_id='101d646a-c2d2-4a44-a3c4-1cc6ae145163' THEN NULL ELSE e.centro_taller_id END
  FROM public.registros_hotel r WHERE r.id=e.registro_hotel_id AND r.seguimiento_id=v_follow
    AND e.seguimiento_id IN ('a9830d28-60a9-4b42-92ee-996dc104e342','a0e6704f-d48a-42bf-9d6e-63532bfccfc5',
      '101d646a-c2d2-4a44-a3c4-1cc6ae145163','f943f44e-fbe1-473d-a29f-75cc3156755b');

  UPDATE app_private.manteniment_t_visitas v SET
    taller=x.taller,clave_visita='LUGAR|F:'||x.taller,modalidad=x.modalidad,
    grupo_entrada_id=e.grupo_documental_id,grupo_recogida_id=rec.grupo_documental_id,
    actualizado_en=clock_timestamp()
  FROM (VALUES
    ('b4459837-6e0c-4f3e-ab46-d9663d9db186'::uuid,'DIRECAUTO','taller','83e04a8e-7563-4860-a89b-0a71677f8be3'::uuid),
    ('f09e83d5-5b0d-45a6-a44d-de0dd708d57d','FRIGICOLL','taller','a9830d28-60a9-4b42-92ee-996dc104e342'),
    ('fcdb1107-19ed-4fa4-a3aa-b9b1d930539d','UPC','gestion','101d646a-c2d2-4a44-a3c4-1cc6ae145163'),
    ('2bba00f8-e057-41c9-a700-6e64eb4c0d95','APPLUS VILAFRANCA','tramite','f943f44e-fbe1-473d-a29f-75cc3156755b')
  ) x(id,taller,modalidad,identidad)
  JOIN public.etapas_hotel e ON e.registro_hotel_id=v_registro AND e.seguimiento_id=x.identidad
  LEFT JOIN public.etapas_hotel rec ON rec.etapa_origen_id=e.id AND NOT rec.cancelado AND rec.tipo_etapa='recogida_taller'
  WHERE v.id=x.id AND v.seguimiento_id=v_follow;
  UPDATE app_private.manteniment_t_trabajos w SET taller=v.taller,
    clave_trabajo='F:'||v.taller||'|H:'||w.designacion,grupo_etapa_id=v.grupo_entrada_id,
    actualizado_en=clock_timestamp()
  FROM app_private.manteniment_t_visitas v WHERE v.id=w.visita_id AND w.seguimiento_id=v_follow;

  WITH orden AS (
    SELECT e.id,row_number() OVER (PARTITION BY e.registro_hotel_id ORDER BY e.posicion,e.creado_en,e.id)::integer AS posicion
    FROM public.etapas_hotel e JOIN public.registros_hotel r ON r.id=e.registro_hotel_id
    WHERE r.seguimiento_id=v_follow AND NOT e.cancelado
  ) UPDATE public.etapas_hotel e SET posicion=o.posicion FROM orden o WHERE e.id=o.id AND e.posicion<>o.posicion;
  IF (SELECT count(*) FROM public.etapas_hotel WHERE registro_hotel_id=v_registro)<>7
    OR (SELECT count(*) FROM public.trabajos_etapa_hotel t JOIN public.etapas_hotel e ON e.id=t.etapa_hotel_id
      WHERE e.registro_hotel_id=v_registro)<>5 THEN RAISE EXCEPTION 'Resultado final inesperado'; END IF;
  PERFORM set_config('app.reconciliando_etapas','0',true);
  PERFORM app_private.manteniment_encolar_parada(v_follow);
END $repair$;
SET CONSTRAINTS ALL IMMEDIATE;
SELECT count(*) AS copias_vacias_retiradas FROM tmp_r1487_retirar;
COMMIT;
