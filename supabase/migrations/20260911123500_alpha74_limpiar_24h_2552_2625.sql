begin;

-- Limpieza física limitada a los tres trabajos autorizados. No se conserva
-- anulación ni auditoría de las T creadas por error.
create temp table tmp_alpha74_24h_trabajos_retirar (
  trabajo_sync_id uuid primary key,
  visita_id uuid not null,
  trabajo_hotel_id uuid,
  etapa_hotel_id uuid,
  registro_hotel_id uuid not null,
  asistencia_id uuid not null
) on commit drop;

insert into tmp_alpha74_24h_trabajos_retirar(
  trabajo_sync_id, visita_id, trabajo_hotel_id, etapa_hotel_id,
  registro_hotel_id, asistencia_id
)
select w.id, v.id, w.trabajo_hotel_id, t.etapa_hotel_id,
       r.id, asistencia.id
from public.activaciones_24h a
join public.registros_hotel r on r.id = a.registro_hotel_id
join app_private.manteniment_t_visitas v on v.seguimiento_id = r.seguimiento_id
join app_private.manteniment_t_trabajos w on w.visita_id = v.id
left join public.trabajos_etapa_hotel t on t.id = w.trabajo_hotel_id
join lateral (
  select e.id
  from public.etapas_hotel e
  where e.registro_hotel_id = r.id
    and not e.cancelado
    and regexp_replace(upper(btrim(coalesce(e.nombre, ''))), '[^A-Z0-9]+', '', 'g')
      in ('24H', '24HAVERIA', 'AVERIA24H', 'ASISTENCIA24H')
  order by (e.estado = 'en_curso') desc, e.posicion, e.creado_en, e.id
  limit 1
) asistencia on true
where upper(btrim(coalesce(r.tipo_movimiento, ''))) = '24H'
  and (
    (regexp_replace(upper(btrim(a.dfm)), '[[:space:]]+', '', 'g') = '2625'
      and upper(btrim(w.designacion)) in ('44TN', 'ITV'))
    or
    (regexp_replace(upper(btrim(a.dfm)), '[[:space:]]+', '', 'g') = '2552'
      and upper(btrim(w.designacion)) = 'EDT')
  );

create temp table tmp_alpha74_24h_etapas_retirar (
  id uuid primary key
) on commit drop;

insert into tmp_alpha74_24h_etapas_retirar(id)
select distinct x.id
from (
  select q.etapa_hotel_id as id
  from tmp_alpha74_24h_trabajos_retirar q
  where q.etapa_hotel_id is not null
    and q.etapa_hotel_id <> q.asistencia_id

  union

  select e.id
  from tmp_alpha74_24h_trabajos_retirar q
  join app_private.manteniment_t_visitas v on v.id = q.visita_id
  join public.etapas_hotel e
    on e.registro_hotel_id = q.registro_hotel_id
   and e.grupo_documental_id in (v.grupo_entrada_id, v.grupo_recogida_id)
  where e.id <> q.asistencia_id
    and e.estado <> 'realizada'
) x
where x.id is not null;

delete from public.trabajos_etapa_hotel t
using tmp_alpha74_24h_trabajos_retirar q
where t.id = q.trabajo_hotel_id;

delete from public.auditoria_cambios a
using tmp_alpha74_24h_trabajos_retirar q
where a.tabla = 'trabajos_etapa_hotel'
  and a.registro_id = q.trabajo_hotel_id;

delete from public.etapas_hotel e
using tmp_alpha74_24h_etapas_retirar q
where e.id = q.id
  and e.etapa_origen_id is not null;

delete from public.etapas_hotel e
using tmp_alpha74_24h_etapas_retirar q
where e.id = q.id;

delete from public.auditoria_cambios a
using tmp_alpha74_24h_etapas_retirar q
where a.tabla = 'etapas_hotel'
  and a.registro_id = q.id;

delete from app_private.manteniment_t_trabajos w
using tmp_alpha74_24h_trabajos_retirar q
where w.id = q.trabajo_sync_id;

delete from app_private.manteniment_t_visitas v
where v.id in (select distinct q.visita_id from tmp_alpha74_24h_trabajos_retirar q)
  and not exists (
    select 1 from app_private.manteniment_t_trabajos w where w.visita_id = v.id
  );

-- Repara exclusivamente las dos fichas 24H revisadas tras retirar los trabajos.
do $do$
declare
  v_registro_id uuid;
begin
  for v_registro_id in
    select distinct a.registro_hotel_id
    from public.activaciones_24h a
    join public.registros_hotel r on r.id = a.registro_hotel_id
    where a.registro_hotel_id is not null
      and coalesce(a.estado, '') <> 'anulada'
      and upper(btrim(coalesce(r.tipo_movimiento, ''))) = '24H'
      and regexp_replace(upper(btrim(a.dfm)), '[[:space:]]+', '', 'g')
        in ('2552', '2625')
  loop
    perform app_private.manteniment_reconciliar_asistencia_alpha74(v_registro_id);
  end loop;
end;
$do$;

commit;
