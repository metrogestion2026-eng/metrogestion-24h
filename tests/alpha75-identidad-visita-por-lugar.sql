-- Pruebas con ROLLBACK; ejecutar después de la migración y la reparación.
BEGIN;
SET LOCAL statement_timeout='120s';
CREATE TEMP TABLE tmp_identidad_resultados(prueba text,resultado jsonb) ON COMMIT DROP;
CREATE TEMP TABLE tmp_identidad_payload(payload jsonb) ON COMMIT DROP;
INSERT INTO tmp_identidad_payload VALUES ($payload$[{"fila": 6678, "trabajo_sync_id": "06fe2946-9c89-4938-9b3c-cc989eb3f9fb", "clave_fila": "R1487|R1540BDT|DIRECAUTO|REPARACIÓN|GP|2025-11-07", "dfm": "R1487", "matricula": "R1540BDT", "numero_parada": "2600152", "taller": "DIRECAUTO", "tipo_trabajo": "REPARACIÓN", "designacion": "GP", "fecha_necesidad": "2025-11-07", "fecha_realizada": "", "fecha_recogida": "", "pendiente_fondo_blanco": true, "prioridad_fondo_amarillo": true, "marca_equipo": "Termo King", "marca_vehiculo": ""}, {"fila": 6680, "trabajo_sync_id": "f228d8fa-dfc8-4e15-890f-6f4f9dbfac40", "clave_fila": "R1487|R1540BDT|FRIGICOLL|MANTENIMIENTO A|MCD|2026-02-20", "dfm": "R1487", "matricula": "R1540BDT", "numero_parada": "2600152", "taller": "FRIGICOLL", "tipo_trabajo": "MANTENIMIENTO A", "designacion": "MCD", "fecha_necesidad": "2026-02-20", "fecha_realizada": "", "fecha_recogida": "", "pendiente_fondo_blanco": true, "prioridad_fondo_amarillo": true, "marca_equipo": "Termo King", "marca_vehiculo": ""}, {"fila": 6685, "trabajo_sync_id": "203cd5d1-7512-42c9-a05e-b18a4b0e904d", "clave_fila": "R1487|R1540BDT|UPC|GESTIÓN|LKT|2026-06-20", "dfm": "R1487", "matricula": "R1540BDT", "numero_parada": "2600152", "taller": "UPC", "tipo_trabajo": "GESTIÓN", "designacion": "LKT", "fecha_necesidad": "2026-06-20", "fecha_realizada": "", "fecha_recogida": "", "pendiente_fondo_blanco": true, "prioridad_fondo_amarillo": true, "marca_equipo": "Termo King", "marca_vehiculo": ""}, {"fila": 6687, "trabajo_sync_id": "f164fc18-f9d1-4205-84c0-36658eef0701", "clave_fila": "R1487|R1540BDT|APPLUS VILAFRANCA|TRÁMITE|ITV|2026-07-07", "dfm": "R1487", "matricula": "R1540BDT", "numero_parada": "2600152", "taller": "APPLUS VILAFRANCA", "tipo_trabajo": "TRÁMITE", "designacion": "ITV", "fecha_necesidad": "2026-07-07", "fecha_realizada": "", "fecha_recogida": "", "pendiente_fondo_blanco": true, "prioridad_fondo_amarillo": true, "marca_equipo": "Termo King", "marca_vehiculo": ""}, {"fila": 6688, "trabajo_sync_id": "186b2bdf-55ce-4d5c-8a33-b34e92442489", "clave_fila": "R1487|R1540BDT|DIRECAUTO|MANTENIMIENTO|BPW|2026-07-07", "dfm": "R1487", "matricula": "R1540BDT", "numero_parada": "2600152", "taller": "DIRECAUTO", "tipo_trabajo": "MANTENIMIENTO", "designacion": "BPW", "fecha_necesidad": "2026-07-07", "fecha_realizada": "", "fecha_recogida": "", "pendiente_fondo_blanco": true, "prioridad_fondo_amarillo": true, "marca_equipo": "Termo King", "marca_vehiculo": ""}, {"fila": 6692, "trabajo_sync_id": "06fe2946-9c89-4938-9b3c-cc989eb3f9fb", "clave_fila": "R1487|R1540BDT|DIRECAUTO|REPARACIÓN|GP|2026-09-22", "dfm": "R1487", "matricula": "R1540BDT", "numero_parada": "2600152", "taller": "DIRECAUTO", "tipo_trabajo": "REPARACIÓN", "designacion": "GP", "fecha_necesidad": "2026-09-22", "fecha_realizada": "", "fecha_recogida": "", "pendiente_fondo_blanco": true, "prioridad_fondo_amarillo": true, "marca_equipo": "Termo King", "marca_vehiculo": ""}]$payload$);
DO $test$ BEGIN
IF EXISTS (
 SELECT 1 FROM app_private.manteniment_t_trabajos w
 JOIN public.trabajos_etapa_hotel t ON t.id=w.trabajo_hotel_id
 JOIN public.etapas_hotel original ON original.id=t.etapa_hotel_id
 JOIN public.etapas_hotel actual ON actual.id=app_private.manteniment_etapa_actual(w.seguimiento_id,original.id)
 WHERE w.seguimiento_id='5e172b9a-29c5-402f-864d-0724eb8c8af9'
 AND actual.seguimiento_id<>original.seguimiento_id
) THEN RAISE EXCEPTION 'El grupo documental ha suplantado la identidad'; END IF;
END $test$;

DO $test$ DECLARE v jsonb; BEGIN v:=app_private.manteniment_importar_trabajos((select payload from tmp_identidad_payload)); IF (v->>'t_creadas')::int<>0 OR (v->>'trabajos_creados')::int<>0 THEN RAISE EXCEPTION 'R1487 pasada 1: %',v; END IF; INSERT INTO tmp_identidad_resultados VALUES ('R1487 pasada 1',v); END $test$;
DROP TABLE IF EXISTS tmp_alpha74_manteniment_candidates,tmp_alpha74_manteniment_raw;

DO $test$ DECLARE v jsonb; BEGIN v:=app_private.manteniment_importar_trabajos((select payload from tmp_identidad_payload)); IF (v->>'t_creadas')::int<>0 OR (v->>'trabajos_creados')::int<>0 THEN RAISE EXCEPTION 'R1487 pasada 2: %',v; END IF; INSERT INTO tmp_identidad_resultados VALUES ('R1487 pasada 2',v); END $test$;
DROP TABLE IF EXISTS tmp_alpha74_manteniment_candidates,tmp_alpha74_manteniment_raw;

DO $test$ DECLARE v jsonb; BEGIN v:=app_private.manteniment_importar_trabajos((select payload from tmp_identidad_payload)); IF (v->>'t_creadas')::int<>0 OR (v->>'trabajos_creados')::int<>0 THEN RAISE EXCEPTION 'R1487 pasada 3: %',v; END IF; INSERT INTO tmp_identidad_resultados VALUES ('R1487 pasada 3',v); END $test$;
DROP TABLE IF EXISTS tmp_alpha74_manteniment_candidates,tmp_alpha74_manteniment_raw;

DO $test$ DECLARE v jsonb; BEGIN v:=app_private.manteniment_importar_trabajos((select jsonb_agg(jsonb_set(value,'{taller}','""'::jsonb)) from tmp_identidad_payload,jsonb_array_elements(payload))); IF (v->>'t_creadas')::int<>0 OR (v->>'trabajos_creados')::int<>0 THEN RAISE EXCEPTION 'F vacío conserva la visita: %',v; END IF; INSERT INTO tmp_identidad_resultados VALUES ('F vacío conserva la visita',v); END $test$;
DROP TABLE IF EXISTS tmp_alpha74_manteniment_candidates,tmp_alpha74_manteniment_raw;

-- La prueba aislada crea una sola ficha en una pizarra futura y luego usa
-- la misma función real que copia las pizarras al cambio de día.
CREATE TEMP TABLE tmp_identidad_fixture(registro uuid,seguimiento uuid,pizarra uuid) ON COMMIT DROP;
DO $test$ DECLARE p uuid; r uuid; f uuid:=gen_random_uuid(); BEGIN
 UPDATE public.pizarras SET estado='archivada' WHERE estado='en_curso';
 INSERT INTO public.pizarras(fecha,estado,origen) VALUES('2099-09-19','en_curso','manual') RETURNING id INTO p;
 INSERT INTO public.registros_hotel(pizarra_id,seguimiento_id,numero_parada,vehiculo_sustituido,matricula_sustituido,estado,fecha_parada)
 VALUES(p,f,'99001487','PRUEBA_IDENTIDAD_R1487','TEST','planificado','2099-09-19') RETURNING id INTO r;
 INSERT INTO tmp_identidad_fixture VALUES(r,f,p);
END $test$;
CREATE TEMP TABLE tmp_identidad_mix(payload jsonb) ON COMMIT DROP;

INSERT INTO tmp_identidad_mix VALUES ($payload$[{"fila": 900011, "clave_fila": "PRUEBA_IDENTIDAD_R1487|PRUEBA MISMO F|REPUESTOS", "dfm": "PRUEBA_IDENTIDAD_R1487", "matricula": "TEST", "numero_parada": "99001487", "taller": "PRUEBA MISMO F", "tipo_trabajo": "GESTIÓN", "designacion": "REPUESTOS", "fecha_necesidad": "2026-09-19", "fecha_realizada": "", "fecha_recogida": "", "pendiente_fondo_blanco": true, "prioridad_fondo_amarillo": true}, {"fila": 900012, "clave_fila": "PRUEBA_IDENTIDAD_R1487|PRUEBA MISMO F|ITV", "dfm": "PRUEBA_IDENTIDAD_R1487", "matricula": "TEST", "numero_parada": "99001487", "taller": "PRUEBA MISMO F", "tipo_trabajo": "TRÁMITE", "designacion": "ITV", "fecha_necesidad": "2026-09-19", "fecha_realizada": "", "fecha_recogida": "", "pendiente_fondo_blanco": true, "prioridad_fondo_amarillo": true}, {"fila": 900013, "clave_fila": "PRUEBA_IDENTIDAD_R1487|PRUEBA MISMO F|GP", "dfm": "PRUEBA_IDENTIDAD_R1487", "matricula": "TEST", "numero_parada": "99001487", "taller": "PRUEBA MISMO F", "tipo_trabajo": "REPARACIÓN", "designacion": "GP", "fecha_necesidad": "2026-09-19", "fecha_realizada": "", "fecha_recogida": "", "pendiente_fondo_blanco": true, "prioridad_fondo_amarillo": true}]$payload$);

DO $test$ DECLARE v jsonb; BEGIN v:=app_private.manteniment_importar_trabajos((select payload from tmp_identidad_mix));  INSERT INTO tmp_identidad_resultados VALUES ('Gestión trámite reparación mismo F',v); END $test$;
DROP TABLE IF EXISTS tmp_alpha74_manteniment_candidates,tmp_alpha74_manteniment_raw;

DO $test$ BEGIN
 IF (SELECT count(DISTINCT t.etapa_hotel_id) FROM app_private.manteniment_t_trabajos w
 JOIN public.trabajos_etapa_hotel t ON t.id=w.trabajo_hotel_id
 WHERE w.seguimiento_id=(SELECT seguimiento FROM tmp_identidad_fixture))<>1 THEN
 RAISE EXCEPTION 'Mismo F ha generado T de trabajo distintas'; END IF;
 IF (SELECT count(*) FROM public.etapas_hotel WHERE registro_hotel_id=(SELECT registro FROM tmp_identidad_fixture)
 AND tipo_etapa='recogida_taller' AND NOT cancelado)<>1 THEN RAISE EXCEPTION 'La visita mixta debe tener una única recogida'; END IF;
END $test$;

DO $test$ DECLARE v jsonb; BEGIN v:=app_private.manteniment_importar_trabajos((select payload from tmp_identidad_mix)); IF (v->>'t_creadas')::int<>0 OR (v->>'trabajos_creados')::int<>0 THEN RAISE EXCEPTION 'Repetición del lote mixto: %',v; END IF; INSERT INTO tmp_identidad_resultados VALUES ('Repetición del lote mixto',v); END $test$;
DROP TABLE IF EXISTS tmp_alpha74_manteniment_candidates,tmp_alpha74_manteniment_raw;

CREATE TEMP TABLE tmp_identidad_incremental(payload jsonb) ON COMMIT DROP;

INSERT INTO tmp_identidad_incremental VALUES ($payload$[{"fila": 900014, "clave_fila": "PRUEBA_IDENTIDAD_R1487|PRUEBA INCREMENTAL|LKT", "dfm": "PRUEBA_IDENTIDAD_R1487", "matricula": "TEST", "numero_parada": "99001487", "taller": "PRUEBA INCREMENTAL", "tipo_trabajo": "GESTIÓN", "designacion": "LKT", "fecha_necesidad": "2026-09-19", "fecha_realizada": "", "fecha_recogida": "", "pendiente_fondo_blanco": true, "prioridad_fondo_amarillo": true}, {"fila": 900015, "clave_fila": "PRUEBA_IDENTIDAD_R1487|PRUEBA INCREMENTAL|ACT", "dfm": "PRUEBA_IDENTIDAD_R1487", "matricula": "TEST", "numero_parada": "99001487", "taller": "PRUEBA INCREMENTAL", "tipo_trabajo": "REPARACIÓN", "designacion": "ACT", "fecha_necesidad": "2026-09-19", "fecha_realizada": "", "fecha_recogida": "", "pendiente_fondo_blanco": true, "prioridad_fondo_amarillo": true}]$payload$);

DO $test$ DECLARE v jsonb; BEGIN v:=app_private.manteniment_importar_trabajos((select jsonb_build_array(payload->0) from tmp_identidad_incremental));  INSERT INTO tmp_identidad_resultados VALUES ('Primera gestión de visita',v); END $test$;
DROP TABLE IF EXISTS tmp_alpha74_manteniment_candidates,tmp_alpha74_manteniment_raw;

DO $test$ DECLARE v jsonb; BEGIN v:=app_private.manteniment_importar_trabajos((select jsonb_build_array(payload->1) from tmp_identidad_incremental));  INSERT INTO tmp_identidad_resultados VALUES ('Reparación posterior mismo F',v); END $test$;
DROP TABLE IF EXISTS tmp_alpha74_manteniment_candidates,tmp_alpha74_manteniment_raw;

DO $test$ BEGIN
 IF (SELECT count(DISTINCT t.etapa_hotel_id) FROM app_private.manteniment_t_trabajos w
 JOIN public.trabajos_etapa_hotel t ON t.id=w.trabajo_hotel_id
 WHERE w.seguimiento_id=(SELECT seguimiento FROM tmp_identidad_fixture) AND w.taller='PRUEBA INCREMENTAL')<>1
 THEN RAISE EXCEPTION 'La ampliación de visita ha separado los trabajos'; END IF;
END $test$;
-- Propagación histórica: una T recién creada debe conservar sus dos identidades.
DO $test$ DECLARE p uuid;r uuid;e uuid;f uuid;g uuid; BEGIN
 SELECT seguimiento INTO f FROM tmp_identidad_fixture;
 INSERT INTO public.pizarras(fecha,estado,origen) VALUES('2099-09-18','archivada','manual') RETURNING id INTO p;
 INSERT INTO public.registros_hotel(pizarra_id,seguimiento_id,numero_parada,vehiculo_sustituido,estado,fecha_parada)
 VALUES(p,f,'99001487','PRUEBA_IDENTIDAD_R1487','planificado','2099-09-18') RETURNING id INTO r;
 UPDATE public.registros_hotel SET fecha_parada='2099-09-18' WHERE id=(SELECT registro FROM tmp_identidad_fixture);
 PERFORM app_private.propagar_detalles_t_parada((SELECT registro FROM tmp_identidad_fixture));
 IF EXISTS (SELECT 1 FROM public.etapas_hotel a JOIN public.etapas_hotel b ON b.seguimiento_id=a.seguimiento_id
 WHERE a.registro_hotel_id=(SELECT registro FROM tmp_identidad_fixture) AND b.registro_hotel_id=r
 AND a.grupo_documental_id IS DISTINCT FROM b.grupo_documental_id) THEN RAISE EXCEPTION 'La propagación cambia el grupo documental'; END IF;
 INSERT INTO tmp_identidad_resultados VALUES('Propagación histórica conserva identidad','{"ok":true}');
END $test$;
SELECT app_private.crear_pizarra_diaria('2099-09-20');
DROP TABLE IF EXISTS tmp_reg_map,tmp_stage_map;
DO $test$ BEGIN
 IF EXISTS (SELECT 1 FROM app_private.manteniment_t_trabajos w JOIN public.trabajos_etapa_hotel t ON t.id=w.trabajo_hotel_id
 JOIN public.etapas_hotel e ON e.id=t.etapa_hotel_id
 JOIN public.etapas_hotel actual ON actual.id=app_private.manteniment_etapa_actual(w.seguimiento_id,e.id)
 WHERE w.seguimiento_id=(SELECT seguimiento FROM tmp_identidad_fixture)
 AND (actual.seguimiento_id<>e.seguimiento_id OR actual.grupo_documental_id<>e.grupo_documental_id OR actual.id=e.id))
 THEN RAISE EXCEPTION 'La copia diaria pierde la identidad'; END IF;
 INSERT INTO tmp_identidad_resultados VALUES('Copia diaria conserva identidad','{"ok":true}');
END $test$;

DO $test$ DECLARE v jsonb; BEGIN v:=app_private.manteniment_importar_trabajos((select payload from tmp_identidad_mix)); IF (v->>'t_creadas')::int<>0 OR (v->>'trabajos_creados')::int<>0 THEN RAISE EXCEPTION 'Sincronización después del cambio de día: %',v; END IF; INSERT INTO tmp_identidad_resultados VALUES ('Sincronización después del cambio de día',v); END $test$;
DROP TABLE IF EXISTS tmp_alpha74_manteniment_candidates,tmp_alpha74_manteniment_raw;

DO $test$ DECLARE v jsonb; BEGIN v:=app_private.manteniment_importar_trabajos((select payload from tmp_identidad_incremental)); IF (v->>'t_creadas')::int<>0 OR (v->>'trabajos_creados')::int<>0 THEN RAISE EXCEPTION 'Visita ampliada después del cambio de día: %',v; END IF; INSERT INTO tmp_identidad_resultados VALUES ('Visita ampliada después del cambio de día',v); END $test$;
DROP TABLE IF EXISTS tmp_alpha74_manteniment_candidates,tmp_alpha74_manteniment_raw;

SET CONSTRAINTS ALL IMMEDIATE;
SELECT jsonb_agg(to_jsonb(t)) AS pruebas FROM tmp_identidad_resultados t;
ROLLBACK;
