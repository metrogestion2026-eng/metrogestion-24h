-- Reparación puntual solicitada: R1320 / PA-2600121, Direcauto -> Fridiel.
-- Conserva las fechas introducidas, reserva, documentos y T anuladas.
-- La T de Fridiel ya realizada estaba tipada como «otro»; no había recogida
-- vinculada y la ficha conservaba el estado/lugar anterior de Direcauto.
-- Ejecutar en una transacción; sustituir COMMIT por ROLLBACK para validar.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
select set_config('app.audit_origin', 'correccion-r1320-traslado-fridiel', true);
select set_config('app.audit_reason', 'Corrección solicitada: recogida Direcauto y entrada Fridiel el mismo día; conservar las horas registradas.', true);
select set_config('app.request_id', 'r1320_traslado_fridiel_20260915', true);

do $repair$
declare
  v_registro public.registros_hotel%rowtype;
  v_entrada public.etapas_hotel%rowtype;
  v_recogida public.etapas_hotel%rowtype;
  v_anuladas jsonb;
  v_cantidad integer;
begin
  select * into strict v_registro from public.registros_hotel
  where id = 'b2a4893f-9f69-4b82-8d4c-2f0dbff6c0f2' for update;
  perform 1 from public.etapas_hotel
  where registro_hotel_id = v_registro.id order by id for update;
  select * into strict v_entrada from public.etapas_hotel
  where id = '359c4832-1356-4f8d-bb67-2d37da55286c';

  if v_registro.vehiculo_sustituido <> 'R1320'
     or v_registro.numero_parada <> '2600121'
     or v_registro.version <> 1
     or v_registro.cancelado or v_registro.retirado_hotel_activo
     or v_registro.vehiculo_reserva <> 'R1524'
     or v_entrada.registro_hotel_id <> v_registro.id
     or v_entrada.version <> 10 or v_entrada.tipo_etapa <> 'otro'
     or v_entrada.cancelado or v_entrada.estado <> 'realizada'
     or v_entrada.taller_id <> '3144d0f4-af73-4c74-be5c-9771cc6dfc05'
     or v_entrada.fecha_real is distinct from timestamptz '2026-09-15 13:37:00+00'
     or v_entrada.fecha_inicio_real is distinct from timestamptz '2026-09-15 13:36:00+00'
     or v_entrada.fecha_fin_real is not null
  then
    raise exception 'R1320 cambió desde la revisión. Revisar antes de aplicar la reparación.';
  end if;
  if not exists (
    select 1 from public.pizarras where id=v_registro.pizarra_id and estado='en_curso'
  ) or not exists (
    select 1 from public.etapas_hotel
    where id='4e023f5e-1608-43d5-8781-ca0ff313d16e'
      and registro_hotel_id=v_registro.id and not cancelado
      and estado='realizada' and tipo_etapa='recogida_taller'
      and fecha_real=timestamptz '2026-09-15 13:35:00+00'
      and fecha_real < v_entrada.fecha_inicio_real
  ) then raise exception 'La pizarra o la recogida previa no coincide con la revisión.'; end if;

  select jsonb_agg(to_jsonb(e) order by id) into v_anuladas
  from public.etapas_hotel e where registro_hotel_id=v_registro.id and cancelado;

  -- Mantiene los identificadores originales de la necesidad y de su visita.
  -- Antes: modalidad pendiente_taller, taller 9M, grupos de entrada/recogida NULL.
  update app_private.manteniment_t_visitas
  set modalidad='taller', taller='FRIDIEL ABRERA',
      grupo_entrada_id=v_entrada.grupo_documental_id, actualizado_en=clock_timestamp()
  where id='bf910c88-8b20-4205-8211-8a58acda0268'
    and seguimiento_id=v_registro.seguimiento_id
    and modalidad='pendiente_taller' and grupo_entrada_id is null;
  get diagnostics v_cantidad = row_count;
  if v_cantidad <> 1 then raise exception 'La visita de MCD A cambió.'; end if;

  -- Los triggers normales generan una sola recogida para ESTA entrada.
  update public.etapas_hotel
  set tipo_etapa='entrada_taller'
  where id=v_entrada.id;
  select count(*) into v_cantidad from public.etapas_hotel
  where etapa_origen_id=v_entrada.id and not cancelado and tipo_etapa='recogida_taller';
  if v_cantidad <> 1 then raise exception 'La entrada no tiene una única recogida vinculada.'; end if;
  select * into strict v_recogida from public.etapas_hotel
  where etapa_origen_id=v_entrada.id and not cancelado and tipo_etapa='recogida_taller';
  update public.etapas_hotel set nombre='Recogida Fridiel'
  where id=v_recogida.id and estado='pendiente';
  update app_private.manteniment_t_visitas
  set grupo_recogida_id=v_recogida.grupo_documental_id, actualizado_en=clock_timestamp()
  where id='bf910c88-8b20-4205-8211-8a58acda0268';

  -- El enlace apuntaba al trabajo de una pizarra anterior. Se conecta al de hoy
  -- sin trasladar ni borrar trabajos históricos, y sin cerrar la reparación.
  update app_private.manteniment_t_trabajos
  set taller='FRIDIEL ABRERA', trabajo_hotel_id='e5d75210-5898-4a0d-a960-8f68cbd68e5b',
      fecha_realizada=(v_entrada.fecha_real at time zone 'Europe/Madrid')::date,
      fecha_recogida=null, actualizado_en=clock_timestamp()
  where id='c6691df4-65a7-45de-9938-89bed90449d0'
    and seguimiento_id=v_registro.seguimiento_id
    and visita_id='bf910c88-8b20-4205-8211-8a58acda0268'
    and sync_id='deda52c9-2585-4f8f-b62b-d40a9d147bb4'
    and exists (select 1 from public.trabajos_etapa_hotel
      where id='e5d75210-5898-4a0d-a960-8f68cbd68e5b'
        and etapa_hotel_id=v_entrada.id and not cancelado);
  get diagnostics v_cantidad = row_count;
  if v_cantidad <> 1 then raise exception 'El trabajo de MCD A no coincide.'; end if;

  update public.registros_hotel
  set estado='en_taller', lugar='Fridiel · Abrera', fecha_entrada=v_entrada.fecha_real
  where id=v_registro.id;
  perform app_private.manteniment_encolar_parada(v_registro.seguimiento_id);

  if not exists (select 1 from public.hotel_actual_detalle
    where id=v_registro.id and estado='en_taller' and lugar='Fridiel · Abrera')
  then raise exception 'R1320 no aparece en Hotel como en taller en Fridiel.'; end if;
  if v_anuladas is distinct from (select jsonb_agg(to_jsonb(e) order by id)
    from public.etapas_hotel e where registro_hotel_id=v_registro.id and cancelado)
  then raise exception 'Se ha alterado alguna T anulada.'; end if;
  if (select vehiculo_reserva from public.registros_hotel where id=v_registro.id)
      is distinct from v_registro.vehiculo_reserva
  then raise exception 'Se ha alterado la reserva.'; end if;
  if exists (select 1 from public.etapas_hotel where registro_hotel_id=v_registro.id
    and not cancelado and accion_sistema='recuperar_y_liberar' and estado='realizada')
  then raise exception 'La recuperación de ruta debe seguir pendiente.'; end if;
end;
$repair$;
set constraints all immediate;
commit;
