begin;

-- Una ficha cuyo origen es Activar 24H no puede ser el destino de trabajos
-- predictivos de MANTENIMENT. Estos quedan libres para una parada posterior.
create or replace function app_private.manteniment_dfm_bloqueado_por_24h_alpha74(
  p_dfm text
)
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog, public, app_private
as $function$
declare
  v_es_24h boolean := false;
begin
  if btrim(coalesce(p_dfm, '')) = '' then
    return false;
  end if;

  select upper(btrim(coalesce(actual.tipo_movimiento, ''))) = '24H'
  into v_es_24h
  from (
    select r.tipo_movimiento
    from public.registros_hotel r
    join public.pizarras p on p.id = r.pizarra_id
    where not r.cancelado
      and not r.retirado_hotel_activo
      and r.estado not in ('recuperado', 'reserva_liberada', 'anulado')
      and regexp_replace(upper(btrim(coalesce(r.vehiculo_sustituido, ''))), '[[:space:]]+', '', 'g')
        = regexp_replace(upper(btrim(p_dfm)), '[[:space:]]+', '', 'g')
    order by (p.estado = 'en_curso') desc, p.fecha desc,
             r.actualizado_en desc, r.id desc
    limit 1
  ) actual;

  return coalesce(v_es_24h, false);
end;
$function$;

revoke all on function app_private.manteniment_dfm_bloqueado_por_24h_alpha74(text)
  from public, anon, authenticated;

-- Mantiene la inferencia de taller vigente, pero retira del lote los DFM cuya
-- parada activa es una asistencia 24H.
create or replace function app_private.manteniment_importar_trabajos(p_trabajos jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $function$
declare
  v_trabajos jsonb;
  v_resultado jsonb;
  v_registro_id uuid;
begin
  if p_trabajos is null or jsonb_typeof(p_trabajos) <> 'array' then
    return app_private.manteniment_importar_trabajos_alpha74_base(p_trabajos);
  end if;

  select coalesce(
    jsonb_agg(
      case
        when btrim(coalesce(item.value->>'taller', '')) <> '' then item.value
        when inferred.taller is null then item.value
        else jsonb_set(item.value, '{taller}', to_jsonb(inferred.taller), true)
      end
      order by item.ordinality
    ),
    '[]'::jsonb
  )
  into v_trabajos
  from jsonb_array_elements(p_trabajos) with ordinality as item(value, ordinality)
  cross join lateral (
    select app_private.manteniment_inferir_taller_alpha74(
      item.value->>'dfm', item.value->>'taller', item.value->>'tipo_trabajo',
      item.value->>'designacion', item.value->>'marca_equipo',
      item.value->>'marca_vehiculo'
    ) as taller
  ) inferred
  where not app_private.manteniment_dfm_bloqueado_por_24h_alpha74(item.value->>'dfm');

  v_resultado := app_private.manteniment_importar_trabajos_alpha74_base(v_trabajos);

  for v_registro_id in
    with dfm_lote as (
      select distinct regexp_replace(upper(btrim(coalesce(x.value->>'dfm', ''))), '[[:space:]]+', '', 'g') as dfm
      from jsonb_array_elements(v_trabajos) x(value)
    ), fichas as (
      select r.id,
             row_number() over (
               partition by r.seguimiento_id
               order by (p.estado = 'en_curso') desc, p.fecha desc,
                        r.actualizado_en desc, r.id desc
             ) as rn
      from public.registros_hotel r
      join public.pizarras p on p.id = r.pizarra_id
      join dfm_lote d
        on d.dfm = regexp_replace(upper(btrim(coalesce(r.vehiculo_sustituido, ''))), '[[:space:]]+', '', 'g')
      where not r.cancelado
        and not r.retirado_hotel_activo
        and r.estado not in ('recuperado', 'reserva_liberada', 'anulado')
    )
    select id from fichas where rn = 1
  loop
    perform app_private.manteniment_reconciliar_asistencia_alpha74(v_registro_id);
  end loop;

  return v_resultado;
end;
$function$;

revoke all on function app_private.manteniment_importar_trabajos(jsonb)
  from public, anon;
grant execute on function app_private.manteniment_importar_trabajos(jsonb)
  to authenticated;

-- Las modalidades generales no eliminan la T de recuperación de una parada
-- 24H: toda asistencia conserva siempre su cierre de recuperar ruta.
create or replace function app_private.modalidad_hotel_requiere_recuperacion(
  p_registro_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $function$
declare
  v_codigo text;
  v_comportamiento text;
  v_fecha_parada date;
  v_seguimiento_id uuid;
  v_tipo_movimiento text;
  v_total integer := 0;
  v_pendientes integer := 0;
  v_ultima_fecha date;
  v_hoy date := (clock_timestamp() at time zone 'Europe/Madrid')::date;
begin
  v_codigo := nullif(btrim(coalesce(current_setting('app.hotel_modalidad_operativa', true), '')), '');
  select coalesce(v_codigo, nullif(btrim(r.modalidad_operativa), '')),
         r.fecha_parada, r.seguimiento_id, upper(btrim(coalesce(r.tipo_movimiento, '')))
    into v_codigo, v_fecha_parada, v_seguimiento_id, v_tipo_movimiento
  from public.registros_hotel r
  where r.id = p_registro_id;

  if v_tipo_movimiento = '24H' then
    return true;
  end if;

  if exists (
       select 1 from app_private.manteniment_t_visitas v
       where v.seguimiento_id = v_seguimiento_id
     )
     and not exists (
       select 1 from app_private.manteniment_t_visitas v
       where v.seguimiento_id = v_seguimiento_id
         and v.modalidad not in ('tramite', 'gestion')
     ) then
    return false;
  end if;

  if v_codigo is null then return true; end if;
  select c.comportamiento into v_comportamiento
  from public.catalogo_modalidades_operativas_hotel c
  where c.codigo = v_codigo and c.activo = true;

  if v_comportamiento is null or v_comportamiento = 'manual' then return true; end if;
  if v_comportamiento in ('reparado_en_ruta', 'reserva_en_reparacion') then return false; end if;
  if v_comportamiento <> 'sin_sustitucion' then return true; end if;

  select count(*),
         count(*) filter (where e.estado not in ('realizada', 'anulada')),
         max(coalesce(e.fecha_real, e.fecha_fin_real, e.fecha_inicio_real, e.fecha_prevista)::date)
    into v_total, v_pendientes, v_ultima_fecha
  from public.etapas_hotel e
  where e.registro_hotel_id = p_registro_id
    and not e.cancelado
    and e.accion_sistema <> 'recuperar_y_liberar';

  if v_total = 0 then return false; end if;
  if v_fecha_parada is null then return true; end if;
  if v_pendientes > 0 then
    return greatest(coalesce(v_ultima_fecha, v_fecha_parada), v_hoy) > v_fecha_parada;
  end if;
  return coalesce(v_ultima_fecha, v_fecha_parada) > v_fecha_parada;
end;
$function$;

revoke all on function app_private.modalidad_hotel_requiere_recuperacion(uuid)
  from public, anon, authenticated;

-- Reconciliación propia de 24H. No utiliza visitas de MANTENIMENT para decidir
-- el taller: solo el traslado confirmado en Activar 24H crea Entrada/Recogida.
create or replace function app_private.manteniment_reconciliar_asistencia_alpha74(
  p_registro_id uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $function$
declare
  v_ficha public.registros_hotel%rowtype;
  v_activacion public.activaciones_24h%rowtype;
  v_asistencia_id uuid;
  v_recovery_id uuid;
  v_entry_id uuid;
  v_pickup_id uuid;
  v_job_id uuid;
  v_taller text := '';
  v_traslado boolean := false;
  v_pos integer;
  v_actor uuid;
begin
  select * into v_ficha
  from public.registros_hotel
  where id = p_registro_id
  for update;

  if v_ficha.id is null or upper(btrim(coalesce(v_ficha.tipo_movimiento, ''))) <> '24H' then
    return;
  end if;

  select * into v_activacion
  from public.activaciones_24h a
  where coalesce(a.estado, '') <> 'anulada'
    and (a.registro_hotel_id = v_ficha.id or a.seguimiento_hotel_id = v_ficha.seguimiento_id)
  order by (a.registro_hotel_id = v_ficha.id) desc,
           (a.estado = 'abierta') desc, a.actualizado_en desc, a.creado_en desc
  limit 1;

  select e.id into v_asistencia_id
  from public.etapas_hotel e
  where e.registro_hotel_id = v_ficha.id
    and not e.cancelado
    and regexp_replace(upper(btrim(coalesce(e.nombre, ''))), '[^A-Z0-9]+', '', 'g')
      in ('24H', '24HAVERIA', 'AVERIA24H', 'ASISTENCIA24H')
  order by (e.estado = 'en_curso') desc, e.posicion, e.creado_en
  limit 1;

  if v_asistencia_id is null then
    return;
  end if;

  v_actor := coalesce(v_ficha.modificado_por, v_ficha.creado_por);
  v_traslado := coalesce(v_activacion.trasladado_taller, false)
    or lower(btrim(coalesce(v_activacion.resultado, ''))) = 'trasladado_taller';
  v_taller := btrim(coalesce(v_activacion.taller_traslado, ''));

  perform set_config('app.reconciliando_etapas', '1', true);
  perform set_config('app.audit_origin', 'alpha74-24h-aislada-manteniment', true);
  set constraints etapas_hotel_posicion_activa_uq deferred;

  -- La primera T siempre es la avería de asistencia 24H.
  update public.etapas_hotel
  set nombre = '24H · Avería',
      tipo_etapa = '24H',
      modificado_por = coalesce(v_actor, modificado_por),
      actualizado_en = clock_timestamp(),
      version = version + 1
  where id = v_asistencia_id;

  select t.id into v_job_id
  from public.trabajos_etapa_hotel t
  where t.etapa_hotel_id = v_asistencia_id
    and not t.cancelado
    and upper(btrim(coalesce(t.tipo_trabajo, ''))) in ('AV', 'AVERÍA', 'AVERIA')
    and upper(btrim(coalesce(t.categoria_tecnica, ''))) = '24H'
  order by t.creado_en, t.id
  limit 1;

  if v_job_id is null then
    insert into public.trabajos_etapa_hotel(
      etapa_hotel_id, tipo_trabajo, categoria_tecnica, motivo_entrada,
      diagnostico_real, km_averia, expediente, descripcion, observaciones,
      cancelado, creado_por, modificado_por
    ) values (
      v_asistencia_id, 'AV', '24H', v_activacion.averia,
      v_activacion.diagnostico, v_activacion.km_actual,
      v_activacion.numero_caso, v_activacion.averia,
      app_private.cronologia_activacion_24h_alpha74(v_activacion),
      false, v_actor, v_actor
    );
  end if;

  -- Libera posiciones antes de restaurar o crear T operativas.
  update public.etapas_hotel e
  set posicion = e.posicion + 10000,
      modificado_por = coalesce(v_actor, e.modificado_por)
  where e.registro_hotel_id = v_ficha.id
    and not e.cancelado;

  select e.id into v_recovery_id
  from public.etapas_hotel e
  where e.registro_hotel_id = v_ficha.id
    and e.accion_sistema = 'recuperar_y_liberar'
  order by e.cancelado, e.creado_en, e.id
  limit 1;

  if v_recovery_id is null then
    insert into public.etapas_hotel(
      registro_hotel_id, seguimiento_id, nombre, posicion, estado,
      estado_catalogo_codigo, tipo_etapa, lugar, observaciones, cancelado,
      creado_por, modificado_por, accion_sistema
    ) values (
      v_ficha.id, gen_random_uuid(), 'Recuperar ruta y liberar reserva',
      20000, 'pendiente', 'pendiente', 'recuperar_ruta', '',
      'Generada automáticamente como T final de cierre.', false,
      v_actor, v_actor, 'recuperar_y_liberar'
    ) returning id into v_recovery_id;
  else
    update public.etapas_hotel
    set cancelado = false,
        estado = 'pendiente',
        estado_catalogo_codigo = 'pendiente',
        tipo_etapa = 'recuperar_ruta',
        motivo_cancelacion = '',
        cancelado_en = null,
        cancelado_por = null,
        modificado_por = coalesce(v_actor, modificado_por),
        actualizado_en = clock_timestamp(),
        version = version + 1
    where id = v_recovery_id
      and cancelado;
  end if;

  -- Solo una grúa confirmada con taller crea las T de Entrada y Recogida.
  if v_traslado and v_taller <> '' then
    select e.id into v_entry_id
    from public.etapas_hotel e
    where e.registro_hotel_id = v_ficha.id
      and not e.cancelado
      and e.tipo_etapa = 'entrada_taller'
      and (
        regexp_replace(upper(btrim(coalesce(e.lugar, ''))), '[[:space:]]+', ' ', 'g')
          = regexp_replace(upper(v_taller), '[[:space:]]+', ' ', 'g')
        or regexp_replace(upper(btrim(coalesce(e.nombre, ''))), '[^A-Z0-9]+', '', 'g')
          = 'ENTRADA' || regexp_replace(upper(v_taller), '[^A-Z0-9]+', '', 'g')
      )
    order by e.posicion, e.creado_en, e.id
    limit 1;

    if v_entry_id is null then
      insert into public.etapas_hotel(
        registro_hotel_id, seguimiento_id, nombre, posicion, estado,
        estado_catalogo_codigo, tipo_etapa, lugar, observaciones, cancelado,
        creado_por, modificado_por
      ) values (
        v_ficha.id, gen_random_uuid(), 'Entrada ' || v_taller, 15000,
        'pendiente', 'pendiente', 'entrada_taller', v_taller,
        'Generada al confirmar traslado en grúa desde la asistencia 24H.',
        false, v_actor, v_actor
      ) returning id into v_entry_id;
    end if;

    select e.id into v_pickup_id
    from public.etapas_hotel e
    where e.registro_hotel_id = v_ficha.id
      and not e.cancelado
      and e.tipo_etapa = 'recogida_taller'
      and e.etapa_origen_id = v_entry_id
    order by e.posicion, e.creado_en, e.id
    limit 1;

    if v_pickup_id is null then
      insert into public.etapas_hotel(
        registro_hotel_id, seguimiento_id, nombre, posicion, estado,
        estado_catalogo_codigo, tipo_etapa, lugar, observaciones, cancelado,
        creado_por, modificado_por, etapa_origen_id
      ) values (
        v_ficha.id, gen_random_uuid(), 'Recogida ' || v_taller, 16000,
        'pendiente', 'pendiente', 'recogida_taller', v_taller,
        'Generada al confirmar traslado en grúa desde la asistencia 24H.',
        false, v_actor, v_actor, v_entry_id
      );
    end if;
  end if;

  -- Orden final: Avería 24H, Entrada/Recogida si existen y Recuperar ruta.
  with ordenadas as (
    select e.id,
           row_number() over (
             order by case
               when e.id = v_asistencia_id then 0
               when e.tipo_etapa = 'entrada_taller' then 10
               when e.tipo_etapa = 'recogida_taller' then 20
               when e.accion_sistema = 'recuperar_y_liberar' then 99
               else 50
             end,
             e.posicion, e.creado_en, e.id
           )::integer as posicion
    from public.etapas_hotel e
    where e.registro_hotel_id = v_ficha.id
      and not e.cancelado
  )
  update public.etapas_hotel e
  set posicion = o.posicion,
      modificado_por = coalesce(v_actor, e.modificado_por)
  from ordenadas o
  where e.id = o.id;

  if v_traslado and v_taller <> '' then
    update public.registros_hotel
    set estado = 'en_taller',
        lugar = v_taller,
        modificado_por = coalesce(v_actor, modificado_por),
        actualizado_en = clock_timestamp(),
        version = version + 1
    where id = v_ficha.id;
  end if;

  perform set_config('app.reconciliando_etapas', '0', true);
  perform app_private.manteniment_encolar_parada(v_ficha.seguimiento_id);
exception when others then
  perform set_config('app.reconciliando_etapas', '0', true);
  raise;
end;
$function$;

revoke all on function app_private.manteniment_reconciliar_asistencia_alpha74(uuid)
  from public, anon, authenticated;

-- Impide que el estado de seguimiento "En reparación" se confunda con una
-- entrada física al taller. Una Entrada activa o la grúa confirmada sí lo permite.
create or replace function app_private.normalizar_estado_taller_24h_alpha74()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $function$
begin
  if upper(btrim(coalesce(new.tipo_movimiento, ''))) = '24H'
     and new.estado = 'en_taller'
     and not exists (
       select 1
       from public.etapas_hotel e
       where e.registro_hotel_id = new.id
         and not e.cancelado
         and e.tipo_etapa = 'entrada_taller'
     ) then
    new.estado := 'asistencia_24h';
  end if;
  return new;
end;
$function$;

revoke all on function app_private.normalizar_estado_taller_24h_alpha74()
  from public, anon, authenticated;

drop trigger if exists registros_hotel_normalizar_estado_taller_24h_alpha74_trg
  on public.registros_hotel;
create trigger registros_hotel_normalizar_estado_taller_24h_alpha74_trg
before insert or update of estado, tipo_movimiento on public.registros_hotel
for each row execute function app_private.normalizar_estado_taller_24h_alpha74();

comment on function app_private.manteniment_reconciliar_asistencia_alpha74(uuid) is
  'Aísla la parada 24H de MANTENIMENT; solo la grúa confirmada crea Entrada y Recogida y siempre conserva Recuperar ruta.';

commit;
