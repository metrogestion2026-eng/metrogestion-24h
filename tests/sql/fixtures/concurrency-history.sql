-- Synthetic sentinels shared by the native PostgreSQL concurrency/UI harness.
-- Loaded before trigger wiring. No operational data is imported.
INSERT INTO public.pizarras VALUES('00000000-0000-4000-8000-000000000011','archivada','2026-09-30');
INSERT INTO public.registros_hotel(id,pizarra_id,seguimiento_id,numero_parada,vehiculo_sustituido,vehiculo_reserva,matricula_reserva,tipo_movimiento,estado,lugar,fecha_parada,modalidad_operativa,observaciones)
VALUES('00000000-0000-4000-8000-000000002556','00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000202556','SINT-2556','2556','R2556','SYN2556','24H','en_taller','Taller manual 2556','2026-10-10','reserva_en_reparacion','Dato manual protegido'),
  ('00000000-0000-4000-8000-000000002637','00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000202637','SINT-2637','2637','R2637','SYN2637','TALLER','en_taller','Taller manual 2637','2026-09-19','','Identidad y medias manuales');
INSERT INTO public.activaciones_24h(id,dfm,registro_hotel_id,seguimiento_hotel_id,fecha_activacion,hora_activacion,resultado,estado,creado_por)
VALUES('00000000-0000-4000-8000-000000102556','2556','00000000-0000-4000-8000-000000002556','00000000-0000-4000-8000-000000202556','2026-10-10','10:00','trasladado_taller','abierta','00000000-0000-4000-8000-000000000001');
INSERT INTO public.etapas_hotel(registro_hotel_id,nombre,posicion,estado,tipo_etapa,lugar,fecha_inicio_real,fecha_fin_real,fecha_real)
VALUES('00000000-0000-4000-8000-000000002556','24H · Avería',1,'realizada','24H','Lugar histórico','2026-10-10 10:00 Europe/Madrid','2026-10-10 11:00 Europe/Madrid','2026-10-10 11:00 Europe/Madrid'),
  ('00000000-0000-4000-8000-000000002556','Estancia taller manual',2,'en_curso','entrada_taller','Taller manual 2556','2026-10-11 09:00 Europe/Madrid',NULL,NULL),
  ('00000000-0000-4000-8000-000000002637','Taller histórico',1,'en_curso','entrada_taller','Taller manual 2637','2026-09-19 08:00 Europe/Madrid',NULL,NULL);
INSERT INTO app_private.manteniment_parada_sync(seguimiento_id,fecha_programada_parada,fecha_corte,tancament,fecha_inicio_tramo,dias_parada_manual,km_facturables_manual,km_dia_manual,tancament_supervisado)
VALUES('00000000-0000-4000-8000-000000202556','2026-10-10','2026-10-24','TANCAMENT 10','2026-10-10',15,555.55,37.03,true),
  ('00000000-0000-4000-8000-000000202637','2026-09-19','2026-09-30','TANCAMENT 9','2026-09-19',12,987.65,82.3042,true);
INSERT INTO app_private.hotel_flujo_modelo VALUES('00000000-0000-4000-8000-000000202556','entrada_hitos_v1','00000000-0000-4000-8000-000000000001');
