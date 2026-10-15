-- Alpha75 · Una reserva ocupada no puede darse de baja.
-- El estado operativo se deriva de su uso real en la Pizarra activa.

create or replace function app_private.bloquear_baja_reserva_ocupada()
returns trigger
language plpgsql
set search_path = pg_catalog, public, app_private
as $function$
begin
  if old.activo = true and new.activo = false and exists (
    select 1
    from public.registros_hotel h
    join public.pizarras p on p.id = h.pizarra_id
    where p.estado = 'en_curso'
      and not h.cancelado
      and not h.retirado_hotel_activo
      and h.estado not in ('reserva_liberada','recuperado','anulado')
      and upper(btrim(coalesce(h.vehiculo_reserva,''))) = upper(btrim(old.vehiculo_codigo))
  ) then
    raise exception 'La reserva % está ocupada y no puede darse de baja mientras siga asignada', old.vehiculo_codigo
      using errcode = '23514';
  end if;
  return new;
end;
$function$;

drop trigger if exists reservas_hotel_bloquear_baja_ocupada on public.reservas_hotel;
create trigger reservas_hotel_bloquear_baja_ocupada
before update of activo on public.reservas_hotel
for each row
execute function app_private.bloquear_baja_reserva_ocupada();

comment on function app_private.bloquear_baja_reserva_ocupada() is
  'Impide dar de baja una reserva mientras figure como sustituto en una ficha activa de la Pizarra en curso.';
