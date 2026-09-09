create or replace function app_private.listar_t_pendientes_30d_alpha74()
returns table (
  etapa_id uuid,
  registro_hotel_id uuid,
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
  origen_manteniment boolean
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
    raise exception 'No tienes permiso para consultar las T pendientes'
      using errcode = '42501';
  end if;

  return query
  with agrupadas as (
    select
      e.id as etapa_id,
      e.registro_hotel_id,
      h.dfm::text as dfm,
      h.matricula::text as matricula,
      h.numero_parada::text as numero_parada,
      h.prioridad::integer as prioridad,
      e.posicion,
      e.nombre,
      e.estado,
      e.tipo_etapa,
      e.lugar,
      coalesce(
        min(mw.fecha_necesidad) filter (where mw.fecha_realizada is null),
        e.fecha_prevista::date
      ) as fecha_referencia,
      coalesce(
        nullif(string_agg(
          distinct concat_ws(
            ' · ',
            nullif(btrim(t.motivo_entrada), ''),
            nullif(btrim(t.categoria_tecnica), ''),
            nullif(btrim(t.descripcion), '')
          ),
          ' | '
        ) filter (where t.id is not null and not t.cancelado), ''),
        ''
      ) as trabajos,
      bool_or(mw.id is not null) as origen_manteniment,
      translate(
        upper(concat_ws(
          ' ',
          e.nombre,
          e.tipo_etapa,
          e.lugar,
          string_agg(
            distinct concat_ws(
              ' ',
              t.tipo_trabajo,
              t.motivo_entrada,
              t.categoria_tecnica,
              t.descripcion
            ),
            ' '
          ) filter (where t.id is not null and not t.cancelado)
        )),
        'ÁÉÍÓÚÜÑ',
        'AEIOUUN'
      ) as texto_clasificacion
    from public.etapas_hotel e
    join public.hotel_actual_detalle h
      on h.id = e.registro_hotel_id
    left join public.trabajos_etapa_hotel t
      on t.etapa_hotel_id = e.id
     and not t.cancelado
    left join app_private.manteniment_t_trabajos mw
      on mw.trabajo_hotel_id = t.id
     and mw.fecha_realizada is null
    where not e.cancelado
      and e.estado in ('pendiente', 'programada', 'en_curso')
    group by
      e.id,
      e.registro_hotel_id,
      h.dfm,
      h.matricula,
      h.numero_parada,
      h.prioridad,
      e.posicion,
      e.nombre,
      e.estado,
      e.tipo_etapa,
      e.lugar,
      e.fecha_prevista
  )
  select
    a.etapa_id,
    a.registro_hotel_id,
    a.dfm,
    a.matricula,
    a.numero_parada,
    a.prioridad,
    a.posicion,
    a.nombre,
    a.estado,
    a.tipo_etapa,
    a.lugar,
    a.fecha_referencia,
    case
      when a.texto_clasificacion ~ '(^|[^A-Z0-9])EXT(INTOR)?([^A-Z0-9]|$)' then 'EXTINTOR'
      when a.texto_clasificacion ~ '(^|[^A-Z0-9])ITV([^A-Z0-9]|$)' then 'ITV'
      when a.texto_clasificacion ~ '(^|[^A-Z0-9])(AV|AVERIA|REPARACION|BR)([^A-Z0-9]|$)' then 'AVERIA'
      when a.texto_clasificacion ~ '(^|[^A-Z0-9])(MANTENIMIENTO|MANTENIMENT|MCD|BPW)([^A-Z0-9]|$)' then 'MANTENIMIENTO'
      when a.texto_clasificacion ~ '(^|[^A-Z0-9])(TRAMITE|GESTION|TMG|ATP|44TN|LKT)([^A-Z0-9]|$)' then 'TRAMITE'
      else 'OTROS'
    end::text as familia,
    a.trabajos,
    a.origen_manteniment
  from agrupadas a
  order by
    a.fecha_referencia asc nulls last,
    a.prioridad asc nulls last,
    a.dfm,
    a.posicion,
    a.etapa_id
  limit 500;
end;
$function$;

create or replace function public.listar_t_pendientes_30d_alpha74()
returns table (
  etapa_id uuid,
  registro_hotel_id uuid,
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
  origen_manteniment boolean
)
language sql
stable
security invoker
set search_path = pg_catalog, app_private
as $function$
  select * from app_private.listar_t_pendientes_30d_alpha74();
$function$;

revoke all on function app_private.listar_t_pendientes_30d_alpha74()
  from public, anon, authenticated;
grant execute on function app_private.listar_t_pendientes_30d_alpha74()
  to authenticated, service_role;

revoke all on function public.listar_t_pendientes_30d_alpha74()
  from public, anon, authenticated;
grant execute on function public.listar_t_pendientes_30d_alpha74()
  to authenticated, service_role;

comment on function public.listar_t_pendientes_30d_alpha74()
  is 'Listado deduplicado de T pendientes para la pestaña T pendientes, con fecha de MANTENIMENT y clasificación operativa.';
