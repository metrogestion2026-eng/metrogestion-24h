-- Metrogestion: cierre de superficie pública y mínimo privilegio.
-- Alpha66 y Alpha67 no se modifican; esta migración endurece la base compartida.

-- 1. RLS en las tablas detectadas por Security Advisor.
alter table public.medias_km_dfm enable row level security;
alter table public.cierres_facturacion enable row level security;
alter table public.config_facturacion_sustituciones enable row level security;

drop policy if exists medias_km_dfm_select_hotel on public.medias_km_dfm;
create policy medias_km_dfm_select_hotel
on public.medias_km_dfm
for select
to authenticated
using (
  (select public.dispositivo_autorizado())
  and (
    (select public.puede_ver_modulo('hotel'))
    or (select public.puede_ver_modulo('historico'))
  )
);

drop policy if exists cierres_facturacion_select_hotel on public.cierres_facturacion;
create policy cierres_facturacion_select_hotel
on public.cierres_facturacion
for select
to authenticated
using (
  (select public.dispositivo_autorizado())
  and (
    (select public.puede_ver_modulo('hotel'))
    or (select public.puede_ver_modulo('historico'))
  )
);

drop policy if exists config_facturacion_select_primary on public.config_facturacion_sustituciones;
create policy config_facturacion_select_primary
on public.config_facturacion_sustituciones
for select
to authenticated
using (
  (select public.dispositivo_autorizado())
  and (select public.es_administrador_principal())
);

-- La media manual validada en Alpha66 queda visible solo para el administrador principal.
drop policy if exists ajustes_sustitucion_select_authenticated on public.ajustes_sustitucion_parada;
drop policy if exists ajustes_sustitucion_select_primary on public.ajustes_sustitucion_parada;
create policy ajustes_sustitucion_select_primary
on public.ajustes_sustitucion_parada
for select
to authenticated
using (
  (select public.dispositivo_autorizado())
  and (select public.es_administrador_principal())
);

revoke all privileges on all tables in schema public from anon;

revoke all privileges on table
  public.medias_km_dfm,
  public.cierres_facturacion,
  public.config_facturacion_sustituciones
from authenticated;

grant select on table
  public.medias_km_dfm,
  public.cierres_facturacion,
  public.config_facturacion_sustituciones
to authenticated;

grant all privileges on table
  public.medias_km_dfm,
  public.cierres_facturacion,
  public.config_facturacion_sustituciones
to service_role;

revoke insert, update, delete on table public.ajustes_sustitucion_parada from authenticated;
grant select on table public.ajustes_sustitucion_parada to authenticated;
grant all privileges on table public.ajustes_sustitucion_parada to service_role;

-- 2. Las vistas ejecutan con los permisos/RLS del usuario y son solo de lectura.
alter view public.hotel_actual_detalle set (security_invoker = true);
alter view public.listado_paradas_operativas set (security_invoker = true);
alter view public.paradas_sustitucion_resumen set (security_invoker = true);
alter view public.facturacion_dfm_periodos set (security_invoker = true);
alter view public.facturacion_r_sustituciones set (security_invoker = true);

revoke all privileges on table
  public.hotel_actual_detalle,
  public.listado_paradas_operativas,
  public.paradas_sustitucion_resumen,
  public.facturacion_dfm_periodos,
  public.facturacion_r_sustituciones
from public, anon, authenticated;

grant select on table
  public.hotel_actual_detalle,
  public.listado_paradas_operativas,
  public.paradas_sustitucion_resumen,
  public.facturacion_dfm_periodos,
  public.facturacion_r_sustituciones
to authenticated, service_role;

-- 3. Las implementaciones privilegiadas salen del esquema expuesto.
alter function public.anular_activacion_24h(uuid, text, text) set schema app_private;
alter function public.crear_ficha_hotel(jsonb, text) set schema app_private;
alter function public.guardar_activacion_24h(uuid, jsonb, text) set schema app_private;
alter function public.guardar_ficha_hotel_edicion(uuid, integer, jsonb, jsonb, text) set schema app_private;
alter function public.guardar_ficha_hotel_edicion_catalogos(uuid, integer, jsonb, jsonb, text) set schema app_private;
alter function public.guardar_ficha_hotel_edicion_v2(uuid, integer, jsonb, jsonb, text) set schema app_private;
alter function public.guardar_km_dia_sustitucion(uuid, numeric, text) set schema app_private;
alter function public.guardar_precio_r_sustitucion(numeric) set schema app_private;
alter function public.guardar_revision_importacion_hotel(uuid, jsonb, text) set schema app_private;
alter function public.modificar_activacion_24h(uuid, jsonb, text, text) set schema app_private;
alter function public.reconciliar_etapas_hotel(uuid, text) set schema app_private;
alter function public.restaurar_activacion_24h(uuid, text, text) set schema app_private;

create function public.anular_activacion_24h(
  p_id uuid, p_motivo text, p_request_id text
) returns jsonb
language sql volatile security invoker
set search_path = pg_catalog, app_private
as $function$
  select app_private.anular_activacion_24h($1, $2, $3);
$function$;

create function public.crear_ficha_hotel(
  p_ficha jsonb, p_request_id text
) returns jsonb
language sql volatile security invoker
set search_path = pg_catalog, app_private
as $function$
  select app_private.crear_ficha_hotel($1, $2);
$function$;

create function public.guardar_activacion_24h(
  p_id uuid, p_payload jsonb, p_request_id text
) returns jsonb
language sql volatile security invoker
set search_path = pg_catalog, app_private
as $function$
  select app_private.guardar_activacion_24h($1, $2, $3);
$function$;

create function public.guardar_ficha_hotel_edicion(
  p_registro_id uuid, p_version integer, p_ficha jsonb, p_etapas jsonb, p_request_id text
) returns jsonb
language sql volatile security invoker
set search_path = pg_catalog, app_private
as $function$
  select app_private.guardar_ficha_hotel_edicion($1, $2, $3, $4, $5);
$function$;

create function public.guardar_ficha_hotel_edicion_catalogos(
  p_registro_id uuid, p_version integer, p_ficha jsonb, p_etapas jsonb, p_request_id text
) returns jsonb
language sql volatile security invoker
set search_path = pg_catalog, app_private
as $function$
  select app_private.guardar_ficha_hotel_edicion_catalogos($1, $2, $3, $4, $5);
$function$;

create function public.guardar_ficha_hotel_edicion_v2(
  p_registro_id uuid, p_version integer, p_ficha jsonb, p_etapas jsonb, p_request_id text
) returns jsonb
language sql volatile security invoker
set search_path = pg_catalog, app_private
as $function$
  select app_private.guardar_ficha_hotel_edicion_v2($1, $2, $3, $4, $5);
$function$;

create function public.guardar_km_dia_sustitucion(
  p_seguimiento_id uuid, p_km_dia numeric, p_observaciones text default ''::text
) returns jsonb
language sql volatile security invoker
set search_path = pg_catalog, app_private
as $function$
  select app_private.guardar_km_dia_sustitucion($1, $2, $3);
$function$;

create function public.guardar_precio_r_sustitucion(
  p_precio numeric
) returns jsonb
language sql volatile security invoker
set search_path = pg_catalog, app_private
as $function$
  select app_private.guardar_precio_r_sustitucion($1);
$function$;

create function public.guardar_revision_importacion_hotel(
  p_importacion_id uuid, p_revisiones jsonb, p_request_id text
) returns jsonb
language sql volatile security invoker
set search_path = pg_catalog, app_private
as $function$
  select app_private.guardar_revision_importacion_hotel($1, $2, $3);
$function$;

create function public.modificar_activacion_24h(
  p_id uuid, p_cambios jsonb, p_motivo text, p_request_id text
) returns jsonb
language sql volatile security invoker
set search_path = pg_catalog, app_private
as $function$
  select app_private.modificar_activacion_24h($1, $2, $3, $4);
$function$;

create function public.reconciliar_etapas_hotel(
  p_registro_id uuid, p_request_id text
) returns jsonb
language sql volatile security invoker
set search_path = pg_catalog, app_private
as $function$
  select app_private.reconciliar_etapas_hotel($1, $2);
$function$;

create function public.restaurar_activacion_24h(
  p_id uuid, p_motivo text, p_request_id text
) returns jsonb
language sql volatile security invoker
set search_path = pg_catalog, app_private
as $function$
  select app_private.restaurar_activacion_24h($1, $2, $3);
$function$;

-- Estos cuatro ya eran pasarelas; se elimina el privilegio del propio wrapper.
alter function public.desactivar_sync_manteniment() security invoker;
alter function public.estado_sync_manteniment() security invoker;
alter function public.generar_clave_sync_manteniment() security invoker;
alter function public.recibir_snapshot_manteniment(text, jsonb) security invoker;

-- Ninguna función pública se hereda de PUBLIC/anon salvo el webhook con clave propia.
revoke execute on all functions in schema public from public, anon;

grant execute on function
  public.anular_activacion_24h(uuid, text, text),
  public.crear_ficha_hotel(jsonb, text),
  public.desactivar_sync_manteniment(),
  public.estado_sync_manteniment(),
  public.generar_clave_sync_manteniment(),
  public.guardar_activacion_24h(uuid, jsonb, text),
  public.guardar_ficha_hotel_edicion(uuid, integer, jsonb, jsonb, text),
  public.guardar_ficha_hotel_edicion_catalogos(uuid, integer, jsonb, jsonb, text),
  public.guardar_ficha_hotel_edicion_v2(uuid, integer, jsonb, jsonb, text),
  public.guardar_km_dia_sustitucion(uuid, numeric, text),
  public.guardar_precio_r_sustitucion(numeric),
  public.guardar_revision_importacion_hotel(uuid, jsonb, text),
  public.modificar_activacion_24h(uuid, jsonb, text, text),
  public.recibir_snapshot_manteniment(text, jsonb),
  public.reconciliar_etapas_hotel(uuid, text),
  public.restaurar_activacion_24h(uuid, text, text)
to authenticated, service_role;

grant execute on function public.recibir_snapshot_manteniment(text, jsonb) to anon;

-- app_private no se expone por PostgREST. Solo el webhook es alcanzable por anon.
grant usage on schema app_private to anon, authenticated, service_role;
revoke execute on all functions in schema app_private from public, anon;
grant execute on all functions in schema app_private to authenticated, service_role;
grant execute on function app_private.recibir_snapshot_manteniment(text, jsonb) to anon;

-- 4. Evitar que las futuras migraciones vuelvan a conceder acceso automático.
alter default privileges for role postgres in schema public
  revoke all privileges on tables from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all privileges on sequences from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated;
alter default privileges for role postgres in schema public
  grant all privileges on tables to service_role;
alter default privileges for role postgres in schema public
  grant all privileges on sequences to service_role;
alter default privileges for role postgres in schema public
  grant execute on functions to service_role;

alter default privileges for role postgres in schema app_private
  revoke execute on functions from public, anon, authenticated;
alter default privileges for role postgres in schema app_private
  grant execute on functions to service_role;
