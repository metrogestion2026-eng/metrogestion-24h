begin;

alter table public.etapas_hotel
  add column if not exists marcado_rapido boolean not null default false,
  add column if not exists marcado_rapido_en timestamptz,
  add column if not exists marcado_rapido_por uuid,
  add column if not exists datos_pendientes boolean not null default false,
  add column if not exists datos_completados_en timestamptz,
  add column if not exists datos_completados_por uuid;

alter table public.etapas_hotel
  drop constraint if exists etapas_hotel_marcado_rapido_por_fkey,
  add constraint etapas_hotel_marcado_rapido_por_fkey
    foreign key (marcado_rapido_por) references public.usuarios(id),
  drop constraint if exists etapas_hotel_datos_completados_por_fkey,
  add constraint etapas_hotel_datos_completados_por_fkey
    foreign key (datos_completados_por) references public.usuarios(id),
  drop constraint if exists etapas_hotel_marcado_rapido_coherente_check,
  add constraint etapas_hotel_marcado_rapido_coherente_check
    check (
      not marcado_rapido
      or (marcado_rapido_en is not null and marcado_rapido_por is not null)
    ),
  drop constraint if exists etapas_hotel_datos_pendientes_coherente_check,
  add constraint etapas_hotel_datos_pendientes_coherente_check
    check (not datos_pendientes or marcado_rapido),
  drop constraint if exists etapas_hotel_datos_completados_coherente_check,
  add constraint etapas_hotel_datos_completados_coherente_check
    check (
      (datos_completados_en is null and datos_completados_por is null)
      or (
        datos_completados_en is not null
        and datos_completados_por is not null
        and marcado_rapido
        and not datos_pendientes
      )
    );

create index if not exists etapas_hotel_datos_pendientes_idx
  on public.etapas_hotel(registro_hotel_id, posicion)
  where datos_pendientes = true and cancelado = false;

create or replace function app_private.heredar_control_marcado_rapido_etapa()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_source public.etapas_hotel%rowtype;
begin
  if coalesce(current_setting('app.clonando_pizarra', true), '') <> '1' then
    return new;
  end if;

  select e.* into v_source
  from public.etapas_hotel e
  join public.registros_hotel r on r.id = e.registro_hotel_id
  join public.pizarras p on p.id = r.pizarra_id
  where e.seguimiento_id = new.seguimiento_id
  order by p.fecha desc, e.actualizado_en desc, e.creado_en desc, e.id desc
  limit 1;

  if found then
    new.marcado_rapido := v_source.marcado_rapido;
    new.marcado_rapido_en := v_source.marcado_rapido_en;
    new.marcado_rapido_por := v_source.marcado_rapido_por;
    new.datos_pendientes := v_source.datos_pendientes;
    new.datos_completados_en := v_source.datos_completados_en;
    new.datos_completados_por := v_source.datos_completados_por;
  end if;

  return new;
end;
$$;

drop trigger if exists etapas_hotel_heredar_marcado_rapido on public.etapas_hotel;
create trigger etapas_hotel_heredar_marcado_rapido
before insert on public.etapas_hotel
for each row
execute function app_private.heredar_control_marcado_rapido_etapa();

create or replace function app_private.normalizar_control_marcado_rapido_etapa()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if new.cancelado = true or new.estado <> 'realizada' then
    new.datos_pendientes := false;
  end if;
  return new;
end;
$$;

drop trigger if exists etapas_hotel_normalizar_marcado_rapido on public.etapas_hotel;
create trigger etapas_hotel_normalizar_marcado_rapido
before update of estado, cancelado on public.etapas_hotel
for each row
execute function app_private.normalizar_control_marcado_rapido_etapa();

create or replace function app_private.marcar_t_realizada_rapida(
  p_etapa_id uuid,
  p_version integer,
  p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_stage public.etapas_hotel%rowtype;
  v_saved public.etapas_hotel%rowtype;
  v_board_state text;
  v_record_state text;
  v_now timestamptz := clock_timestamp();
  v_effect text;
  v_audit_count integer := 0;
begin
  if auth.uid() is null
     or not public.dispositivo_autorizado()
     or not public.es_administrador_principal() then
    raise exception 'Solo el administrador principal puede marcar rápidamente una T como realizada';
  end if;

  if p_etapa_id is null or p_version is null then
    raise exception 'No se ha identificado la T o su versión';
  end if;
  if p_request_id is null or p_request_id !~ '^[A-Za-z0-9_-]{8,80}$' then
    raise exception 'Identificador de operación no válido';
  end if;

  select e.* into v_stage
  from public.etapas_hotel e
  where e.id = p_etapa_id
  for update;

  if not found then
    raise exception 'La T indicada no existe';
  end if;

  select p.estado into v_board_state
  from public.registros_hotel r
  join public.pizarras p on p.id = r.pizarra_id
  where r.id = v_stage.registro_hotel_id;

  if v_board_state <> 'en_curso' then
    raise exception 'El marcado rápido solo está disponible en la Pizarra actual';
  end if;
  if v_stage.version <> p_version then
    raise exception 'La T ha cambiado desde que se cargó. Recarga la Pizarra antes de confirmarla.';
  end if;
  if v_stage.cancelado or v_stage.estado = 'anulada' then
    raise exception 'Una T anulada no puede marcarse como realizada';
  end if;
  if v_stage.estado = 'realizada' then
    raise exception 'Esta T ya está marcada como realizada';
  end if;

  perform 1
  from public.registros_hotel
  where id = v_stage.registro_hotel_id
  for update;

  perform set_config('app.request_id', p_request_id, true);
  perform set_config('app.audit_origin', 'metrogestion-r1-stage-quick-complete', true);
  perform set_config(
    'app.audit_reason',
    format('Marcado rápido de la T %s como realizada', v_stage.posicion),
    true
  );

  update public.etapas_hotel
  set estado = 'realizada',
      fecha_fin_real = v_now,
      fecha_real = v_now,
      marcado_rapido = true,
      marcado_rapido_en = v_now,
      marcado_rapido_por = auth.uid(),
      datos_pendientes = true,
      datos_completados_en = null,
      datos_completados_por = null,
      modificado_por = auth.uid()
  where id = p_etapa_id
    and version = p_version
  returning * into v_saved;

  if not found then
    raise exception 'La T cambió antes de confirmarse. Recarga la Pizarra.';
  end if;

  select estado into v_record_state
  from public.registros_hotel
  where id = v_saved.registro_hotel_id;

  v_effect := case
    when v_saved.accion_sistema = 'recuperar_y_liberar'
      then 'T realizada; ruta recuperada y sustituto liberado'
    when v_saved.accion_sistema = 'liberar_reserva'
      then 'T realizada y reserva liberada'
    when v_saved.tipo_etapa = 'recogida_taller'
      then 'Recogida realizada con fecha y hora de salida registradas'
    else 'T marcada como realizada'
  end;

  select count(*) into v_audit_count
  from public.auditoria_cambios
  where request_id = p_request_id;

  return jsonb_build_object(
    'ok', true,
    'request_id', p_request_id,
    'efecto', v_effect,
    'registro_estado', v_record_state,
    'datos_pendientes', true,
    'etapa', to_jsonb(v_saved),
    'eventos_auditoria', v_audit_count
  );
end;
$$;

create or replace function public.marcar_t_realizada_rapida(
  p_etapa_id uuid,
  p_version integer,
  p_request_id text
)
returns jsonb
language sql
set search_path = pg_catalog, app_private
as $$
  select app_private.marcar_t_realizada_rapida(
    p_etapa_id,
    p_version,
    p_request_id
  );
$$;

revoke all on function public.marcar_t_realizada_rapida(uuid,integer,text) from public;
revoke all on function public.marcar_t_realizada_rapida(uuid,integer,text) from anon;
grant execute on function public.marcar_t_realizada_rapida(uuid,integer,text) to authenticated;

create or replace function app_private.completar_datos_t_rapida(
  p_registro_id uuid,
  p_etapa_ids uuid[],
  p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_count integer := 0;
  v_audit_count integer := 0;
begin
  if auth.uid() is null
     or not public.dispositivo_autorizado()
     or not public.es_administrador_principal() then
    raise exception 'Solo el administrador principal puede cerrar el aviso de datos pendientes';
  end if;

  if p_registro_id is null then
    raise exception 'No se ha identificado la ficha';
  end if;
  if p_etapa_ids is null
     or cardinality(p_etapa_ids) < 1
     or cardinality(p_etapa_ids) > 50 then
    raise exception 'El listado de T pendientes no es válido';
  end if;
  if p_request_id is null or p_request_id !~ '^[A-Za-z0-9_-]{8,80}$' then
    raise exception 'Identificador de operación no válido';
  end if;

  perform 1
  from public.registros_hotel
  where id = p_registro_id
  for update;
  if not found then
    raise exception 'Ficha de Hotel no encontrada';
  end if;

  if exists (
    select 1
    from unnest(p_etapa_ids) x(id)
    left join public.etapas_hotel e
      on e.id = x.id and e.registro_hotel_id = p_registro_id
    where e.id is null
  ) then
    raise exception 'Una de las T indicadas ya no pertenece a esta ficha';
  end if;

  perform set_config('app.request_id', p_request_id, true);
  perform set_config('app.audit_origin', 'metrogestion-r1-stage-quick-data-complete', true);
  perform set_config('app.audit_reason', 'Datos de una T marcada rápidamente completados en la ficha', true);

  update public.etapas_hotel
  set datos_pendientes = false,
      datos_completados_en = clock_timestamp(),
      datos_completados_por = auth.uid(),
      modificado_por = auth.uid()
  where registro_hotel_id = p_registro_id
    and id = any(p_etapa_ids)
    and marcado_rapido = true
    and datos_pendientes = true
    and estado = 'realizada'
    and cancelado = false;

  get diagnostics v_count = row_count;
  if v_count <> cardinality(p_etapa_ids) then
    raise exception 'Alguna T ya no está pendiente de completar o ha cambiado de estado';
  end if;

  select count(*) into v_audit_count
  from public.auditoria_cambios
  where request_id = p_request_id;

  return jsonb_build_object(
    'ok', true,
    'request_id', p_request_id,
    't_completadas', v_count,
    'eventos_auditoria', v_audit_count,
    'detalle', public.obtener_ficha_hotel_edicion(p_registro_id)
  );
end;
$$;

create or replace function public.completar_datos_t_rapida(
  p_registro_id uuid,
  p_etapa_ids uuid[],
  p_request_id text
)
returns jsonb
language sql
set search_path = pg_catalog, app_private
as $$
  select app_private.completar_datos_t_rapida(
    p_registro_id,
    p_etapa_ids,
    p_request_id
  );
$$;

revoke all on function public.completar_datos_t_rapida(uuid,uuid[],text) from public;
revoke all on function public.completar_datos_t_rapida(uuid,uuid[],text) from anon;
grant execute on function public.completar_datos_t_rapida(uuid,uuid[],text) to authenticated;

commit;
