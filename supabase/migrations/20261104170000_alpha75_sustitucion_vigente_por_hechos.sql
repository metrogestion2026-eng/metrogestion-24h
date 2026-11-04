-- MG75-SUSTITUCION-VIGENTE-002
-- Una reserva/FLOTA escrita en la cabecera conserva el hecho histórico, pero no
-- acredita por sí sola que la sustitución continúe operativa. La vigencia exige
-- una obligación actual de recuperación/liberación, una 24H abierta con
-- sustituto real o una continuidad confirmada todavía no recuperada.

create or replace function app_private.evidencia_sustitucion_vigente_alpha75(
  p_registro_id uuid
)
returns text
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'public', 'app_private'
as $function$
declare
  v_r public.registros_hotel%rowtype;
  v_estado_pizarra text;
  v_cabecera_con_sustituto boolean := false;
  v_activacion_abierta boolean := false;
  v_recuperacion_abierta boolean := false;
  v_recuperacion_realizada_actual boolean := false;
  v_continuidad_entrada boolean := false;
  v_continuidad_salida boolean := false;
  v_continuidad_confirmada_en timestamptz;
  v_recuperacion_realizada_en timestamptz;
begin
  select r.*
  into v_r
  from public.registros_hotel r
  where r.id = p_registro_id;

  if not found then
    return '';
  end if;

  select p.estado
  into v_estado_pizarra
  from public.pizarras p
  where p.id = v_r.pizarra_id;

  if v_estado_pizarra <> 'en_curso'
     or v_r.cancelado
     or v_r.retirado_hotel_activo
     or v_r.estado in ('recuperado', 'reserva_liberada', 'anulado') then
    return '';
  end if;

  v_cabecera_con_sustituto :=
    nullif(btrim(coalesce(v_r.vehiculo_reserva, '')), '') is not null
    or nullif(btrim(coalesce(v_r.matricula_reserva, '')), '') is not null;

  select
    exists (
      select 1
      from app_private.sustitucion_continuidades_alpha75 c
      where c.destino_seguimiento_id = v_r.seguimiento_id
    ),
    exists (
      select 1
      from app_private.sustitucion_continuidades_alpha75 c
      where c.origen_seguimiento_id = v_r.seguimiento_id
    ),
    (
      select max(c.confirmado_en)
      from app_private.sustitucion_continuidades_alpha75 c
      where c.destino_seguimiento_id = v_r.seguimiento_id
    )
  into
    v_continuidad_entrada,
    v_continuidad_salida,
    v_continuidad_confirmada_en;

  -- Una PA que ya cedió el sustituto conserva la historia, pero no su vigencia.
  if v_continuidad_salida then
    return '';
  end if;

  select exists (
    select 1
    from public.etapas_hotel e
    where e.registro_hotel_id = v_r.id
      and not e.cancelado
      and app_private.es_recuperacion_rec001(to_jsonb(e))
      and (
        e.estado = 'realizada'
        or e.fecha_fin_real is not null
        or e.fecha_real is not null
        or coalesce(e.marcado_rapido, false)
      )
  ) into v_recuperacion_realizada_actual;

  -- Un hecho físico de recuperación en la ficha actual siempre cierra la
  -- sustitución, aunque la cabecera conserve el DFM y la matrícula.
  if v_recuperacion_realizada_actual then
    return '';
  end if;

  select exists (
    select 1
    from public.etapas_hotel e
    where e.registro_hotel_id = v_r.id
      and not e.cancelado
      and app_private.es_recuperacion_rec001(to_jsonb(e))
      and e.estado in ('pendiente', 'programada', 'en_curso')
      and e.fecha_fin_real is null
      and e.fecha_real is null
      and not coalesce(e.marcado_rapido, false)
  ) into v_recuperacion_abierta;

  select exists (
    select 1
    from public.activaciones_24h a
    where (
      a.registro_hotel_id = v_r.id
      or a.seguimiento_hotel_id = v_r.seguimiento_id
    )
      and a.estado = 'abierta'
      and (
        nullif(btrim(coalesce(a.vehiculo_sustituto, '')), '') is not null
        or nullif(btrim(coalesce(a.matricula_sustituto, '')), '') is not null
      )
  ) into v_activacion_abierta;

  if v_recuperacion_abierta
     and (
       v_cabecera_con_sustituto
       or v_activacion_abierta
       or v_continuidad_entrada
     ) then
    return 'recuperacion_o_liberacion_pendiente';
  end if;

  if v_activacion_abierta then
    return '24h_abierta_con_sustituto';
  end if;

  if v_continuidad_entrada then
    select max(
      coalesce(
        e.fecha_real,
        e.fecha_fin_real,
        e.actualizado_en
      )
    )
    into v_recuperacion_realizada_en
    from public.registros_hotel h
    join public.etapas_hotel e on e.registro_hotel_id = h.id
    where h.seguimiento_id = v_r.seguimiento_id
      and not h.cancelado
      and not e.cancelado
      and app_private.es_recuperacion_rec001(to_jsonb(e))
      and (
        e.estado = 'realizada'
        or e.fecha_fin_real is not null
        or e.fecha_real is not null
        or coalesce(e.marcado_rapido, false)
      );

    -- Una recuperación anterior a la continuidad no cierra el nuevo tramo.
    if v_recuperacion_realizada_en is null
       or v_continuidad_confirmada_en is null
       or v_recuperacion_realizada_en < v_continuidad_confirmada_en then
      return 'continuidad_confirmada_sin_recuperacion';
    end if;
  end if;

  return '';
end;
$function$;

revoke all on function app_private.evidencia_sustitucion_vigente_alpha75(uuid)
  from public;

create or replace function app_private.sustitucion_vigente_por_hechos_alpha75(
  p_registro_id uuid
)
returns boolean
language sql
stable
security definer
set search_path to 'pg_catalog', 'app_private'
as $function$
  select app_private.evidencia_sustitucion_vigente_alpha75(p_registro_id) <> ''
$function$;

revoke all on function app_private.sustitucion_vigente_por_hechos_alpha75(uuid)
  from public;

create or replace function app_private.metadatos_continuidad_alpha75(
  p_seguimiento_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'public', 'app_private'
as $function$
declare
  i app_private.sustitucion_continuidades_alpha75%rowtype;
  o app_private.sustitucion_continuidades_alpha75%rowtype;
  v_final uuid;
  r public.registros_hotel%rowtype;
  v_owner jsonb;
  v_recuperacion date;
  v_estado text;
  v_vigente boolean := false;
  v_evidencia text := '';
begin
  select * into i
  from app_private.sustitucion_continuidades_alpha75
  where destino_seguimiento_id = p_seguimiento_id;

  select * into o
  from app_private.sustitucion_continuidades_alpha75
  where origen_seguimiento_id = p_seguimiento_id;

  with recursive cadena as (
    select p_seguimiento_id as seguimiento,
           array[p_seguimiento_id] as camino
    union all
    select c.destino_seguimiento_id,
           ca.camino || c.destino_seguimiento_id
    from cadena ca
    join app_private.sustitucion_continuidades_alpha75 c
      on c.origen_seguimiento_id = ca.seguimiento
    where not c.destino_seguimiento_id = any(ca.camino)
  )
  select seguimiento
  into v_final
  from cadena
  order by cardinality(camino) desc
  limit 1;

  select h.*
  into r
  from public.registros_hotel h
  join public.pizarras p on p.id = h.pizarra_id
  where h.seguimiento_id = v_final
  order by
    (p.estado = 'en_curso') desc,
    p.fecha desc,
    h.actualizado_en desc,
    h.id desc
  limit 1;

  if found then
    select p.estado
    into v_estado
    from public.pizarras p
    where p.id = r.pizarra_id;

    if v_estado = 'en_curso'
       and not r.cancelado
       and not r.retirado_hotel_activo
       and r.estado not in ('recuperado', 'reserva_liberada', 'anulado') then
      v_evidencia :=
        app_private.evidencia_sustitucion_vigente_alpha75(r.id);

      if v_evidencia <> '' then
        v_owner := jsonb_build_object(
          'id', r.id,
          'seguimiento_id', r.seguimiento_id,
          'numero_parada', r.numero_parada
        );
        v_vigente := v_final = p_seguimiento_id;
      end if;
    end if;
  end if;

  -- Una continuidad activa no puede conservar simultáneamente una fecha final
  -- antigua. La recuperación histórica solo cierra cuando ya no hay evidencia
  -- operativa vigente en el tramo final.
  if i.id is not null
     and o.id is null
     and not v_vigente then
    select max(
      (coalesce(e.fecha_real, e.fecha_fin_real)
        at time zone 'Europe/Madrid')::date
    )
    into v_recuperacion
    from public.etapas_hotel e
    join public.registros_hotel h on h.id = e.registro_hotel_id
    where h.seguimiento_id = p_seguimiento_id
      and not h.cancelado
      and not e.cancelado
      and app_private.es_recuperacion_rec001(to_jsonb(e))
      and (
        e.estado = 'realizada'
        or e.fecha_real is not null
        or e.fecha_fin_real is not null
        or coalesce(e.marcado_rapido, false)
      )
      and coalesce(e.fecha_real, e.fecha_fin_real) is not null;
  end if;

  return jsonb_build_object(
    'continuidad_entrada_id', i.id,
    'continuidad_salida_id', o.id,
    'continuidad_origen_seguimiento_id', i.origen_seguimiento_id,
    'continuidad_origen_numero_parada', i.origen_numero_parada,
    'continuidad_destino_seguimiento_id', o.destino_seguimiento_id,
    'continuidad_destino_numero_parada', o.destino_numero_parada,
    'fecha_inicio_imputacion', i.dia_entrada,
    'fecha_fin_imputacion', case
      when o.id is not null then o.dia_entrada - 1
      else v_recuperacion
    end,
    'fin_imputacion_motivo', case
      when o.id is not null then 'continuidad'
      when v_recuperacion is not null then 'recuperacion'
      else ''
    end,
    'propietario_actual', v_owner,
    'propietario_sustitucion_seguimiento_id', case
      when v_owner is not null then v_final
    end,
    'sustitucion_vigente', v_vigente,
    'sustitucion_vigente_evidencia', v_evidencia
  );
end;
$function$;

-- Recalcula toda la Pizarra actual. Conserva los campos históricos del
-- sustituto; solo corrige la clasificación Activa cuando ya no existe un hecho
-- operativo que acredite la sustitución.
do $migration$
declare
  v_id uuid;
begin
  if to_regprocedure(
    'app_private.sincronizar_situacion_operativa_hotel_alpha75(uuid,boolean)'
  ) is null then
    return;
  end if;

  perform set_config(
    'app.request_id',
    'sustitucion_hechos_20261104',
    true
  );
  perform set_config(
    'app.audit_origin',
    'metrogestion-r1-sustitucion-vigente-hechos',
    true
  );

  for v_id in
    select r.id
    from public.registros_hotel r
    join public.pizarras p on p.id = r.pizarra_id
    where p.estado = 'en_curso'
      and not r.cancelado
    order by r.orden, r.id
  loop
    execute
      'select app_private.sincronizar_situacion_operativa_hotel_alpha75($1, true)'
      using v_id;
  end loop;
end;
$migration$;

do $migration$
begin
  if to_regprocedure(
    'app_private.proyectar_situacion_operativa_hotel_alpha75(uuid)'
  ) is null then
    return;
  end if;

  if exists (
    select 1
    from public.registros_hotel r
    join public.pizarras p
      on p.id = r.pizarra_id
     and p.estado = 'en_curso'
    where not r.cancelado
      and not r.retirado_hotel_activo
      and not coalesce(
        (
          app_private.proyectar_situacion_operativa_hotel_alpha75(r.id)
          ->> 'activa_recomendada'
        )::boolean,
        false
      )
  ) then
    raise exception
      'MG75-SUSTITUCION-VIGENTE-002: queda una ficha cerrada dentro de Activas';
  end if;

  if exists (
    select 1
    from public.registros_hotel r
    join public.pizarras p
      on p.id = r.pizarra_id
     and p.estado = 'en_curso'
    where not r.cancelado
      and not r.retirado_hotel_activo
      and coalesce(
        (
          app_private.metadatos_continuidad_alpha75(r.seguimiento_id)
          ->> 'sustitucion_vigente'
        )::boolean,
        false
      )
      and app_private.evidencia_sustitucion_vigente_alpha75(r.id) = ''
  ) then
    raise exception
      'MG75-SUSTITUCION-VIGENTE-002: queda una sustitución vigente sin hecho operativo';
  end if;
end;
$migration$;
