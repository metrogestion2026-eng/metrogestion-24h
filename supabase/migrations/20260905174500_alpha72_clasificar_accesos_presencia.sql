begin;

alter table public.intentos_acceso_no_reconocido
  add column if not exists aperturas_login integer not null default 0,
  add column if not exists credenciales_rechazadas integer not null default 0,
  add column if not exists ultimo_rechazo_en timestamptz,
  add column if not exists reconocido_en timestamptz,
  add column if not exists reconocido_por uuid references public.usuarios(id) on delete set null;

do $constraints$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'intentos_acceso_aperturas_login_check'
      and conrelid = 'public.intentos_acceso_no_reconocido'::regclass
  ) then
    alter table public.intentos_acceso_no_reconocido
      add constraint intentos_acceso_aperturas_login_check check (aperturas_login >= 0);
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'intentos_acceso_credenciales_rechazadas_check'
      and conrelid = 'public.intentos_acceso_no_reconocido'::regclass
  ) then
    alter table public.intentos_acceso_no_reconocido
      add constraint intentos_acceso_credenciales_rechazadas_check check (credenciales_rechazadas >= 0);
  end if;
end;
$constraints$;

update public.intentos_acceso_no_reconocido
set aperturas_login = greatest(
      repeticiones - case when correo_indicado <> '' then 1 else 0 end,
      0
    ),
    credenciales_rechazadas = case when correo_indicado <> '' then 1 else 0 end,
    ultimo_rechazo_en = case when correo_indicado <> '' then primero_en else null end
where aperturas_login = 0
  and credenciales_rechazadas = 0;

with autorizados as (
  select distinct on (d.token_hash)
    d.token_hash,
    d.usuario_id,
    d.ultimo_acceso_en
  from public.dispositivos_usuario d
  where d.estado = 'autorizado'
    and d.ultimo_acceso_en is not null
  order by d.token_hash, d.ultimo_acceso_en desc
)
update public.intentos_acceso_no_reconocido i
set reconocido_en = a.ultimo_acceso_en,
    reconocido_por = a.usuario_id,
    aperturas_login = case when a.ultimo_acceso_en >= coalesce(i.ultimo_rechazo_en, '-infinity'::timestamptz) then 0 else i.aperturas_login end,
    credenciales_rechazadas = case when a.ultimo_acceso_en >= coalesce(i.ultimo_rechazo_en, '-infinity'::timestamptz) then 0 else i.credenciales_rechazadas end,
    ultimo_rechazo_en = case when a.ultimo_acceso_en >= coalesce(i.ultimo_rechazo_en, '-infinity'::timestamptz) then null else i.ultimo_rechazo_en end
from autorizados a
where a.token_hash = i.huella_hash;

create index if not exists dispositivos_usuario_token_hash_idx
  on public.dispositivos_usuario (token_hash);

CREATE OR REPLACE FUNCTION app_private.registrar_intento_acceso_anonimo(p_huella_hash text, p_ip_hash text, p_correo text, p_evento text, p_agente text, p_ruta text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'app_private'
AS $function$
declare
  v_id uuid;
  v_bloqueado boolean;
  v_evento text := lower(btrim(coalesce(p_evento, '')));
  v_incremento integer;
  v_apertura integer;
  v_rechazo integer;
begin
  if coalesce(p_huella_hash, '') !~ '^[0-9a-f]{64}$' then raise exception 'Huella no válida'; end if;
  if coalesce(p_ip_hash, '') <> '' and p_ip_hash !~ '^[0-9a-f]{64}$' then raise exception 'Red no válida'; end if;
  if v_evento not in ('vista_login','credenciales_rechazadas','comprobar_bloqueo') then
    raise exception 'Evento no válido';
  end if;

  v_incremento := case when v_evento = 'comprobar_bloqueo' then 0 else 1 end;
  v_apertura := case when v_evento = 'vista_login' then 1 else 0 end;
  v_rechazo := case when v_evento = 'credenciales_rechazadas' then 1 else 0 end;

  insert into public.intentos_acceso_no_reconocido (
    huella_hash, ip_hash, correo_indicado, ultimo_evento,
    agente, ruta, primero_en, ultimo_en, repeticiones,
    aperturas_login, credenciales_rechazadas, ultimo_rechazo_en
  ) values (
    p_huella_hash, coalesce(p_ip_hash, ''),
    left(lower(btrim(coalesce(p_correo, ''))), 160), v_evento,
    left(coalesce(p_agente, ''), 500), left(coalesce(p_ruta, ''), 160),
    now(), now(), greatest(v_incremento, 1),
    v_apertura, v_rechazo,
    case when v_rechazo = 1 then now() else null end
  )
  on conflict (huella_hash) do update
  set ip_hash = case when excluded.ip_hash <> '' then excluded.ip_hash
                     else public.intentos_acceso_no_reconocido.ip_hash end,
      correo_indicado = case when excluded.correo_indicado <> '' then excluded.correo_indicado
                             else public.intentos_acceso_no_reconocido.correo_indicado end,
      ultimo_evento = case when excluded.ultimo_evento = 'comprobar_bloqueo'
                           then public.intentos_acceso_no_reconocido.ultimo_evento
                           else excluded.ultimo_evento end,
      agente = excluded.agente,
      ruta = excluded.ruta,
      ultimo_en = now(),
      repeticiones = public.intentos_acceso_no_reconocido.repeticiones + v_incremento,
      aperturas_login = public.intentos_acceso_no_reconocido.aperturas_login + v_apertura,
      credenciales_rechazadas = public.intentos_acceso_no_reconocido.credenciales_rechazadas + v_rechazo,
      ultimo_rechazo_en = case when v_rechazo = 1 then now()
                               else public.intentos_acceso_no_reconocido.ultimo_rechazo_en end
  returning id, bloqueado into v_id, v_bloqueado;

  return jsonb_build_object(
    'ok', true,
    'intento_id', v_id,
    'bloqueado', v_bloqueado
  );
end;
$function$;

CREATE OR REPLACE FUNCTION app_private.actualizar_presencia(p_instancia_id uuid, p_pagina text DEFAULT 'Aplicación'::text, p_version text DEFAULT ''::text, p_visible boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'app_private', 'extensions'
AS $function$
declare
  v_usuario public.usuarios%rowtype;
  v_dispositivo jsonb;
  v_permitido boolean := false;
  v_estado text := 'sin_sesion';
  v_dispositivo_id uuid;
  v_presencia_id uuid;
  v_session_id text;
  v_agente text;
  v_token text;
  v_huella_hash text;
begin
  if auth.uid() is null or p_instancia_id is null then
    return jsonb_build_object('permitido', false, 'estado', 'sin_sesion');
  end if;

  select * into v_usuario from public.usuarios where id = auth.uid();
  if not found then
    return jsonb_build_object('permitido', false, 'estado', 'usuario_no_reconocido');
  end if;

  v_token := app_private.request_header('x-device-token');
  v_dispositivo := app_private.comprobar_dispositivo(v_token);
  v_permitido := coalesce((v_dispositivo ->> 'permitido')::boolean, false);
  v_estado := coalesce(v_dispositivo ->> 'estado', 'desconocido');

  if not v_permitido then
    update public.sesiones_presencia
    set estado = 'bloqueado',
        visible = false,
        ultima_actividad_en = now(),
        bloqueada_en = coalesce(bloqueada_en, now()),
        motivo_bloqueo = case when motivo_bloqueo = '' then left(v_estado, 300) else motivo_bloqueo end
    where usuario_id = auth.uid() and instancia_id = p_instancia_id;

    return jsonb_build_object(
      'permitido', false,
      'estado', v_estado,
      'tipo_usuario', v_usuario.tipo_usuario
    );
  end if;

  begin
    v_dispositivo_id := nullif(v_dispositivo ->> 'dispositivo_id', '')::uuid;
  exception when others then
    v_dispositivo_id := null;
  end;

  v_session_id := coalesce(auth.jwt() ->> 'session_id', '');
  v_agente := left(coalesce(app_private.request_header('user-agent'), ''), 500);

  insert into public.sesiones_presencia (
    usuario_id, dispositivo_id, instancia_id, auth_session_id,
    pagina, version_cliente, visible, estado, conectada_en,
    ultima_actividad_en, agente, bloqueada_en, bloqueada_por, motivo_bloqueo
  ) values (
    auth.uid(), v_dispositivo_id, p_instancia_id, nullif(v_session_id, ''),
    left(coalesce(nullif(btrim(p_pagina), ''), 'Aplicación'), 160),
    left(coalesce(p_version, ''), 80), coalesce(p_visible, true),
    'activo', now(), now(), v_agente, null, null, ''
  )
  on conflict (usuario_id, instancia_id) do update
  set dispositivo_id = excluded.dispositivo_id,
      auth_session_id = excluded.auth_session_id,
      pagina = excluded.pagina,
      version_cliente = excluded.version_cliente,
      visible = excluded.visible,
      estado = 'activo',
      ultima_actividad_en = now(),
      agente = excluded.agente,
      bloqueada_en = null,
      bloqueada_por = null,
      motivo_bloqueo = ''
  returning id into v_presencia_id;

  if length(coalesce(v_token, '')) >= 32 then
    v_huella_hash := encode(extensions.digest(v_token, 'sha256'), 'hex');
    update public.intentos_acceso_no_reconocido
    set reconocido_en = now(),
        reconocido_por = auth.uid(),
        aperturas_login = 0,
        credenciales_rechazadas = 0,
        ultimo_rechazo_en = null
    where huella_hash = v_huella_hash
      and bloqueado = false;
  end if;

  return jsonb_build_object(
    'permitido', true,
    'estado', 'activo',
    'presencia_id', v_presencia_id,
    'usuario_id', v_usuario.id,
    'nombre', btrim(concat_ws(' ', v_usuario.nombre, v_usuario.apellidos)),
    'tipo_usuario', v_usuario.tipo_usuario,
    'dispositivo_id', v_dispositivo_id
  );
end;
$function$;

CREATE OR REPLACE FUNCTION app_private.estado_presencia_admin()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'app_private'
AS $function$
declare
  v_en_linea jsonb;
  v_intentos jsonb;
  v_ahora timestamptz := now();
  v_identificaciones_en_linea bigint;
  v_rechazos bigint;
  v_bloqueados bigint;
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
    'intentos_no_reconocidos', v_intentos,
    'total_en_linea', jsonb_array_length(v_en_linea),
    'no_reconocidos_en_linea', v_identificaciones_en_linea,
    'identificaciones_en_linea', v_identificaciones_en_linea,
    'rechazos_credenciales', v_rechazos,
    'bloqueados', v_bloqueados
  );
end;
$function$;

comment on column public.intentos_acceso_no_reconocido.aperturas_login
  is 'Aperturas de la pantalla de identificación; no representan contraseñas fallidas.';
comment on column public.intentos_acceso_no_reconocido.credenciales_rechazadas
  is 'Número de rechazos de credenciales desde el último acceso reconocido.';
comment on column public.intentos_acceso_no_reconocido.reconocido_en
  is 'Último acceso válido que resolvió esta huella y la retira de los avisos pendientes.';
comment on function public.estado_presencia_admin()
  is 'Presencia en vivo y accesos sin completar, separados de los rechazos de credenciales; exclusivo del administrador principal.';

commit;
