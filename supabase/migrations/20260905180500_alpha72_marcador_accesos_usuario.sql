begin;

create table if not exists public.accesos_usuario (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references public.usuarios(id) on delete cascade,
  dispositivo_id uuid references public.dispositivos_usuario(id) on delete set null,
  sesion_clave text not null check (char_length(sesion_clave) between 6 and 400),
  auth_session_id text,
  accedido_en timestamptz not null default now(),
  ultimo_visto_en timestamptz not null default now(),
  version_cliente text not null default '',
  agente text not null default '',
  constraint accesos_usuario_sesion_uq unique (usuario_id, sesion_clave)
);

create index if not exists accesos_usuario_accedido_idx
  on public.accesos_usuario (accedido_en desc);
create index if not exists accesos_usuario_usuario_accedido_idx
  on public.accesos_usuario (usuario_id, accedido_en desc);
create index if not exists accesos_usuario_dispositivo_idx
  on public.accesos_usuario (dispositivo_id)
  where dispositivo_id is not null;

alter table public.accesos_usuario enable row level security;
revoke all on table public.accesos_usuario from public, anon, authenticated;
grant select, insert, update, delete on table public.accesos_usuario to service_role;

insert into public.accesos_usuario (
  usuario_id,
  dispositivo_id,
  sesion_clave,
  auth_session_id,
  accedido_en,
  ultimo_visto_en,
  version_cliente,
  agente
)
select
  s.usuario_id,
  (array_agg(s.dispositivo_id order by s.ultima_actividad_en desc)
    filter (where s.dispositivo_id is not null))[1],
  case
    when nullif(s.auth_session_id, '') is not null then 'auth:' || s.auth_session_id
    else 'instancia:' || s.instancia_id::text
  end,
  max(nullif(s.auth_session_id, '')),
  min(s.conectada_en),
  max(s.ultima_actividad_en),
  (array_agg(s.version_cliente order by s.ultima_actividad_en desc))[1],
  (array_agg(s.agente order by s.ultima_actividad_en desc))[1]
from public.sesiones_presencia s
group by
  s.usuario_id,
  case
    when nullif(s.auth_session_id, '') is not null then 'auth:' || s.auth_session_id
    else 'instancia:' || s.instancia_id::text
  end
on conflict (usuario_id, sesion_clave) do update
set dispositivo_id = coalesce(excluded.dispositivo_id, public.accesos_usuario.dispositivo_id),
    accedido_en = least(public.accesos_usuario.accedido_en, excluded.accedido_en),
    ultimo_visto_en = greatest(public.accesos_usuario.ultimo_visto_en, excluded.ultimo_visto_en),
    version_cliente = excluded.version_cliente,
    agente = excluded.agente;

CREATE OR REPLACE FUNCTION app_private.registrar_acceso_usuario_desde_presencia()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'app_private'
AS $function$
declare
  v_sesion_clave text;
begin
  if new.estado <> 'activo' then
    return new;
  end if;

  v_sesion_clave := case
    when nullif(new.auth_session_id, '') is not null then 'auth:' || new.auth_session_id
    else 'instancia:' || new.instancia_id::text
  end;

  insert into public.accesos_usuario (
    usuario_id,
    dispositivo_id,
    sesion_clave,
    auth_session_id,
    accedido_en,
    ultimo_visto_en,
    version_cliente,
    agente
  ) values (
    new.usuario_id,
    new.dispositivo_id,
    v_sesion_clave,
    nullif(new.auth_session_id, ''),
    new.conectada_en,
    new.ultima_actividad_en,
    new.version_cliente,
    new.agente
  )
  on conflict (usuario_id, sesion_clave) do update
  set dispositivo_id = coalesce(excluded.dispositivo_id, public.accesos_usuario.dispositivo_id),
      accedido_en = least(public.accesos_usuario.accedido_en, excluded.accedido_en),
      ultimo_visto_en = greatest(public.accesos_usuario.ultimo_visto_en, excluded.ultimo_visto_en),
      version_cliente = excluded.version_cliente,
      agente = excluded.agente;

  return new;
end;
$function$;

revoke all on function app_private.registrar_acceso_usuario_desde_presencia() from public, anon, authenticated;
grant execute on function app_private.registrar_acceso_usuario_desde_presencia() to service_role;

drop trigger if exists sesiones_presencia_registrar_acceso on public.sesiones_presencia;
create trigger sesiones_presencia_registrar_acceso
  after insert or update of ultima_actividad_en, estado, auth_session_id, dispositivo_id
  on public.sesiones_presencia
  for each row
  when (new.estado = 'activo')
  execute function app_private.registrar_acceso_usuario_desde_presencia();

CREATE OR REPLACE FUNCTION app_private.estado_presencia_admin()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'app_private'
AS $function$
declare
  v_en_linea jsonb;
  v_accesos_usuarios jsonb;
  v_intentos jsonb;
  v_ahora timestamptz := now();
  v_inicio_hoy timestamptz := date_trunc('day', now() at time zone 'Europe/Madrid') at time zone 'Europe/Madrid';
  v_identificaciones_en_linea bigint;
  v_rechazos bigint;
  v_bloqueados bigint;
  v_total_accesos_hoy bigint;
begin
  if not app_private.es_administrador_principal()
     or not app_private.dispositivo_autorizado() then
    raise exception 'Solo el administrador principal puede consultar la presencia';
  end if;

  select coalesce(jsonb_agg(to_jsonb(q) order by q.ultima_actividad_en desc), '[]'::jsonb)
  into v_en_linea
  from (
    select
      s.id as presencia_id, s.usuario_id,
      btrim(concat_ws(' ', u.nombre, u.apellidos)) as nombre,
      u.correo, u.tipo_usuario, u.activo as usuario_activo,
      s.dispositivo_id,
      coalesce(d.nombre, case when u.tipo_usuario = 'administrador_principal'
        then 'Dispositivo del administrador principal' else 'Dispositivo no localizado' end) as dispositivo,
      d.tipo_dispositivo, d.estado as estado_dispositivo,
      s.pagina, s.version_cliente, s.visible,
      s.conectada_en, s.ultima_actividad_en, s.estado, s.agente
    from public.sesiones_presencia s
    join public.usuarios u on u.id = s.usuario_id
    left join public.dispositivos_usuario d on d.id = s.dispositivo_id
    where s.estado = 'activo'
      and s.ultima_actividad_en >= v_ahora - interval '45 seconds'
  ) q;

  select coalesce(jsonb_agg(to_jsonb(q) order by q.ultimo_acceso_en desc nulls last, q.nombre), '[]'::jsonb)
  into v_accesos_usuarios
  from (
    select
      u.id as usuario_id,
      btrim(concat_ws(' ', u.nombre, u.apellidos)) as nombre,
      u.correo,
      u.tipo_usuario,
      coalesce((
        select count(*)
        from public.accesos_usuario acceso
        where acceso.usuario_id = u.id
          and acceso.accedido_en >= v_inicio_hoy
      ), 0) as accesos_hoy,
      coalesce((
        select count(*)
        from public.accesos_usuario acceso
        where acceso.usuario_id = u.id
          and acceso.accedido_en >= v_ahora - interval '7 days'
      ), 0) as accesos_7_dias,
      ultimo.accedido_en as ultimo_acceso_en,
      ultimo.ultimo_visto_en as ultima_actividad_en,
      ultimo.version_cliente as ultima_version_cliente,
      ultimo.agente as ultimo_agente,
      coalesce(dispositivo.nombre,
        case
          when ultimo.agente ilike '%Android%' then 'Android'
          when ultimo.agente ilike '%iPhone%' or ultimo.agente ilike '%iPad%' then 'Apple móvil'
          when ultimo.agente ilike '%Macintosh%' then 'Mac'
          when ultimo.agente ilike '%Windows%' then 'Windows'
          when ultimo.id is not null then 'Dispositivo no localizado'
          else ''
        end
      ) as ultimo_dispositivo
    from public.usuarios u
    left join lateral (
      select acceso.*
      from public.accesos_usuario acceso
      where acceso.usuario_id = u.id
      order by acceso.accedido_en desc
      limit 1
    ) ultimo on true
    left join public.dispositivos_usuario dispositivo on dispositivo.id = ultimo.dispositivo_id
    where u.activo = true
  ) q;

  select coalesce(sum((item ->> 'accesos_hoy')::bigint), 0)
  into v_total_accesos_hoy
  from jsonb_array_elements(v_accesos_usuarios) item;

  select coalesce(jsonb_agg(to_jsonb(q) order by q.ultimo_en desc), '[]'::jsonb)
  into v_intentos
  from (
    select
      i.id as intento_id, i.correo_indicado, i.ultimo_evento,
      i.agente, i.ruta, i.primero_en, i.ultimo_en,
      i.repeticiones, i.aperturas_login, i.credenciales_rechazadas,
      i.ultimo_rechazo_en, i.reconocido_en,
      (i.bloqueado or coalesce(d.estado, '') in ('bloqueado', 'revocado')) as bloqueado,
      coalesce(i.bloqueado_en, case when d.estado in ('bloqueado', 'revocado') then d.actualizado_en end) as bloqueado_en,
      coalesce(nullif(i.motivo_bloqueo, ''),
        case when d.estado in ('bloqueado', 'revocado')
          then coalesce(nullif(d.observaciones, ''), 'Dispositivo ' || d.estado) end,
        '') as motivo_bloqueo,
      case when i.bloqueado then 'huella'
           when d.estado in ('bloqueado', 'revocado') then 'dispositivo'
           else '' end as bloqueo_origen,
      d.id as dispositivo_id,
      d.nombre as dispositivo,
      d.estado as estado_dispositivo,
      case
        when i.bloqueado or coalesce(d.estado, '') in ('bloqueado', 'revocado') then 'bloqueado'
        when i.ultimo_rechazo_en is not null
          and (i.reconocido_en is null or i.ultimo_rechazo_en > i.reconocido_en)
          then 'credenciales_rechazadas'
        else 'identificacion'
      end as clasificacion,
      (i.ultimo_en >= v_ahora - interval '45 seconds') as en_linea
    from public.intentos_acceso_no_reconocido i
    left join lateral (
      select dispositivo.*
      from public.dispositivos_usuario dispositivo
      where dispositivo.token_hash = i.huella_hash
      order by
        case dispositivo.estado
          when 'autorizado' then 1
          when 'pendiente' then 2
          else 3
        end,
        coalesce(dispositivo.ultimo_acceso_en, dispositivo.actualizado_en) desc
      limit 1
    ) d on true
    where (i.ultimo_en >= v_ahora - interval '24 hours' or i.bloqueado = true)
      and (
        i.bloqueado = true
        or coalesce(d.estado, '') in ('bloqueado', 'revocado', 'pendiente')
        or (
          i.ultimo_rechazo_en is not null
          and (i.reconocido_en is null or i.ultimo_rechazo_en > i.reconocido_en)
        )
        or (d.id is null and i.reconocido_en is null)
      )
    order by i.ultimo_en desc
    limit 100
  ) q;

  select
    count(*) filter (where coalesce((item ->> 'en_linea')::boolean, false)),
    count(*) filter (where item ->> 'clasificacion' = 'credenciales_rechazadas'),
    count(*) filter (where coalesce((item ->> 'bloqueado')::boolean, false))
  into v_identificaciones_en_linea, v_rechazos, v_bloqueados
  from jsonb_array_elements(v_intentos) item;

  return jsonb_build_object(
    'consultado_en', v_ahora,
    'umbral_segundos', 45,
    'en_linea', v_en_linea,
    'accesos_usuarios', v_accesos_usuarios,
    'intentos_no_reconocidos', v_intentos,
    'total_en_linea', jsonb_array_length(v_en_linea),
    'total_accesos_hoy', v_total_accesos_hoy,
    'no_reconocidos_en_linea', v_identificaciones_en_linea,
    'identificaciones_en_linea', v_identificaciones_en_linea,
    'rechazos_credenciales', v_rechazos,
    'bloqueados', v_bloqueados
  );
end;
$function$;

comment on table public.accesos_usuario
  is 'Un registro por sesión autenticada y validada; los pulsos y las pestañas no aumentan el contador.';
comment on column public.accesos_usuario.sesion_clave
  is 'Identificador único de sesión Auth; usa la instancia únicamente como compatibilidad si falta session_id.';
comment on function public.estado_presencia_admin()
  is 'Presencia, marcador de accesos por usuario y accesos sin completar; exclusivo del administrador principal.';

commit;
