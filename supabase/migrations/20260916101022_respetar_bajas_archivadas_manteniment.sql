-- Respeta bajas manuales archivadas sin reactivar unidades ni modificar el Histórico.
CREATE OR REPLACE FUNCTION app_private.manteniment_encolar_parada(p_seguimiento_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'app_private'
AS $function$
declare
  v_payload jsonb;
  v_trabajos jsonb;
  v_ajuste_24h jsonb;
  v_sync_id uuid;
  v_numero_parada text;
begin
  -- Una baja manual protegida conserva su Hotel histórico, pero ya no envía
  -- órdenes operativas a la hoja de activos MANTENIMENT.
  if exists (
    select 1 from public.vehiculos v
    join lateral (
      select r.vehiculo_sustituido from public.registros_hotel r
      join public.pizarras p on p.id=r.pizarra_id
      where r.seguimiento_id=p_seguimiento_id
      order by (p.estado='en_curso') desc,p.fecha desc,r.actualizado_en desc,r.id desc
      limit 1
    ) ficha on v.dfm=regexp_replace(upper(btrim(ficha.vehiculo_sustituido)),'[[:space:]]+','','g')
    where not v.activo and v.baja_manual_bloquea_sync
  ) then
    delete from app_private.manteniment_parada_outbox where seguimiento_id=p_seguimiento_id;
    return;
  end if;

  v_trabajos := app_private.manteniment_trabajos_asignados(p_seguimiento_id);
  v_ajuste_24h := app_private.manteniment_ajuste_24h(p_seguimiento_id);
  v_payload := app_private.manteniment_construir_payload_parada(p_seguimiento_id);

  if v_payload is null then
    if jsonb_array_length(v_trabajos) = 0 and v_ajuste_24h is null then
      delete from app_private.manteniment_parada_outbox
      where seguimiento_id = p_seguimiento_id;
      return;
    end if;

    select s.sync_id,
           nullif(btrim(coalesce(r.numero_parada, '')), '')
      into v_sync_id, v_numero_parada
    from app_private.manteniment_parada_sync s
    join lateral (
      select h.numero_parada
      from public.registros_hotel h
      join public.pizarras p on p.id = h.pizarra_id
      where h.seguimiento_id = p_seguimiento_id
      order by (p.estado = 'en_curso') desc, p.fecha desc,
               h.actualizado_en desc, h.id desc
      limit 1
    ) r on true
    where s.seguimiento_id = p_seguimiento_id;

    if v_sync_id is null or v_numero_parada is null then return; end if;
    v_payload := jsonb_build_object(
      'sync_id', v_sync_id,
      'seguimiento_id', p_seguimiento_id,
      'numero_parada', 'PA-' || v_numero_parada,
      'solo_trabajos', true,
      'trabajos_asignados', v_trabajos
    );
  else
    v_payload := jsonb_set(v_payload, '{solo_trabajos}', 'false'::jsonb, true);
    v_payload := jsonb_set(v_payload, '{trabajos_asignados}', v_trabajos, true);
    v_sync_id := (v_payload->>'sync_id')::uuid;
  end if;

  if v_ajuste_24h is not null then
    v_payload := jsonb_set(v_payload, '{ajuste_24h}', v_ajuste_24h, true);
  end if;

  insert into app_private.manteniment_parada_outbox(
    seguimiento_id, sync_id, revision, estado, payload,
    actualizado_en, confirmado_en, ultimo_error
  ) values (
    p_seguimiento_id, v_sync_id, 1, 'pendiente', v_payload,
    clock_timestamp(), null, ''
  )
  on conflict (seguimiento_id) do update
  set sync_id = excluded.sync_id,
      revision = app_private.manteniment_parada_outbox.revision + 1,
      estado = 'pendiente',
      payload = excluded.payload,
      actualizado_en = clock_timestamp(),
      confirmado_en = null,
      ultimo_error = '';
end;
$function$
;

CREATE OR REPLACE FUNCTION app_private.aplicar_snapshot_manteniment(p_payload jsonb, p_modo text DEFAULT 'programada'::text, p_actor uuid DEFAULT NULL::uuid, p_origen text DEFAULT 'google_apps_script'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'app_private'
AS $function$
declare
  v_payload jsonb := p_payload;
  v_filas jsonb := '[]'::jsonb;
  v_result jsonb;
  v_bloqueadas integer := 0;
  v_paradas integer := 0;
  v_trabajos jsonb := '{}'::jsonb;
  v_comandos jsonb := '[]'::jsonb;
begin
  if jsonb_typeof(p_payload) = 'object' and jsonb_typeof(p_payload->'filas') = 'array' then
    select coalesce(jsonb_agg(f.value order by f.ordinality) filter (where not f.bloqueada), '[]'::jsonb),
           count(*) filter (where f.bloqueada)
      into v_filas, v_bloqueadas
    from (
      select e.value, e.ordinality,
             exists (
               select 1 from public.vehiculos v
               where v.baja_manual_bloquea_sync = true
                 and v.dfm = regexp_replace(upper(btrim(coalesce(e.value->>'dfm', ''))), '[[:space:]]+', '', 'g')
             ) as bloqueada
      from jsonb_array_elements(p_payload->'filas') with ordinality e(value, ordinality)
    ) f;
    v_payload := jsonb_set(p_payload, '{filas}', v_filas, true);
  end if;

  perform set_config('app.manteniment_importando_altas', '1', true);
  v_result := app_private.aplicar_snapshot_manteniment_base(v_payload, p_modo, p_actor, p_origen);
  if not coalesce((v_result->>'ok')::boolean, false) then
    perform set_config('app.manteniment_importando_altas', '0', true);
    return v_result;
  end if;

  update public.vehiculos v
  set fecha_matriculacion = x.fecha_matriculacion::date
  from jsonb_to_recordset(v_filas) as x(dfm text, fecha_matriculacion text)
  where v.dfm = regexp_replace(upper(btrim(coalesce(x.dfm, ''))), '[[:space:]]+', '', 'g')
    and btrim(coalesce(x.fecha_matriculacion, '')) ~ '^\d{4}-\d{2}-\d{2}$'
    and v.fecha_matriculacion is distinct from x.fecha_matriculacion::date;
  perform set_config('app.manteniment_importando_altas', '0', true);

  v_paradas := app_private.manteniment_importar_paradas(p_payload->'paradas');
  v_trabajos := app_private.manteniment_importar_trabajos(p_payload->'trabajos');

  perform app_private.manteniment_encolar_parada(v.seguimiento_id)
  from public.paradas_sustitucion_resumen v
  join app_private.manteniment_parada_sync s using (seguimiento_id)
  where v.clase_facturacion = 'DFM'
    and v.sustituto is not null
    and v.fecha_fin_parada is null
    and s.fila_manteniment is not null;

  -- Retira órdenes antiguas que quedaron pendientes antes de registrar la baja.
  delete from app_private.manteniment_parada_outbox o
  using public.vehiculos v
  where o.estado='pendiente'
    and v.dfm=regexp_replace(upper(btrim(o.payload->>'dfm')),'[[:space:]]+','','g')
    and not v.activo and v.baja_manual_bloquea_sync;

  -- Si la fotografía válida ya no trae ALTA, no se debe recrear la unidad
  -- archivada como una fila BAJA nueva. Si aún trae ALTA, sí se envía la baja.
  if jsonb_typeof(p_payload->'filas')='array' then
    delete from app_private.manteniment_activo_outbox o
    using public.vehiculos v
    where o.vehiculo_id=v.id and o.estado='pendiente'
      and o.payload->>'estado'='BAJA'
      and not v.activo and v.baja_manual_bloquea_sync
      and not exists (
        select 1 from jsonb_array_elements(p_payload->'filas') x(value)
        where v.dfm=regexp_replace(upper(btrim(x.value->>'dfm')),'[[:space:]]+','','g')
      );
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'tipo', c.tipo,
    'vehiculo_id', c.vehiculo_id,
    'sync_id', c.sync_id,
    'revision', c.revision,
    'payload', c.payload
  ) order by c.actualizado_en, c.tipo, c.clave), '[]'::jsonb)
  into v_comandos
  from (
    select 'alta'::text as tipo, o.vehiculo_id, null::uuid as sync_id,
           o.revision, o.payload, o.actualizado_en, o.vehiculo_id::text as clave
    from app_private.manteniment_activo_outbox o
    where o.estado = 'pendiente'
    union all
    select 'parada'::text, null::uuid, o.sync_id,
           o.revision, o.payload, o.actualizado_en, o.sync_id::text
    from app_private.manteniment_parada_outbox o
    where o.estado = 'pendiente'
    order by actualizado_en, tipo, clave
    limit 200
  ) c;

  if v_bloqueadas > 0 then
    update public.manteniment_sync_ejecuciones
    set detalle = jsonb_set(coalesce(detalle, '{}'::jsonb), '{bajas_manuales_protegidas}', to_jsonb(v_bloqueadas), true),
        mensaje = concat_ws(' ', mensaje, format('%s baja(s) manual(es) protegida(s).', v_bloqueadas))
    where id = (v_result->>'ejecucion_id')::uuid;
  end if;

  update public.manteniment_sync_ejecuciones
  set detalle = coalesce(detalle, '{}'::jsonb) || jsonb_build_object(
    'paradas_recibidas', v_paradas,
    'trabajos_predictivos', v_trabajos,
    'comandos_manteniment_pendientes', jsonb_array_length(v_comandos)
  )
  where id = (v_result->>'ejecucion_id')::uuid;

  return v_result || jsonb_build_object(
    'bajas_manuales_protegidas', v_bloqueadas,
    'paradas_recibidas', v_paradas,
    'trabajos_predictivos', v_trabajos,
    'comandos_manteniment', v_comandos
  );
end;
$function$
;
