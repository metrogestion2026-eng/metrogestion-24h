begin;

-- Alpha74.12:
-- 1) solo las filas con fondo blanco de H pueden originar una necesidad nueva;
-- 2) los trabajos del mismo taller se agrupan dentro de una única T de entrada;
-- 3) GESTIÓN, TRÁMITE y pendiente de taller mantienen su propia T.
CREATE OR REPLACE FUNCTION app_private.manteniment_importar_trabajos(p_trabajos jsonb)
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
  v_entry_id uuid;
  v_pickup_id uuid;
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
    pendiente_fondo_blanco boolean
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
  ) then
    raise exception 'Una necesidad de MANTENIMENT contiene fila, identificador o fecha no válidos';
  end if;

  insert into tmp_alpha74_manteniment_raw(
    fila, trabajo_sync_id, clave_fila, dfm, matricula, numero_parada,
    taller, taller_norm, tipo_trabajo, tipo_norm, designacion,
    designacion_norm, fecha_necesidad, fecha_realizada, fecha_recogida,
    pendiente_fondo_blanco
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
    coalesce((item.value->>'pendiente_fondo_blanco')::boolean, false)
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
      and x.fecha_necesidad <= (a.fecha_generacion + interval '1 month')::date
      and (
        x.pendiente_fondo_blanco
        or sync_work.id is not null
        or key_work.id is not null
      )
      and (
        x.fecha_realizada is null
        or x.trabajo_sync_id is not null
        or x.numero_parada = a.numero_parada
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
       or sync_work.id is not null
       or key_work.id is not null
    group by x.fila,x.clave_fila
  )
  select count(*) into v_ambiguous from matches where n>1;

  select count(*) into v_candidate_count from tmp_alpha74_manteniment_candidates;

  -- Primero se fijan los grupos lógicos. El par F + H identifica un trabajo;
  -- todos los trabajos ordinarios del mismo F comparten una visita de taller.
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
      when translate(coalesce(v_group.tipo_norm, ''), 'Ó', 'O') like '%GESTION%' then 'gestion'
      when translate(coalesce(v_group.tipo_norm, ''), 'Á', 'A') like '%TRAMITE%' then 'tramite'
      when coalesce(v_group.taller_norm, '') = '' then 'pendiente_taller'
      else 'taller'
    end;
    v_clave_visita := case
      when v_modalidad = 'taller' then 'TALLER|F:' || v_group.taller_norm
      else upper(v_modalidad) || '|' || v_clave_trabajo
    end;

    select * into v_visit
    from app_private.manteniment_t_visitas
    where seguimiento_id = v_group.seguimiento_id and clave_visita = v_clave_visita
    for update;
    if not found then
      insert into app_private.manteniment_t_visitas(
        seguimiento_id, clave_visita, modalidad, taller, fecha_necesidad,
        grupo_entrada_id, grupo_recogida_id
      ) values (
        v_group.seguimiento_id, v_clave_visita, v_modalidad,
        coalesce(v_group.taller, ''), v_group.fecha_necesidad,
        case when v_modalidad = 'taller' then gen_random_uuid() end,
        case when v_modalidad = 'taller' then gen_random_uuid() end
      ) returning * into v_visit;
    else
      update app_private.manteniment_t_visitas
      set taller = coalesce(v_group.taller, taller),
          fecha_necesidad = least(fecha_necesidad, v_group.fecha_necesidad),
          actualizado_en = clock_timestamp()
      where id = v_visit.id
      returning * into v_visit;
    end if;

    v_current_work := null;
    if v_group.existing_work_id is not null then
      select * into v_current_work
      from app_private.manteniment_t_trabajos
      where id = v_group.existing_work_id and seguimiento_id = v_group.seguimiento_id
      for update;
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
      if v_current_work.clave_trabajo <> v_clave_trabajo and exists (
        select 1 from app_private.manteniment_t_trabajos conflicting_work
        where conflicting_work.seguimiento_id = v_group.seguimiento_id
          and conflicting_work.clave_trabajo = v_clave_trabajo
          and conflicting_work.id <> v_current_work.id
      ) then
        raise exception 'Una necesidad vinculada entra en conflicto con otro trabajo de la misma parada';
      end if;
      update app_private.manteniment_t_trabajos
      set visita_id = v_visit.id,
          clave_trabajo = v_clave_trabajo,
          taller = coalesce(v_group.taller, ''),
          tipo_trabajo = coalesce(v_group.tipo_trabajo, ''),
          designacion = v_group.designacion,
          fecha_necesidad = least(fecha_necesidad, v_group.fecha_necesidad),
          fecha_realizada = v_group.fecha_realizada,
          fecha_recogida = v_group.fecha_recogida,
          fuentes = v_group.fuentes,
          actualizado_en = clock_timestamp()
      where id = v_current_work.id;
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

      if v_visit_stage.modalidad = 'taller' then
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
        if v_visit_stage.modalidad = 'taller' then
          v_stage_id := v_entry_id;
        else
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
                when 'gestion' then 'Gestión · ' || v_work.designacion
                when 'tramite' then 'Trámite · ' || v_work.designacion
                else 'Pendiente de taller · ' || v_work.designacion
              end,
              v_pos,
              case when v_work.fecha_realizada is null then 'pendiente' else 'realizada' end,
              case when v_work.fecha_realizada is null then 'pendiente' else 'realizada' end,
              'otro', v_work.taller, null,
              case when v_work.fecha_realizada is null then null else v_work.fecha_realizada::timestamp at time zone 'Europe/Madrid' end,
              case when v_work.fecha_realizada is null then null else v_work.fecha_realizada::timestamp at time zone 'Europe/Madrid' end,
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
        if v_visit_stage.modalidad <> 'taller' and v_work.fecha_realizada is not null then
          update public.etapas_hotel
          set estado = 'realizada',
              estado_catalogo_codigo = 'realizada',
              fecha_fin_real = coalesce(fecha_fin_real, v_work.fecha_realizada::timestamp at time zone 'Europe/Madrid'),
              fecha_real = coalesce(fecha_real, v_work.fecha_realizada::timestamp at time zone 'Europe/Madrid'),
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

revoke execute on function app_private.manteniment_importar_trabajos(jsonb)
from public, anon, authenticated;

-- Reagrupa únicamente las T predictivas pendientes creadas erróneamente.
-- Se preservan todas las T realizadas, con fechas, documentos o resoluciones.
set constraints etapas_hotel_posicion_activa_uq deferred;
select set_config('app.reconciliando_etapas', '1', true);
select set_config('app.audit_origin', 'manteniment-alpha74.12-reagrupar-visita', true);

create temp table tmp_alpha74_reagrupar_taller on commit drop as
select
  w.id as vinculacion_id,
  w.trabajo_hotel_id,
  trabajo.etapa_hotel_id as etapa_trabajo_id,
  entrada.id as etapa_entrada_id,
  trabajo_etapa.registro_hotel_id
from app_private.manteniment_t_trabajos w
join app_private.manteniment_t_visitas visita
  on visita.id = w.visita_id
 and visita.modalidad = 'taller'
join public.trabajos_etapa_hotel trabajo
  on trabajo.id = w.trabajo_hotel_id
 and not trabajo.cancelado
join public.etapas_hotel trabajo_etapa
  on trabajo_etapa.id = trabajo.etapa_hotel_id
 and not trabajo_etapa.cancelado
 and trabajo_etapa.estado = 'pendiente'
 and trabajo_etapa.fecha_inicio_real is null
 and trabajo_etapa.fecha_fin_real is null
 and trabajo_etapa.fecha_real is null
 and trabajo_etapa.accion_sistema = ''
 and trabajo_etapa.observaciones like 'Necesidad detectada en MANTENIMENT el %.'
join public.etapas_hotel entrada
  on entrada.registro_hotel_id = trabajo_etapa.registro_hotel_id
 and entrada.grupo_documental_id = visita.grupo_entrada_id
 and not entrada.cancelado
where trabajo.etapa_hotel_id <> entrada.id
  and not exists (
    select 1
    from public.documentos_gestion d
    where not d.cancelado
      and (
        d.etapa_hotel_id = trabajo_etapa.id
        or d.grupo_etapa_id = trabajo_etapa.grupo_documental_id
      )
  )
  and not exists (
    select 1
    from public.reservas_pendientes_resueltos rpr
    where rpr.etapa_hotel_id = trabajo_etapa.id
  );

do $cleanup$
declare
  v_total integer;
begin
  select count(*) into v_total from tmp_alpha74_reagrupar_taller;
  if v_total > 50 then
    raise exception 'La corrección Alpha74.12 supera el límite seguro de 50 T pendientes';
  end if;
end;
$cleanup$;

update public.trabajos_etapa_hotel trabajo
set etapa_hotel_id = correccion.etapa_entrada_id,
    modificado_por = coalesce(trabajo.modificado_por, trabajo.creado_por),
    version = trabajo.version + 1,
    actualizado_en = clock_timestamp()
from tmp_alpha74_reagrupar_taller correccion
where trabajo.id = correccion.trabajo_hotel_id;

update public.etapas_hotel etapa
set cancelado = true,
    motivo_cancelacion = 'Agrupada como trabajo de la visita de taller por Alpha74.12.',
    cancelado_en = clock_timestamp(),
    cancelado_por = coalesce(etapa.modificado_por, etapa.creado_por),
    modificado_por = coalesce(etapa.modificado_por, etapa.creado_por),
    version = etapa.version + 1,
    actualizado_en = clock_timestamp()
from tmp_alpha74_reagrupar_taller correccion
where etapa.id = correccion.etapa_trabajo_id;

with registros_afectados as (
  select distinct registro_hotel_id
  from tmp_alpha74_reagrupar_taller
),
orden as (
  select
    e.id,
    row_number() over (
      partition by e.registro_hotel_id
      order by
        case when e.accion_sistema = 'recuperar_y_liberar' then 1 else 0 end,
        e.posicion,
        e.creado_en,
        e.id
    )::integer as nueva_posicion
  from public.etapas_hotel e
  join registros_afectados r on r.registro_hotel_id = e.registro_hotel_id
  where not e.cancelado
)
update public.etapas_hotel e
set posicion = orden.nueva_posicion,
    modificado_por = coalesce(e.modificado_por, e.creado_por),
    actualizado_en = clock_timestamp()
from orden
where e.id = orden.id
  and e.posicion is distinct from orden.nueva_posicion;

select set_config('app.reconciliando_etapas', '0', true);

commit;
