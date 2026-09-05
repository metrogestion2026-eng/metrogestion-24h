-- Reactivacion coherente de fichas de Hotel.
--
-- Una reserva puede repetirse en el Historico, pero nunca puede estar ocupando
-- dos fichas activas de la misma Pizarra. Ademas, una ficha activa no puede
-- conservar realizada la T de cierre que recupera la ruta o libera la reserva.

do $preflight$
begin
  if exists (
    select 1
    from public.registros_hotel r
    where not r.cancelado
      and not r.retirado_hotel_activo
      and r.estado not in ('recuperado', 'reserva_liberada', 'anulado')
      and nullif(btrim(r.vehiculo_reserva), '') is not null
    group by r.pizarra_id, upper(btrim(r.vehiculo_reserva))
    having count(*) > 1
  ) then
    raise exception 'Existen reservas duplicadas entre fichas activas; corrige los datos antes de aplicar la migracion';
  end if;

  if exists (
    select 1
    from public.registros_hotel r
    join public.etapas_hotel e on e.registro_hotel_id = r.id
    where not r.cancelado
      and not r.retirado_hotel_activo
      and r.estado not in ('recuperado', 'reserva_liberada', 'anulado')
      and not e.cancelado
      and e.accion_sistema in ('recuperar_y_liberar', 'liberar_reserva')
      and (
        e.estado = 'realizada'
        or e.fecha_fin_real is not null
        or e.fecha_real is not null
        or e.marcado_rapido
      )
  ) then
    raise exception 'Existen fichas activas con una T final cerrada; restaura los datos antes de aplicar la migracion';
  end if;
end
$preflight$;

create unique index if not exists registros_hotel_reserva_activa_pizarra_uq
  on public.registros_hotel (pizarra_id, upper(btrim(vehiculo_reserva)))
  where cancelado = false
    and retirado_hotel_activo = false
    and estado not in ('recuperado', 'reserva_liberada', 'anulado')
    and nullif(btrim(vehiculo_reserva), '') is not null;

create or replace function app_private.reabrir_cierre_ficha_hotel(
  p_registro_id uuid,
  p_actor uuid default null
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $function$
declare
  v_actor uuid;
  v_count integer := 0;
begin
  select coalesce(p_actor, auth.uid(), r.modificado_por, r.creado_por)
    into v_actor
  from public.registros_hotel r
  where r.id = p_registro_id
    and not r.cancelado
    and not r.retirado_hotel_activo
    and r.estado not in ('recuperado', 'reserva_liberada', 'anulado')
  for update;

  if not found then
    return 0;
  end if;

  if nullif(current_setting('app.request_id', true), '') is null then
    perform set_config(
      'app.request_id',
      'reactivar_' || replace(gen_random_uuid()::text, '-', ''),
      true
    );
  end if;
  perform set_config('app.audit_origin', 'metrogestion-r1-reactivacion-integridad', true);
  perform set_config(
    'app.audit_reason',
    'Reapertura atomica de la T final al reactivar la ficha',
    true
  );

  update public.etapas_hotel e
  set estado = case when e.fecha_prevista is null then 'pendiente' else 'programada' end,
      estado_catalogo_codigo = case when e.fecha_prevista is null then 'pendiente' else 'programada' end,
      fecha_inicio_real = null,
      fecha_fin_real = null,
      fecha_real = null,
      marcado_rapido = false,
      marcado_rapido_en = null,
      marcado_rapido_por = null,
      datos_pendientes = false,
      datos_completados_en = null,
      datos_completados_por = null,
      modificado_por = v_actor
  where e.registro_hotel_id = p_registro_id
    and not e.cancelado
    and e.accion_sistema in ('recuperar_y_liberar', 'liberar_reserva')
    and (
      e.estado = 'realizada'
      or e.fecha_fin_real is not null
      or e.fecha_real is not null
      or e.marcado_rapido
      or e.marcado_rapido_en is not null
      or e.marcado_rapido_por is not null
    );

  get diagnostics v_count = row_count;
  return v_count;
end;
$function$;

revoke all on function app_private.reabrir_cierre_ficha_hotel(uuid, uuid)
  from public, anon, authenticated;
grant execute on function app_private.reabrir_cierre_ficha_hotel(uuid, uuid)
  to service_role;

create or replace function app_private.reabrir_cierre_al_reactivar_registro_hotel()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $function$
begin
  -- El editor Alpha72 prepara el payload antes de guardar para conservar el
  -- control optimista de versiones de las T. Las demas vias se reparan aqui.
  if current_setting('app.audit_origin', true) = 'metrogestion-r1-editor' then
    return new;
  end if;

  if (
       old.cancelado
       or old.retirado_hotel_activo
       or old.estado in ('recuperado', 'reserva_liberada', 'anulado')
     )
     and not new.cancelado
     and not new.retirado_hotel_activo
     and new.estado not in ('recuperado', 'reserva_liberada', 'anulado') then
    perform app_private.reabrir_cierre_ficha_hotel(
      new.id,
      coalesce(auth.uid(), new.modificado_por, new.creado_por)
    );
  end if;

  return new;
end;
$function$;

revoke all on function app_private.reabrir_cierre_al_reactivar_registro_hotel()
  from public, anon, authenticated;

drop trigger if exists registros_hotel_reabrir_cierre on public.registros_hotel;
create trigger registros_hotel_reabrir_cierre
after update of estado, retirado_hotel_activo, cancelado
on public.registros_hotel
for each row
execute function app_private.reabrir_cierre_al_reactivar_registro_hotel();

create or replace function app_private.preparar_etapas_reactivacion_hotel(
  p_registro_id uuid,
  p_etapas jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $function$
declare
  v_item jsonb;
  v_id_text text;
  v_stage_id uuid;
  v_state text;
  v_result jsonb := '[]'::jsonb;
begin
  if jsonb_typeof(p_etapas) <> 'array' then
    raise exception 'El bloque de T no tiene un formato valido';
  end if;

  for v_item in
    select value from jsonb_array_elements(p_etapas)
  loop
    v_id_text := nullif(v_item->>'id', '');
    v_stage_id := case
      when v_id_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        then v_id_text::uuid
      else null
    end;

    if v_stage_id is not null
       and not coalesce((v_item->>'cancelado')::boolean, false)
       and exists (
         select 1
         from public.etapas_hotel e
         where e.id = v_stage_id
           and e.registro_hotel_id = p_registro_id
           and not e.cancelado
           and e.accion_sistema in ('recuperar_y_liberar', 'liberar_reserva')
       ) then
      v_state := case
        when nullif(v_item->>'fecha_prevista', '') is null then 'pendiente'
        else 'programada'
      end;
      v_item := v_item || jsonb_build_object(
        'estado', v_state,
        'estado_catalogo_codigo', v_state,
        'fecha_inicio_real', '',
        'fecha_fin_real', '',
        'fecha_real', '',
        'marcado_rapido', false,
        'marcado_rapido_en', null,
        'marcado_rapido_por', null,
        'datos_pendientes', false,
        'datos_completados_en', null,
        'datos_completados_por', null
      );
    end if;

    v_result := v_result || jsonb_build_array(v_item);
  end loop;

  return v_result;
end;
$function$;

revoke all on function app_private.preparar_etapas_reactivacion_hotel(uuid, jsonb)
  from public, anon, authenticated;
grant execute on function app_private.preparar_etapas_reactivacion_hotel(uuid, jsonb)
  to service_role;

-- Corrige la via de reactivacion desde Historico. Si ya hay una copia del
-- mismo seguimiento en la Pizarra actual, la reactiva y reabre su cierre. Si
-- no existe, clona la ficha y despues normaliza su T final antes del commit.
create or replace function app_private.asegurar_reactivacion_historica(p_registro_id uuid)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $function$
declare
  v_source public.registros_hotel%rowtype;
  v_board_state text;
  v_current_board uuid;
  v_current_id uuid;
  v_actor uuid;
  v_new_record uuid;
  v_new_stage uuid;
  v_pos integer := 0;
  e public.etapas_hotel%rowtype;
  t public.trabajos_etapa_hotel%rowtype;
begin
  select * into v_source
  from public.registros_hotel
  where id = p_registro_id;
  if not found then return null; end if;

  select estado into v_board_state
  from public.pizarras
  where id = v_source.pizarra_id;

  if v_board_state <> 'archivada' then return null; end if;
  if v_source.cancelado then return null; end if;
  if v_source.estado in ('recuperado', 'reserva_liberada', 'anulado') then return null; end if;
  if not v_source.retirado_hotel_activo then return null; end if;

  select id into v_current_board
  from public.pizarras
  where estado = 'en_curso'
  order by fecha desc
  limit 1;
  if v_current_board is null then return null; end if;

  select r.id into v_current_id
  from public.registros_hotel r
  where r.pizarra_id = v_current_board
    and r.seguimiento_id = v_source.seguimiento_id
  order by r.actualizado_en desc
  limit 1;

  v_actor := coalesce(auth.uid(), v_source.modificado_por, v_source.creado_por);
  perform set_config('app.audit_origin', 'metrogestion-r1-history-reactivation', true);

  if v_current_id is not null then
    update public.registros_hotel
    set estado = v_source.estado,
        vehiculo_reserva = v_source.vehiculo_reserva,
        matricula_reserva = v_source.matricula_reserva,
        etiqueta_reserva = v_source.etiqueta_reserva,
        tipo_sustituto = v_source.tipo_sustituto,
        retirado_hotel_activo = false,
        fecha_retirado_hotel = null,
        cancelado = false,
        motivo_cancelacion = '',
        cancelado_en = null,
        cancelado_por = null,
        modificado_por = v_actor
    where id = v_current_id
      and (
        retirado_hotel_activo
        or cancelado
        or estado in ('recuperado', 'reserva_liberada', 'anulado')
      );

    perform app_private.reabrir_cierre_ficha_hotel(v_current_id, v_actor);
    return v_current_id;
  end if;

  perform set_config('app.clonando_pizarra', '1', true);
  perform set_config('app.reconciliando_etapas', '1', true);
  set constraints etapas_hotel_posicion_activa_uq deferred;

  insert into public.registros_hotel(
    pizarra_id, seguimiento_id, numero_parada,
    vehiculo_sustituido, matricula_sustituido,
    vehiculo_reserva, matricula_reserva, etiqueta_reserva,
    tipo_unidad, marca, tipo_motor, modelo, upc, telefono,
    prioridad, estado, lugar, fecha_parada, fecha_entrada, tipo_movimiento,
    causa, trabajos_reserva, incidencia, proximo, observaciones,
    sustitucion_temporal, motivo_sustitucion_temporal, fecha_limite_sustitucion,
    orden, retirado_hotel_activo, fecha_retirado_hotel,
    cancelado, motivo_cancelacion, cancelado_en, cancelado_por,
    creado_por, modificado_por, tipo_sustituto, trazo_marron, modalidad_operativa
  ) values (
    v_current_board, v_source.seguimiento_id, v_source.numero_parada,
    v_source.vehiculo_sustituido, v_source.matricula_sustituido,
    v_source.vehiculo_reserva, v_source.matricula_reserva, v_source.etiqueta_reserva,
    v_source.tipo_unidad, v_source.marca, v_source.tipo_motor, v_source.modelo, v_source.upc, v_source.telefono,
    v_source.prioridad, v_source.estado, v_source.lugar, v_source.fecha_parada, v_source.fecha_entrada, v_source.tipo_movimiento,
    v_source.causa, v_source.trabajos_reserva, v_source.incidencia, v_source.proximo, v_source.observaciones,
    v_source.sustitucion_temporal, v_source.motivo_sustitucion_temporal, v_source.fecha_limite_sustitucion,
    (select coalesce(max(r.orden), 0) + 1 from public.registros_hotel r where r.pizarra_id = v_current_board and not r.cancelado),
    false, null, false, '', null, null,
    v_actor, v_actor, v_source.tipo_sustituto, v_source.trazo_marron, v_source.modalidad_operativa
  ) returning id into v_new_record;

  insert into public.hotel_edicion_piloto(registro_hotel_id, activo, observaciones)
  values(v_new_record, true, 'Reactivada desde Historico')
  on conflict(registro_hotel_id) do update
    set activo = true, observaciones = 'Reactivada desde Historico';

  create temp table if not exists tmp_reactivar_stage_map(
    old_id uuid primary key,
    new_id uuid not null
  ) on commit drop;
  truncate tmp_reactivar_stage_map;

  for e in
    select * from public.etapas_hotel
    where registro_hotel_id = p_registro_id
    order by cancelado, posicion, creado_en, id
  loop
    if not e.cancelado then v_pos := v_pos + 1; end if;

    insert into public.etapas_hotel(
      registro_hotel_id, seguimiento_id, nombre, posicion, estado, estado_catalogo_codigo, tipo_etapa,
      taller_id, centro_taller_id, lugar, fecha_prevista, fecha_inicio_real,
      fecha_fin_real, fecha_real, observaciones, cancelado, motivo_cancelacion,
      cancelado_en, cancelado_por, creado_por, modificado_por, accion_sistema, etapa_origen_id
    ) values (
      v_new_record, e.seguimiento_id, e.nombre,
      case when e.cancelado then e.posicion else v_pos end,
      e.estado, e.estado_catalogo_codigo, e.tipo_etapa,
      e.taller_id, e.centro_taller_id, e.lugar, e.fecha_prevista, e.fecha_inicio_real,
      e.fecha_fin_real, e.fecha_real, e.observaciones, e.cancelado, e.motivo_cancelacion,
      e.cancelado_en, e.cancelado_por, v_actor, v_actor, e.accion_sistema, null
    ) returning id into v_new_stage;

    insert into tmp_reactivar_stage_map(old_id, new_id) values(e.id, v_new_stage);

    for t in
      select * from public.trabajos_etapa_hotel
      where etapa_hotel_id = e.id
      order by creado_en, id
    loop
      insert into public.trabajos_etapa_hotel(
        etapa_hotel_id, tipo_trabajo, categoria_tecnica, motivo_entrada,
        diagnostico_real, km_averia, expediente, descripcion, peritaje_estado,
        observaciones, cancelado, motivo_cancelacion, cancelado_en, cancelado_por,
        creado_por, modificado_por
      ) values (
        v_new_stage, t.tipo_trabajo, t.categoria_tecnica, t.motivo_entrada,
        t.diagnostico_real, t.km_averia, t.expediente, t.descripcion, t.peritaje_estado,
        t.observaciones, t.cancelado, t.motivo_cancelacion, t.cancelado_en, t.cancelado_por,
        v_actor, v_actor
      );
    end loop;
  end loop;

  update public.etapas_hotel n
  set etapa_origen_id = m_origin.new_id
  from public.etapas_hotel e_old
  join tmp_reactivar_stage_map m on m.old_id = e_old.id
  join tmp_reactivar_stage_map m_origin on m_origin.old_id = e_old.etapa_origen_id
  where n.id = m.new_id;

  perform set_config('app.reconciliando_etapas', '0', true);
  perform set_config('app.clonando_pizarra', '0', true);
  perform app_private.reabrir_cierre_ficha_hotel(v_new_record, v_actor);
  return v_new_record;
end;
$function$;

revoke all on function app_private.asegurar_reactivacion_historica(uuid)
  from public, anon, authenticated;
grant execute on function app_private.asegurar_reactivacion_historica(uuid)
  to service_role;

create or replace function app_private.validar_coherencia_ficha_hotel_diferida()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $function$
declare
  v_registro_id uuid;
  v_registro public.registros_hotel%rowtype;
  v_row jsonb;
begin
  v_row := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  v_registro_id := case
    when tg_table_name = 'etapas_hotel'
      then nullif(v_row->>'registro_hotel_id', '')::uuid
    else nullif(v_row->>'id', '')::uuid
  end;

  select * into v_registro
  from public.registros_hotel
  where id = v_registro_id;
  if not found then return null; end if;

  if not v_registro.cancelado
     and not v_registro.retirado_hotel_activo
     and v_registro.estado not in ('recuperado', 'reserva_liberada', 'anulado')
     and exists (
       select 1
       from public.etapas_hotel e
       where e.registro_hotel_id = v_registro.id
         and not e.cancelado
         and e.accion_sistema in ('recuperar_y_liberar', 'liberar_reserva')
         and (
           e.estado = 'realizada'
           or e.fecha_fin_real is not null
           or e.fecha_real is not null
           or e.marcado_rapido
         )
     ) then
    raise exception using
      errcode = '23514',
      constraint = 'ficha_hotel_activa_sin_cierre_realizado',
      message = 'Una ficha activa no puede conservar realizada la T que recupera la ruta o libera la reserva';
  end if;

  return null;
end;
$function$;

revoke all on function app_private.validar_coherencia_ficha_hotel_diferida()
  from public, anon, authenticated;

drop trigger if exists registros_hotel_coherencia_diferida on public.registros_hotel;
create constraint trigger registros_hotel_coherencia_diferida
after insert or update on public.registros_hotel
deferrable initially deferred
for each row
execute function app_private.validar_coherencia_ficha_hotel_diferida();

drop trigger if exists etapas_hotel_coherencia_diferida on public.etapas_hotel;
create constraint trigger etapas_hotel_coherencia_diferida
after insert or update or delete on public.etapas_hotel
deferrable initially deferred
for each row
execute function app_private.validar_coherencia_ficha_hotel_diferida();

create or replace function app_private.guardar_ficha_hotel_edicion_alpha72(
  p_registro_id uuid,
  p_version integer,
  p_ficha jsonb,
  p_etapas jsonb,
  p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $function$
declare
  v_before public.registros_hotel%rowtype;
  v_board_state text;
  v_target_board uuid;
  v_requested_state text;
  v_requested_cancelled boolean;
  v_reactivation boolean := false;
  v_reactivated_id uuid;
  v_etapas_reabiertas integer := 0;
  v_codigo text;
  v_ficha_out jsonb := p_ficha;
  v_etapas_out jsonb := p_etapas;
  v_saved jsonb;
  v_version integer;
  v_notas integer;
  v_audit_count integer;
begin
  if auth.uid() is null
     or not public.dispositivo_autorizado()
     or not public.puede_editar_modulo('hotel') then
    raise exception 'No tienes permiso para modificar Hotel';
  end if;

  select * into v_before
  from public.registros_hotel
  where id = p_registro_id
  for update;
  if not found then raise exception 'Ficha de Hotel no encontrada'; end if;

  select p.estado into v_board_state
  from public.pizarras p
  where p.id = v_before.pizarra_id;
  v_target_board := v_before.pizarra_id;

  v_requested_state := lower(btrim(coalesce(p_ficha->>'estado', v_before.estado)));
  v_requested_cancelled := coalesce((p_ficha->>'cancelado')::boolean, v_before.cancelado);
  v_reactivation := (
      v_before.cancelado
      or v_before.retirado_hotel_activo
      or v_before.estado in ('recuperado', 'reserva_liberada', 'anulado')
    )
    and not v_requested_cancelled
    and v_requested_state not in ('recuperado', 'reserva_liberada', 'anulado');

  if v_reactivation then
    select count(*) into v_etapas_reabiertas
    from public.etapas_hotel e
    where e.registro_hotel_id = p_registro_id
      and not e.cancelado
      and e.accion_sistema in ('recuperar_y_liberar', 'liberar_reserva')
      and (
        e.estado = 'realizada'
        or e.fecha_fin_real is not null
        or e.fecha_real is not null
        or e.marcado_rapido
      );

    if v_board_state = 'archivada' then
      -- El registro historico se conserva retirado. La copia de la Pizarra
      -- actual es la que vuelve a quedar operativa.
      select p.id into v_target_board
      from public.pizarras p
      where p.estado = 'en_curso'
      order by p.fecha desc
      limit 1;
      if v_target_board is null then
        raise exception 'No existe una Pizarra actual en la que reactivar la ficha';
      end if;
      v_ficha_out := jsonb_set(v_ficha_out, '{retirado_hotel_activo}', 'true'::jsonb, true);
    else
      v_ficha_out := jsonb_set(v_ficha_out, '{retirado_hotel_activo}', 'false'::jsonb, true);
      v_etapas_out := app_private.preparar_etapas_reactivacion_hotel(
        p_registro_id,
        p_etapas
      );
    end if;
  end if;

  if not v_requested_cancelled
     and v_requested_state not in ('recuperado', 'reserva_liberada', 'anulado')
     and nullif(btrim(p_ficha->>'vehiculo_reserva'), '') is not null
     and exists (
       select 1
       from public.registros_hotel r
       where r.id <> p_registro_id
         and r.pizarra_id = v_target_board
         and not r.cancelado
         and not r.retirado_hotel_activo
         and r.estado not in ('recuperado', 'reserva_liberada', 'anulado')
         and upper(btrim(r.vehiculo_reserva)) = upper(btrim(p_ficha->>'vehiculo_reserva'))
     ) then
    raise exception 'La reserva % ya esta asignada a otra ficha activa de esta Pizarra', upper(btrim(p_ficha->>'vehiculo_reserva'));
  end if;

  v_codigo := app_private.resolver_modalidad_operativa_hotel(v_ficha_out->>'modalidad_operativa');
  perform set_config('app.hotel_modalidad_operativa', v_codigo, true);
  v_saved := app_private.guardar_ficha_hotel_edicion_alpha71(
    p_registro_id,
    p_version,
    v_ficha_out,
    v_etapas_out,
    p_request_id
  );

  update public.registros_hotel
  set modalidad_operativa = v_codigo,
      modificado_por = auth.uid()
  where id = p_registro_id
    and modalidad_operativa is distinct from v_codigo;

  perform set_config('app.request_id', left(p_request_id, 200), true);
  perform set_config('app.audit_origin', 'metrogestion-alpha72-anotaciones', true);
  v_notas := app_private.sincronizar_anotaciones_manuales_hotel(
    p_registro_id,
    coalesce(v_ficha_out->'anotaciones_manuales', '[]'::jsonb)
  );

  if v_reactivation then
    if v_board_state = 'archivada' then
      select r.id into v_reactivated_id
      from public.registros_hotel r
      join public.pizarras p on p.id = r.pizarra_id
      where p.estado = 'en_curso'
        and r.seguimiento_id = v_before.seguimiento_id
      order by p.fecha desc, r.actualizado_en desc, r.id desc
      limit 1;
    else
      v_reactivated_id := p_registro_id;
    end if;

    if v_reactivated_id is null then
      raise exception 'No se ha podido crear o localizar la ficha reactivada en la Pizarra actual';
    end if;

    perform app_private.reabrir_cierre_ficha_hotel(v_reactivated_id, auth.uid());

    if not exists (
      select 1
      from public.registros_hotel r
      where r.id = v_reactivated_id
        and not r.cancelado
        and not r.retirado_hotel_activo
        and r.estado not in ('recuperado', 'reserva_liberada', 'anulado')
    ) then
      raise exception 'La reactivacion no ha dejado una ficha operativa en la Pizarra actual';
    end if;
  end if;

  select version into v_version
  from public.registros_hotel
  where id = p_registro_id;
  select count(*) into v_audit_count
  from public.auditoria_cambios
  where request_id = p_request_id;

  return v_saved || jsonb_build_object(
    'ok', true,
    'version', v_version,
    'modalidad_operativa', v_codigo,
    'anotaciones_guardadas', v_notas,
    'eventos_auditoria', v_audit_count,
    'reactivacion_coherente', v_reactivation,
    'ficha_activa_id', v_reactivated_id,
    'etapas_reabiertas', v_etapas_reabiertas,
    'detalle', app_private.obtener_ficha_hotel_edicion_alpha72(p_registro_id)
  );
end;
$function$;

revoke all on function app_private.guardar_ficha_hotel_edicion_alpha72(uuid, integer, jsonb, jsonb, text)
  from public, anon;
grant execute on function app_private.guardar_ficha_hotel_edicion_alpha72(uuid, integer, jsonb, jsonb, text)
  to authenticated, service_role;

revoke all on function public.guardar_ficha_hotel_edicion_alpha72(uuid, integer, jsonb, jsonb, text)
  from public, anon;
grant execute on function public.guardar_ficha_hotel_edicion_alpha72(uuid, integer, jsonb, jsonb, text)
  to authenticated, service_role;
