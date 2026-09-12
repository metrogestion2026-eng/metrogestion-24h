begin;

create or replace function app_private.liberar_reserva_al_anular_ficha_hotel()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $function$
begin
  if new.cancelado then
    new.vehiculo_reserva := '';
    new.matricula_reserva := '';
    new.etiqueta_reserva := '';
    new.tipo_sustituto := '';
    new.sustitucion_temporal := false;
    new.motivo_sustitucion_temporal := '';
    new.fecha_limite_sustitucion := null;
  end if;
  return new;
end;
$function$;

revoke all on function app_private.liberar_reserva_al_anular_ficha_hotel()
  from public, anon, authenticated;

drop trigger if exists registros_hotel_liberar_reserva_al_anular
  on public.registros_hotel;
create trigger registros_hotel_liberar_reserva_al_anular
before insert or update of cancelado on public.registros_hotel
for each row
execute function app_private.liberar_reserva_al_anular_ficha_hotel();

comment on function app_private.liberar_reserva_al_anular_ficha_hotel() is
  'Libera la asignación de reserva y sus datos operativos cuando una ficha de Hotel se anula.';

do $repair$
declare
  v_source_id constant uuid := '47dbe8b1-56f7-44da-af6f-6d514067723b'::uuid;
  v_follow_id uuid;
  v_current_board uuid;
  v_active_id uuid;
begin
  select seguimiento_id into v_follow_id
  from public.registros_hotel
  where id = v_source_id
    and regexp_replace(upper(coalesce(numero_parada, '')), '[[:space:]-]+', '', 'g') in ('2600152', 'PA2600152')
    and upper(btrim(coalesce(vehiculo_sustituido, ''))) = 'R1487'
  for update;

  if not found then
    raise exception 'No se localiza la ficha exacta de PA-2600152 / R1487';
  end if;

  select id into v_current_board
  from public.pizarras
  where estado = 'en_curso'
  order by fecha desc
  limit 1;

  if v_current_board is null then
    raise exception 'No existe una Pizarra actual para reactivar PA-2600152';
  end if;

  select id into v_active_id
  from public.registros_hotel
  where pizarra_id = v_current_board
    and seguimiento_id = v_follow_id
    and not cancelado
    and not retirado_hotel_activo
    and estado not in ('recuperado', 'reserva_liberada', 'anulado')
  order by actualizado_en desc, id desc
  limit 1;

  if v_active_id is null then
    perform set_config('app.request_id', 'reactivar-pa-2600152-sin-reserva-20260912', true);
    perform set_config('app.audit_origin', 'metrogestion-reparacion-pa-2600152', true);

    update public.registros_hotel
    set estado = 'pendiente_taller',
        retirado_hotel_activo = true,
        fecha_retirado_hotel = coalesce(fecha_retirado_hotel, clock_timestamp()),
        cancelado = false,
        motivo_cancelacion = '',
        cancelado_en = null,
        cancelado_por = null,
        vehiculo_reserva = '',
        matricula_reserva = '',
        etiqueta_reserva = '',
        tipo_sustituto = '',
        sustitucion_temporal = false,
        motivo_sustitucion_temporal = '',
        fecha_limite_sustitucion = null,
        modificado_por = coalesce(modificado_por, creado_por)
    where id = v_source_id;

    v_active_id := app_private.asegurar_reactivacion_historica(v_source_id);
  end if;

  if v_active_id is null or not exists (
    select 1
    from public.registros_hotel
    where id = v_active_id
      and pizarra_id = v_current_board
      and seguimiento_id = v_follow_id
      and regexp_replace(upper(coalesce(numero_parada, '')), '[[:space:]-]+', '', 'g') in ('2600152', 'PA2600152')
      and upper(btrim(coalesce(vehiculo_sustituido, ''))) = 'R1487'
      and btrim(coalesce(vehiculo_reserva, '')) = ''
      and not cancelado
      and not retirado_hotel_activo
      and estado not in ('recuperado', 'reserva_liberada', 'anulado')
  ) then
    raise exception 'PA-2600152 no ha quedado activa y sin reserva en la Pizarra actual';
  end if;

  if (select count(*) from public.etapas_hotel where registro_hotel_id = v_active_id) <> 11
     or (select count(*) from public.etapas_hotel where registro_hotel_id = v_active_id and not cancelado) <> 7
     or (select count(*) from public.etapas_hotel where registro_hotel_id = v_active_id and cancelado) <> 4 then
    raise exception 'La reactivación de PA-2600152 no ha conservado exactamente sus 11 T (7 activas y 4 anuladas)';
  end if;
end;
$repair$;

commit;
