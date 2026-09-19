-- Identidad operativa estable entre copias diarias y una visita por lugar F.
-- Las identidades documentales y de sincronización ya existentes se conservan.

DO $guard$ BEGIN IF md5(rtrim(pg_get_functiondef('app_private.manteniment_etapa_actual(uuid,uuid)'::regprocedure), E' \t\n\r')) <> '809505b6a67c325972f190ecdddf419e' THEN RAISE EXCEPTION 'Ha cambiado manteniment_etapa_actual; revisar antes de aplicar'; END IF; END $guard$;
CREATE OR REPLACE FUNCTION app_private.manteniment_etapa_actual(p_seguimiento_id uuid, p_etapa_origen_id uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public', 'app_private'
AS $function$
  select actual.id
  from public.etapas_hotel origen
  join public.registros_hotel original on original.id = origen.registro_hotel_id
  cross join lateral (
    select r.id from public.registros_hotel r
    join public.pizarras p on p.id = r.pizarra_id
    where r.seguimiento_id = p_seguimiento_id
    order by (p.estado = 'en_curso') desc, p.fecha desc, r.actualizado_en desc, r.id desc
    limit 1
  ) ficha
  join public.etapas_hotel actual
    on actual.registro_hotel_id = ficha.id
   and (actual.seguimiento_id = origen.seguimiento_id
     or (actual.grupo_documental_id = origen.grupo_documental_id
       and not exists (
         select 1 from public.etapas_hotel identidad
         where identidad.registro_hotel_id = ficha.id
           and identidad.seguimiento_id = origen.seguimiento_id
       )))
  where origen.id = p_etapa_origen_id
    and original.seguimiento_id = p_seguimiento_id
  order by actual.cancelado, actual.creado_en, actual.id
  limit 1;
$function$;


DO $guard$ BEGIN IF md5(rtrim(pg_get_functiondef('app_private.propagar_detalles_t_parada(uuid)'::regprocedure), E' \t\n\r')) <> '26fb390c7235ebcd4f391ed0af122403' THEN RAISE EXCEPTION 'Ha cambiado propagar_detalles_t_parada; revisar antes de aplicar'; END IF; END $guard$;
CREATE OR REPLACE FUNCTION app_private.propagar_detalles_t_parada(p_registro_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'app_private'
AS $function$
declare
  v_reg public.registros_hotel%rowtype;
  s public.etapas_hotel%rowtype;
  tgt record;
  w public.trabajos_etapa_hotel%rowtype;
  v_new_stage uuid;
  v_origin_follow uuid;
  v_origin_target uuid;
  v_existing_pickup uuid;
  v_count integer := 0;
  v_n integer;
  v_actor uuid:=auth.uid();
begin
  select * into v_reg from public.registros_hotel where id=p_registro_id;
  if not found then return 0; end if;

  perform set_config('app.audit_origin','metrogestion-r1-history-propagation',true);
  perform set_config('app.clonando_pizarra','1',true);
  perform set_config('app.reconciliando_etapas','1',true);
  set constraints etapas_hotel_posicion_activa_uq deferred;

  for s in
    select * from public.etapas_hotel
    where registro_hotel_id=p_registro_id
    order by cancelado,posicion,creado_en,id
  loop
    -- TM, LKT, EXTINTOR y trámites no admiten recogida, tampoco al propagar
    -- días históricos ya existentes.
    if s.tipo_etapa='recogida_taller'
       and s.etapa_origen_id is not null
       and app_private.etapa_manteniment_sin_recogida_alpha74(s.etapa_origen_id) then
      continue;
    end if;

    -- Si la T ya existe en otros días, sincroniza sus datos descriptivos comunes.
    update public.etapas_hotel e
    set nombre=s.nombre,
        tipo_etapa=s.tipo_etapa,
        taller_id=s.taller_id,
        centro_taller_id=s.centro_taller_id,
        lugar=s.lugar,
        observaciones=s.observaciones,
        modificado_por=coalesce(v_actor,s.modificado_por,s.creado_por)
    where e.seguimiento_id=s.seguimiento_id
      and e.id<>s.id
      and (
        e.nombre is distinct from s.nombre or
        e.tipo_etapa is distinct from s.tipo_etapa or
        e.taller_id is distinct from s.taller_id or
        e.centro_taller_id is distinct from s.centro_taller_id or
        e.lugar is distinct from s.lugar or
        e.observaciones is distinct from s.observaciones
      );
    get diagnostics v_n = row_count;
    v_count := v_count + v_n;

    -- Si es una T nueva y no existe en otro día de la misma parada, créala allí.
    for tgt in
      select r.id as registro_id,p.fecha
      from public.registros_hotel r
      join public.pizarras p on p.id=r.pizarra_id
      where r.seguimiento_id=v_reg.seguimiento_id
        and r.id<>p_registro_id
        and not r.cancelado
        and p.fecha>=coalesce(v_reg.fecha_parada,p.fecha)
        and not exists(
          select 1 from public.etapas_hotel e2
          where e2.registro_hotel_id=r.id
            and e2.seguimiento_id=s.seguimiento_id
        )
      order by p.fecha,r.id
    loop
      if not s.cancelado then
        -- Libera la posición deseada sin perder ninguna T existente.
        update public.etapas_hotel
        set posicion=posicion+1,
            modificado_por=coalesce(v_actor,modificado_por,creado_por)
        where registro_hotel_id=tgt.registro_id
          and not cancelado
          and posicion>=s.posicion;
      end if;

      v_origin_target:=null;
      if s.etapa_origen_id is not null then
        select seguimiento_id into v_origin_follow
        from public.etapas_hotel
        where id=s.etapa_origen_id;
        if v_origin_follow is not null then
          select id into v_origin_target
          from public.etapas_hotel
          where registro_hotel_id=tgt.registro_id
            and seguimiento_id=v_origin_follow
          order by creado_en,id
          limit 1;
        end if;
      end if;

      -- Una recogida se identifica por su Entrada de origen. Si el día
      -- histórico ya tiene una recogida activa para esa Entrada, se reutiliza
      -- y se alinea su seguimiento en lugar de insertar una duplicada.
      v_existing_pickup:=null;
      if not s.cancelado
         and s.tipo_etapa='recogida_taller'
         and v_origin_target is not null then
        select e.id into v_existing_pickup
        from public.etapas_hotel e
        where e.registro_hotel_id=tgt.registro_id
          and e.tipo_etapa='recogida_taller'
          and e.etapa_origen_id=v_origin_target
          and not e.cancelado
        order by e.creado_en,e.id
        limit 1;
      end if;

      if v_existing_pickup is not null then
        update public.etapas_hotel e
        set seguimiento_id=s.seguimiento_id,
            nombre=s.nombre,
            tipo_etapa=s.tipo_etapa,
            taller_id=s.taller_id,
            centro_taller_id=s.centro_taller_id,
            lugar=s.lugar,
            observaciones=s.observaciones,
            modificado_por=coalesce(v_actor,e.modificado_por,e.creado_por)
        where e.id=v_existing_pickup;
        get diagnostics v_n = row_count;
        v_count := v_count + v_n;
        continue;
      end if;

      insert into public.etapas_hotel(
        registro_hotel_id,seguimiento_id,nombre,posicion,estado,tipo_etapa,
        taller_id,centro_taller_id,lugar,fecha_prevista,fecha_inicio_real,
        fecha_fin_real,fecha_real,observaciones,cancelado,motivo_cancelacion,
        cancelado_en,cancelado_por,creado_por,modificado_por,accion_sistema,etapa_origen_id, grupo_documental_id
      ) values(
        tgt.registro_id,s.seguimiento_id,s.nombre,s.posicion,s.estado,s.tipo_etapa,
        s.taller_id,s.centro_taller_id,s.lugar,s.fecha_prevista,s.fecha_inicio_real,
        s.fecha_fin_real,s.fecha_real,s.observaciones,s.cancelado,s.motivo_cancelacion,
        s.cancelado_en,s.cancelado_por,coalesce(v_actor,s.creado_por),coalesce(v_actor,s.modificado_por,s.creado_por),s.accion_sistema,v_origin_target,s.grupo_documental_id
      ) returning id into v_new_stage;

      for w in
        select * from public.trabajos_etapa_hotel
        where etapa_hotel_id=s.id
        order by creado_en,id
      loop
        insert into public.trabajos_etapa_hotel(
          etapa_hotel_id,tipo_trabajo,categoria_tecnica,motivo_entrada,
          diagnostico_real,km_averia,expediente,descripcion,peritaje_estado,
          observaciones,cancelado,motivo_cancelacion,cancelado_en,cancelado_por,
          creado_por,modificado_por
        ) values(
          v_new_stage,w.tipo_trabajo,w.categoria_tecnica,w.motivo_entrada,
          w.diagnostico_real,w.km_averia,w.expediente,w.descripcion,w.peritaje_estado,
          w.observaciones,w.cancelado,w.motivo_cancelacion,w.cancelado_en,w.cancelado_por,
          coalesce(v_actor,w.creado_por),coalesce(v_actor,w.modificado_por,w.creado_por)
        );
      end loop;

      v_count := v_count + 1;
    end loop;
  end loop;

  perform set_config('app.reconciliando_etapas','0',true);
  perform set_config('app.clonando_pizarra','0',true);
  return v_count;
end;
$function$;


DO $guard$ BEGIN IF md5(rtrim(pg_get_functiondef('app_private.reactivar_historico_en_hotel_actual()'::regprocedure), E' \t\n\r')) <> 'f4d694224afea6d16b9b61dc9a6d2d50' THEN RAISE EXCEPTION 'Ha cambiado reactivar_historico_en_hotel_actual; revisar antes de aplicar'; END IF; END $guard$;
CREATE OR REPLACE FUNCTION app_private.reactivar_historico_en_hotel_actual()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'app_private'
AS $function$
declare
  v_pizarra_actual uuid;
  v_registro_actual uuid;
  v_actor uuid := coalesce(auth.uid(), new.modificado_por, new.creado_por);
  v_nuevo_registro uuid;
  e public.etapas_hotel%rowtype;
  t public.trabajos_etapa_hotel%rowtype;
  v_nueva_etapa uuid;
  v_pos integer := 0;
begin
  if current_setting('app.clonando_pizarra', true)='1' then
    return new;
  end if;

  if old.estado not in ('recuperado','reserva_liberada')
     or new.estado in ('recuperado','reserva_liberada','anulado')
     or new.cancelado then
    return new;
  end if;

  if not exists (
    select 1 from public.pizarras p
    where p.id = new.pizarra_id and p.estado='archivada'
  ) then
    return new;
  end if;

  select id into v_pizarra_actual
  from public.pizarras
  where estado='en_curso'
  limit 1;

  if v_pizarra_actual is null then
    return new;
  end if;

  select r.id into v_registro_actual
  from public.registros_hotel r
  where r.pizarra_id=v_pizarra_actual
    and r.seguimiento_id=new.seguimiento_id
  order by r.actualizado_en desc
  limit 1;

  perform set_config('app.request_id',coalesce(nullif(current_setting('app.request_id',true),''),'reactivar_'||replace(gen_random_uuid()::text,'-','')),true);
  perform set_config('app.audit_origin','metrogestion-r1-history-reactivation',true);

  if v_registro_actual is not null then
    update public.registros_hotel
    set estado=new.estado,
        retirado_hotel_activo=false,
        fecha_retirado_hotel=null,
        cancelado=false,
        motivo_cancelacion='',
        cancelado_en=null,
        cancelado_por=null,
        modificado_por=v_actor
    where id=v_registro_actual
      and (retirado_hotel_activo or estado in ('recuperado','reserva_liberada'));
    return new;
  end if;

  perform set_config('app.clonando_pizarra','1',true);
  perform set_config('app.reconciliando_etapas','1',true);

  insert into public.registros_hotel(
    pizarra_id,seguimiento_id,numero_parada,
    vehiculo_sustituido,matricula_sustituido,
    vehiculo_reserva,matricula_reserva,etiqueta_reserva,
    tipo_unidad,marca,tipo_motor,modelo,upc,telefono,
    prioridad,estado,lugar,fecha_parada,fecha_entrada,tipo_movimiento,
    causa,trabajos_reserva,incidencia,proximo,observaciones,
    sustitucion_temporal,motivo_sustitucion_temporal,fecha_limite_sustitucion,
    orden,retirado_hotel_activo,fecha_retirado_hotel,
    cancelado,motivo_cancelacion,cancelado_en,cancelado_por,
    creado_por,modificado_por,tipo_sustituto,trazo_marron)
  values(
    v_pizarra_actual,new.seguimiento_id,new.numero_parada,
    new.vehiculo_sustituido,new.matricula_sustituido,
    new.vehiculo_reserva,new.matricula_reserva,new.etiqueta_reserva,
    new.tipo_unidad,new.marca,new.tipo_motor,new.modelo,new.upc,new.telefono,
    new.prioridad,new.estado,new.lugar,new.fecha_parada,new.fecha_entrada,new.tipo_movimiento,
    new.causa,new.trabajos_reserva,new.incidencia,new.proximo,new.observaciones,
    new.sustitucion_temporal,new.motivo_sustitucion_temporal,new.fecha_limite_sustitucion,
    (select coalesce(max(r.orden),0)+1 from public.registros_hotel r where r.pizarra_id=v_pizarra_actual and not r.cancelado),
    false,null,false,'',null,null,
    v_actor,v_actor,new.tipo_sustituto,new.trazo_marron)
  returning id into v_nuevo_registro;

  insert into public.hotel_edicion_piloto(registro_hotel_id,activo,observaciones)
  values(v_nuevo_registro,true,'Reactivada desde Histórico')
  on conflict(registro_hotel_id) do update
    set activo=true,observaciones='Reactivada desde Histórico';

  create temp table if not exists tmp_reactivar_stage_map(
    old_id uuid primary key,
    new_id uuid not null
  ) on commit drop;
  truncate tmp_reactivar_stage_map;

  for e in
    select * from public.etapas_hotel
    where registro_hotel_id=new.id
    order by cancelado, posicion, creado_en, id
  loop
    if not e.cancelado then
      v_pos := v_pos + 1;
    end if;

    insert into public.etapas_hotel(
      registro_hotel_id,seguimiento_id,nombre,posicion,estado,tipo_etapa,
      taller_id,centro_taller_id,lugar,fecha_prevista,fecha_inicio_real,
      fecha_fin_real,fecha_real,observaciones,cancelado,motivo_cancelacion,
      cancelado_en,cancelado_por,creado_por,modificado_por,accion_sistema,etapa_origen_id,grupo_documental_id)
    values(
      v_nuevo_registro,e.seguimiento_id,e.nombre,
      case when e.cancelado then e.posicion else v_pos end,
      e.estado,e.tipo_etapa,
      e.taller_id,e.centro_taller_id,e.lugar,e.fecha_prevista,e.fecha_inicio_real,
      e.fecha_fin_real,e.fecha_real,e.observaciones,e.cancelado,e.motivo_cancelacion,
      e.cancelado_en,e.cancelado_por,v_actor,v_actor,e.accion_sistema,null,e.grupo_documental_id)
    returning id into v_nueva_etapa;

    insert into tmp_reactivar_stage_map(old_id,new_id) values(e.id,v_nueva_etapa);

    for t in
      select * from public.trabajos_etapa_hotel
      where etapa_hotel_id=e.id
      order by creado_en,id
    loop
      insert into public.trabajos_etapa_hotel(
        etapa_hotel_id,tipo_trabajo,categoria_tecnica,motivo_entrada,
        diagnostico_real,km_averia,expediente,descripcion,peritaje_estado,
        observaciones,cancelado,motivo_cancelacion,cancelado_en,cancelado_por,
        creado_por,modificado_por)
      values(
        v_nueva_etapa,t.tipo_trabajo,t.categoria_tecnica,t.motivo_entrada,
        t.diagnostico_real,t.km_averia,t.expediente,t.descripcion,t.peritaje_estado,
        t.observaciones,t.cancelado,t.motivo_cancelacion,t.cancelado_en,t.cancelado_por,
        v_actor,v_actor);
    end loop;
  end loop;

  update public.etapas_hotel n
  set etapa_origen_id = m_origin.new_id
  from public.etapas_hotel e_old
  join tmp_reactivar_stage_map m on m.old_id=e_old.id
  join tmp_reactivar_stage_map m_origin on m_origin.old_id=e_old.etapa_origen_id
  where n.id=m.new_id;

  perform set_config('app.reconciliando_etapas','0',true);
  perform set_config('app.clonando_pizarra','0',true);
  return new;
end;
$function$;


DO $guard$ BEGIN IF md5(rtrim(pg_get_functiondef('app_private.asegurar_reactivacion_historica(uuid)'::regprocedure), E' \t\n\r')) <> '0d886983302940c91625cb8ae53eff54' THEN RAISE EXCEPTION 'Ha cambiado asegurar_reactivacion_historica; revisar antes de aplicar'; END IF; END $guard$;
CREATE OR REPLACE FUNCTION app_private.asegurar_reactivacion_historica(p_registro_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'app_private'
AS $function$
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
      cancelado_en, cancelado_por, creado_por, modificado_por, accion_sistema, etapa_origen_id, grupo_documental_id
    ) values (
      v_new_record, e.seguimiento_id, e.nombre,
      case when e.cancelado then e.posicion else v_pos end,
      e.estado, e.estado_catalogo_codigo, e.tipo_etapa,
      e.taller_id, e.centro_taller_id, e.lugar, e.fecha_prevista, e.fecha_inicio_real,
      e.fecha_fin_real, e.fecha_real, e.observaciones, e.cancelado, e.motivo_cancelacion,
      e.cancelado_en, e.cancelado_por, v_actor, v_actor, e.accion_sistema, null, e.grupo_documental_id
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


DO $guard$ BEGIN IF md5(rtrim(pg_get_functiondef('app_private.manteniment_importar_trabajos_alpha74_base(jsonb)'::regprocedure), E' \t\n\r')) <> '498e198386b540e5a13379e837082c91' THEN RAISE EXCEPTION 'Ha cambiado manteniment_importar_trabajos_alpha74_base; revisar antes de aplicar'; END IF; END $guard$;
CREATE OR REPLACE FUNCTION app_private.manteniment_importar_trabajos_alpha74_base(p_trabajos jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'app_private'
AS $function$
declare
  v_group record;
  v_follow record;
  v_visit app_private.manteniment_t_visitas%rowtype;
  v_work app_private.manteniment_t_trabajos%rowtype;
  v_current_work app_private.manteniment_t_trabajos%rowtype;
  v_visit_stage record;
  v_stage_id uuid;
  v_job_id uuid;
  v_fecha_cierre_grupo date;
  v_entry_id uuid;
  v_pickup_id uuid;
  v_legacy_entry_count integer := 0;
  v_legacy_entry_group uuid;
  v_legacy_pickup_group uuid;
  v_pickup_date date;
  v_taller_id uuid;
  v_centro_id uuid;
  v_tipo_codigo text;
  v_modalidad text;
  v_clave_visita text;
  v_clave_trabajo text;
  v_pos integer;
  v_actor uuid;
  v_raw_count integer := 0;
  v_candidate_count integer := 0;
  v_created_stages integer := 0;
  v_created_works integer := 0;
  v_ambiguous integer := 0;
begin
  if p_trabajos is null then
    return jsonb_build_object('recibidos', 0, 'seleccionados', 0, 't_creadas', 0, 'trabajos_creados', 0, 'ambiguos', 0);
  end if;
  if jsonb_typeof(p_trabajos) <> 'array' or jsonb_array_length(p_trabajos) > 10000 then
    raise exception 'El bloque de necesidades de MANTENIMENT no tiene un formato válido';
  end if;

  create temp table if not exists tmp_alpha74_manteniment_raw (
    fila integer,
    trabajo_sync_id uuid,
    clave_fila text,
    dfm text,
    matricula text,
    numero_parada text,
    taller text,
    taller_norm text,
    tipo_trabajo text,
    tipo_norm text,
    designacion text,
    designacion_norm text,
    fecha_necesidad date,
    fecha_realizada date,
    fecha_recogida date,
    pendiente_fondo_blanco boolean,
    prioridad_fondo_amarillo boolean
  ) on commit drop;
  truncate tmp_alpha74_manteniment_raw;

  if exists (
    select 1
    from jsonb_array_elements(p_trabajos) item(value)
    where coalesce(item.value->>'fila', '') !~ '^[0-9]{1,6}$'
       or (coalesce(item.value->>'trabajo_sync_id', '') <> ''
           and item.value->>'trabajo_sync_id' !~* '^[0-9a-f-]{36}$')
       or coalesce(item.value->>'fecha_necesidad', '') !~ '^\d{4}-\d{2}-\d{2}$'
       or (coalesce(item.value->>'fecha_realizada', '') <> ''
           and item.value->>'fecha_realizada' !~ '^\d{4}-\d{2}-\d{2}$')
       or (coalesce(item.value->>'fecha_recogida', '') <> ''
           and item.value->>'fecha_recogida' !~ '^\d{4}-\d{2}-\d{2}$')
       or coalesce(item.value->>'pendiente_fondo_blanco', 'false') not in ('true', 'false')
       or coalesce(item.value->>'prioridad_fondo_amarillo', 'false') not in ('true', 'false')
  ) then
    raise exception 'Una necesidad de MANTENIMENT contiene fila, identificador o fecha no válidos';
  end if;

  insert into tmp_alpha74_manteniment_raw(
    fila, trabajo_sync_id, clave_fila, dfm, matricula, numero_parada,
    taller, taller_norm, tipo_trabajo, tipo_norm, designacion,
    designacion_norm, fecha_necesidad, fecha_realizada, fecha_recogida,
    pendiente_fondo_blanco, prioridad_fondo_amarillo
  )
  select
    (item.value->>'fila')::integer,
    nullif(item.value->>'trabajo_sync_id', '')::uuid,
    left(coalesce(item.value->>'clave_fila', ''), 1000),
    regexp_replace(upper(btrim(coalesce(item.value->>'dfm', ''))), '[[:space:]]+', '', 'g'),
    upper(btrim(coalesce(item.value->>'matricula', ''))),
    regexp_replace(upper(btrim(coalesce(item.value->>'numero_parada', ''))), '^PA[- ]*', ''),
    left(btrim(coalesce(item.value->>'taller', '')), 160),
    regexp_replace(upper(btrim(coalesce(item.value->>'taller', ''))), '[[:space:]]+', ' ', 'g'),
    left(btrim(coalesce(item.value->>'tipo_trabajo', '')), 160),
    regexp_replace(upper(btrim(coalesce(item.value->>'tipo_trabajo', ''))), '[[:space:]]+', ' ', 'g'),
    left(btrim(coalesce(item.value->>'designacion', '')), 160),
    regexp_replace(upper(btrim(coalesce(item.value->>'designacion', ''))), '[[:space:]]+', ' ', 'g'),
    (item.value->>'fecha_necesidad')::date,
    nullif(item.value->>'fecha_realizada', '')::date,
    nullif(item.value->>'fecha_recogida', '')::date,
    coalesce((item.value->>'pendiente_fondo_blanco')::boolean, false),
    coalesce((item.value->>'prioridad_fondo_amarillo')::boolean, false)
  from jsonb_array_elements(p_trabajos) item(value);

  select count(*) into v_raw_count from tmp_alpha74_manteniment_raw;

  -- Una nota técnica nunca puede trasladar una T a otro vehículo. Ante cualquier
  -- discrepancia se aborta el lote completo sin crear ni modificar etapas.
  if exists (
    select 1
    from tmp_alpha74_manteniment_raw x
    join app_private.manteniment_t_trabajos w on w.sync_id = x.trabajo_sync_id
    join lateral (
      select regexp_replace(upper(btrim(r.vehiculo_sustituido)), '[[:space:]]+', '', 'g') as dfm
      from public.registros_hotel r
      join public.pizarras p on p.id = r.pizarra_id
      where r.seguimiento_id = w.seguimiento_id
      order by (p.estado = 'en_curso') desc, p.fecha desc, r.actualizado_en desc, r.id desc
      limit 1
    ) ficha on true
    where x.dfm is distinct from ficha.dfm
  ) then
    raise exception 'Una necesidad vinculada no coincide con el vehículo de su seguimiento';
  end if;

  for v_follow in
    select distinct r.seguimiento_id
    from public.registros_hotel r
    join tmp_alpha74_manteniment_raw x on x.dfm =
      regexp_replace(upper(btrim(r.vehiculo_sustituido)), '[[:space:]]+', '', 'g')
    order by r.seguimiento_id
  loop
    perform pg_advisory_xact_lock(hashtextextended('manteniment-visita:' || v_follow.seguimiento_id::text, 0));
  end loop;

  create temp table tmp_alpha74_manteniment_candidates on commit drop as
  with ranked_active as (
    select
      r.id as registro_id,
      r.seguimiento_id,
      regexp_replace(upper(btrim(r.vehiculo_sustituido)), '[[:space:]]+', '', 'g') as dfm,
      regexp_replace(upper(btrim(r.numero_parada)), '^PA[- ]*', '') as numero_parada,
      min((r.creado_en at time zone 'Europe/Madrid')::date)
        over (partition by r.seguimiento_id) as fecha_generacion,
      coalesce(r.modificado_por, r.creado_por) as actor_id,
      row_number() over (
        partition by r.seguimiento_id
        order by (p.estado = 'en_curso') desc, p.fecha desc, r.actualizado_en desc, r.id desc
      ) as rn
    from public.registros_hotel r
    join public.pizarras p on p.id = r.pizarra_id
    where not r.cancelado
      and not r.retirado_hotel_activo
      and r.estado not in ('recuperado', 'reserva_liberada', 'anulado')
      and btrim(coalesce(r.numero_parada, '')) <> ''
  ),
  active as (
    select * from ranked_active where rn = 1
  ),
  matched as (
    select
      x.*,
      a.registro_id,
      a.seguimiento_id,
      a.numero_parada as numero_parada_activa,
      a.fecha_generacion,
      a.actor_id,
      coalesce(sync_work.id, key_work.id) as existing_work_id,
      count(*) over (partition by x.fila, x.clave_fila) as match_count
    from tmp_alpha74_manteniment_raw x
    join active a on a.dfm = x.dfm
      and (x.numero_parada = '' or x.numero_parada = a.numero_parada)
    left join app_private.manteniment_t_trabajos sync_work
      on sync_work.sync_id = x.trabajo_sync_id
     and sync_work.seguimiento_id = a.seguimiento_id
    left join app_private.manteniment_t_trabajos key_work
      on key_work.seguimiento_id = a.seguimiento_id
     and key_work.clave_trabajo = 'F:' || x.taller_norm || '|H:' || x.designacion_norm
    where x.dfm <> ''
      and x.designacion_norm <> ''
      and x.designacion_norm not in ('ALTA', 'BAJA', 'PARADA', 'ANULADA', 'FIN', 'ARCHIVO', 'CARPETA', 'PRIMITIVA')
      and (
        sync_work.id is not null
        or key_work.id is not null
        or x.prioridad_fondo_amarillo
        or x.fecha_necesidad <= (
          (clock_timestamp() at time zone 'Europe/Madrid')::date + interval '1 month'
        )::date
      )
      and x.pendiente_fondo_blanco
      -- Las realizadas solo vuelven a entrar una vez si su fecha de realización
      -- o recogida todavía no ha llegado a la vinculación. Después se ignoran.
      and (
        x.fecha_realizada is null
        or (x.designacion_norm in ('REPUESTOS', 'ACT', 'LINDEP', 'CV') and x.fecha_recogida is null)
        or (
          sync_work.id is not null
          and (
            sync_work.fecha_realizada is distinct from x.fecha_realizada
            or sync_work.fecha_recogida is distinct from x.fecha_recogida
          )
        )
        or (
          sync_work.id is null
          and key_work.id is not null
          and (
            key_work.fecha_realizada is distinct from x.fecha_realizada
            or key_work.fecha_recogida is distinct from x.fecha_recogida
          )
        )
      )
  )
  select * from matched where match_count = 1;

  with ranked_active as (
    select r.seguimiento_id,
      regexp_replace(upper(btrim(r.vehiculo_sustituido)), '[[:space:]]+', '', 'g') as dfm,
      regexp_replace(upper(btrim(r.numero_parada)), '^PA[- ]*', '') as numero_parada,
      row_number() over (partition by r.seguimiento_id order by (p.estado='en_curso') desc,p.fecha desc,r.actualizado_en desc,r.id desc) rn
    from public.registros_hotel r join public.pizarras p on p.id=r.pizarra_id
    where not r.cancelado and not r.retirado_hotel_activo
      and r.estado not in ('recuperado','reserva_liberada','anulado')
      and btrim(coalesce(r.numero_parada,''))<>''
  ), matches as (
    select x.fila,x.clave_fila,count(*) as n
    from tmp_alpha74_manteniment_raw x
    join ranked_active a on a.rn=1 and a.dfm=x.dfm
      and (x.numero_parada='' or x.numero_parada=a.numero_parada)
    left join app_private.manteniment_t_trabajos sync_work
      on sync_work.sync_id=x.trabajo_sync_id
     and sync_work.seguimiento_id=a.seguimiento_id
    left join app_private.manteniment_t_trabajos key_work
      on key_work.seguimiento_id=a.seguimiento_id
     and key_work.clave_trabajo='F:' || x.taller_norm || '|H:' || x.designacion_norm
    where x.pendiente_fondo_blanco
    group by x.fila,x.clave_fila
  )
  select count(*) into v_ambiguous from matches where n>1;

  select count(*) into v_candidate_count from tmp_alpha74_manteniment_candidates;

  -- Primero se fijan los grupos lógicos. F manda sobre G: si hay taller en F,
  -- el par F + H identifica un trabajo dentro de una única visita de taller.
  for v_group in
    select
      c.seguimiento_id,
      c.registro_id,
      c.numero_parada_activa,
      c.existing_work_id,
      'F:' || c.taller_norm || '|H:' || c.designacion_norm as clave_trabajo,
      min(c.taller) filter (where c.taller <> '') as taller,
      min(c.taller_norm) as taller_norm,
      min(c.tipo_trabajo) filter (where c.tipo_trabajo <> '') as tipo_trabajo,
      min(c.tipo_norm) filter (where c.tipo_norm <> '') as tipo_norm,
      min(c.designacion) as designacion,
      min(c.designacion_norm) as designacion_norm,
      min(c.fecha_necesidad) as fecha_necesidad,
      max(c.fecha_realizada) as fecha_realizada,
      max(c.fecha_recogida) as fecha_recogida,
      jsonb_agg(
        jsonb_build_object(
          'fila', c.fila,
          'clave_fila', c.clave_fila
        ) order by c.fila
      ) as fuentes
    from tmp_alpha74_manteniment_candidates c
    group by c.seguimiento_id, c.registro_id, c.numero_parada_activa,
      c.existing_work_id, c.taller_norm, c.designacion_norm
    order by min(c.fecha_necesidad), min(c.fila)
  loop
    v_clave_trabajo := v_group.clave_trabajo;
    v_modalidad := case
      when v_group.designacion_norm = 'REPUESTOS' then 'gestion'
      when v_group.designacion_norm = 'LKT' and translate(coalesce(v_group.tipo_norm, ''), 'Ó', 'O') like '%GESTION%' then 'gestion'
      when v_group.designacion_norm in ('LKT', 'EXTINTOR', 'LINDEP') then 'tramite'
      when translate(coalesce(v_group.tipo_norm, ''), 'Á', 'A') like '%TRAMITE%' then 'tramite'
      when translate(coalesce(v_group.tipo_norm, ''), 'Ó', 'O') like '%GESTION%' then 'gestion'
      when v_group.taller_norm = 'TM' then 'entrada_sin_recogida'
      when coalesce(v_group.taller_norm, '') <> '' then 'taller'
      else 'pendiente_taller'
    end;
    v_clave_visita := case
      when coalesce(v_group.taller_norm, '') <> '' then 'LUGAR|F:' || v_group.taller_norm
      else 'PENDIENTE|' || v_clave_trabajo
    end;

    -- Una nota METROGESTION_T identifica de forma inmutable la visita histórica.
    -- Si después se simplifica F (p. ej. AUTODIS PDF6 -> AUTODIS), no se mueve
    -- el trabajo a otra entrada ni se mezclan visitas ya realizadas.
    v_current_work := null;
    v_visit := null;
    if v_group.existing_work_id is not null then
      select * into v_current_work
      from app_private.manteniment_t_trabajos
      where id = v_group.existing_work_id
        and seguimiento_id = v_group.seguimiento_id
      for update;
    end if;

    if v_current_work.id is not null then
      select * into v_visit
      from app_private.manteniment_t_visitas
      where id = v_current_work.visita_id
        and seguimiento_id = v_group.seguimiento_id
      for update;
      if not found then
        raise exception 'Una necesidad vinculada no conserva una visita válida';
      end if;
    else
      select * into v_visit
      from app_private.manteniment_t_visitas
      where seguimiento_id = v_group.seguimiento_id
        and (clave_visita = v_clave_visita
          or (coalesce(v_group.taller_norm, '') <> '' and
            regexp_replace(upper(btrim(taller)), '[[:space:]]+', ' ', 'g') = v_group.taller_norm))
      order by (clave_visita = v_clave_visita) desc, creado_en, id
      limit 1 for update;
    end if;

    if v_current_work.id is not null and coalesce(v_group.taller_norm, '') = '' then
      v_modalidad := v_visit.modalidad;
    elsif v_visit.modalidad in ('taller', 'entrada_sin_recogida') then
      v_modalidad := v_visit.modalidad;
    end if;
    if coalesce(v_group.taller_norm, '') <> '' and exists (
      select 1 from tmp_alpha74_manteniment_candidates c
      where c.seguimiento_id = v_group.seguimiento_id and c.taller_norm = v_group.taller_norm
        and c.designacion_norm not in ('REPUESTOS', 'LKT', 'EXTINTOR', 'LINDEP')
        and translate(c.tipo_norm, 'ÁÉÍÓÚ', 'AEIOU') not like '%TRAMITE%'
        and translate(c.tipo_norm, 'ÁÉÍÓÚ', 'AEIOU') not like '%GESTION%'
    ) then
      v_modalidad := case when v_group.taller_norm = 'TM' then 'entrada_sin_recogida' else 'taller' end;
    end if;

    -- Cuando un trabajo se agrupó manualmente en otra entrada, su enlace
    -- real manda sobre los grupos antiguos de la visita, incluso si ya se realizó.
    if v_current_work.trabajo_hotel_id is not null
       and v_visit.id is not null
       then
      select e.id, e.grupo_documental_id
        into v_entry_id, v_legacy_entry_group
      from public.trabajos_etapa_hotel t
      join public.etapas_hotel e on e.id = app_private.manteniment_etapa_actual(
        v_group.seguimiento_id, t.etapa_hotel_id)
      where t.id = v_current_work.trabajo_hotel_id;
      if v_entry_id is not null then
        v_legacy_pickup_group := null;
        select e.grupo_documental_id into v_legacy_pickup_group
        from public.etapas_hotel e
        where e.registro_hotel_id = v_group.registro_id
          and e.tipo_etapa = 'recogida_taller'
          and e.etapa_origen_id = v_entry_id
        order by e.cancelado, e.posicion, e.creado_en, e.id
        limit 1;
        update app_private.manteniment_t_visitas
        set grupo_entrada_id = v_legacy_entry_group,
            grupo_recogida_id = case when v_modalidad = 'taller'
              then coalesce(v_legacy_pickup_group, grupo_recogida_id) else null end
        where id = v_visit.id
        returning * into v_visit;
      end if;
    end if;

    if v_visit.id is null then
      v_entry_id := null;
      v_pickup_id := null;
      v_legacy_entry_group := null;
      v_legacy_pickup_group := null;

      -- Las fichas creadas antes de Alpha74 ya pueden tener la entrada y la
      -- recogida. Solo se reutiliza una T aún no realizada cuyo nombre o lugar
      -- normalizado coincide exactamente con F. AUTODIS no coincide con
      -- AUTODIS PDF1/PDF3: son visitas distintas.
      if coalesce(v_group.taller_norm, '') <> '' then
        select count(*) into v_legacy_entry_count
        from public.etapas_hotel e
        where e.registro_hotel_id = v_group.registro_id
          and not e.cancelado
          and e.tipo_etapa in ('entrada_taller', 'otro')
            and coalesce(e.accion_sistema, '') = ''
          and e.estado <> 'realizada'
          and e.fecha_real is null
          and e.fecha_fin_real is null
          and (
            regexp_replace(upper(btrim(coalesce(e.lugar, ''))), '[[:space:]]+', ' ', 'g')
              = v_group.taller_norm
            or regexp_replace(
                 regexp_replace(upper(btrim(coalesce(e.nombre, ''))), '[[:space:]]+', ' ', 'g'),
                 '^ENTRADA( EN)?( TALLER)?[[:space:]·:.-]*', '', 'g'
               ) = v_group.taller_norm
          );

        if v_legacy_entry_count > 1 then
          raise exception 'La ficha contiene varias entradas compatibles con el taller %; no se ha modificado ninguna T',
            v_group.taller;
        end if;

        if v_legacy_entry_count = 1 then
          select e.id, e.grupo_documental_id
          into v_entry_id, v_legacy_entry_group
          from public.etapas_hotel e
          where e.registro_hotel_id = v_group.registro_id
            and not e.cancelado
            and e.tipo_etapa in ('entrada_taller', 'otro')
            and coalesce(e.accion_sistema, '') = ''
            and e.estado <> 'realizada'
            and e.fecha_real is null
            and e.fecha_fin_real is null
            and (
              regexp_replace(upper(btrim(coalesce(e.lugar, ''))), '[[:space:]]+', ' ', 'g')
                = v_group.taller_norm
              or regexp_replace(
                   regexp_replace(upper(btrim(coalesce(e.nombre, ''))), '[[:space:]]+', ' ', 'g'),
                   '^ENTRADA( EN)?( TALLER)?[[:space:]·:.-]*', '', 'g'
                 ) = v_group.taller_norm
            )
          limit 1;

          select e.id, e.grupo_documental_id
          into v_pickup_id, v_legacy_pickup_group
          from public.etapas_hotel e
          where e.registro_hotel_id = v_group.registro_id
            and not e.cancelado
            and e.tipo_etapa = 'recogida_taller'
            and e.etapa_origen_id = v_entry_id
          order by e.posicion, e.creado_en
          limit 1;
        end if;
      end if;

      insert into app_private.manteniment_t_visitas(
        seguimiento_id, clave_visita, modalidad, taller, fecha_necesidad,
        grupo_entrada_id, grupo_recogida_id
      ) values (
        v_group.seguimiento_id, v_clave_visita, v_modalidad,
        coalesce(v_group.taller, ''), v_group.fecha_necesidad,
        case when v_modalidad in ('taller', 'entrada_sin_recogida', 'tramite', 'gestion')
          then coalesce(v_legacy_entry_group, gen_random_uuid()) end,
        case when v_modalidad = 'taller'
          then coalesce(v_legacy_pickup_group, gen_random_uuid()) end
      ) returning * into v_visit;
    else
      -- Un LKT/LINDEP ya incorporado a una visita conserva sus trabajos y
      -- documentos. La regla clasifica las nuevas necesidades, no traslada
      -- las visitas históricas ni elimina su entrada/recogida compartida.
      if v_current_work.id is not null
         and v_group.designacion_norm in ('LKT', 'LINDEP')
         and v_visit.modalidad in ('taller', 'entrada_sin_recogida') then
        v_modalidad := v_visit.modalidad;
      end if;
      -- Una necesidad puede nacer sin F y recibir el taller después. En ese
      -- cambio se adoptan los grupos de la Entrada/Recogida ya existentes; si
      -- no existen, se crean identificadores una sola vez y quedan estables.
      v_entry_id := null;
      v_legacy_entry_group := null;
      v_legacy_pickup_group := null;
      if v_visit.grupo_entrada_id is null
         and v_modalidad in ('taller', 'entrada_sin_recogida') then
        select e.id, e.grupo_documental_id
          into v_entry_id, v_legacy_entry_group
        from public.etapas_hotel e
        where e.registro_hotel_id = v_group.registro_id
          and not e.cancelado
          and e.tipo_etapa = 'entrada_taller'
          and e.estado <> 'realizada'
          and e.fecha_real is null
          and e.fecha_fin_real is null
          and (
            regexp_replace(upper(btrim(coalesce(e.lugar, ''))), '[[:space:]]+', ' ', 'g')
              = v_group.taller_norm
            or regexp_replace(
                 regexp_replace(upper(btrim(coalesce(e.nombre, ''))), '[[:space:]]+', ' ', 'g'),
                 '^ENTRADA( EN)?( TALLER)?[[:space:]·:.-]*', '', 'g'
               ) = v_group.taller_norm
          )
        order by e.posicion, e.creado_en, e.id
        limit 1;

        if v_entry_id is not null then
          select e.grupo_documental_id
            into v_legacy_pickup_group
          from public.etapas_hotel e
          where e.registro_hotel_id = v_group.registro_id
            and not e.cancelado
            and e.tipo_etapa = 'recogida_taller'
            and e.etapa_origen_id = v_entry_id
          order by e.posicion, e.creado_en, e.id
          limit 1;
        end if;
      end if;

      update app_private.manteniment_t_visitas
      set modalidad = v_modalidad,
          taller = coalesce(v_group.taller, taller),
          fecha_necesidad = least(fecha_necesidad, v_group.fecha_necesidad),
          grupo_entrada_id = case
            when v_modalidad in ('taller', 'entrada_sin_recogida', 'tramite', 'gestion')
              then coalesce(grupo_entrada_id, v_legacy_entry_group, gen_random_uuid())
            else null
          end,
          grupo_recogida_id = case
            when v_modalidad = 'taller'
              then coalesce(grupo_recogida_id, v_legacy_pickup_group, gen_random_uuid())
            else null
          end,
          actualizado_en = clock_timestamp()
      where id = v_visit.id
      returning * into v_visit;
    end if;

    -- En trámites/gestiones del mismo lugar, conservar la T donde ya se
    -- agruparon sus trabajos. El grupo sirve también para nuevas H de la visita.
    if v_modalidad in ('tramite', 'gestion') and coalesce(v_group.taller_norm, '') <> '' then
      v_legacy_entry_group := null;
      if v_current_work.trabajo_hotel_id is not null then
        select e.grupo_documental_id into v_legacy_entry_group
        from public.trabajos_etapa_hotel t
        join public.etapas_hotel e on e.id = app_private.manteniment_etapa_actual(
          v_group.seguimiento_id, t.etapa_hotel_id)
        where t.id = v_current_work.trabajo_hotel_id;
      end if;
      update app_private.manteniment_t_visitas
      set grupo_entrada_id = coalesce(v_legacy_entry_group, grupo_entrada_id, gen_random_uuid())
      where id = v_visit.id returning * into v_visit;
    end if;

    if v_current_work.id is null then
      select * into v_current_work
      from app_private.manteniment_t_trabajos
      where seguimiento_id = v_group.seguimiento_id and clave_trabajo = v_clave_trabajo
      for update;
    end if;

    if v_current_work.id is null then
      insert into app_private.manteniment_t_trabajos(
        seguimiento_id, visita_id, clave_trabajo, taller, tipo_trabajo,
        designacion, fecha_necesidad, fecha_realizada, fecha_recogida, fuentes
      ) values (
        v_group.seguimiento_id, v_visit.id, v_clave_trabajo,
        coalesce(v_group.taller, ''), coalesce(v_group.tipo_trabajo, ''),
        v_group.designacion, v_group.fecha_necesidad, v_group.fecha_realizada,
        v_group.fecha_recogida, v_group.fuentes
      ) returning * into v_current_work;
    else
      -- La identidad y la visita del trabajo se conservan. MANTENIMENT sigue
      -- gobernando sus fechas y las filas de origen sin reescribir el histórico.
      update app_private.manteniment_t_trabajos
      set taller = coalesce(v_group.taller, taller),
          clave_trabajo = case when coalesce(v_group.taller_norm, '') = '' then clave_trabajo
            when not exists (select 1 from app_private.manteniment_t_trabajos otro
              where otro.seguimiento_id = v_group.seguimiento_id and otro.clave_trabajo = v_clave_trabajo
                and otro.id <> v_current_work.id) then v_clave_trabajo else clave_trabajo end,
          fecha_necesidad = least(fecha_necesidad, v_group.fecha_necesidad),
          fecha_realizada = v_group.fecha_realizada,
          fecha_recogida = v_group.fecha_recogida,
          fuentes = v_group.fuentes,
          actualizado_en = clock_timestamp()
      where id = v_current_work.id;
    end if;
    if v_visit.grupo_entrada_id is not null then
      update app_private.manteniment_t_trabajos
      set grupo_etapa_id = v_visit.grupo_entrada_id
      where id = v_current_work.id and grupo_etapa_id is distinct from v_visit.grupo_entrada_id;
    end if;
  end loop;

  -- Se materializan únicamente las T que todavía no existen. Una reprogramación
  -- manual conserva posicion y fecha_prevista porque esta función no las actualiza.
  for v_follow in
    select distinct c.seguimiento_id, c.registro_id, c.actor_id
    from tmp_alpha74_manteniment_candidates c
  loop
    v_actor := v_follow.actor_id;
    perform set_config('app.reconciliando_etapas', '1', true);
    perform set_config('app.audit_origin', 'manteniment-alpha74-predictivo', true);
    set constraints etapas_hotel_posicion_activa_uq deferred;

    update public.etapas_hotel
    set posicion = posicion + 10000,
        modificado_por = coalesce(v_actor, modificado_por)
    where registro_hotel_id = v_follow.registro_id
      and not cancelado
      and accion_sistema = 'recuperar_y_liberar';

    select coalesce(max(e.posicion), 0) into v_pos
    from public.etapas_hotel e
    where e.registro_hotel_id = v_follow.registro_id
      and not e.cancelado
      and e.accion_sistema is distinct from 'recuperar_y_liberar';

    for v_visit_stage in
      select v.*
      from app_private.manteniment_t_visitas v
      where v.seguimiento_id = v_follow.seguimiento_id
      order by v.fecha_necesidad, v.creado_en, v.id
    loop
      v_entry_id := null;
      v_pickup_id := null;
      v_taller_id := null;
      v_centro_id := null;

      update public.etapas_hotel
      set lugar = v_visit_stage.taller,
          nombre = case
            when nombre like 'Entrada %' and tipo_etapa='entrada_taller' then 'Entrada ' || v_visit_stage.taller
            when nombre like 'Recogida %' and tipo_etapa='recogida_taller' then 'Recogida ' || v_visit_stage.taller
            else nombre end
      where registro_hotel_id=v_follow.registro_id
        and grupo_documental_id in (v_visit_stage.grupo_entrada_id,v_visit_stage.grupo_recogida_id)
        and not cancelado and estado <> 'realizada'
        and fecha_real is null and fecha_inicio_real is null and fecha_fin_real is null
        and btrim(v_visit_stage.taller) <> '' and lugar is distinct from v_visit_stage.taller
        and (observaciones like 'Generada desde las necesidades pendientes de MANTENIMENT.%'
          or observaciones like 'Necesidad detectada en MANTENIMENT%');

      if v_visit_stage.modalidad in ('taller', 'entrada_sin_recogida') then
        update public.etapas_hotel
        set tipo_etapa = 'entrada_taller'
        where registro_hotel_id = v_follow.registro_id
          and grupo_documental_id = v_visit_stage.grupo_entrada_id
          and tipo_etapa = 'otro' and not cancelado
          and estado <> 'realizada' and fecha_real is null and fecha_fin_real is null;
      end if;

      if v_visit_stage.modalidad in ('taller', 'entrada_sin_recogida') then
        select t.id into v_taller_id
        from public.talleres t
        where t.activo
          and (
            regexp_replace(upper(btrim(t.nombre)), '[[:space:]]+', ' ', 'g') = regexp_replace(upper(btrim(v_visit_stage.taller)), '[[:space:]]+', ' ', 'g')
            or regexp_replace(upper(btrim(v_visit_stage.taller)), '[[:space:]]+', ' ', 'g') like regexp_replace(upper(btrim(t.nombre)), '[[:space:]]+', ' ', 'g') || ' %'
          )
        order by char_length(t.nombre) desc, t.creado_en
        limit 1;

        if v_taller_id is not null then
          select c.id into v_centro_id
          from public.centros_taller c
          where c.activo and c.taller_id = v_taller_id
            and regexp_replace(upper(btrim(v_visit_stage.taller)), '[[:space:]]+', ' ', 'g')
                like '%' || regexp_replace(upper(btrim(c.nombre)), '[[:space:]]+', ' ', 'g') || '%'
          order by char_length(c.nombre) desc, c.creado_en
          limit 1;
        end if;

        select e.id into v_entry_id
        from public.etapas_hotel e
        where e.registro_hotel_id = v_follow.registro_id
          and e.grupo_documental_id = v_visit_stage.grupo_entrada_id
        order by e.cancelado, e.creado_en
        limit 1;
        if v_entry_id is null then
          v_pos := v_pos + 1;
          insert into public.etapas_hotel(
            registro_hotel_id, seguimiento_id, grupo_documental_id, nombre,
            posicion, estado, estado_catalogo_codigo, tipo_etapa, taller_id,
            centro_taller_id, lugar, fecha_prevista, observaciones, cancelado,
            creado_por, modificado_por
          ) values (
            v_follow.registro_id, gen_random_uuid(), v_visit_stage.grupo_entrada_id,
            'Entrada ' || v_visit_stage.taller, v_pos, 'pendiente', 'pendiente',
            'entrada_taller', v_taller_id, v_centro_id, v_visit_stage.taller,
            null, 'Generada desde las necesidades pendientes de MANTENIMENT.',
            false, v_actor, v_actor
          ) returning id into v_entry_id;
          v_created_stages := v_created_stages + 1;
        end if;
      end if;

      for v_work in
        select * from app_private.manteniment_t_trabajos w
        where w.visita_id = v_visit_stage.id
        order by w.fecha_necesidad, w.creado_en, w.id
      loop
        -- En una visita de taller, F identifica una única T operativa de entrada.
        -- Cada H diferente es un trabajo dentro de esa misma T, nunca otra T.
        if v_visit_stage.modalidad in ('taller', 'entrada_sin_recogida') then
          v_stage_id := v_entry_id;
        else
          -- Solo se cierra una T compartida cuando todas sus necesidades
          -- tienen una fecha de cierre. La fecha conjunta es la última.
          select case when bool_and(app_private.manteniment_fecha_cierre_necesidad(
              w.designacion, w.fecha_realizada, w.fecha_recogida) is not null)
            then max(app_private.manteniment_fecha_cierre_necesidad(
              w.designacion, w.fecha_realizada, w.fecha_recogida)) end
            into v_fecha_cierre_grupo
          from app_private.manteniment_t_trabajos w
          where w.seguimiento_id = v_work.seguimiento_id
            and w.grupo_etapa_id = v_work.grupo_etapa_id;
          select e.id into v_stage_id
          from public.etapas_hotel e
          where e.registro_hotel_id = v_follow.registro_id
            and e.grupo_documental_id = v_work.grupo_etapa_id
          order by e.cancelado, e.creado_en
          limit 1;

          if v_stage_id is null then
            v_pos := v_pos + 1;
            insert into public.etapas_hotel(
              registro_hotel_id, seguimiento_id, grupo_documental_id, nombre,
              posicion, estado, estado_catalogo_codigo, tipo_etapa, lugar,
              fecha_prevista, fecha_fin_real, fecha_real, observaciones,
              cancelado, creado_por, modificado_por
            ) values (
              v_follow.registro_id, gen_random_uuid(), v_work.grupo_etapa_id,
              case v_visit_stage.modalidad
                when 'gestion' then 'Gestión · ' || (select string_agg(distinct w.designacion, ' + ' order by w.designacion) from app_private.manteniment_t_trabajos w where w.seguimiento_id=v_work.seguimiento_id and w.grupo_etapa_id=v_work.grupo_etapa_id)
                when 'tramite' then 'Trámite · ' || (select string_agg(distinct w.designacion, ' + ' order by w.designacion) from app_private.manteniment_t_trabajos w where w.seguimiento_id=v_work.seguimiento_id and w.grupo_etapa_id=v_work.grupo_etapa_id)
                else 'Pendiente de taller · ' || v_work.designacion
              end,
              v_pos,
              case when v_fecha_cierre_grupo is null then 'pendiente' else 'realizada' end,
              case when v_fecha_cierre_grupo is null then 'pendiente' else 'realizada' end,
              'otro', v_work.taller, null,
              case when v_fecha_cierre_grupo is null then null else v_fecha_cierre_grupo::timestamp at time zone 'Europe/Madrid' end,
              case when v_fecha_cierre_grupo is null then null else v_fecha_cierre_grupo::timestamp at time zone 'Europe/Madrid' end,
              'Necesidad detectada en MANTENIMENT el ' || to_char(v_work.fecha_necesidad, 'DD/MM/YYYY') || '.',
              false, v_actor, v_actor
            ) returning id into v_stage_id;
            v_created_stages := v_created_stages + 1;
          end if;
        end if;

        v_job_id := null;
        if v_work.trabajo_hotel_id is not null then
          select t.id into v_job_id
          from public.trabajos_etapa_hotel t
          where t.id = v_work.trabajo_hotel_id
          limit 1;
        end if;

        if v_job_id is null then
          select c.codigo into v_tipo_codigo
          from public.catalogo_tipos_trabajo c
          where (
            upper(btrim(c.codigo)) = upper(btrim(v_work.designacion))
            or upper(btrim(c.nombre)) = upper(btrim(v_work.designacion))
          )
          order by (upper(btrim(c.codigo)) = upper(btrim(v_work.designacion))) desc
          limit 1;
          if v_tipo_codigo is null then
            v_tipo_codigo := 'MNT_' || upper(substr(md5(upper(btrim(v_work.designacion))), 1, 12));
            insert into public.catalogo_tipos_trabajo(
              codigo, nombre, requiere_expediente, requiere_diagnostico, activo
            ) values (v_tipo_codigo, v_work.designacion, false, false, true)
            on conflict (codigo) do nothing;
          end if;

          insert into public.trabajos_etapa_hotel(
            etapa_hotel_id, tipo_trabajo, categoria_tecnica, motivo_entrada,
            descripcion, observaciones, cancelado, creado_por, modificado_por
          ) values (
            v_stage_id, v_tipo_codigo, v_work.designacion, v_work.tipo_trabajo,
            concat_ws(' · ', nullif(v_work.tipo_trabajo, ''), nullif(v_work.designacion, '')),
            'Generado automáticamente desde MANTENIMENT.', false, v_actor, v_actor
          ) returning id into v_job_id;
          update app_private.manteniment_t_trabajos
          set trabajo_hotel_id = v_job_id,
              actualizado_en = clock_timestamp()
          where id = v_work.id;
          v_created_works := v_created_works + 1;
        end if;

        -- Una gestión o un trámite sí son una T propia y su fecha puede cerrarla.
        -- Completar un trabajo de taller no completa toda la visita de taller.
        if v_visit_stage.modalidad not in ('taller', 'entrada_sin_recogida')
           and v_fecha_cierre_grupo is not null then
          update public.etapas_hotel
          set estado = 'realizada',
              estado_catalogo_codigo = 'realizada',
              fecha_fin_real = coalesce(fecha_fin_real, v_fecha_cierre_grupo::timestamp at time zone 'Europe/Madrid'),
              fecha_real = coalesce(fecha_real, v_fecha_cierre_grupo::timestamp at time zone 'Europe/Madrid'),
              modificado_por = coalesce(v_actor, modificado_por)
          where id = v_stage_id and not cancelado and estado <> 'realizada';
        end if;
      end loop;

      if v_visit_stage.modalidad = 'taller' then
        select e.id into v_pickup_id
        from public.etapas_hotel e
        where e.registro_hotel_id = v_follow.registro_id
          and e.grupo_documental_id = v_visit_stage.grupo_recogida_id
        order by e.cancelado, e.creado_en
        limit 1;
        if v_pickup_id is null then
          v_pos := v_pos + 1;
          insert into public.etapas_hotel(
            registro_hotel_id, seguimiento_id, grupo_documental_id, nombre,
            posicion, estado, estado_catalogo_codigo, tipo_etapa, taller_id,
            centro_taller_id, lugar, fecha_prevista, observaciones, cancelado,
            creado_por, modificado_por, etapa_origen_id
          ) values (
            v_follow.registro_id, gen_random_uuid(), v_visit_stage.grupo_recogida_id,
            'Recogida ' || v_visit_stage.taller, v_pos, 'pendiente', 'pendiente',
            'recogida_taller', v_taller_id, v_centro_id, v_visit_stage.taller,
            null, 'Generada desde las necesidades pendientes de MANTENIMENT.',
            false, v_actor, v_actor, v_entry_id
          ) returning id into v_pickup_id;
          v_created_stages := v_created_stages + 1;
        end if;

        select max(w.fecha_recogida) into v_pickup_date
        from app_private.manteniment_t_trabajos w
        where w.visita_id = v_visit_stage.id;
        if v_pickup_date is not null then
          update public.etapas_hotel
          set estado = 'realizada', estado_catalogo_codigo = 'realizada',
              fecha_fin_real = coalesce(fecha_fin_real, v_pickup_date::timestamp at time zone 'Europe/Madrid'),
              fecha_real = coalesce(fecha_real, v_pickup_date::timestamp at time zone 'Europe/Madrid'),
              modificado_por = coalesce(v_actor, modificado_por)
          where id = v_pickup_id and not cancelado and estado <> 'realizada';
        end if;
      end if;
    end loop;

    if app_private.modalidad_hotel_requiere_recuperacion(v_follow.registro_id) then
      select e.id into v_stage_id
      from public.etapas_hotel e
      where e.registro_hotel_id = v_follow.registro_id
        and not e.cancelado and e.accion_sistema = 'recuperar_y_liberar'
      order by e.creado_en limit 1;
      v_pos := v_pos + 1;
      if v_stage_id is null then
        insert into public.etapas_hotel(
          registro_hotel_id, seguimiento_id, nombre, posicion, estado,
          estado_catalogo_codigo, tipo_etapa, lugar, observaciones, cancelado,
          creado_por, modificado_por, accion_sistema
        ) values (
          v_follow.registro_id, gen_random_uuid(), 'Recuperar ruta y liberar reserva',
          v_pos, 'pendiente', 'pendiente', 'otro', '',
          'Generada automáticamente como T final de cierre.', false,
          v_actor, v_actor, 'recuperar_y_liberar'
        );
        v_created_stages := v_created_stages + 1;
      else
        update public.etapas_hotel
        set posicion = v_pos, modificado_por = coalesce(v_actor, modificado_por)
        where id = v_stage_id;
      end if;
    end if;

    if (select count(*) from public.etapas_hotel e where e.registro_hotel_id=v_follow.registro_id and not e.cancelado) > 99 then
      raise exception 'La generación predictiva supera el máximo de 99 T activas';
    end if;
    perform set_config('app.reconciliando_etapas', '0', true);
    perform app_private.manteniment_encolar_parada(v_follow.seguimiento_id);
  end loop;

  return jsonb_build_object(
    'recibidos', v_raw_count,
    'seleccionados', v_candidate_count,
    't_creadas', v_created_stages,
    'trabajos_creados', v_created_works,
    'ambiguos', v_ambiguous
  );
exception when others then
  perform set_config('app.reconciliando_etapas', '0', true);
  raise;
end;
$function$;


DO $guard$ BEGIN IF md5(rtrim(pg_get_functiondef('app_private.etapa_manteniment_sin_recogida_alpha74(uuid)'::regprocedure), E' \t\n\r')) <> '0f9f625d31597ef5f29a45b652246bc0' THEN RAISE EXCEPTION 'Ha cambiado etapa_manteniment_sin_recogida_alpha74; revisar antes de aplicar'; END IF; END $guard$;
CREATE OR REPLACE FUNCTION app_private.etapa_manteniment_sin_recogida_alpha74(p_etapa_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'app_private'
AS $function$
  select case when exists (
    select 1 from public.etapas_hotel e
    join app_private.manteniment_t_visitas v on v.grupo_entrada_id=e.grupo_documental_id
    join public.registros_hotel r on r.id=e.registro_hotel_id and r.seguimiento_id=v.seguimiento_id
    where e.id=p_etapa_id and v.modalidad='taller'
  ) then false else exists (
    select 1
    from public.etapas_hotel origen
    where origen.id = p_etapa_id
      and (
        exists (
          select 1
          from app_private.manteniment_t_visitas v
          where v.grupo_entrada_id = origen.grupo_documental_id
            and (
              v.modalidad in ('tramite', 'entrada_sin_recogida')
              or regexp_replace(upper(btrim(coalesce(v.taller, ''))), '[[:space:]]+', ' ', 'g') in ('TM', 'NAVE TM')
            )
        )
        or exists (
          select 1
          from public.trabajos_etapa_hotel t
          left join app_private.manteniment_t_trabajos w
            on w.trabajo_hotel_id = t.id
          where t.etapa_hotel_id = origen.id
            and not t.cancelado
            and (
              translate(upper(coalesce(w.tipo_trabajo, t.motivo_entrada, '')), 'ÁÉÍÓÚÜÑ', 'AEIOUUN') like '%TRAMITE%'
              or upper(btrim(coalesce(w.designacion, t.categoria_tecnica, ''))) in ('LKT', 'EXTINTOR')
            )
        )
        or translate(upper(coalesce(origen.nombre, '')), 'ÁÉÍÓÚÜÑ', 'AEIOUUN')
             ~ '(^|[^A-Z0-9])(TRAMITE|LKT|EXTINTOR)([^A-Z0-9]|$)'
        or regexp_replace(
             regexp_replace(upper(btrim(coalesce(origen.nombre, ''))), '[[:space:]]+', ' ', 'g'),
             '^ENTRADA( EN)?( TALLER)?[[:space:]·:.-]*', '', 'g'
           ) in ('TM', 'NAVE TM')
      )
  ) end;
$function$;


CREATE UNIQUE INDEX IF NOT EXISTS etapas_hotel_identidad_ficha_uq ON public.etapas_hotel(registro_hotel_id, seguimiento_id);
