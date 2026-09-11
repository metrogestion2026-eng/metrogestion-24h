begin;

-- La asistencia 24H es una clase operativa propia. Su situación (En curso,
-- Realizada, etc.) continúa gobernada por el catálogo de estados.
insert into public.catalogo_tipos_etapa_hotel (
  codigo,
  nombre,
  orden,
  activo
)
values ('24H', 'Asistencia 24H', 5, true)
on conflict (codigo) do update
set nombre = excluded.nombre,
    orden = excluded.orden,
    activo = true;

create or replace function app_private.activacion_24h_clasificar_tipo_t_alpha74()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $function$
begin
  if new.registro_hotel_id is null then
    return new;
  end if;

  update public.etapas_hotel e
  set tipo_etapa = '24H',
      modificado_por = coalesce(auth.uid(), e.modificado_por),
      version = e.version + 1,
      actualizado_en = clock_timestamp()
  where e.registro_hotel_id = new.registro_hotel_id
    and not e.cancelado
    and e.tipo_etapa is distinct from '24H'
    and regexp_replace(upper(e.nombre), '[^A-Z0-9]+', '', 'g')
      in ('24H', '24HAVERIA', 'AVERIA24H', 'ASISTENCIA24H');

  return new;
end;
$function$;

revoke all on function app_private.activacion_24h_clasificar_tipo_t_alpha74()
  from public, anon, authenticated;

drop trigger if exists activaciones_24h_clasificar_tipo_t_alpha74_trg
  on public.activaciones_24h;

create trigger activaciones_24h_clasificar_tipo_t_alpha74_trg
after insert or update of registro_hotel_id on public.activaciones_24h
for each row execute function app_private.activacion_24h_clasificar_tipo_t_alpha74();

-- Corrige también las fichas 24H que ya estaban creadas como "otro".
update public.etapas_hotel e
set tipo_etapa = '24H',
    version = e.version + 1,
    actualizado_en = clock_timestamp()
from public.activaciones_24h a
where a.registro_hotel_id = e.registro_hotel_id
  and not e.cancelado
  and e.tipo_etapa is distinct from '24H'
  and regexp_replace(upper(e.nombre), '[^A-Z0-9]+', '', 'g')
    in ('24H', '24HAVERIA', 'AVERIA24H', 'ASISTENCIA24H');

commit;
