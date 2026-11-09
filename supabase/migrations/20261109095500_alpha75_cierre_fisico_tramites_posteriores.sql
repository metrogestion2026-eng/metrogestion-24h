-- MG75-CIERRE-FISICO-ADMIN-001
-- La recuperación cierra el bloque físico/sustitución, no las T administrativas independientes.
-- Una ficha puede quedar fuera de Activas con TRÁMITES/GESTIONES pendientes, que siguen
-- disponibles en T pendientes y pueden realizarse posteriormente sin generar otra recuperación.

create or replace function app_private.etapa_es_administrativa_alpha75(p_etapa_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'pg_catalog', 'public', 'app_private'
as $function$
  select exists (
    select 1
    from public.etapas_hotel e
    where e.id = p_etapa_id
      and (
        lower(
          translate(
            btrim(coalesce(e.tipo_etapa, '')),
            'ÁÉÍÓÚÜÑáéíóúüñ',
            'AEIOUUNaeiouun'
          )
        ) in ('gestion', 'tramite')
        or translate(
          upper(coalesce(e.nombre, '')),
          'ÁÉÍÓÚÜÑ',
          'AEIOUUN'
        ) ~ '(^|[^A-Z0-9])(TRAMITE|GESTION|ITV|44TN|TMG|ATP|LKT|EXTINTOR)([^A-Z0-9]|$)'
      )
  );
$function$;

revoke all on function app_private.etapa_es_administrativa_alpha75(uuid)
  from public, anon, authenticated;

create or replace function app_private.normalizar_orden_t_parada(p_registro_id uuid)
returns integer
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'app_private'
as $function$
declare
  v_follow uuid;
  rec record;
  v_count integer:=0;
  v_n integer:=0;
begin
  select seguimiento_id into v_follow
  from public.registros_hotel
  where id=p_registro_id;
  if v_follow is null then return 0; end if;

  perform set_config('app.audit_origin','metrogestion-r1-history-order-normalization',true);
  perform set_config('app.reconciliando_etapas','1',true);
  set constraints etapas_hotel_posicion_activa_uq deferred;

  create temp table if not exists tmp_norm_t_order(
    etapa_id uuid primary key,
    new_pos integer not null
  ) on commit drop;

  for rec in
    select r.id as registro_id
    from public.registros_hotel r
    where r.seguimiento_id=v_follow
      and not r.cancelado
  loop
    truncate tmp_norm_t_order;

    insert into tmp_norm_t_order(etapa_id,new_pos)
    with base as (
      select
        e.id,
        e.posicion,
        e.creado_en,
        app_private.es_recuperacion_rec001(to_jsonb(e)) as es_recuperacion,
        app_private.etapa_es_administrativa_alpha75(e.id) as es_administrativa
      from public.etapas_hotel e
      where e.registro_hotel_id=rec.registro_id
        and not e.cancelado
    ),
    marcado as (
      select
        b.*,
        max(b.posicion) filter (
          where not b.es_recuperacion
            and not b.es_administrativa
        ) over () as ultima_fisica
      from base b
    )
    select
      m.id,
      row_number() over (
        order by
          case
            when m.es_recuperacion and m.ultima_fisica is not null
              then m.ultima_fisica::numeric + 0.5
            else m.posicion::numeric
          end,
          m.creado_en,
          m.id
      )::integer
    from marcado m;

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

    get diagnostics v_n = row_count;
    v_count := v_count + v_n;
  end loop;

  perform set_config('app.reconciliando_etapas','0',true);
  return v_count;
end;
$function$;

revoke all on function app_private.normalizar_orden_t_parada(uuid)
  from public, anon, authenticated;

create or replace function app_private.asegurar_recuperacion_final()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'app_private'
as $function$
declare
  v_actor uuid;
  v_last_pos integer;
  v_name_normalized text;
begin
  if exists(
    select 1
    from public.registros_hotel r
    where r.id=new.registro_hotel_id
      and not app_private.es_titular_continuidad_alpha75(r.seguimiento_id)
  ) then return new; end if;

  if exists(
    select 1
    from public.registros_hotel r
    where r.id=new.registro_hotel_id
      and upper(btrim(coalesce(r.tipo_movimiento,'')))='24H'
  ) then return new; end if;

  if current_setting('app.clonando_pizarra',true)='1' then return new; end if;
  if current_setting('app.reconciliando_etapas',true)='1' then return new; end if;
  if current_setting('app.audit_origin',true)='metrogestion-r1-editor' then return new; end if;
  if new.cancelado then return new; end if;

  v_name_normalized:=lower(
    translate(coalesce(new.nombre,''),'áéíóúÁÉÍÓÚ','aeiouAEIOU')
  );
  if new.accion_sistema='recuperar_y_liberar'
     or v_name_normalized like 'recuperar ruta%'
     or v_name_normalized like 'recuperar vehiculo%' then
    return new;
  end if;

  if not app_private.modalidad_hotel_requiere_recuperacion(new.registro_hotel_id) then
    return new;
  end if;

  if exists(
    select 1
    from public.etapas_hotel e
    where e.registro_hotel_id=new.registro_hotel_id
      and e.cancelado=false
      and e.accion_sistema='recuperar_y_liberar'
  ) then
    perform app_private.normalizar_orden_t_parada(new.registro_hotel_id);
    return new;
  end if;

  v_actor:=coalesce(auth.uid(),new.modificado_por,new.creado_por);
  select coalesce(max(e.posicion),0)+1
    into v_last_pos
  from public.etapas_hotel e
  where e.registro_hotel_id=new.registro_hotel_id
    and e.cancelado=false;

  insert into public.etapas_hotel(
    registro_hotel_id,seguimiento_id,nombre,posicion,estado,tipo_etapa,lugar,
    fecha_prevista,fecha_inicio_real,fecha_fin_real,fecha_real,observaciones,
    cancelado,creado_por,modificado_por,accion_sistema
  )
  values(
    new.registro_hotel_id,gen_random_uuid(),
    'Recuperar ruta y liberar reserva',v_last_pos,'pendiente','otro','',
    null,null,null,null,'Generada automáticamente como T final de cierre.',
    false,v_actor,v_actor,'recuperar_y_liberar'
  );

  perform app_private.normalizar_orden_t_parada(new.registro_hotel_id);
  return new;
end;
$function$;

revoke all on function app_private.asegurar_recuperacion_final()
  from public, anon, authenticated;

do $migration$
declare
  definition text := pg_get_functiondef(
    'app_private.reconciliar_etapas_hotel(uuid,text)'::regprocedure
  );
  old_block text := $old$
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
$old$;
begin
  if (length(definition)-length(replace(definition,old_block,'')))
       / greatest(length(old_block),1) <> 1 then
    raise exception 'Ha cambiado el bloque de orden de reconciliar_etapas_hotel; revisar antes de aplicar';
  end if;

  definition := replace(
    definition,
    old_block,
    E'\n  perform app_private.normalizar_orden_t_parada(p_registro_id);\n'
  );
  execute definition;
end;
$migration$;

create or replace function app_private.cierre_fisico_con_t_administrativas_pendientes_alpha75(
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
  v_fisicas_total integer:=0;
  v_fisicas_abiertas integer:=0;
  v_admin_abiertas integer:=0;
  v_recuperacion_realizada boolean:=false;
  v_requiere_recuperacion boolean:=false;
  v_aplica boolean:=false;
  v_estado_cierre text;
begin
  select * into v_r
  from public.registros_hotel
  where id=p_registro_id;

  if not found or v_r.cancelado then
    return jsonb_build_object('aplica',false);
  end if;

  select
    count(*) filter (
      where not e.cancelado
        and not app_private.es_recuperacion_rec001(to_jsonb(e))
        and not app_private.etapa_es_administrativa_alpha75(e.id)
    ),
    count(*) filter (
      where not e.cancelado
        and not app_private.es_recuperacion_rec001(to_jsonb(e))
        and not app_private.etapa_es_administrativa_alpha75(e.id)
        and e.estado in ('pendiente','programada','en_curso')
    ),
    count(*) filter (
      where not e.cancelado
        and app_private.etapa_es_administrativa_alpha75(e.id)
        and e.estado in ('pendiente','programada','en_curso')
    ),
    coalesce(bool_or(
      not e.cancelado
      and app_private.es_recuperacion_rec001(to_jsonb(e))
      and e.estado='realizada'
    ),false)
  into
    v_fisicas_total,
    v_fisicas_abiertas,
    v_admin_abiertas,
    v_recuperacion_realizada
  from public.etapas_hotel e
  where e.registro_hotel_id=p_registro_id;

  v_requiere_recuperacion :=
    app_private.modalidad_hotel_requiere_recuperacion(p_registro_id);

  v_aplica :=
    v_fisicas_total > 0
    and v_fisicas_abiertas = 0
    and v_admin_abiertas > 0
    and (
      not v_requiere_recuperacion
      or v_recuperacion_realizada
    );

  if v_aplica then
    if v_recuperacion_realizada then
      v_estado_cierre := case
        when v_r.estado in ('recuperado','reserva_liberada')
          then v_r.estado
        else 'recuperado'
      end;
    else
      v_estado_cierre := case
        when v_r.estado in ('recuperado','reserva_liberada','realizada')
          then v_r.estado
        else 'realizada'
      end;
    end if;
  end if;

  return jsonb_build_object(
    'aplica',v_aplica,
    'estado_cierre',v_estado_cierre,
    'fisicas_total',v_fisicas_total,
    'fisicas_abiertas',v_fisicas_abiertas,
    'administrativas_abiertas',v_admin_abiertas,
    'requiere_recuperacion',v_requiere_recuperacion,
    'recuperacion_realizada',v_recuperacion_realizada
  );
end;
$function$;

revoke all on function app_private.cierre_fisico_con_t_administrativas_pendientes_alpha75(uuid)
  from public, anon, authenticated;

do $migration$
declare
  definition text := pg_get_functiondef(
    'app_private.proyectar_situacion_operativa_hotel_alpha75(uuid)'::regprocedure
  );
  declaration_old text := $old$  v_stage record;
begin$old$;
  declaration_new text := $new$  v_stage record;
  v_cierre_admin jsonb;
begin$new$;
  anchor_old text := $old$  v_estado := v_r.estado;
  v_lugar := v_r.lugar;

  select$old$;
  anchor_new text := $new$  v_estado := v_r.estado;
  v_lugar := v_r.lugar;

  v_cierre_admin :=
    app_private.cierre_fisico_con_t_administrativas_pendientes_alpha75(
      p_registro_id
    );

  if coalesce((v_cierre_admin->>'aplica')::boolean,false) then
    v_estado := nullif(v_cierre_admin->>'estado_cierre','');
    v_motivo := 'flujo_fisico_cerrado_t_administrativas_pendientes';
    v_activa := false;

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
      'activa_recomendada', v_activa
    );
  end if;

  select$new$;
begin
  if (length(definition)-length(replace(definition,declaration_old,'')))
       / greatest(length(declaration_old),1) <> 1 then
    raise exception 'Ha cambiado la declaración de proyectar_situacion_operativa_hotel_alpha75';
  end if;
  if (length(definition)-length(replace(definition,anchor_old,'')))
       / greatest(length(anchor_old),1) <> 1 then
    raise exception 'Ha cambiado el punto de inserción de proyectar_situacion_operativa_hotel_alpha75';
  end if;

  definition := replace(definition,declaration_old,declaration_new);
  definition := replace(definition,anchor_old,anchor_new);
  execute definition;
end;
$migration$;

do $migration$
declare
  definition text := pg_get_functiondef(
    'app_private.listar_t_pendientes_30d_alpha74()'::regprocedure
  );
  cte_old text := $old$  with agrupadas as ($old$;
  cte_new text := $new$  with registros_rankeados as (
    select
      r.id,
      coalesce(r.seguimiento_id,r.id) as identidad_parada,
      r.vehiculo_sustituido::text as dfm,
      r.matricula_sustituido::text as matricula,
      r.numero_parada::text as numero_parada,
      r.prioridad::integer as prioridad,
      r.retirado_hotel_activo,
      row_number() over (
        partition by coalesce(r.seguimiento_id,r.id)
        order by
          (p.estado='en_curso') desc,
          p.fecha desc,
          r.actualizado_en desc,
          r.id desc
      ) as rn
    from public.registros_hotel r
    join public.pizarras p on p.id=r.pizarra_id
    where not r.cancelado
  ),
  hotel_fuente as (
    select
      id,dfm,matricula,numero_parada,prioridad,retirado_hotel_activo
    from registros_rankeados
    where rn=1
  ),
  agrupadas as ($new$;
  join_old text := $old$    join public.hotel_actual_detalle h
      on h.id = e.registro_hotel_id$old$;
  join_new text := $new$    join hotel_fuente h
      on h.id = e.registro_hotel_id$new$;
  where_old text := $old$    where not e.cancelado
      and e.estado in ('pendiente', 'programada', 'en_curso')$old$;
  where_new text := $new$    where not e.cancelado
      and e.estado in ('pendiente', 'programada', 'en_curso')
      and (
        not h.retirado_hotel_activo
        or app_private.etapa_es_administrativa_alpha75(e.id)
      )$new$;
begin
  if (length(definition)-length(replace(definition,cte_old,'')))
       / greatest(length(cte_old),1) <> 1 then
    raise exception 'Ha cambiado el CTE de listar_t_pendientes_30d_alpha74';
  end if;
  if (length(definition)-length(replace(definition,join_old,'')))
       / greatest(length(join_old),1) <> 1 then
    raise exception 'Ha cambiado la fuente activa de listar_t_pendientes_30d_alpha74';
  end if;
  if (length(definition)-length(replace(definition,where_old,'')))
       / greatest(length(where_old),1) <> 1 then
    raise exception 'Ha cambiado el filtro de listar_t_pendientes_30d_alpha74';
  end if;

  definition := replace(definition,cte_old,cte_new);
  definition := replace(definition,join_old,join_new);
  definition := replace(definition,where_old,where_new);
  execute definition;
end;
$migration$;

-- Normaliza todas las copias que presentan una recuperación por detrás de
-- T administrativas. No se identifica ninguna unidad concreta.
do $backfill$
declare
  v_id uuid;
begin
  perform set_config('app.request_id','cierre_fisico_admin_20261109',true);
  perform set_config('app.audit_origin','metrogestion-r1-cierre-fisico-admin',true);

  for v_id in
    select distinct on (r.seguimiento_id) r.id
    from public.registros_hotel r
    join public.etapas_hotel rec
      on rec.registro_hotel_id=r.id
     and not rec.cancelado
     and app_private.es_recuperacion_rec001(to_jsonb(rec))
    where not r.cancelado
      and exists (
        select 1
        from public.etapas_hotel a
        where a.registro_hotel_id=r.id
          and not a.cancelado
          and app_private.etapa_es_administrativa_alpha75(a.id)
          and a.posicion < rec.posicion
      )
      and exists (
        select 1
        from public.etapas_hotel f
        where f.registro_hotel_id=r.id
          and not f.cancelado
          and not app_private.es_recuperacion_rec001(to_jsonb(f))
          and not app_private.etapa_es_administrativa_alpha75(f.id)
      )
    order by r.seguimiento_id,r.actualizado_en desc,r.id desc
  loop
    perform app_private.normalizar_orden_t_parada(v_id);
  end loop;

  -- Recalcula únicamente la pizarra actual para permitir cierre físico con
  -- T administrativas pendientes.
  for v_id in
    select r.id
    from public.registros_hotel r
    join public.pizarras p on p.id=r.pizarra_id
    where p.estado='en_curso'
      and not r.cancelado
      and not r.retirado_hotel_activo
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
    join public.etapas_hotel rec
      on rec.registro_hotel_id=r.id
     and not rec.cancelado
     and app_private.es_recuperacion_rec001(to_jsonb(rec))
    where not r.cancelado
      and exists (
        select 1
        from public.etapas_hotel f
        where f.registro_hotel_id=r.id
          and not f.cancelado
          and not app_private.es_recuperacion_rec001(to_jsonb(f))
          and not app_private.etapa_es_administrativa_alpha75(f.id)
      )
      and exists (
        select 1
        from public.etapas_hotel a
        where a.registro_hotel_id=r.id
          and not a.cancelado
          and app_private.etapa_es_administrativa_alpha75(a.id)
          and a.posicion > (
            select max(f2.posicion)
            from public.etapas_hotel f2
            where f2.registro_hotel_id=r.id
              and not f2.cancelado
              and not app_private.es_recuperacion_rec001(to_jsonb(f2))
              and not app_private.etapa_es_administrativa_alpha75(f2.id)
          )
          and a.posicion < rec.posicion
      )
  ) then
    raise exception 'MG75-CIERRE-FISICO-ADMIN-001: queda una recuperación detrás de una T administrativa posterior al bloque físico';
  end if;

  if exists (
    select 1
    from public.registros_hotel r
    join public.pizarras p on p.id=r.pizarra_id
    where p.estado='en_curso'
      and not r.cancelado
      and not r.retirado_hotel_activo
      and coalesce(
        (
          app_private.cierre_fisico_con_t_administrativas_pendientes_alpha75(r.id)
          ->>'aplica'
        )::boolean,
        false
      )
  ) then
    raise exception 'MG75-CIERRE-FISICO-ADMIN-001: queda activa una ficha cuyo flujo físico ya está cerrado y solo mantiene T administrativas';
  end if;
end;
$check$;
