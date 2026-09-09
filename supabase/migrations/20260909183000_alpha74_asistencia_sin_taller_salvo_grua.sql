begin;

-- Una asistencia 24H se resuelve por defecto en carretera. El taller indicado
-- en MANTENIMENT es informativo hasta que Activar 24H confirme el traslado.
-- La T final de recuperar ruta queda fuera de esta reconciliacion y se conserva.
create or replace function app_private.manteniment_reconciliar_asistencia_alpha74(
  p_registro_id uuid
)
returns void
language plpgsql
security definer
set search_path = 'pg_catalog', 'public', 'app_private'
as $function$
declare
  v_ficha public.registros_hotel%rowtype;
  v_asistencia_id uuid;
  v_traslado boolean := false;
  v_visit app_private.manteniment_t_visitas%rowtype;
  v_entry_id uuid;
  v_pickup_id uuid;
  v_recovery_id uuid;
  v_pos integer;
  v_actor uuid;
begin
  select * into v_ficha
  from public.registros_hotel
  where id = p_registro_id
  for update;

  if v_ficha.id is null then
    return;
  end if;

  select e.id into v_asistencia_id
  from public.etapas_hotel e
  where e.registro_hotel_id = v_ficha.id
    and not e.cancelado
    and regexp_replace(upper(btrim(coalesce(e.nombre, ''))), '[^A-Z0-9]+', '', 'g')
      in ('24H', 'ASISTENCIA24H')
  order by (e.estado = 'en_curso') desc, e.posicion, e.creado_en
  limit 1;

  if v_asistencia_id is null then
    return;
  end if;

  -- Prima la vinculacion exacta. Para activaciones antiguas todavia no
  -- vinculadas se admite la incidencia abierta del mismo DFM y matricula,
  -- creada alrededor de la ficha de parada.
  select coalesce(a.trasladado_taller, false)
         or lower(btrim(coalesce(a.resultado, ''))) = 'trasladado_taller'
  into v_traslado
  from public.activaciones_24h a
  where coalesce(a.estado, '') <> 'anulada'
    and (
      a.registro_hotel_id = v_ficha.id
      or a.seguimiento_hotel_id = v_ficha.seguimiento_id
      or (
        a.registro_hotel_id is null
        and a.seguimiento_hotel_id is null
        and regexp_replace(upper(btrim(coalesce(a.dfm, ''))), '[[:space:]]+', '', 'g')
          = regexp_replace(upper(btrim(coalesce(v_ficha.vehiculo_sustituido, ''))), '[[:space:]]+', '', 'g')
        and (
          btrim(coalesce(a.matricula, '')) = ''
          or btrim(coalesce(v_ficha.matricula_sustituido, '')) = ''
          or regexp_replace(upper(btrim(a.matricula)), '[^A-Z0-9]+', '', 'g')
             = regexp_replace(upper(btrim(v_ficha.matricula_sustituido)), '[^A-Z0-9]+', '', 'g')
        )
        and a.creado_en between v_ficha.creado_en - interval '1 day'
                            and v_ficha.creado_en + interval '7 days'
      )
    )
  order by
    (a.registro_hotel_id = v_ficha.id) desc,
    (a.seguimiento_hotel_id = v_ficha.seguimiento_id) desc,
    (a.estado = 'abierta') desc,
    a.actualizado_en desc,
    a.creado_en desc
  limit 1;

  v_traslado := coalesce(v_traslado, false);
  v_actor := coalesce(v_ficha.modificado_por, v_ficha.creado_por);
  perform set_config('app.reconciliando_etapas', '1', true);
  perform set_config('app.audit_origin', 'manteniment-alpha74-asistencia', true);
  set constraints etapas_hotel_posicion_activa_uq deferred;

  for v_visit in
    select v.*
    from app_private.manteniment_t_visitas v
    where v.seguimiento_id = v_ficha.seguimiento_id
      and v.modalidad in ('taller', 'entrada_sin_recogida')
      and v.grupo_entrada_id is not null
    order by v.fecha_necesidad, v.creado_en, v.id
  loop
    -- No se reescribe una entrada o recogida que ya fue realizada: es
    -- evidencia historica de que el vehiculo sí llegó al taller.
    if exists (
      select 1 from public.etapas_hotel e
      where e.registro_hotel_id = v_ficha.id
        and e.grupo_documental_id in (v_visit.grupo_entrada_id, v_visit.grupo_recogida_id)
        and (e.estado = 'realizada' or e.fecha_real is not null or e.fecha_fin_real is not null)
    ) then
      continue;
    end if;

    if not v_traslado then
      update public.trabajos_etapa_hotel t
      set etapa_hotel_id = v_asistencia_id,
          modificado_por = coalesce(v_actor, t.modificado_por),
          actualizado_en = clock_timestamp(),
          version = t.version + 1
      from app_private.manteniment_t_trabajos w
      where w.visita_id = v_visit.id
        and w.trabajo_hotel_id = t.id
        and t.etapa_hotel_id is distinct from v_asistencia_id;

      update public.etapas_hotel e
      set cancelado = true,
          estado = 'anulada',
          estado_catalogo_codigo = 'anulada',
          motivo_cancelacion = 'Asistencia 24H sin traslado en grúa a taller.',
          cancelado_en = clock_timestamp(),
          cancelado_por = coalesce(v_actor, e.cancelado_por),
          modificado_por = coalesce(v_actor, e.modificado_por),
          actualizado_en = clock_timestamp(),
          version = e.version + 1
      where e.registro_hotel_id = v_ficha.id
        and e.grupo_documental_id in (v_visit.grupo_entrada_id, v_visit.grupo_recogida_id)
        and not e.cancelado
        and e.estado <> 'realizada';
    else
      -- Si posteriormente se confirma la grúa, se restauran (o crean) la
      -- entrada y la recogida y el trabajo vuelve a la entrada de taller.
      select e.id into v_recovery_id
      from public.etapas_hotel e
      where e.registro_hotel_id = v_ficha.id
        and not e.cancelado
        and e.accion_sistema = 'recuperar_y_liberar'
      order by e.creado_en
      limit 1;

      if v_recovery_id is not null then
        update public.etapas_hotel
        set posicion = posicion + 10000,
            modificado_por = coalesce(v_actor, modificado_por)
        where id = v_recovery_id;
      end if;

      select coalesce(max(e.posicion), 0) into v_pos
      from public.etapas_hotel e
      where e.registro_hotel_id = v_ficha.id
        and not e.cancelado
        and e.accion_sistema is distinct from 'recuperar_y_liberar';

      select e.id into v_entry_id
      from public.etapas_hotel e
      where e.registro_hotel_id = v_ficha.id
        and e.grupo_documental_id = v_visit.grupo_entrada_id
      order by e.cancelado, e.creado_en
      limit 1;

      v_pos := v_pos + 1;
      if v_entry_id is null then
        insert into public.etapas_hotel(
          registro_hotel_id, seguimiento_id, grupo_documental_id, nombre,
          posicion, estado, estado_catalogo_codigo, tipo_etapa, lugar,
          observaciones, cancelado, creado_por, modificado_por
        ) values (
          v_ficha.id, gen_random_uuid(), v_visit.grupo_entrada_id,
          'Entrada ' || v_visit.taller, v_pos, 'pendiente', 'pendiente',
          'entrada_taller', v_visit.taller,
          'Generada al confirmar traslado en grúa a taller.', false,
          v_actor, v_actor
        ) returning id into v_entry_id;
      else
        update public.etapas_hotel
        set cancelado = false,
            estado = 'pendiente',
            estado_catalogo_codigo = 'pendiente',
            motivo_cancelacion = '',
            cancelado_en = null,
            cancelado_por = null,
            posicion = v_pos,
            modificado_por = coalesce(v_actor, modificado_por),
            actualizado_en = clock_timestamp(),
            version = version + 1
        where id = v_entry_id
          and cancelado
          and motivo_cancelacion = 'Asistencia 24H sin traslado en grúa a taller.';
      end if;

      if v_visit.grupo_recogida_id is null then
        update app_private.manteniment_t_visitas
        set modalidad = 'taller',
            grupo_recogida_id = gen_random_uuid(),
            actualizado_en = clock_timestamp()
        where id = v_visit.id
        returning * into v_visit;
      end if;

      select e.id into v_pickup_id
      from public.etapas_hotel e
      where e.registro_hotel_id = v_ficha.id
        and e.grupo_documental_id = v_visit.grupo_recogida_id
      order by e.cancelado, e.creado_en
      limit 1;

      v_pos := v_pos + 1;
      if v_pickup_id is null then
        insert into public.etapas_hotel(
          registro_hotel_id, seguimiento_id, grupo_documental_id, nombre,
          posicion, estado, estado_catalogo_codigo, tipo_etapa, lugar,
          observaciones, cancelado, creado_por, modificado_por, etapa_origen_id
        ) values (
          v_ficha.id, gen_random_uuid(), v_visit.grupo_recogida_id,
          'Recogida ' || v_visit.taller, v_pos, 'pendiente', 'pendiente',
          'recogida_taller', v_visit.taller,
          'Generada al confirmar traslado en grúa a taller.', false,
          v_actor, v_actor, v_entry_id
        ) returning id into v_pickup_id;
      else
        update public.etapas_hotel
        set cancelado = false,
            estado = 'pendiente',
            estado_catalogo_codigo = 'pendiente',
            motivo_cancelacion = '',
            cancelado_en = null,
            cancelado_por = null,
            posicion = v_pos,
            etapa_origen_id = v_entry_id,
            modificado_por = coalesce(v_actor, modificado_por),
            actualizado_en = clock_timestamp(),
            version = version + 1
        where id = v_pickup_id
          and cancelado
          and motivo_cancelacion = 'Asistencia 24H sin traslado en grúa a taller.';
      end if;

      update public.trabajos_etapa_hotel t
      set etapa_hotel_id = v_entry_id,
          modificado_por = coalesce(v_actor, t.modificado_por),
          actualizado_en = clock_timestamp(),
          version = t.version + 1
      from app_private.manteniment_t_trabajos w
      where w.visita_id = v_visit.id
        and w.trabajo_hotel_id = t.id
        and t.etapa_hotel_id is distinct from v_entry_id;

      if v_recovery_id is not null then
        v_pos := v_pos + 1;
        update public.etapas_hotel
        set posicion = v_pos,
            modificado_por = coalesce(v_actor, modificado_por)
        where id = v_recovery_id;
      end if;
    end if;
  end loop;

  perform set_config('app.reconciliando_etapas', '0', true);
  perform app_private.manteniment_encolar_parada(v_ficha.seguimiento_id);
exception when others then
  perform set_config('app.reconciliando_etapas', '0', true);
  raise;
end;
$function$;

revoke execute on function app_private.manteniment_reconciliar_asistencia_alpha74(uuid)
  from public, anon, authenticated;

-- Conserva la inferencia DFM vigente y reconcilia despues las asistencias
-- incluidas en el lote. El resultado publico de la sincronizacion no cambia.
create or replace function app_private.manteniment_importar_trabajos(p_trabajos jsonb)
returns jsonb
language plpgsql
security definer
set search_path = 'pg_catalog', 'public', 'app_private'
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
  ) inferred;

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

revoke execute on function app_private.manteniment_importar_trabajos(jsonb)
  from public, anon;
grant execute on function app_private.manteniment_importar_trabajos(jsonb)
  to authenticated;

comment on function app_private.manteniment_reconciliar_asistencia_alpha74(uuid) is
  'Mantiene la recuperacion de ruta y suprime Entrada/Recogida en asistencias salvo traslado en grua confirmado.';

commit;
