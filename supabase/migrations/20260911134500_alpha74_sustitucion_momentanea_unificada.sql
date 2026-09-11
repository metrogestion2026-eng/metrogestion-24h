begin;

-- Si una unidad tiene ficha propia marcada como sustitución temporal, actúa
-- como FLOTA aunque también figure en el catálogo de reservas.
create or replace function app_private.derivar_tipo_sustituto_hotel()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $function$
begin
  if btrim(coalesce(new.vehiculo_reserva, '')) = '' then
    new.tipo_sustituto := '';
  elsif exists (
    select 1
    from public.registros_hotel s
    join public.pizarras p on p.id = s.pizarra_id
    where p.estado = 'en_curso'
      and not s.cancelado
      and not s.retirado_hotel_activo
      and s.sustitucion_temporal
      and regexp_replace(upper(btrim(s.vehiculo_sustituido)), '[[:space:]]+', '', 'g')
          = regexp_replace(upper(btrim(new.vehiculo_reserva)), '[[:space:]]+', '', 'g')
  ) then
    new.tipo_sustituto := 'FLOTA';
  elsif exists (
    select 1
    from public.reservas_hotel r
    where regexp_replace(upper(btrim(r.vehiculo_codigo)), '[[:space:]]+', '', 'g')
          = regexp_replace(upper(btrim(new.vehiculo_reserva)), '[[:space:]]+', '', 'g')
      and r.activo
  ) then
    new.tipo_sustituto := 'RESERVA';
  else
    new.tipo_sustituto := 'FLOTA';
  end if;
  return new;
end;
$function$;

-- Reevalúa las relaciones existentes sin identificar casos concretos.
update public.registros_hotel r
set vehiculo_reserva = r.vehiculo_reserva
where not r.cancelado
  and not r.retirado_hotel_activo
  and btrim(coalesce(r.vehiculo_reserva, '')) <> ''
  and exists (
    select 1
    from public.registros_hotel s
    join public.pizarras p on p.id = s.pizarra_id
    where p.estado = 'en_curso'
      and s.pizarra_id = r.pizarra_id
      and s.id <> r.id
      and not s.cancelado
      and not s.retirado_hotel_activo
      and s.sustitucion_temporal
      and regexp_replace(upper(btrim(s.vehiculo_sustituido)), '[[:space:]]+', '', 'g')
          = regexp_replace(upper(btrim(r.vehiculo_reserva)), '[[:space:]]+', '', 'g')
  );

-- El estado visible es una capa operativa: no borra el estado propio que debe
-- recuperar la unidad cuando finalice la sustitución momentánea.
create or replace view public.hotel_actual with (security_invoker=true) as
select r.id,r.pizarra_id,p.fecha as fecha_pizarra,r.seguimiento_id,r.numero_parada,
  nullif(r.vehiculo_sustituido,'') as dfm,nullif(r.matricula_sustituido,'') as matricula,
  nullif(r.vehiculo_reserva,'') as reserva,nullif(r.matricula_reserva,'') as matricula_reserva,
  nullif(r.vehiculo_reserva,'') as sustituto,nullif(r.matricula_reserva,'') as matricula_sustituto,
  r.tipo_sustituto,r.etiqueta_reserva,r.etiqueta_reserva as etiqueta_sustituto,
  r.tipo_unidad,r.marca,r.tipo_motor,r.modelo,r.upc,r.telefono,r.prioridad,
  case when exists(
    select 1 from public.registros_hotel x
    where x.pizarra_id=r.pizarra_id and x.id<>r.id and not x.cancelado
      and not x.retirado_hotel_activo and x.tipo_sustituto='FLOTA'
      and regexp_replace(upper(btrim(x.vehiculo_reserva)), '[[:space:]]+', '', 'g')
          = regexp_replace(upper(btrim(r.vehiculo_sustituido)), '[[:space:]]+', '', 'g')
  ) then 'sustitucion_momentanea' else r.estado end as estado,
  r.lugar,r.fecha_parada,r.fecha_entrada,r.tipo_movimiento,r.causa,r.trabajos_reserva,
  r.incidencia,r.proximo,r.observaciones,r.trazo_marron,
  case when exists(
         select 1 from public.registros_hotel x
         where x.pizarra_id=r.pizarra_id and x.id<>r.id and not x.cancelado
           and not x.retirado_hotel_activo and x.tipo_sustituto='FLOTA'
           and regexp_replace(upper(btrim(x.vehiculo_reserva)), '[[:space:]]+', '', 'g')
               = regexp_replace(upper(btrim(r.vehiculo_sustituido)), '[[:space:]]+', '', 'g')
       ) then 'marron'
       when r.estado='planificado' then 'amarillo' when r.estado='pendiente_taller' then 'blanco'
       when r.estado in ('en_taller','pendiente_diagnostico','pendiente_autorizacion','pendiente_repuestos') then 'lila'
       when r.estado='terminado_pendiente_recogida' then 'azul' when r.estado='recogido_pendiente_ruta' then 'calabaza'
       when r.estado='reserva_liberada' then 'verde' else 'blanco' end as fondo_visual,
  r.orden,r.version,r.modificado_por,r.actualizado_en,
  count(e.id) filter(where not e.cancelado) as total_t,
  count(e.id) filter(where not e.cancelado and e.estado='realizada') as t_realizadas,
  count(e.id) filter(where not e.cancelado and e.estado not in ('realizada','anulada')) as t_pendientes,
  r.modalidad_operativa,
  (select c.nombre from public.catalogo_modalidades_operativas_hotel c where c.codigo=r.modalidad_operativa) as modalidad_operativa_nombre
from public.registros_hotel r join public.pizarras p on p.id=r.pizarra_id
left join public.etapas_hotel e on e.registro_hotel_id=r.id
where p.estado='en_curso' and not r.cancelado and not r.retirado_hotel_activo and r.estado<>'reserva_liberada'
group by r.id,p.fecha;

create or replace view public.hotel_por_dia with (security_invoker=true) as
select r.id,r.pizarra_id,p.fecha as fecha_pizarra,p.estado as estado_pizarra,r.seguimiento_id,r.numero_parada,
  nullif(r.vehiculo_sustituido,'') as dfm,nullif(r.matricula_sustituido,'') as matricula,
  nullif(r.vehiculo_reserva,'') as reserva,nullif(r.matricula_reserva,'') as matricula_reserva,
  nullif(r.vehiculo_reserva,'') as sustituto,nullif(r.matricula_reserva,'') as matricula_sustituto,
  r.tipo_sustituto,r.etiqueta_reserva,r.etiqueta_reserva as etiqueta_sustituto,
  r.tipo_unidad,r.marca,r.tipo_motor,r.modelo,r.upc,r.telefono,r.prioridad,
  case when exists(
    select 1 from public.registros_hotel x
    where x.pizarra_id=r.pizarra_id and x.id<>r.id and not x.cancelado
      and not x.retirado_hotel_activo and x.tipo_sustituto='FLOTA'
      and regexp_replace(upper(btrim(x.vehiculo_reserva)), '[[:space:]]+', '', 'g')
          = regexp_replace(upper(btrim(r.vehiculo_sustituido)), '[[:space:]]+', '', 'g')
  ) then 'sustitucion_momentanea' else r.estado end as estado,
  r.lugar,r.fecha_parada,r.fecha_entrada,r.tipo_movimiento,r.causa,r.trabajos_reserva,
  r.incidencia,r.proximo,r.observaciones,r.trazo_marron,
  case when exists(
         select 1 from public.registros_hotel x
         where x.pizarra_id=r.pizarra_id and x.id<>r.id and not x.cancelado
           and not x.retirado_hotel_activo and x.tipo_sustituto='FLOTA'
           and regexp_replace(upper(btrim(x.vehiculo_reserva)), '[[:space:]]+', '', 'g')
               = regexp_replace(upper(btrim(r.vehiculo_sustituido)), '[[:space:]]+', '', 'g')
       ) then 'marron'
       when r.estado='planificado' then 'amarillo' when r.estado='pendiente_taller' then 'blanco'
       when r.estado in ('en_taller','pendiente_diagnostico','pendiente_autorizacion','pendiente_repuestos') then 'lila'
       when r.estado='terminado_pendiente_recogida' then 'azul' when r.estado='recogido_pendiente_ruta' then 'calabaza'
       when r.estado='reserva_liberada' then 'verde' else 'blanco' end as fondo_visual,
  r.orden,r.retirado_hotel_activo,r.fecha_retirado_hotel,r.cancelado,r.motivo_cancelacion,
  r.cancelado_en,r.cancelado_por,r.version,r.modificado_por,r.actualizado_en,
  count(e.id) filter(where not e.cancelado) as total_t,
  count(e.id) filter(where not e.cancelado and e.estado='realizada') as t_realizadas,
  count(e.id) filter(where not e.cancelado and e.estado not in ('realizada','anulada')) as t_pendientes,
  r.modalidad_operativa,
  (select c.nombre from public.catalogo_modalidades_operativas_hotel c where c.codigo=r.modalidad_operativa) as modalidad_operativa_nombre
from public.registros_hotel r join public.pizarras p on p.id=r.pizarra_id
left join public.etapas_hotel e on e.registro_hotel_id=r.id
group by r.id,p.fecha,p.estado;

grant select on public.hotel_actual, public.hotel_por_dia, public.hotel_actual_detalle
  to authenticated;

comment on function app_private.derivar_tipo_sustituto_hotel() is
  'Prioriza FLOTA para una unidad con ficha propia en sustitución momentánea, aunque también figure en Reservas.';

commit;
