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

-- Correccion puntual de datos excluida del repositorio publico.

commit;
