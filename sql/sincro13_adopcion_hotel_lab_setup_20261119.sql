-- Solo laboratorio PG17, se instala DESPUES de todas las pruebas CAS previas.
-- No trasplantar a Supabase. Simula únicamente la proyección y touch de
-- etapas_hotel existentes en Metroges; NO equivale a sus 28 triggers reales.
ALTER TABLE public.etapas_hotel
 ADD COLUMN fecha_inicio_real timestamptz,
 ADD COLUMN estado text NOT NULL DEFAULT 'pendiente',
 ADD COLUMN estado_catalogo_codigo text NOT NULL DEFAULT 'pendiente',
 ADD COLUMN version integer NOT NULL DEFAULT 1,
 ADD COLUMN modificado_por uuid;
ALTER TABLE public.registros_hotel
 ADD COLUMN pizarra_id uuid,
 ADD COLUMN retirado_hotel_activo boolean NOT NULL DEFAULT false,
 ADD COLUMN estado text NOT NULL DEFAULT 'en_taller';
CREATE TABLE public.pizarras (
 id uuid PRIMARY KEY,
 estado text NOT NULL CHECK (estado IN ('en_curso','archivada'))
);
CREATE TABLE public.hotel_edicion_piloto (
 registro_hotel_id uuid PRIMARY KEY,
 activo boolean NOT NULL DEFAULT false
);
INSERT INTO public.pizarras(id,estado)
VALUES ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','en_curso');
UPDATE public.registros_hotel
 SET pizarra_id='cccccccc-cccc-4ccc-8ccc-cccccccccccc'
WHERE id='77777777-7777-4777-8777-777777777777';
INSERT INTO public.hotel_edicion_piloto(registro_hotel_id,activo)
VALUES ('77777777-7777-4777-8777-777777777777',true);

-- Restituir el libro ficticio al estado ANTERIOR a una recogida, antes
-- de crear los triggers. El cierre taller J permanece del ensayo previo.
UPDATE public.etapas_hotel
 SET fecha_real=NULL,fecha_inicio_real='2026-11-18T07:00:00Z',
     estado='en_curso',estado_catalogo_codigo='en_curso',
     version=1,modificado_por=NULL
 WHERE id='66666666-6666-4666-8666-666666666666';
UPDATE app_private.manteniment_t_trabajos
 SET fecha_recogida=NULL
 WHERE sync_id='11111111-1111-4111-8111-111111111111';
UPDATE app_private.manteniment_parada_outbox
 SET estado='confirmado',payload='{}'::jsonb,ultimo_error=''
 WHERE seguimiento_id='33333333-3333-4333-8333-333333333333';

CREATE FUNCTION app_private.s13_lab_touch_stage()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 NEW.version:=OLD.version+1;
 RETURN NEW;
END;
$$;
CREATE TRIGGER s13_lab_stage_touch
BEFORE UPDATE ON public.etapas_hotel
FOR EACH ROW EXECUTE FUNCTION app_private.s13_lab_touch_stage();

-- La aplicación real trae su propio manteniment_fechas_desde_etapa;
-- esta simulación intencionadamente mínima actualiza solo K desde
-- el hito fecha_real de entrada_taller y encola una salida con K correcta.
CREATE FUNCTION app_private.s13_lab_fechas_desde_etapa()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.fecha_real IS NOT DISTINCT FROM OLD.fecha_real THEN RETURN NEW; END IF;
 IF NEW.tipo_etapa='entrada_taller' AND NOT NEW.cancelado THEN
   UPDATE app_private.manteniment_t_trabajos w
   SET fecha_recogida=(NEW.fecha_real AT TIME ZONE 'Europe/Madrid')::date,
       actualizado_en=clock_timestamp()
   FROM public.trabajos_etapa_hotel t
   WHERE t.id=w.trabajo_hotel_id
     AND t.etapa_hotel_id=NEW.id
     AND w.seguimiento_id=(
       SELECT r.seguimiento_id FROM public.registros_hotel r
       WHERE r.id=NEW.registro_hotel_id
     );
   UPDATE app_private.manteniment_parada_outbox
   SET estado='pendiente',
       payload=jsonb_build_object(
         'trabajos_asignados',jsonb_build_array(
            jsonb_build_object(
              'trabajo_sync_id',
              '11111111-1111-4111-8111-111111111111',
              'fecha_salida',
              (NEW.fecha_real AT TIME ZONE 'Europe/Madrid')::date
            )
         )
       ),
       ultimo_error=''
   WHERE seguimiento_id=(SELECT r.seguimiento_id FROM public.registros_hotel r WHERE r.id=NEW.registro_hotel_id);
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER s13_lab_etapa_proyeccion
AFTER UPDATE OF fecha_real ON public.etapas_hotel
FOR EACH ROW EXECUTE FUNCTION app_private.s13_lab_fechas_desde_etapa();


-- Sólo LABORATORIO: derivación mínima de estado de ficha después de
-- completar hito Recogido. No representa todos los efectos reales.
CREATE FUNCTION app_private.sincronizar_situacion_operativa_hotel_alpha75(
 p_registro uuid,p_forzar boolean
) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  UPDATE public.registros_hotel r SET estado='recogido_pendiente_ruta'
  WHERE r.id=p_registro
    AND EXISTS(
      SELECT 1 FROM public.etapas_hotel e
      WHERE e.registro_hotel_id=r.id AND e.estado='realizada'
      AND e.fecha_real IS NOT NULL
    );
END;
$$;
