-- MG75-ESTADO-REAL-ORDEN-001
-- El orden manual de las T manda. La normalización solo compacta posiciones
-- sin mover Recuperar por tipo. El estado pendiente se deriva de la primera T
-- no resuelta por posición, salvo hechos físicos ya iniciados que describen
-- la situación real actual.

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
      order by
        e.posicion,
        case when e.tipo_etapa='recogida_taller' then 0 else 1 end,
        e.creado_en,
        e.id
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
  v_tipo text;
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
  v_es_recuperacion :=
    coalesce(v_e.accion_sistema,'')='recuperar_y_liberar'
    or v_tipo in ('recuperar_ruta','recuperar');

  if v_es_recuperacion then
    v_estado := 'recogido_pendiente_ruta';
    v_motivo := 'primera_t_recuperacion';
  elsif v_tipo='entrada_taller' then
    if v_e.fecha_inicio_real is not null and v_e.fecha_fin_real is not null
       and v_e.fecha_real is null then
      v_estado := 'terminado_pendiente_recogida';
      v_motivo := 'primera_t_taller_acabada';
    elsif v_e.fecha_inicio_real is not null and v_e.fecha_real is null then
      v_estado := 'en_taller';
      v_motivo := 'primera_t_taller_en_curso';
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
  old_physical_select text := $old$    e.lugar,
    t.nombre as taller,
    ct.nombre as centro$old$;
  new_physical_select text := $new$    e.lugar,
    e.fecha_fin_real,
    t.nombre as taller,
    ct.nombre as centro$new$;
  old_physical_condition text := $old$    and coalesce(e.fecha_fin_real, e.fecha_real) is null$old$;
  old_physical_state text := $old$    else
      v_estado := 'en_taller';
    end if;$old$;
  new_physical_state text := $new$    else
      v_estado := case
        when v_stage.fecha_fin_real is not null
          then 'terminado_pendiente_recogida'
        else 'en_taller'
      end;
    end if;$new$;
  old_generic_select text := $old$        select e.id, e.lugar, e.tipo_etapa, e.accion_sistema$old$;
  new_generic_select text := $new$        select e.id, e.lugar, e.tipo_etapa, e.accion_sistema, e.fecha_fin_real$new$;
  old_generic_block text := $old$          v_lugar := coalesce(nullif(btrim(v_stage.lugar), ''), v_r.lugar);
          if (
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
          else
            v_estado := case
              when v_r.estado in ('tramite','gestion','en_taller','asistencia_24h')
                then v_r.estado
              else 't_pendientes'
            end;
            v_motivo := 'otra_t_en_curso';
          end if;$old$;
  new_generic_block text := $new$          v_lugar := coalesce(nullif(btrim(v_stage.lugar), ''), v_r.lugar);
          if lower(coalesce(v_stage.tipo_etapa,''))='recogida_taller' then
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
          else
            v_estado := case
              when v_r.estado in ('tramite','gestion','en_taller','asistencia_24h')
                then v_r.estado
              else 't_pendientes'
            end;
            v_motivo := 'otra_t_en_curso';
          end if;$new$;
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
  if position(old_decl in definition)=0 then
    raise exception 'MG75-ESTADO-REAL-ORDEN-001: declaración no localizada';
  end if;
  if position(old_physical_select in definition)=0 then
    raise exception 'MG75-ESTADO-REAL-ORDEN-001: select físico no localizado';
  end if;
  if position(old_physical_condition in definition)=0 then
    raise exception 'MG75-ESTADO-REAL-ORDEN-001: condición física no localizada';
  end if;
  if position(old_physical_state in definition)=0 then
    raise exception 'MG75-ESTADO-REAL-ORDEN-001: estado físico no localizado';
  end if;
  if position(old_generic_select in definition)=0 then
    raise exception 'MG75-ESTADO-REAL-ORDEN-001: select genérico no localizado';
  end if;
  if position(old_generic_block in definition)=0 then
    raise exception 'MG75-ESTADO-REAL-ORDEN-001: bloque genérico no localizado';
  end if;
  if position(old_pending_anchor in definition)=0 then
    raise exception 'MG75-ESTADO-REAL-ORDEN-001: punto de orden pendiente no localizado';
  end if;

  definition := replace(definition,old_decl,new_decl);
  definition := replace(definition,old_physical_select,new_physical_select);
  definition := replace(definition,old_physical_condition,'    and e.fecha_real is null');
  definition := replace(definition,old_physical_state,new_physical_state);
  definition := replace(definition,old_generic_select,new_generic_select);
  definition := replace(definition,old_generic_block,new_generic_block);
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
        select 1 from public.etapas_hotel e
        where e.registro_hotel_id=r.id
          and not e.cancelado
      )
  loop
    perform app_private.sincronizar_situacion_operativa_hotel_alpha75(v_id,true);
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
        select 1 from public.etapas_hotel e
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
