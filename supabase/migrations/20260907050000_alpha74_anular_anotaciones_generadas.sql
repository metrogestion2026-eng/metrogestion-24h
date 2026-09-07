-- Alpha74: permite al administrador principal anular una línea automática de
-- la cronología sin cancelar ni modificar la T que originó esa línea.
-- La anulación se conserva como un registro independiente e inmutable.

create table if not exists public.anotaciones_generadas_hotel_anuladas (
  id uuid primary key default gen_random_uuid(),
  seguimiento_id uuid not null,
  etapa_seguimiento_id uuid not null,
  registro_origen_id uuid not null references public.registros_hotel(id) on delete restrict,
  etapa_origen_id uuid not null references public.etapas_hotel(id) on delete restrict,
  motivo text not null default 'Anotación automática anulada desde Hotel',
  anulada_por uuid not null references public.usuarios(id) on delete restrict,
  anulada_en timestamptz not null default clock_timestamp(),
  request_id text not null,
  constraint anotaciones_generadas_hotel_anuladas_motivo_check
    check (length(btrim(motivo)) between 1 and 500),
  constraint anotaciones_generadas_hotel_anuladas_request_check
    check (length(btrim(request_id)) between 1 and 200),
  constraint anotaciones_generadas_hotel_anuladas_seguimiento_uq
    unique (seguimiento_id, etapa_seguimiento_id),
  constraint anotaciones_generadas_hotel_anuladas_request_uq unique (request_id)
);

create index if not exists anotaciones_generadas_hotel_anuladas_seguimiento_idx
  on public.anotaciones_generadas_hotel_anuladas (seguimiento_id, anulada_en desc);

alter table public.anotaciones_generadas_hotel_anuladas enable row level security;

drop policy if exists anotaciones_generadas_hotel_anuladas_select_secure
  on public.anotaciones_generadas_hotel_anuladas;
create policy anotaciones_generadas_hotel_anuladas_select_secure
  on public.anotaciones_generadas_hotel_anuladas
  for select
  to authenticated
  using (
    (select public.usuario_activo())
    and (select public.dispositivo_autorizado())
    and (
      (select public.puede_ver_modulo('hotel'))
      or (select public.puede_ver_modulo('historico'))
    )
  );

revoke all on table public.anotaciones_generadas_hotel_anuladas
  from public, anon, authenticated;
grant select on table public.anotaciones_generadas_hotel_anuladas to authenticated;
grant all on table public.anotaciones_generadas_hotel_anuladas to service_role;

create or replace function app_private.anular_anotacion_generada_hotel_alpha74(
  p_registro_id uuid,
  p_etapa_id uuid,
  p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $function$
declare
  v_actor uuid := auth.uid();
  v_request_id text := btrim(coalesce(p_request_id, ''));
  v_seguimiento_id uuid;
  v_etapa_seguimiento_id uuid;
  v_anulacion public.anotaciones_generadas_hotel_anuladas%rowtype;
begin
  if v_actor is null
    or not public.usuario_activo()
    or not public.dispositivo_autorizado()
    or not public.es_administrador_principal() then
    raise exception 'Solo el administrador principal puede anular anotaciones generadas'
      using errcode = '42501';
  end if;

  if p_registro_id is null or p_etapa_id is null then
    raise exception 'La identidad de la anotación generada no es válida'
      using errcode = '22023';
  end if;
  if length(v_request_id) not between 1 and 200 then
    raise exception 'El identificador de la operación no es válido'
      using errcode = '22023';
  end if;

  select r.seguimiento_id, e.seguimiento_id
    into v_seguimiento_id, v_etapa_seguimiento_id
  from public.registros_hotel r
  join public.etapas_hotel e on e.registro_hotel_id = r.id
  where r.id = p_registro_id
    and e.id = p_etapa_id
    and not e.cancelado
    and e.estado = 'realizada';

  if v_seguimiento_id is null or v_etapa_seguimiento_id is null then
    raise exception 'La anotación generada no pertenece a esta ficha o su T no está realizada'
      using errcode = 'P0002';
  end if;

  perform set_config('app.request_id', v_request_id, true);
  perform set_config('app.audit_origin', 'metrogestion-alpha74-anotacion-generada', true);
  perform set_config(
    'app.audit_reason',
    'Anotación automática anulada sin modificar la T de origen',
    true
  );

  insert into public.anotaciones_generadas_hotel_anuladas (
    seguimiento_id,
    etapa_seguimiento_id,
    registro_origen_id,
    etapa_origen_id,
    anulada_por,
    request_id
  ) values (
    v_seguimiento_id,
    v_etapa_seguimiento_id,
    p_registro_id,
    p_etapa_id,
    v_actor,
    v_request_id
  )
  on conflict (seguimiento_id, etapa_seguimiento_id) do nothing
  returning * into v_anulacion;

  if v_anulacion.id is null then
    select a.* into v_anulacion
    from public.anotaciones_generadas_hotel_anuladas a
    where a.seguimiento_id = v_seguimiento_id
      and a.etapa_seguimiento_id = v_etapa_seguimiento_id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'id', v_anulacion.id,
    'seguimiento_id', v_anulacion.seguimiento_id,
    'etapa_seguimiento_id', v_anulacion.etapa_seguimiento_id,
    'anulada_en', v_anulacion.anulada_en
  );
end;
$function$;

create or replace function public.anular_anotacion_generada_hotel_alpha74(
  p_registro_id uuid,
  p_etapa_id uuid,
  p_request_id text
)
returns jsonb
language sql
security invoker
set search_path = pg_catalog, app_private
as $function$
  select app_private.anular_anotacion_generada_hotel_alpha74($1, $2, $3);
$function$;

revoke all on function app_private.anular_anotacion_generada_hotel_alpha74(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function app_private.anular_anotacion_generada_hotel_alpha74(uuid, uuid, text)
  to authenticated, service_role;

revoke all on function public.anular_anotacion_generada_hotel_alpha74(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.anular_anotacion_generada_hotel_alpha74(uuid, uuid, text)
  to authenticated, service_role;
