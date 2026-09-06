begin;

-- I es la fecha de propuesta de parada. Si al crear la ficha no llega una fecha
-- explícita, queda fijada al día local en que Metrogestión genera la parada.
create or replace function app_private.crear_ficha_hotel_alpha71(p_ficha jsonb, p_request_id text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $function$
declare
  v_result jsonb;
  v_registro_id uuid;
  v_tracking uuid;
  v_fecha_propuesta date;
begin
  v_result := public.crear_ficha_hotel(p_ficha, p_request_id);
  v_registro_id := (v_result->>'id')::uuid;
  select seguimiento_id into v_tracking from public.registros_hotel where id = v_registro_id;

  v_fecha_propuesta := coalesce(
    nullif(p_ficha->>'fecha_programada_parada', '')::date,
    (clock_timestamp() at time zone 'Europe/Madrid')::date
  );

  insert into app_private.manteniment_parada_sync(
    seguimiento_id, fecha_programada_parada, fecha_corte, tancament
  ) values (
    v_tracking,
    v_fecha_propuesta,
    nullif(p_ficha->>'manteniment_fecha_corte', '')::date,
    upper(btrim(coalesce(p_ficha->>'manteniment_tancament', '')))
  )
  on conflict (seguimiento_id) do update
  set fecha_programada_parada = coalesce(
        app_private.manteniment_parada_sync.fecha_programada_parada,
        excluded.fecha_programada_parada
      ),
      fecha_corte = excluded.fecha_corte,
      tancament = excluded.tancament;

  return v_result || jsonb_build_object(
    'manteniment_sync_id', (
      select sync_id
      from app_private.manteniment_parada_sync
      where seguimiento_id = v_tracking
    )
  );
end;
$function$;

-- Completa propuestas ya generadas que todavía no habían llegado a I. Se usa la
-- fecha de creación de la primera ficha del seguimiento y nunca se sobreescribe I.
with propuestas as (
  select
    s.seguimiento_id,
    min((r.creado_en at time zone 'Europe/Madrid')::date) as fecha_propuesta
  from app_private.manteniment_parada_sync s
  join public.registros_hotel r on r.seguimiento_id = s.seguimiento_id
  where s.fecha_programada_parada is null
    and btrim(coalesce(r.numero_parada, '')) <> ''
  group by s.seguimiento_id
)
update app_private.manteniment_parada_sync s
set fecha_programada_parada = p.fecha_propuesta
from propuestas p
where s.seguimiento_id = p.seguimiento_id
  and s.fecha_programada_parada is null;

revoke all on function app_private.crear_ficha_hotel_alpha71(jsonb, text)
  from public, anon;
grant execute on function app_private.crear_ficha_hotel_alpha71(jsonb, text)
  to authenticated, service_role;

comment on function app_private.crear_ficha_hotel_alpha71(jsonb, text) is
  'Crea la ficha y fija en MANTENIMENT I la fecha de propuesta del día en que se genera la parada.';

commit;
