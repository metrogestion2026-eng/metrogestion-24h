-- MG75-ESTADO-REAL-ORDEN-001
-- 1) El orden manual de las T se conserva. Normalizar solo compacta huecos.
-- 2) Recuperar no adelanta ni retrasa otras T por su tipo.
-- 3) El estado se deriva de hechos reales y, para T pendientes, del orden
--    operativo, conservando las situaciones pre-entrada ya válidas.
-- 4) TM/NAVE TM no sustituye una situación Pendiente de taller cuando existe
--    una entrada de taller posterior todavía pendiente.

create or replace function app_private.normalizar_orden_t_parada(p_registro_id uuid)
returns integer
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'app_private'
as $function$
declare
  v_count integer:=0;
begin
  if not exists (
    select 1 from public.registros_hotel where id=p_registro_id
  ) then return 0; end if;

  perform set_config('app.audit_origin','metrogestion-r1-order-compact',true);
  perform set_config('app.reconciliando_etapas','1',true);
  set constraints etapas_hotel_posicion_activa_uq deferred;

  create temp table if not exists tmp_norm_t_order(
    etapa_id uuid primary key,
    new_pos integer not null
  ) on commit drop;
  truncate tmp_norm_t_order;

  insert into tmp_norm_t_order(etapa_id,new_pos)
  select
    e.id,
    row_number() over (
      order by e.posicion,e.creado_en,e.id
    )::integer
  from public.etapas_hotel e
  where e.registro_hotel_id=p_registro_id
    and not e.cancelado;

  update public.etapas_hotel e
  set posicion=1000+n.new_pos
  from tmp_norm_t_order n
  where e.id=n.etapa_id
    and e.posicion is distinct from 1000+n.new_pos;

  update public.etapas_hotel e
  set posicion=n.new_pos
  from tmp_norm_t_order n
  where e.id=n.etapa_id
    and e.posicion is distinct from n.new_pos;

  get diagnostics v_count = row_count;
  perform set_config('app.reconciliando_etapas','0',true);
  return v_count;
end;
$function$;

revoke all on function app_private.normalizar_orden_t_parada(uuid)
  from public, anon, authenticated;

create or replace function app_private.estado_t_pendiente_por_orden_alpha75(
  p_registro_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'public', 'app_private'
as $function$
declare
  v_r public.registros_hotel%rowtype;
  v_e public.etapas_hotel%rowtype;
  v_later public.etapas_hotel%rowtype;
  v_tipo text;
  v_nombre text;
  v_es_recuperacion boolean:=false;
  v_estado text;
  v_motivo text;
begin
  select * into v_r
  from public.registros_hotel
  where id=p_registro_id;
  if not found then return '{}'::jsonb; end if;

  select e.* into v_e
  from public.etapas_hotel e
  where e.registro_hotel_id=p_registro_id
    and not e.cancelado
    and e.estado in ('pendiente','programada','en_curso')
    and not (
      (
        e.accion_sistema='recuperar_y_liberar'
        or lower(
          translate(
            btrim(coalesce(e.tipo_etapa,'')),
            'ÁÉÍÓÚÜÑáéíóúüñ',
            'AEIOUUNaeiouun'
          )
        ) in ('recuperar_ruta','recuperar')
      )
      and lower(coalesce(v_r.modalidad_operativa,'')) in (
        'sin_sustitucion','reparado_en_ruta','reserva_en_reparacion'
      )
    )
  order by e.posicion,e.creado_en,e.id
  limit 1;

  if not found then return '{}'::jsonb; end if;

  v_tipo := lower(
    translate(
      btrim(coalesce(v_e.tipo_etapa,'')),
      'ÁÉÍÓÚÜÑáéíóúüñ',
      'AEIOUUNaeiouun'
    )
  );
  v_nombre := lower(
    translate(
      regexp_replace(btrim(coalesce(v_e.nombre,'')),'[[:space:]]+',' ','g'),
      'ÁÉÍÓÚÜÑáéíóúüñ',
      'AEIOUUNaeiouun'
    )
  );

  if v_tipo='tramite' and v_nombre in ('tm','nave tm') then
    select e.* into v_later
    from public.etapas_hotel e
    where e.registro_hotel_id=p_registro_id
      and not e.cancelado
      and e.estado in ('pendiente','programada','en_curso')
      and e.posicion>v_e.posicion
      and lower(
        translate(
          btrim(coalesce(e.tipo_etapa,'')),
          'ÁÉÍÓÚÜÑáéíóúüñ',
          'AEIOUUNaeiouun'
        )
      )='entrada_taller'
    order by e.posicion,e.creado_en,e.id
    limit 1;

    if found then
      if lower(coalesce(v_r.estado,'')) in (
        'planificado','pendiente_taller','entrada_taller_programada'
      ) then
        v_estado:=v_r.estado;
      elsif v_later.estado='programada' or v_later.fecha_prevista is not null then
        v_estado:='entrada_taller_programada';
      else
        v_estado:='pendiente_taller';
      end if;
      return jsonb_build_object(
        'estado',v_estado,
        'motivo','tm_neutra_antes_taller',
        'etapa_id',v_e.id,
        'posicion',v_e.posicion
      );
    end if;
  end if;

  v_es_recuperacion :=
    coalesce(v_e.accion_sistema,'')='recuperar_y_liberar'
    or v_tipo in ('recuperar_ruta','recuperar');

  if v_es_recuperacion then
    v_estado := 'recogido_pendiente_ruta';
    v_motivo := 'primera_t_recuperacion';
  elsif v_tipo='entrada_taller' then
    if v_e.fecha_inicio_real is not null
       and v_e.fecha_fin_real is not null
       and v_e.fecha_real is null then
      v_estado := 'terminado_pendiente_recogida';
      v_motivo := 'primera_t_taller_acabada';
    elsif v_e.fecha_inicio_real is not null
          and v_e.fecha_real is null then
      v_estado := 'en_taller';
      v_motivo := 'primera_t_taller_en_curso';
    elsif lower(coalesce(v_r.estado,'')) in (
      'planificado','pendiente_taller','entrada_taller_programada'
    ) then
      v_estado := v_r.estado;
      v_motivo := 'situacion_preentrada_conservada';
    elsif v_e.estado='programada' or v_e.fecha_prevista is not null then
      v_estado := 'entrada_taller_programada';
      v_motivo := 'primera_t_taller_programada';
    else
      v_estado := 'pendiente_taller';
      v_motivo := 'primera_t_pendiente_taller';
    end if;
  elsif v_tipo='recogida_taller' then
    v_estado := 'terminado_pendiente_recogida';
    v_motivo := 'primera_t_recogida';
  elsif v_tipo='24h' then
    v_estado := 'asistencia_24h';
    v_motivo := 'primera_t_24h';
  elsif v_tipo='tramite' then
    v_estado := 'tramite';
    v_motivo := 'primera_t_tramite';
  elsif v_tipo='gestion' then
    v_estado := 'gestion';
    v_motivo := 'primera_t_gestion';
  elsif v_e.estado='programada' or v_e.fecha_prevista is not null then
    v_estado := 'planificado';
    v_motivo := 'primera_t_planificada';
  else
    v_estado := 't_pendientes';
    v_motivo := 'primera_t_pendiente';
  end if;

  return jsonb_build_object(
    'estado',v_estado,
    'motivo',v_motivo,
    'etapa_id',v_e.id,
    'posicion',v_e.posicion
  );
end;
$function$;

revoke all on function app_private.estado_t_pendiente_por_orden_alpha75(uuid)
  from public, anon, authenticated;

do $migration$
declare
  definition text := pg_get_functiondef(
    'app_private.proyectar_situacion_operativa_hotel_alpha75(uuid)'::regprocedure
  );

  old_decl text := $old$  v_stage record;
  v_cierre_admin jsonb;$old$;
  new_decl text := $new$  v_stage record;
  v_cierre_admin jsonb;
  v_orden jsonb;$new$;

  old_physical text := $old$  where e.registro_hotel_id = p_registro_id
    and not e.cancelado
    and e.estado = 'en_curso'
    and e.fecha_inicio_real is not null
    and coalesce(e.fecha_fin_real, e.fecha_real) is null
    and ($old$;
  new_physical text := $new$  where e.registro_hotel_id = p_registro_id
    and not e.cancelado
    and e.estado in ('en_curso','realizada')
    and e.fecha_inicio_real is not null
    and e.fecha_real is null
    and ($new$;

  old_select text := $old$    e.lugar,
    t.nombre as taller,
    ct.nombre as centro$old$;
  new_select text := $new$    e.lugar,
    e.fecha_fin_real,
    t.nombre as taller,
    ct.nombre as centro$new$;

  old_state text := $old$    else
      v_estado := 'en_taller';
    end if;$old$;
  new_state text := $new$    else
      v_estado := case
        when v_stage.fecha_fin_real is not null
          then 'terminado_pendiente_recogida'
        else 'en_taller'
      end;
    end if;$new$;

  old_generic_if text := $old$          if (
               coalesce(v_stage.accion_sistema,'') = 'recuperar_y_liberar'
               or lower(coalesce(v_stage.tipo_etapa,'')) in ('recuperar_ruta','recuperar')
             )
             and lower(coalesce(v_r.modalidad_operativa,'')) not in (
               'sin_sustitucion',
               'reparado_en_ruta',
               'reserva_en_reparacion'
             ) then
            v_estado := 'recogido_pendiente_ruta';
            v_motivo := 'recuperacion_en_curso';
          else$old$;
  new_generic_if text := $new$          if lower(coalesce(v_stage.tipo_etapa,''))='recogida_taller' then
            v_estado := 'terminado_pendiente_recogida';
            v_motivo := 'recogida_taller_en_curso';
          elsif (
               coalesce(v_stage.accion_sistema,'') = 'recuperar_y_liberar'
               or lower(coalesce(v_stage.tipo_etapa,'')) in ('recuperar_ruta','recuperar')
             )
             and lower(coalesce(v_r.modalidad_operativa,'')) not in (
               'sin_sustitucion',
               'reparado_en_ruta',
               'reserva_en_reparacion'
             ) then
            v_estado := 'recogido_pendiente_ruta';
            v_motivo := 'recuperacion_en_curso';
          else$new$;

  old_pending_anchor text := $old$        else
        select
          p.id,$old$;
  new_pending_anchor text := $new$        else
        v_orden := app_private.estado_t_pendiente_por_orden_alpha75(
          p_registro_id
        );
        if nullif(v_orden->>'estado','') is not null then
          v_estado := v_orden->>'estado';
          v_motivo := coalesce(v_orden->>'motivo','primera_t_por_orden');
          return jsonb_build_object(
            'existe', true,
            'registro_id', p_registro_id,
            'estado_actual', v_r.estado,
            'estado_proyectado', v_estado,
            'lugar_actual', v_r.lugar,
            'lugar_proyectado', v_lugar,
            'motivo', v_motivo,
            'total_t', v_total,
            't_abiertas', v_abiertas,
            'sustitucion_vigente', v_sustitucion_vigente,
            'activa_recomendada', true
          );
        end if;

        select
          p.id,$new$;
begin
  if position(old_decl in definition)=0
     or position(old_physical in definition)=0
     or position(old_select in definition)=0
     or position(old_state in definition)=0
     or position(old_generic_if in definition)=0
     or position(old_pending_anchor in definition)=0 then
    raise exception 'MG75-ESTADO-REAL-ORDEN-001: cambió la función de proyección; revisar antes de aplicar';
  end if;

  definition := replace(definition,old_decl,new_decl);
  definition := replace(definition,old_physical,new_physical);
  definition := replace(definition,old_select,new_select);
  definition := replace(definition,old_state,new_state);
  definition := replace(definition,old_generic_if,new_generic_if);
  definition := replace(definition,old_pending_anchor,new_pending_anchor);
  execute definition;
end;
$migration$;

do $backfill$
declare
  v_id uuid;
begin
  perform set_config('app.request_id','estado_real_orden_20261111',true);
  perform set_config('app.audit_origin','metrogestion-r1-estado-real-orden',true);
  perform set_config('app.manteniment_importando_paradas','1',true);

  for v_id in
    select r.id
    from public.registros_hotel r
    join public.pizarras p on p.id=r.pizarra_id
    where p.estado='en_curso'
      and not r.cancelado
      and not r.retirado_hotel_activo
      and exists (
        select 1
        from public.etapas_hotel e
        where e.registro_hotel_id=r.id
          and not e.cancelado
      )
  loop
    perform app_private.sincronizar_situacion_operativa_hotel_alpha75(
      v_id,
      false
    );
  end loop;
end;
$backfill$;

do $check$
begin
  if exists (
    select 1
    from public.registros_hotel r
    join public.pizarras p on p.id=r.pizarra_id
    where p.estado='en_curso'
      and not r.cancelado
      and not r.retirado_hotel_activo
      and exists (
        select 1
        from public.etapas_hotel e
        where e.registro_hotel_id=r.id
          and not e.cancelado
      )
      and r.estado is distinct from (
        app_private.proyectar_situacion_operativa_hotel_alpha75(r.id)
        ->>'estado_proyectado'
      )
  ) then
    raise exception 'MG75-ESTADO-REAL-ORDEN-001: queda una ficha activa con estado distinto de su proyección';
  end if;
end;
$check$;
