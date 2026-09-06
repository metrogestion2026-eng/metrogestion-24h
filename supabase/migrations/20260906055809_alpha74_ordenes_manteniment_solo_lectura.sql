-- Alpha74: panel administrativo de solo lectura para la cola de órdenes
-- PARADA que Metrogestión espera que confirme MANTENIMENT. La tabla privada,
-- el payload completo y los identificadores de sincronización no se exponen.

create or replace function app_private.listar_ordenes_manteniment_pendientes_alpha74()
returns table (
  dfm text,
  matricula text,
  numero_parada text,
  accion text,
  revision integer,
  creado_en timestamptz,
  actualizado_en timestamptz,
  con_error boolean
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
    or not public.es_administrador_principal() then
    raise exception 'Solo el administrador principal puede consultar las órdenes de MANTENIMENT'
      using errcode = '42501';
  end if;

  return query
  select
    coalesce(nullif(btrim(o.payload->>'dfm'), ''), '—')::text,
    coalesce(nullif(btrim(o.payload->>'matricula'), ''), '—')::text,
    coalesce(nullif(btrim(r.numero_parada), ''), '—')::text,
    case
      when s.fila_manteniment is null then 'Crear fila PARADA'
      else 'Actualizar fila PARADA'
    end::text,
    o.revision,
    o.creado_en,
    o.actualizado_en,
    (btrim(coalesce(o.ultimo_error, '')) <> '')
  from app_private.manteniment_parada_outbox o
  join app_private.manteniment_parada_sync s
    on s.seguimiento_id = o.seguimiento_id
  left join lateral (
    select rh.numero_parada::text
    from public.registros_hotel rh
    where rh.seguimiento_id = o.seguimiento_id
    order by rh.actualizado_en desc nulls last, rh.id desc
    limit 1
  ) r on true
  where o.estado = 'pendiente'
  order by o.actualizado_en desc, o.seguimiento_id
  limit 100;
end;
$function$;

create or replace function public.listar_ordenes_manteniment_pendientes_alpha74()
returns table (
  dfm text,
  matricula text,
  numero_parada text,
  accion text,
  revision integer,
  creado_en timestamptz,
  actualizado_en timestamptz,
  con_error boolean
)
language sql
stable
security invoker
set search_path = pg_catalog, app_private
as $function$
  select * from app_private.listar_ordenes_manteniment_pendientes_alpha74();
$function$;

revoke all on function app_private.listar_ordenes_manteniment_pendientes_alpha74()
  from public, anon, authenticated;
grant execute on function app_private.listar_ordenes_manteniment_pendientes_alpha74()
  to authenticated, service_role;

revoke all on function public.listar_ordenes_manteniment_pendientes_alpha74()
  from public, anon, authenticated;
grant execute on function public.listar_ordenes_manteniment_pendientes_alpha74()
  to authenticated, service_role;

comment on function public.listar_ordenes_manteniment_pendientes_alpha74()
  is 'Lista limitada y sin secretos de órdenes PARADA pendientes, exclusivamente para el administrador principal.';
