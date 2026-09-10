begin;

-- Vincula una activacion antigua o nueva con la parada 24H activa del mismo
-- vehiculo. La vinculacion exacta evita depender para siempre de DFM y fecha.
create or replace function app_private.activacion_24h_vincular_hotel_alpha74()
returns trigger
language plpgsql
security definer
set search_path = 'pg_catalog', 'public', 'app_private'
as $function$
declare
  v_match record;
begin
  if new.registro_hotel_id is not null or new.seguimiento_hotel_id is not null then
    return new;
  end if;

  select r.id, r.seguimiento_id
  into v_match
  from public.registros_hotel r
  join public.pizarras p on p.id = r.pizarra_id
  where not r.cancelado
    and not r.retirado_hotel_activo
    and r.estado not in ('recuperado', 'reserva_liberada', 'anulado')
    and regexp_replace(upper(btrim(coalesce(r.vehiculo_sustituido, ''))), '[[:space:]]+', '', 'g')
      = regexp_replace(upper(btrim(coalesce(new.dfm, ''))), '[[:space:]]+', '', 'g')
    and (
      btrim(coalesce(new.matricula, '')) = ''
      or btrim(coalesce(r.matricula_sustituido, '')) = ''
      or regexp_replace(upper(btrim(new.matricula)), '[^A-Z0-9]+', '', 'g')
         = regexp_replace(upper(btrim(r.matricula_sustituido)), '[^A-Z0-9]+', '', 'g')
    )
    and exists (
      select 1
      from public.etapas_hotel e
      where e.registro_hotel_id = r.id
        and not e.cancelado
        and regexp_replace(upper(btrim(coalesce(e.nombre, ''))), '[^A-Z0-9]+', '', 'g')
          in ('24H', 'ASISTENCIA24H')
    )
  order by (p.estado = 'en_curso') desc, p.fecha desc,
           r.actualizado_en desc, r.id desc
  limit 1;

  if v_match.id is not null then
    new.registro_hotel_id := v_match.id;
    new.seguimiento_hotel_id := v_match.seguimiento_id;
  end if;
  return new;
end;
$function$;

revoke all on function app_private.activacion_24h_vincular_hotel_alpha74()
  from public, anon, authenticated;

drop trigger if exists activaciones_24h_vincular_hotel_alpha74_trg
  on public.activaciones_24h;
create trigger activaciones_24h_vincular_hotel_alpha74_trg
before insert or update on public.activaciones_24h
for each row execute function app_private.activacion_24h_vincular_hotel_alpha74();

-- Tras guardar el resultado, aplica inmediatamente la regla de taller. No se
-- espera a la siguiente sincronizacion de MANTENIMENT.
create or replace function app_private.activacion_24h_reconciliar_hotel_alpha74()
returns trigger
language plpgsql
security definer
set search_path = 'pg_catalog', 'public', 'app_private'
as $function$
begin
  if new.registro_hotel_id is not null then
    perform app_private.manteniment_reconciliar_asistencia_alpha74(new.registro_hotel_id);
  end if;
  return new;
end;
$function$;

revoke all on function app_private.activacion_24h_reconciliar_hotel_alpha74()
  from public, anon, authenticated;

drop trigger if exists activaciones_24h_reconciliar_hotel_alpha74_trg
  on public.activaciones_24h;
create trigger activaciones_24h_reconciliar_hotel_alpha74_trg
after insert or update of trasladado_taller, taller_traslado, resultado, estado
on public.activaciones_24h
for each row execute function app_private.activacion_24h_reconciliar_hotel_alpha74();

commit;
