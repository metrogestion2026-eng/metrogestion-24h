create or replace function app_private.listar_necesidades_manteniment_pendientes_alpha74()
returns table (
  necesidad_id uuid,
  etapa_id uuid,
  registro_hotel_id uuid,
  seguimiento_id uuid,
  dfm text,
  matricula text,
  numero_parada text,
  prioridad integer,
  posicion integer,
  nombre text,
  estado text,
  tipo_etapa text,
  lugar text,
  fecha_referencia date,
  familia text,
  trabajos text,
  origen_manteniment boolean,
  fila_origen integer,
  tipo_trabajo text,
  designacion text,
  taller text
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, app_private
as $function$
begin
  if auth.uid() is null
    or not public.usuario_activo()
    or not public.dispositivo_autorizado()
    or not (
      public.puede_ver_modulo('t_programadas')
      or public.puede_ver_modulo('hotel')
    ) then
    raise exception 'No tienes permiso para consultar los pendientes de MANTENIMENT'
      using errcode = '42501';
  end if;

  return query
  with pendientes as (
    select
      mt.id as necesidad_id,
      e.id as etapa_id,
      e.registro_hotel_id,
      mt.seguimiento_id,
      coalesce(
        nullif(btrim(rh.vehiculo_sustituido), ''),
        nullif(split_part(mt.fuentes -> 0 ->> 'clave_fila', '|', 1), '')
      )::text as dfm,
      coalesce(
        nullif(btrim(rh.matricula_sustituido), ''),
        nullif(split_part(mt.fuentes -> 0 ->> 'clave_fila', '|', 2), '')
      )::text as matricula,
      nullif(btrim(rh.numero_parada), '')::text as numero_parada,
      rh.prioridad::integer,
      e.posicion,
      concat_ws(' · ', nullif(btrim(mt.tipo_trabajo), ''), nullif(btrim(mt.designacion), ''))::text as nombre,
      'pendiente'::text as estado,
      coalesce(nullif(btrim(e.tipo_etapa), ''), 'trabajo')::text as tipo_etapa,
      coalesce(nullif(btrim(mt.taller), ''), nullif(btrim(e.lugar), ''))::text as lugar,
      mt.fecha_necesidad as fecha_referencia,
      translate(
        upper(concat_ws(' ', mt.tipo_trabajo, mt.designacion, mt.taller)),
        'ÁÉÍÓÚÜÑ',
        'AEIOUUN'
      ) as texto_clasificacion,
      concat_ws(
        ' · ',
        nullif(btrim(mt.tipo_trabajo), ''),
        nullif(btrim(mt.designacion), ''),
        nullif(btrim(mt.taller), '')
      )::text as trabajos,
      coalesce(nullif(mt.fuentes -> 0 ->> 'fila', ''), '0')::integer as fila_origen,
      mt.tipo_trabajo::text,
      mt.designacion::text,
      mt.taller::text
    from app_private.manteniment_t_trabajos mt
    left join public.trabajos_etapa_hotel th
      on th.id = mt.trabajo_hotel_id
    left join public.etapas_hotel e
      on e.id = th.etapa_hotel_id
    left join public.registros_hotel rh
      on rh.id = e.registro_hotel_id
    where mt.fecha_realizada is null
  )
  select
    p.necesidad_id,
    p.etapa_id,
    p.registro_hotel_id,
    p.seguimiento_id,
    p.dfm,
    p.matricula,
    p.numero_parada,
    p.prioridad,
    p.posicion,
    coalesce(nullif(p.nombre, ''), 'Necesidad de MANTENIMENT')::text as nombre,
    p.estado,
    p.tipo_etapa,
    p.lugar,
    p.fecha_referencia,
    case
      when p.texto_clasificacion ~ '(^|[^A-Z0-9])EXT(INTOR)?([^A-Z0-9]|$)' then 'EXTINTOR'
      when p.texto_clasificacion ~ '(^|[^A-Z0-9])ITV([^A-Z0-9]|$)' then 'ITV'
      when p.texto_clasificacion ~ '(^|[^A-Z0-9])(AV|AVERIA|REPARACION|BR|GP)([^A-Z0-9]|$)' then 'AVERIA'
      when p.texto_clasificacion ~ '(^|[^A-Z0-9])(MANTENIMIENTO|MANTENIMENT|MCD|BPW)([^A-Z0-9]|$)' then 'MANTENIMIENTO'
      when p.texto_clasificacion ~ '(^|[^A-Z0-9])(TRAMITE|GESTION|TMG|ATP|44TN|LKT)([^A-Z0-9]|$)' then 'TRAMITE'
      else 'OTROS'
    end::text as familia,
    p.trabajos,
    true as origen_manteniment,
    nullif(p.fila_origen, 0) as fila_origen,
    p.tipo_trabajo,
    p.designacion,
    p.taller
  from pendientes p
  order by
    p.fecha_referencia asc nulls last,
    p.prioridad asc nulls last,
    p.dfm,
    p.fila_origen,
    p.necesidad_id
  limit 1000;
end;
$function$;

create or replace function public.listar_necesidades_manteniment_pendientes_alpha74()
returns table (
  necesidad_id uuid,
  etapa_id uuid,
  registro_hotel_id uuid,
  seguimiento_id uuid,
  dfm text,
  matricula text,
  numero_parada text,
  prioridad integer,
  posicion integer,
  nombre text,
  estado text,
  tipo_etapa text,
  lugar text,
  fecha_referencia date,
  familia text,
  trabajos text,
  origen_manteniment boolean,
  fila_origen integer,
  tipo_trabajo text,
  designacion text,
  taller text
)
language sql
stable
security invoker
set search_path = pg_catalog, app_private
as $function$
  select * from app_private.listar_necesidades_manteniment_pendientes_alpha74();
$function$;

revoke all on function app_private.listar_necesidades_manteniment_pendientes_alpha74()
  from public, anon, authenticated;
grant execute on function app_private.listar_necesidades_manteniment_pendientes_alpha74()
  to authenticated, service_role;

revoke all on function public.listar_necesidades_manteniment_pendientes_alpha74()
  from public, anon, authenticated;
grant execute on function public.listar_necesidades_manteniment_pendientes_alpha74()
  to authenticated, service_role;

comment on function public.listar_necesidades_manteniment_pendientes_alpha74()
  is 'Necesidades pendientes procedentes de MANTENIMENT, una fila por necesidad, para la pestaña T pendientes.';
