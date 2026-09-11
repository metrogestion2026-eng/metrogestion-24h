begin;

-- Segunda pasada exacta para las T del 2625 que estaban vinculadas directamente
-- a su etapa pública. Se identifican por DFM y designación, nunca por UUID fijo.
create temp table tmp_alpha74_2625_trabajos (
  trabajo_id uuid primary key,
  etapa_id uuid not null,
  registro_id uuid not null
) on commit drop;

insert into tmp_alpha74_2625_trabajos(trabajo_id, etapa_id, registro_id)
select t.id, e.id, r.id
from public.activaciones_24h a
join public.registros_hotel r on r.id = a.registro_hotel_id
join public.etapas_hotel e on e.registro_hotel_id = r.id
join public.trabajos_etapa_hotel t on t.etapa_hotel_id = e.id
where regexp_replace(upper(btrim(a.dfm)), '[[:space:]]+', '', 'g') = '2625'
  and upper(btrim(coalesce(r.tipo_movimiento, ''))) = '24H'
  and not e.cancelado
  and not t.cancelado
  and upper(btrim(coalesce(t.tipo_trabajo, ''))) in ('44TN', 'ITV');

create temp table tmp_alpha74_2625_sync (
  trabajo_sync_id uuid primary key,
  visita_id uuid not null
) on commit drop;

insert into tmp_alpha74_2625_sync(trabajo_sync_id, visita_id)
select w.id, w.visita_id
from app_private.manteniment_t_trabajos w
join tmp_alpha74_2625_trabajos q on q.trabajo_id = w.trabajo_hotel_id;

delete from public.trabajos_etapa_hotel t
using tmp_alpha74_2625_trabajos q
where t.id = q.trabajo_id;

delete from public.auditoria_cambios a
using tmp_alpha74_2625_trabajos q
where a.tabla = 'trabajos_etapa_hotel'
  and a.registro_id = q.trabajo_id;

delete from public.etapas_hotel e
using tmp_alpha74_2625_trabajos q
where e.id = q.etapa_id;

delete from public.auditoria_cambios a
using tmp_alpha74_2625_trabajos q
where a.tabla = 'etapas_hotel'
  and a.registro_id = q.etapa_id;

delete from app_private.manteniment_t_trabajos w
using tmp_alpha74_2625_sync q
where w.id = q.trabajo_sync_id;

delete from app_private.manteniment_t_visitas v
where v.id in (select distinct q.visita_id from tmp_alpha74_2625_sync q)
  and not exists (
    select 1 from app_private.manteniment_t_trabajos w where w.visita_id = v.id
  );

do $do$
declare
  v_registro_id uuid;
begin
  select r.id into v_registro_id
  from public.activaciones_24h a
  join public.registros_hotel r on r.id = a.registro_hotel_id
  where regexp_replace(upper(btrim(a.dfm)), '[[:space:]]+', '', 'g') = '2625'
    and upper(btrim(coalesce(r.tipo_movimiento, ''))) = '24H'
    and coalesce(a.estado, '') <> 'anulada'
  order by a.actualizado_en desc, a.creado_en desc
  limit 1;

  if v_registro_id is not null then
    perform app_private.manteniment_reconciliar_asistencia_alpha74(v_registro_id);
  end if;
end;
$do$;

commit;
