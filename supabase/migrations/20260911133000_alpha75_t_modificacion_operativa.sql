begin;

-- Una T anulada, restaurada o modificada no es una nota: sus dependencias
-- automáticas y las fechas enviadas a MANTENIMENT se recalculan con el estado
-- vigente de toda la actuación.
create or replace function app_private.reconciliar_dependencias_t_alpha75(
  p_registro_id uuid,
  p_actor uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'app_private'
as $function$
declare
  v_recogidas_anuladas integer := 0;
  v_recogidas_restauradas integer := 0;
begin
  update public.etapas_hotel recogida
     set cancelado = true,
         estado = 'anulada',
         estado_catalogo_codigo = 'anulada',
         motivo_cancelacion = 'Anulada automáticamente: la Entrada de taller vinculada ya no está activa.',
         cancelado_en = clock_timestamp(),
         cancelado_por = p_actor,
         modificado_por = p_actor
   where recogida.registro_hotel_id = p_registro_id
     and not recogida.cancelado
     and recogida.tipo_etapa = 'recogida_taller'
     and recogida.etapa_origen_id is not null
     and not exists (
       select 1
       from public.etapas_hotel entrada
       where entrada.id = recogida.etapa_origen_id
         and entrada.registro_hotel_id = recogida.registro_hotel_id
         and not entrada.cancelado
         and entrada.tipo_etapa = 'entrada_taller'
     );
  get diagnostics v_recogidas_anuladas = row_count;

  update public.etapas_hotel recogida
     set cancelado = false,
         estado = case when recogida.fecha_prevista is null then 'pendiente' else 'programada' end,
         estado_catalogo_codigo = case when recogida.fecha_prevista is null then 'pendiente' else 'programada' end,
         motivo_cancelacion = '',
         cancelado_en = null,
         cancelado_por = null,
         modificado_por = p_actor
   where recogida.registro_hotel_id = p_registro_id
     and recogida.cancelado
     and recogida.tipo_etapa = 'recogida_taller'
     and recogida.etapa_origen_id is not null
     and recogida.motivo_cancelacion = 'Anulada automáticamente: la Entrada de taller vinculada ya no está activa.'
     and exists (
       select 1
       from public.etapas_hotel entrada
       where entrada.id = recogida.etapa_origen_id
         and entrada.registro_hotel_id = recogida.registro_hotel_id
         and not entrada.cancelado
         and entrada.tipo_etapa = 'entrada_taller'
     )
     and not exists (
       select 1
       from public.etapas_hotel otra
       where otra.registro_hotel_id = recogida.registro_hotel_id
         and otra.etapa_origen_id = recogida.etapa_origen_id
         and otra.id <> recogida.id
         and not otra.cancelado
         and otra.tipo_etapa = 'recogida_taller'
     );
  get diagnostics v_recogidas_restauradas = row_count;

  return jsonb_build_object(
    'recogidas_anuladas', v_recogidas_anuladas,
    'recogidas_restauradas', v_recogidas_restauradas
  );
end;
$function$;

revoke all on function app_private.reconciliar_dependencias_t_alpha75(uuid, uuid)
  from public, anon, authenticated;

create or replace function app_private.recalcular_fechas_manteniment_alpha75(
  p_registro_id uuid
)
returns integer
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'app_private'
as $function$
declare
  v_seguimiento_id uuid;
  v_actualizados integer := 0;
begin
  select r.seguimiento_id
    into v_seguimiento_id
  from public.registros_hotel r
  where r.id = p_registro_id;

  if v_seguimiento_id is null then
    return 0;
  end if;

  with fechas as (
    select w.id,
           case
             when v.modalidad = 'taller' then (
               select (coalesce(e.fecha_real, e.fecha_fin_real, e.fecha_inicio_real)
                       at time zone 'Europe/Madrid')::date
               from public.etapas_hotel e
               join public.registros_hotel r on r.id = e.registro_hotel_id
               where r.seguimiento_id = v_seguimiento_id
                 and not r.cancelado
                 and not e.cancelado
                 and e.estado = 'realizada'
                 and e.tipo_etapa = 'entrada_taller'
                 and e.grupo_documental_id = v.grupo_entrada_id
               order by coalesce(e.fecha_real, e.fecha_fin_real, e.fecha_inicio_real) desc nulls last,
                        e.actualizado_en desc, e.id desc
               limit 1
             )
             when not coalesce(th.cancelado, true)
                  and not coalesce(e.cancelado, true)
                  and e.estado = 'realizada'
                  and e.tipo_etapa <> 'recogida_taller'
             then (coalesce(e.fecha_real, e.fecha_fin_real, e.fecha_inicio_real)
                   at time zone 'Europe/Madrid')::date
             else null
           end as fecha_realizada_nueva,
           case
             when v.modalidad = 'taller' then (
               select (coalesce(e.fecha_real, e.fecha_fin_real, e.fecha_inicio_real)
                       at time zone 'Europe/Madrid')::date
               from public.etapas_hotel e
               join public.registros_hotel r on r.id = e.registro_hotel_id
               where r.seguimiento_id = v_seguimiento_id
                 and not r.cancelado
                 and not e.cancelado
                 and e.estado = 'realizada'
                 and e.tipo_etapa = 'recogida_taller'
                 and e.grupo_documental_id = v.grupo_recogida_id
               order by coalesce(e.fecha_real, e.fecha_fin_real, e.fecha_inicio_real) desc nulls last,
                        e.actualizado_en desc, e.id desc
               limit 1
             )
             when not coalesce(th.cancelado, true)
                  and not coalesce(e.cancelado, true)
                  and e.estado = 'realizada'
                  and e.tipo_etapa not in ('entrada_taller', 'recogida_taller')
             then (coalesce(e.fecha_real, e.fecha_fin_real, e.fecha_inicio_real)
                   at time zone 'Europe/Madrid')::date
             when not coalesce(th.cancelado, true)
                  and not coalesce(e.cancelado, true)
                  and e.estado = 'realizada'
                  and e.tipo_etapa = 'recogida_taller'
             then (coalesce(e.fecha_real, e.fecha_fin_real, e.fecha_inicio_real)
                   at time zone 'Europe/Madrid')::date
             else null
           end as fecha_recogida_nueva
    from app_private.manteniment_t_trabajos w
    join app_private.manteniment_t_visitas v on v.id = w.visita_id
    left join public.trabajos_etapa_hotel th on th.id = w.trabajo_hotel_id
    left join public.etapas_hotel e on e.id = th.etapa_hotel_id
    where v.seguimiento_id = v_seguimiento_id
  )
  update app_private.manteniment_t_trabajos w
     set fecha_realizada = f.fecha_realizada_nueva,
         fecha_recogida = f.fecha_recogida_nueva,
         actualizado_en = clock_timestamp()
    from fechas f
   where w.id = f.id
     and (w.fecha_realizada is distinct from f.fecha_realizada_nueva
          or w.fecha_recogida is distinct from f.fecha_recogida_nueva);
  get diagnostics v_actualizados = row_count;

  if exists (
    select 1
    from app_private.manteniment_parada_sync s
    where s.seguimiento_id = v_seguimiento_id
  ) then
    perform app_private.manteniment_encolar_parada(v_seguimiento_id);
  end if;

  return v_actualizados;
end;
$function$;

revoke all on function app_private.recalcular_fechas_manteniment_alpha75(uuid)
  from public, anon, authenticated;

create or replace function app_private.reconciliar_etapas_hotel(p_registro_id uuid,p_request_id text)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public','app_private'
as $function$
declare
  v_actor uuid;
  v_entry record;
  v_last_pos integer;
  v_audit_count integer;
  v_active_count integer;
  v_requiere_recuperacion boolean;
  v_dependencias jsonb := '{}'::jsonb;
  v_recogidas_creadas integer := 0;
  v_recuperaciones_creadas integer := 0;
  v_recuperaciones_anuladas integer := 0;
  v_fechas_actualizadas integer := 0;
  v_manteniment_encolado boolean := false;
begin
  if auth.uid() is null or not public.dispositivo_autorizado() or not public.puede_editar_modulo('hotel') then
    raise exception 'No tienes permiso para modificar Hotel';
  end if;
  if p_request_id is null or p_request_id !~ '^[A-Za-z0-9_-]{8,80}$' then
    raise exception 'Identificador de guardado no válido';
  end if;
  perform 1 from public.registros_hotel where id=p_registro_id for update;
  if not found then raise exception 'Ficha de Hotel no encontrada'; end if;

  v_actor:=auth.uid();
  perform set_config('app.request_id',p_request_id,true);
  perform set_config('app.audit_origin','metrogestion-r1-reconcile',true);
  perform set_config('app.audit_reason','Aplicación operativa de una T anulada, restaurada o modificada',true);
  perform set_config('app.reconciliando_etapas','1',true);
  set constraints etapas_hotel_posicion_activa_uq deferred;

  v_dependencias := app_private.reconciliar_dependencias_t_alpha75(p_registro_id, v_actor);

  for v_entry in
    select e.id,e.posicion,e.taller_id,e.centro_taller_id,e.lugar
    from public.etapas_hotel e
    where e.registro_hotel_id=p_registro_id and not e.cancelado
      and e.tipo_etapa='entrada_taller' and e.etapa_origen_id is null
      and not exists(select 1 from public.etapas_hotel r where r.etapa_origen_id=e.id and not r.cancelado and r.tipo_etapa='recogida_taller')
    order by e.posicion,e.creado_en,e.id
  loop
    insert into public.etapas_hotel(registro_hotel_id,seguimiento_id,nombre,posicion,estado,tipo_etapa,taller_id,centro_taller_id,lugar,observaciones,cancelado,creado_por,modificado_por,etapa_origen_id)
    values(p_registro_id,gen_random_uuid(),'Recogida taller',v_entry.posicion+1,'pendiente','recogida_taller',v_entry.taller_id,v_entry.centro_taller_id,coalesce(v_entry.lugar,''),'Generada automáticamente al crear la entrada a taller.',false,v_actor,v_actor,v_entry.id);
    v_recogidas_creadas := v_recogidas_creadas + 1;
  end loop;

  v_requiere_recuperacion:=app_private.modalidad_hotel_requiere_recuperacion(p_registro_id);
  if v_requiere_recuperacion then
    if not exists(select 1 from public.etapas_hotel e where e.registro_hotel_id=p_registro_id and not e.cancelado and e.accion_sistema='recuperar_y_liberar') then
      select coalesce(max(e.posicion),0)+1 into v_last_pos from public.etapas_hotel e where e.registro_hotel_id=p_registro_id and not e.cancelado;
      insert into public.etapas_hotel(registro_hotel_id,seguimiento_id,nombre,posicion,estado,tipo_etapa,lugar,observaciones,cancelado,creado_por,modificado_por,accion_sistema)
      values(p_registro_id,gen_random_uuid(),'Recuperar ruta y liberar reserva',v_last_pos,'pendiente','otro','','Generada automáticamente como T final de cierre.',false,v_actor,v_actor,'recuperar_y_liberar');
      v_recuperaciones_creadas := 1;
    end if;
  else
    update public.etapas_hotel
    set cancelado=true,estado='anulada',estado_catalogo_codigo='anulada',
        motivo_cancelacion='No corresponde a la modalidad operativa seleccionada.',
        cancelado_en=clock_timestamp(),cancelado_por=v_actor,modificado_por=v_actor
    where registro_hotel_id=p_registro_id and not cancelado
      and accion_sistema='recuperar_y_liberar' and estado<>'realizada';
    get diagnostics v_recuperaciones_anuladas = row_count;
  end if;

  select count(*) into v_active_count from public.etapas_hotel e
  where e.registro_hotel_id=p_registro_id and not e.cancelado;
  if v_active_count>99 then raise exception 'La ficha supera el máximo de 99 T activas'; end if;

  create temp table if not exists tmp_hotel_reconcile_order(stage_id uuid primary key,new_pos integer not null) on commit drop;
  truncate tmp_hotel_reconcile_order;
  insert into tmp_hotel_reconcile_order(stage_id,new_pos)
  select x.id,row_number() over(order by
    case when x.accion_sistema='recuperar_y_liberar' then 1 else 0 end,
    case when x.accion_sistema='recuperar_y_liberar' then 2147483000::bigint
         when x.tipo_etapa='recogida_taller' and p.id is not null then (p.posicion::bigint*2)+1
         else (x.posicion::bigint*2) end,
    x.creado_en,x.id)::integer
  from public.etapas_hotel x left join public.etapas_hotel p on p.id=x.etapa_origen_id
  where x.registro_hotel_id=p_registro_id and not x.cancelado;
  update public.etapas_hotel e set posicion=1000+o.new_pos,modificado_por=v_actor
  from tmp_hotel_reconcile_order o where e.id=o.stage_id;
  update public.etapas_hotel e set posicion=o.new_pos,modificado_por=v_actor
  from tmp_hotel_reconcile_order o where e.id=o.stage_id;

  perform app_private.cerrar_modalidad_hotel_sin_recuperacion(p_registro_id);
  select exists (
    select 1
    from public.registros_hotel r
    join app_private.manteniment_parada_sync s on s.seguimiento_id = r.seguimiento_id
    where r.id = p_registro_id
  ) into v_manteniment_encolado;
  v_fechas_actualizadas := app_private.recalcular_fechas_manteniment_alpha75(p_registro_id);
  perform set_config('app.reconciliando_etapas','0',true);
  select count(*) into v_audit_count from public.auditoria_cambios where request_id=p_request_id;
  return jsonb_build_object(
    'ok',true,
    'request_id',p_request_id,
    'eventos_auditoria',v_audit_count,
    'impacto_operativo',v_dependencias || jsonb_build_object(
      'recogidas_creadas',v_recogidas_creadas,
      'recuperaciones_creadas',v_recuperaciones_creadas,
      'recuperaciones_anuladas',v_recuperaciones_anuladas,
      'fechas_manteniment_actualizadas',v_fechas_actualizadas,
      'manteniment_encolado',v_manteniment_encolado
    ),
    'detalle',public.obtener_ficha_hotel_edicion(p_registro_id)
  );
end;
$function$;

revoke all on function app_private.reconciliar_etapas_hotel(uuid,text)
  from public, anon, authenticated;

create or replace function app_private.guardar_ficha_hotel_edicion(
  p_registro_id uuid,
  p_version integer,
  p_ficha jsonb,
  p_etapas jsonb,
  p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public','app_private'
as $function$
declare
  v_saved jsonb;
  v_reconciled jsonb;
  v_audit_count integer;
  v_board_state text;
  v_before public.registros_hotel%rowtype;
  v_prop_rows integer:=0;
  v_prop_stages integer:=0;
  v_norm integer:=0;
begin
  select * into v_before
  from public.registros_hotel
  where id=p_registro_id;
  if not found then raise exception 'Ficha de Hotel no encontrada'; end if;

  v_saved:=public.guardar_ficha_hotel_edicion_core(p_registro_id,p_version,p_ficha,p_etapas,p_request_id);

  v_prop_rows:=app_private.propagar_correcciones_globales_parada(p_registro_id,to_jsonb(v_before));
  v_prop_stages:=app_private.propagar_detalles_t_parada(p_registro_id);
  v_norm:=app_private.normalizar_orden_t_parada(p_registro_id);

  select p.estado into v_board_state
  from public.registros_hotel r
  join public.pizarras p on p.id=r.pizarra_id
  where r.id=p_registro_id;

  if v_board_state='en_curso' then
    v_reconciled:=public.reconciliar_etapas_hotel(p_registro_id,p_request_id);
    select count(*) into v_audit_count from public.auditoria_cambios where request_id=p_request_id;
    return v_saved || jsonb_build_object(
      'detalle',v_reconciled->'detalle',
      'eventos_auditoria',v_audit_count,
      'reconciliado',true,
      'impacto_operativo',coalesce(v_reconciled->'impacto_operativo','{}'::jsonb),
      'dias_propagados',v_prop_rows,
      't_propagadas',v_prop_stages,
      't_reordenadas',v_norm
    );
  end if;

  if v_board_state='archivada' then
    perform app_private.asegurar_reactivacion_historica(p_registro_id);
  end if;

  select count(*) into v_audit_count from public.auditoria_cambios where request_id=p_request_id;
  return v_saved || jsonb_build_object(
    'eventos_auditoria',v_audit_count,
    'reconciliado',false,
    'impacto_operativo',jsonb_build_object(
      'recogidas_anuladas',0,
      'recogidas_restauradas',0,
      'recogidas_creadas',0,
      'recuperaciones_creadas',0,
      'recuperaciones_anuladas',0,
      'fechas_manteniment_actualizadas',0,
      'manteniment_encolado',false
    ),
    'dias_propagados',v_prop_rows,
    't_propagadas',v_prop_stages,
    't_reordenadas',v_norm
  );
end;
$function$;

revoke all on function app_private.guardar_ficha_hotel_edicion(uuid,integer,jsonb,jsonb,text)
  from public, anon, authenticated;

commit;
