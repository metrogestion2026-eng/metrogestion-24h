-- MG75-NUMERO-PARADA-TEMPORAL-001
-- El alta de una ficha muestra y mantiene un número provisional exclusivo.
-- Si la ficha no se guarda, el número vuelve al fondo disponible.

create table if not exists app_private.numeros_parada_temporales_alpha75 (
  token uuid primary key default gen_random_uuid(),
  numero_parada bigint not null unique check (numero_parada > 0),
  usuario_id uuid not null,
  request_id text not null unique check (request_id ~ '^[A-Za-z0-9_-]{8,80}$'),
  creado_en timestamptz not null default clock_timestamp(),
  renovado_en timestamptz not null default clock_timestamp(),
  expira_en timestamptz not null,
  check (expira_en > creado_en)
);

create index if not exists numeros_parada_temporales_alpha75_expira_idx
  on app_private.numeros_parada_temporales_alpha75(expira_en);

create table if not exists app_private.numeros_parada_disponibles_alpha75 (
  numero_parada bigint primary key check (numero_parada > 0),
  disponible_desde timestamptz not null default clock_timestamp(),
  motivo text not null default 'liberada'
);

revoke all on app_private.numeros_parada_temporales_alpha75 from public, anon, authenticated;
revoke all on app_private.numeros_parada_disponibles_alpha75 from public, anon, authenticated;

create or replace function app_private.numero_parada_usado_alpha75(p_numero bigint)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $function$
  select p_numero is not null and exists (
    select 1
    from public.registros_hotel r
    where regexp_replace(coalesce(r.numero_parada, ''), '[^0-9]+', '', 'g') = p_numero::text
  );
$function$;

create or replace function app_private.reciclar_numeros_parada_expirados_alpha75()
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $function$
declare
  v_eliminados integer := 0;
begin
  insert into app_private.numeros_parada_disponibles_alpha75(
    numero_parada, disponible_desde, motivo
  )
  select t.numero_parada, clock_timestamp(), 'caducidad'
  from app_private.numeros_parada_temporales_alpha75 t
  where t.expira_en <= clock_timestamp()
    and not app_private.numero_parada_usado_alpha75(t.numero_parada)
  on conflict (numero_parada) do update
    set disponible_desde = excluded.disponible_desde,
        motivo = excluded.motivo;

  delete from app_private.numeros_parada_temporales_alpha75
  where expira_en <= clock_timestamp();
  get diagnostics v_eliminados = row_count;

  delete from app_private.numeros_parada_disponibles_alpha75 d
  where app_private.numero_parada_usado_alpha75(d.numero_parada);

  return v_eliminados;
end;
$function$;

create or replace function app_private.reservar_numero_parada_nueva_ficha_alpha75(
  p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $function$
declare
  v_usuario uuid := auth.uid();
  v_existente app_private.numeros_parada_temporales_alpha75%rowtype;
  v_token uuid;
  v_numero bigint;
  v_expira timestamptz;
begin
  if v_usuario is null
     or not public.dispositivo_autorizado()
     or not public.puede_editar_modulo('hotel') then
    raise exception 'No tienes permiso para reservar números de parada del Hotel';
  end if;

  if p_request_id is null
     or p_request_id !~ '^[A-Za-z0-9_-]{8,80}$' then
    raise exception 'Identificador de apertura no válido';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('MG75-NUMERO-PARADA-TEMPORAL-001', 0)
  );
  perform app_private.reciclar_numeros_parada_expirados_alpha75();

  select * into v_existente
  from app_private.numeros_parada_temporales_alpha75
  where request_id = p_request_id
  for update;

  if found then
    if v_existente.usuario_id <> v_usuario then
      raise exception 'El identificador de apertura ya pertenece a otra sesión';
    end if;

    v_expira := clock_timestamp() + interval '45 minutes';
    update app_private.numeros_parada_temporales_alpha75
    set renovado_en = clock_timestamp(), expira_en = v_expira
    where token = v_existente.token;

    return jsonb_build_object(
      'ok', true,
      'token', v_existente.token,
      'numero_parada', v_existente.numero_parada::text,
      'expira_en', v_expira,
      'reutilizada', true
    );
  end if;

  select d.numero_parada into v_numero
  from app_private.numeros_parada_disponibles_alpha75 d
  where not app_private.numero_parada_usado_alpha75(d.numero_parada)
    and not exists (
      select 1
      from app_private.numeros_parada_temporales_alpha75 t
      where t.numero_parada = d.numero_parada
    )
  order by d.numero_parada
  limit 1
  for update;

  if v_numero is not null then
    delete from app_private.numeros_parada_disponibles_alpha75
    where numero_parada = v_numero;
  else
    loop
      v_numero := nextval('public.numero_parada_seq');
      exit when not app_private.numero_parada_usado_alpha75(v_numero)
        and not exists (
          select 1
          from app_private.numeros_parada_temporales_alpha75 t
          where t.numero_parada = v_numero
        );
    end loop;
  end if;

  v_token := gen_random_uuid();
  v_expira := clock_timestamp() + interval '45 minutes';
  insert into app_private.numeros_parada_temporales_alpha75(
    token, numero_parada, usuario_id, request_id, expira_en
  ) values (
    v_token, v_numero, v_usuario, p_request_id, v_expira
  );

  return jsonb_build_object(
    'ok', true,
    'token', v_token,
    'numero_parada', v_numero::text,
    'expira_en', v_expira,
    'reutilizada', false
  );
end;
$function$;

create or replace function app_private.renovar_numero_parada_nueva_ficha_alpha75(
  p_token uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $function$
declare
  v_usuario uuid := auth.uid();
  v_reserva app_private.numeros_parada_temporales_alpha75%rowtype;
  v_expira timestamptz;
begin
  if v_usuario is null
     or not public.dispositivo_autorizado()
     or not public.puede_editar_modulo('hotel') then
    raise exception 'No tienes permiso para renovar el número de parada';
  end if;
  if p_token is null then
    raise exception 'La reserva temporal no está identificada';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('MG75-NUMERO-PARADA-TEMPORAL-001', 0)
  );
  perform app_private.reciclar_numeros_parada_expirados_alpha75();

  select * into v_reserva
  from app_private.numeros_parada_temporales_alpha75
  where token = p_token and usuario_id = v_usuario
  for update;

  if not found then
    raise exception 'El número provisional ya no está reservado. Cierra y abre una nueva ficha';
  end if;

  v_expira := clock_timestamp() + interval '45 minutes';
  update app_private.numeros_parada_temporales_alpha75
  set renovado_en = clock_timestamp(), expira_en = v_expira
  where token = p_token;

  return jsonb_build_object(
    'ok', true,
    'token', p_token,
    'numero_parada', v_reserva.numero_parada::text,
    'expira_en', v_expira
  );
end;
$function$;

create or replace function app_private.liberar_numero_parada_nueva_ficha_alpha75(
  p_token uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $function$
declare
  v_usuario uuid := auth.uid();
  v_reserva app_private.numeros_parada_temporales_alpha75%rowtype;
begin
  if v_usuario is null then
    raise exception 'Debes identificarte para liberar el número de parada';
  end if;
  if p_token is null then
    return jsonb_build_object('ok', true, 'liberado', false);
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('MG75-NUMERO-PARADA-TEMPORAL-001', 0)
  );
  perform app_private.reciclar_numeros_parada_expirados_alpha75();

  select * into v_reserva
  from app_private.numeros_parada_temporales_alpha75
  where token = p_token and usuario_id = v_usuario
  for update;

  if not found then
    return jsonb_build_object('ok', true, 'liberado', false);
  end if;

  if not app_private.numero_parada_usado_alpha75(v_reserva.numero_parada) then
    insert into app_private.numeros_parada_disponibles_alpha75(
      numero_parada, disponible_desde, motivo
    ) values (
      v_reserva.numero_parada, clock_timestamp(), 'cancelada'
    )
    on conflict (numero_parada) do update
      set disponible_desde = excluded.disponible_desde,
          motivo = excluded.motivo;
  end if;

  delete from app_private.numeros_parada_temporales_alpha75
  where token = p_token;

  return jsonb_build_object(
    'ok', true,
    'liberado', true,
    'numero_parada', v_reserva.numero_parada::text
  );
end;
$function$;

create or replace function app_private.asignar_numero_parada_nuevo()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $function$
declare
  v_num bigint;
  v_explicito text;
  v_reservado text;
begin
  if current_setting('app.clonando_pizarra', true) = '1' then
    return new;
  end if;

  v_reservado := nullif(
    current_setting('app.numero_parada_reservada_alpha75', true),
    ''
  );
  v_explicito := nullif(btrim(coalesce(new.numero_parada, '')), '');

  if v_explicito is not null then
    if v_explicito ~ '^[0-9]+$'
       and exists (
         select 1
         from app_private.numeros_parada_temporales_alpha75 t
         where t.numero_parada = v_explicito::bigint
           and t.expira_en > clock_timestamp()
           and v_explicito is distinct from v_reservado
       ) then
      raise exception 'El número de parada está reservado por otra ficha en edición';
    end if;
    return new;
  end if;

  if v_reservado is not null then
    if v_reservado !~ '^[0-9]+$' then
      raise exception 'El número de parada reservado no es válido';
    end if;
    v_num := v_reservado::bigint;
    if app_private.numero_parada_usado_alpha75(v_num) then
      raise exception 'El número de parada reservado ya está utilizado';
    end if;
    new.numero_parada := v_num::text;
    return new;
  end if;

  loop
    v_num := nextval('public.numero_parada_seq');
    exit when not app_private.numero_parada_usado_alpha75(v_num)
      and not exists (
        select 1
        from app_private.numeros_parada_temporales_alpha75 t
        where t.numero_parada = v_num
      );
  end loop;

  new.numero_parada := v_num::text;
  return new;
end;
$function$;

create or replace function app_private.crear_ficha_hotel_con_etapas_alpha75(
  p_ficha jsonb,
  p_etapas jsonb,
  p_request_id text,
  p_numero_token uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $function$
declare
  v_usuario uuid := auth.uid();
  v_reserva app_private.numeros_parada_temporales_alpha75%rowtype;
  v_result jsonb;
  v_numero_resultado text;
begin
  if v_usuario is null
     or not public.dispositivo_autorizado()
     or not public.puede_editar_modulo('hotel') then
    raise exception 'No tienes permiso para añadir fichas y T al Hotel';
  end if;

  if p_numero_token is null then
    raise exception 'La ficha no tiene un número de parada provisional válido';
  end if;
  if p_request_id is null
     or p_request_id !~ '^[A-Za-z0-9_-]{8,80}$' then
    raise exception 'Identificador de guardado no válido';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('MG75-NUMERO-PARADA-TEMPORAL-001', 0)
  );
  perform app_private.reciclar_numeros_parada_expirados_alpha75();

  select * into v_reserva
  from app_private.numeros_parada_temporales_alpha75
  where token = p_numero_token
    and usuario_id = v_usuario
    and request_id = p_request_id
  for update;

  if not found then
    raise exception 'El número provisional ya no está reservado. Cierra y abre una nueva ficha';
  end if;
  if v_reserva.expira_en <= clock_timestamp() then
    raise exception 'El número provisional ha caducado. Cierra y abre una nueva ficha';
  end if;
  if app_private.numero_parada_usado_alpha75(v_reserva.numero_parada) then
    raise exception 'El número provisional ya está utilizado por otra ficha';
  end if;

  perform set_config(
    'app.numero_parada_reservada_alpha75',
    v_reserva.numero_parada::text,
    true
  );

  v_result := app_private.crear_ficha_hotel_con_etapas_alpha72(
    case
      when jsonb_typeof(p_ficha) = 'object'
        then (p_ficha - 'numero_parada') || jsonb_build_object('numero_parada', '')
      else p_ficha
    end,
    p_etapas,
    p_request_id
  );

  v_numero_resultado := nullif(btrim(v_result->>'numero_parada'), '');
  if v_numero_resultado is distinct from v_reserva.numero_parada::text then
    raise exception 'La ficha creada no conserva el número provisional reservado';
  end if;

  delete from app_private.numeros_parada_temporales_alpha75
  where token = p_numero_token;
  delete from app_private.numeros_parada_disponibles_alpha75
  where numero_parada = v_reserva.numero_parada;

  return v_result || jsonb_build_object(
    'numero_provisional_confirmado', true,
    'numero_token', p_numero_token
  );
end;
$function$;

create or replace function public.reservar_numero_parada_nueva_ficha_alpha75(
  p_request_id text
)
returns jsonb
language sql
security definer
set search_path = pg_catalog, app_private
as $function$
  select app_private.reservar_numero_parada_nueva_ficha_alpha75($1);
$function$;

create or replace function public.renovar_numero_parada_nueva_ficha_alpha75(
  p_token uuid
)
returns jsonb
language sql
security definer
set search_path = pg_catalog, app_private
as $function$
  select app_private.renovar_numero_parada_nueva_ficha_alpha75($1);
$function$;

create or replace function public.liberar_numero_parada_nueva_ficha_alpha75(
  p_token uuid
)
returns jsonb
language sql
security definer
set search_path = pg_catalog, app_private
as $function$
  select app_private.liberar_numero_parada_nueva_ficha_alpha75($1);
$function$;

create or replace function public.crear_ficha_hotel_con_etapas_alpha75(
  p_ficha jsonb,
  p_etapas jsonb,
  p_request_id text,
  p_numero_token uuid
)
returns jsonb
language sql
security definer
set search_path = pg_catalog, app_private
as $function$
  select app_private.crear_ficha_hotel_con_etapas_alpha75($1, $2, $3, $4);
$function$;

revoke all on function app_private.numero_parada_usado_alpha75(bigint) from public, anon, authenticated;
revoke all on function app_private.reciclar_numeros_parada_expirados_alpha75() from public, anon, authenticated;
revoke all on function app_private.reservar_numero_parada_nueva_ficha_alpha75(text) from public, anon, authenticated;
revoke all on function app_private.renovar_numero_parada_nueva_ficha_alpha75(uuid) from public, anon, authenticated;
revoke all on function app_private.liberar_numero_parada_nueva_ficha_alpha75(uuid) from public, anon, authenticated;
revoke all on function app_private.crear_ficha_hotel_con_etapas_alpha75(jsonb, jsonb, text, uuid) from public, anon, authenticated;

revoke all on function public.reservar_numero_parada_nueva_ficha_alpha75(text) from public, anon;
revoke all on function public.renovar_numero_parada_nueva_ficha_alpha75(uuid) from public, anon;
revoke all on function public.liberar_numero_parada_nueva_ficha_alpha75(uuid) from public, anon;
revoke all on function public.crear_ficha_hotel_con_etapas_alpha75(jsonb, jsonb, text, uuid) from public, anon;

grant execute on function public.reservar_numero_parada_nueva_ficha_alpha75(text) to authenticated, service_role;
grant execute on function public.renovar_numero_parada_nueva_ficha_alpha75(uuid) to authenticated, service_role;
grant execute on function public.liberar_numero_parada_nueva_ficha_alpha75(uuid) to authenticated, service_role;
grant execute on function public.crear_ficha_hotel_con_etapas_alpha75(jsonb, jsonb, text, uuid) to authenticated, service_role;

comment on table app_private.numeros_parada_temporales_alpha75 is
  'MG75-NUMERO-PARADA-TEMPORAL-001: números visibles durante el alta, con caducidad y liberación reutilizable.';
comment on function public.reservar_numero_parada_nueva_ficha_alpha75(text) is
  'Reserva y muestra el número de parada antes de editar una ficha nueva.';
comment on function public.crear_ficha_hotel_con_etapas_alpha75(jsonb, jsonb, text, uuid) is
  'Confirma atómicamente el número provisional al crear la ficha y sus T.';
