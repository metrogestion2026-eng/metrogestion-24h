alter table public.etapas_hotel
  add column if not exists reabierta_en timestamptz,
  add column if not exists reabierta_por uuid references public.usuarios(id),
  add column if not exists motivo_reapertura text not null default '',
  add column if not exists reaperturas integer not null default 0,
  add column if not exists estado_registro_antes_realizar text,
  add column if not exists retirado_hotel_antes_realizar boolean,
  add column if not exists fecha_retirado_hotel_antes_realizar timestamptz;

alter table public.etapas_hotel
  drop constraint if exists etapas_hotel_reaperturas_no_negativas_check;
alter table public.etapas_hotel
  add constraint etapas_hotel_reaperturas_no_negativas_check
  check (reaperturas >= 0);

create table if not exists app_private.reservas_pendientes_reaperturas (
  id uuid primary key default gen_random_uuid(),
  resolucion_id uuid not null references public.reservas_pendientes_resueltos(id) on delete restrict,
  etapa_hotel_id uuid not null references public.etapas_hotel(id) on delete restrict,
  reabierto_en timestamptz not null default clock_timestamp(),
  reabierto_por uuid references public.usuarios(id) on delete restrict,
  motivo text not null,
  resuelto_nuevamente_en timestamptz,
  resuelto_nuevamente_por uuid references public.usuarios(id) on delete restrict
);

create unique index if not exists reservas_pendientes_reaperturas_activa_uq
  on app_private.reservas_pendientes_reaperturas (resolucion_id)
  where resuelto_nuevamente_en is null;

revoke all on table app_private.reservas_pendientes_reaperturas
  from public, anon, authenticated;

create or replace function app_private.capturar_estado_registro_antes_realizar_t()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_registro public.registros_hotel%rowtype;
begin
  if coalesce(current_setting('app.clonando_pizarra', true), '') = '1' then
    return new;
  end if;

  if new.cancelado
     or new.estado <> 'realizada'
     or (tg_op = 'UPDATE' and old.estado = 'realizada' and not old.cancelado)
  then
    return new;
  end if;

  select r.* into v_registro
  from public.registros_hotel r
  where r.id = new.registro_hotel_id;

  if found then
    new.estado_registro_antes_realizar := v_registro.estado;
    new.retirado_hotel_antes_realizar := v_registro.retirado_hotel_activo;
    new.fecha_retirado_hotel_antes_realizar := v_registro.fecha_retirado_hotel;
  end if;
  return new;
end;
$function$;

revoke all on function app_private.capturar_estado_registro_antes_realizar_t()
  from public, anon, authenticated;

drop trigger if exists etapas_hotel_capturar_estado_antes_realizar on public.etapas_hotel;
create trigger etapas_hotel_capturar_estado_antes_realizar
before insert or update of estado, cancelado
on public.etapas_hotel
for each row
execute function app_private.capturar_estado_registro_antes_realizar_t();

create or replace function app_private.manteniment_fechas_desde_etapa()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'app_private'
as $function$
declare
  v_fecha date;
  v_seguimiento_id uuid;
  v_actualizados integer := 0;
  v_reapertura boolean := false;
begin
  if coalesce(current_setting('app.clonando_pizarra', true), '') = '1'
     or coalesce(current_setting('app.reconciliando_etapas', true), '') = '1'
     or coalesce(current_setting('app.manteniment_importando_paradas', true), '') = '1'
  then
    return new;
  end if;

  v_reapertura := tg_op = 'UPDATE'
    and old.estado = 'realizada'
    and not old.cancelado
    and (new.estado <> 'realizada' or new.cancelado);

  if v_reapertura then
    if old.tipo_etapa = 'entrada_taller' then
      update app_private.manteniment_t_trabajos w
         set fecha_realizada = null,
             actualizado_en = clock_timestamp()
        from app_private.manteniment_t_visitas v
       where v.id = w.visita_id
         and v.modalidad = 'taller'
         and v.grupo_entrada_id = old.grupo_documental_id
         and w.fecha_realizada is not null;
      get diagnostics v_actualizados = row_count;
    elsif old.tipo_etapa = 'recogida_taller' then
      update app_private.manteniment_t_trabajos w
         set fecha_recogida = null,
             actualizado_en = clock_timestamp()
        from app_private.manteniment_t_visitas v
       where v.id = w.visita_id
         and v.modalidad = 'taller'
         and v.grupo_recogida_id = old.grupo_documental_id
         and w.fecha_recogida is not null;
      get diagnostics v_actualizados = row_count;
    end if;
  elsif not new.cancelado
        and new.estado = 'realizada'
        and (
          tg_op = 'INSERT'
          or old.estado is distinct from new.estado
          or old.cancelado is distinct from new.cancelado
        )
  then
    v_fecha := (
      coalesce(new.fecha_real, new.fecha_fin_real, new.fecha_inicio_real, clock_timestamp())
      at time zone 'Europe/Madrid'
    )::date;

    if new.tipo_etapa = 'entrada_taller' then
      update app_private.manteniment_t_trabajos w
         set fecha_realizada = v_fecha,
             actualizado_en = clock_timestamp()
        from app_private.manteniment_t_visitas v
       where v.id = w.visita_id
         and v.modalidad = 'taller'
         and v.grupo_entrada_id = new.grupo_documental_id
         and w.fecha_realizada is distinct from v_fecha;
      get diagnostics v_actualizados = row_count;
    elsif new.tipo_etapa = 'recogida_taller' then
      update app_private.manteniment_t_trabajos w
         set fecha_recogida = v_fecha,
             actualizado_en = clock_timestamp()
        from app_private.manteniment_t_visitas v
       where v.id = w.visita_id
         and v.modalidad = 'taller'
         and v.grupo_recogida_id = new.grupo_documental_id
         and w.fecha_recogida is distinct from v_fecha;
      get diagnostics v_actualizados = row_count;
    end if;
  else
    return new;
  end if;

  select r.seguimiento_id into v_seguimiento_id
  from public.registros_hotel r
  where r.id = new.registro_hotel_id;

  if v_seguimiento_id is not null
     and (
       v_actualizados > 0
       or new.accion_sistema = 'recuperar_y_liberar'
     )
     and exists (
       select 1
       from app_private.manteniment_parada_sync s
       where s.seguimiento_id = v_seguimiento_id
     )
  then
    perform app_private.manteniment_encolar_parada(v_seguimiento_id);
  end if;

  return new;
end;
$function$;

revoke all on function app_private.manteniment_fechas_desde_etapa()
  from public, anon, authenticated;

create or replace function app_private.resolver_reaperturas_pendiente_reserva()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'app_private'
as $function$
declare
  v_item record;
  v_token text;
  v_restantes text[];
begin
  if new.cancelado
     or new.estado <> 'realizada'
     or (tg_op = 'UPDATE' and old.estado = 'realizada' and not old.cancelado)
  then
    return new;
  end if;

  for v_item in
    select rp.id as reapertura_id,
           rr.reserva_id,
           rr.pendiente_codigo
    from app_private.reservas_pendientes_reaperturas rp
    join public.reservas_pendientes_resueltos rr on rr.id = rp.resolucion_id
    where rp.etapa_hotel_id = new.id
      and rp.resuelto_nuevamente_en is null
    for update of rp
  loop
    v_restantes := array[]::text[];
    for v_token in
      select btrim(p.parte)
      from public.reservas_hotel r
      cross join lateral regexp_split_to_table(
        r.pendientes,
        E'\\s*[+,;|\\n]+\\s*'
      ) with ordinality as p(parte, orden)
      where r.id = v_item.reserva_id
      order by p.orden
    loop
      if v_token <> ''
         and app_private.normalizar_codigo_pendiente(v_token) <> v_item.pendiente_codigo
      then
        v_restantes := array_append(v_restantes, v_token);
      end if;
    end loop;

    update public.reservas_hotel
       set pendientes = array_to_string(v_restantes, ' + '),
           modificado_por = coalesce(auth.uid(), new.modificado_por)
     where id = v_item.reserva_id;

    update app_private.reservas_pendientes_reaperturas
       set resuelto_nuevamente_en = clock_timestamp(),
           resuelto_nuevamente_por = coalesce(auth.uid(), new.modificado_por)
     where id = v_item.reapertura_id;
  end loop;
  return new;
end;
$function$;

revoke all on function app_private.resolver_reaperturas_pendiente_reserva()
  from public, anon, authenticated;

drop trigger if exists etapas_aa_resolver_reaperturas_reserva on public.etapas_hotel;
create trigger etapas_aa_resolver_reaperturas_reserva
after insert or update of estado, cancelado
on public.etapas_hotel
for each row
execute function app_private.resolver_reaperturas_pendiente_reserva();

create or replace function app_private.reabrir_t_realizada_rapida(
  p_etapa_id uuid,
  p_version integer,
  p_motivo text,
  p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'app_private'
as $function$
declare
  v_stage public.etapas_hotel%rowtype;
  v_saved public.etapas_hotel%rowtype;
  v_record public.registros_hotel%rowtype;
  v_board_state text;
  v_later record;
  v_resolution record;
  v_existing boolean;
  v_work_sync_ids jsonb := '[]'::jsonb;
  v_reversion jsonb;
  v_now timestamptz := clock_timestamp();
  v_motivo text := btrim(coalesce(p_motivo, ''));
  v_audit_count integer := 0;
begin
  if auth.uid() is null
     or not public.dispositivo_autorizado()
     or not public.es_administrador_principal()
  then
    raise exception 'Solo el administrador principal puede reabrir una T realizada';
  end if;

  if p_etapa_id is null or p_version is null then
    raise exception 'No se ha identificado la T o su versión';
  end if;
  if length(v_motivo) not between 5 and 500 then
    raise exception 'Indica un motivo de entre 5 y 500 caracteres';
  end if;
  if p_request_id is null or p_request_id !~ '^[A-Za-z0-9_-]{8,80}$' then
    raise exception 'Identificador de operación no válido';
  end if;

  select e.* into v_stage
  from public.etapas_hotel e
  where e.id = p_etapa_id
  for update;

  if not found then raise exception 'La T indicada no existe'; end if;

  select r.*
    into v_record
  from public.registros_hotel r
  where r.id = v_stage.registro_hotel_id
  for update;

  select p.estado into v_board_state
  from public.pizarras p
  where p.id = v_record.pizarra_id;
  if v_board_state <> 'en_curso' then
    raise exception 'Solo se puede reabrir una T de la Pizarra actual';
  end if;
  if v_stage.version <> p_version then
    raise exception 'La T ha cambiado desde que se cargó. Recarga antes de reabrirla.';
  end if;
  if v_stage.cancelado or v_stage.estado = 'anulada' then
    raise exception 'Una T anulada no se puede reabrir';
  end if;
  if v_stage.estado <> 'realizada' then
    raise exception 'Esta T ya está pendiente o en curso';
  end if;

  select e.posicion, e.nombre into v_later
  from public.etapas_hotel e
  where e.registro_hotel_id = v_stage.registro_hotel_id
    and not e.cancelado
    and e.estado = 'realizada'
    and e.posicion > v_stage.posicion
  order by e.posicion desc
  limit 1;

  if found then
    raise exception 'Primero reabre la %T (%). Las T realizadas se deshacen de la última a la primera.',
      v_later.posicion, v_later.nombre;
  end if;

  if (
       v_record.retirado_hotel_activo
       or v_record.estado in ('recuperado', 'reserva_liberada')
     )
     and v_stage.estado_registro_antes_realizar is null
  then
    raise exception 'Esta T es anterior al control de reapertura. Reabre la ficha desde el editor para conservar su estado previo.';
  end if;

  select coalesce(jsonb_agg(x.sync_id order by x.sync_id), '[]'::jsonb)
    into v_work_sync_ids
  from (
    select distinct w.sync_id
    from app_private.manteniment_t_trabajos w
    join app_private.manteniment_t_visitas v on v.id = w.visita_id
    where v.modalidad = 'taller'
      and (
        (v_stage.tipo_etapa = 'entrada_taller' and v.grupo_entrada_id = v_stage.grupo_documental_id)
        or
        (v_stage.tipo_etapa = 'recogida_taller' and v.grupo_recogida_id = v_stage.grupo_documental_id)
      )
  ) x;

  perform set_config('app.request_id', p_request_id, true);
  perform set_config('app.audit_origin', 'metrogestion-r1-stage-reopen', true);
  perform set_config(
    'app.audit_reason',
    format('Reapertura de la T %s: %s', v_stage.posicion, v_motivo),
    true
  );

  for v_resolution in
    select rr.*
    from public.reservas_pendientes_resueltos rr
    where rr.etapa_hotel_id = v_stage.id
    order by rr.creado_en, rr.id
  loop
    select exists (
      select 1
      from regexp_split_to_table(
        (select r.pendientes from public.reservas_hotel r where r.id = v_resolution.reserva_id),
        E'\\s*[+,;|\\n]+\\s*'
      ) p(token)
      where app_private.normalizar_codigo_pendiente(p.token) = v_resolution.pendiente_codigo
    ) into v_existing;

    if not v_existing then
      update public.reservas_hotel
         set pendientes = case
               when btrim(pendientes) = '' then v_resolution.pendiente_texto
               else pendientes || ' + ' || v_resolution.pendiente_texto
             end,
             modificado_por = auth.uid()
       where id = v_resolution.reserva_id;
    end if;

    insert into app_private.reservas_pendientes_reaperturas (
      resolucion_id, etapa_hotel_id, reabierto_en, reabierto_por, motivo
    ) values (
      v_resolution.id, v_stage.id, v_now, auth.uid(), v_motivo
    )
    on conflict (resolucion_id) where resuelto_nuevamente_en is null do nothing;
  end loop;

  update public.etapas_hotel
     set estado = case when fecha_prevista is null then 'pendiente' else 'programada' end,
         estado_catalogo_codigo = case when fecha_prevista is null then 'pendiente' else 'programada' end,
         fecha_inicio_real = null,
         fecha_fin_real = null,
         fecha_real = null,
         marcado_rapido = false,
         marcado_rapido_en = null,
         marcado_rapido_por = null,
         datos_pendientes = false,
         datos_completados_en = null,
         datos_completados_por = null,
         reabierta_en = v_now,
         reabierta_por = auth.uid(),
         motivo_reapertura = v_motivo,
         reaperturas = reaperturas + 1,
         modificado_por = auth.uid()
   where id = v_stage.id
     and version = p_version
  returning * into v_saved;

  if not found then
    raise exception 'La T cambió antes de confirmarse. Recarga la Pizarra.';
  end if;

  if (
       v_record.retirado_hotel_activo
       or v_record.estado in ('recuperado', 'reserva_liberada')
     )
  then
    update public.registros_hotel
       set estado = v_stage.estado_registro_antes_realizar,
           retirado_hotel_activo = coalesce(v_stage.retirado_hotel_antes_realizar, false),
           fecha_retirado_hotel = v_stage.fecha_retirado_hotel_antes_realizar,
           modificado_por = auth.uid()
     where id = v_stage.registro_hotel_id;
  end if;

  v_reversion := jsonb_build_object(
    'etapa_id', v_stage.id,
    'tipo_etapa', v_stage.tipo_etapa,
    'trabajo_sync_ids', v_work_sync_ids,
    'limpiar_fecha_entrada', v_stage.tipo_etapa = 'entrada_taller',
    'limpiar_fecha_salida', v_stage.tipo_etapa = 'recogida_taller',
    'limpiar_k_parada', v_stage.accion_sistema = 'recuperar_y_liberar'
  );

  if exists (
    select 1
    from app_private.manteniment_parada_sync s
    where s.seguimiento_id = v_record.seguimiento_id
  ) then
    perform app_private.manteniment_encolar_parada(v_record.seguimiento_id);
    update app_private.manteniment_parada_outbox o
       set payload = jsonb_set(o.payload, '{reversion_t}', v_reversion, true),
           estado = 'pendiente',
           actualizado_en = clock_timestamp(),
           confirmado_en = null,
           ultimo_error = ''
     where o.seguimiento_id = v_record.seguimiento_id;
  end if;

  select count(*) into v_audit_count
  from public.auditoria_cambios
  where request_id = p_request_id;

  return jsonb_build_object(
    'ok', true,
    'request_id', p_request_id,
    'efecto', case
      when v_stage.accion_sistema = 'recuperar_y_liberar'
        then 'T reabierta; recuperación y fecha K de PARADA pendientes de revertir en MANTENIMENT'
      when v_stage.tipo_etapa = 'recogida_taller'
        then 'T reabierta; fecha de salida y confirmación verde pendientes de revertir en MANTENIMENT'
      when v_stage.tipo_etapa = 'entrada_taller'
        then 'T reabierta; fecha de entrada pendiente de revertir en MANTENIMENT'
      else 'T reabierta y devuelta a pendientes'
    end,
    'etapa', to_jsonb(v_saved),
    'eventos_auditoria', v_audit_count,
    'reversion_manteniment', v_reversion
  );
end;
$function$;

revoke all on function app_private.reabrir_t_realizada_rapida(uuid, integer, text, text)
  from public, anon, authenticated;

create or replace function public.reabrir_t_realizada_rapida(
  p_etapa_id uuid,
  p_version integer,
  p_motivo text,
  p_request_id text
)
returns jsonb
language sql
security definer
set search_path to 'pg_catalog', 'app_private'
as $function$
  select app_private.reabrir_t_realizada_rapida(
    p_etapa_id,
    p_version,
    p_motivo,
    p_request_id
  );
$function$;

revoke all on function public.reabrir_t_realizada_rapida(uuid, integer, text, text)
  from public, anon;
grant execute on function public.reabrir_t_realizada_rapida(uuid, integer, text, text)
  to authenticated;
