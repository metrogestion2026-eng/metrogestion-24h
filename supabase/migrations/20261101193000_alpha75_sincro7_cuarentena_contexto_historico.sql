-- SINCRO 7 · cuarentena de UUID únicos con contexto histórico o incoherente.
-- Extiende la lógica anterior sin modificar fechas ni datos manuales.

begin;

create or replace function app_private.manteniment_importar_trabajos(p_trabajos jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'app_private'
as $function$
declare
  v_identificados jsonb := '[]'::jsonb;
  v_resueltos jsonb := '[]'::jsonb;
  v_cuarentena jsonb := '[]'::jsonb;
  v_result jsonb;
  v_uuid text;
  v_total integer;
  v_match_count integer;
  v_item jsonb;
  v_work app_private.manteniment_t_trabajos%rowtype;
  v_job public.trabajos_etapa_hotel%rowtype;
  v_record public.registros_hotel%rowtype;
  v_catalog record;
begin
  if coalesce((select c.pausa_importacion_identidad
               from app_private.manteniment_sync_config c
               where c.id=1), true) then
    raise exception using errcode='55000',
      message='MG_SYNC_PAUSADA_IDENTIDAD: Sincronización detenida hasta completar la revisión de identidad; no reenviar ni confirmar órdenes.';
  end if;

  if p_trabajos is null then
    return app_private.manteniment_importar_trabajos_alpha74_base('[]'::jsonb);
  end if;
  if jsonb_typeof(p_trabajos) <> 'array' or jsonb_array_length(p_trabajos) > 10000 then
    raise exception 'Bloque de trabajos no válido';
  end if;

  select coalesce(jsonb_agg(e.value order by e.ordinality), '[]'::jsonb)
    into v_identificados
  from jsonb_array_elements(p_trabajos) with ordinality e(value, ordinality)
  where jsonb_typeof(e.value) = 'object'
    and coalesce(e.value->>'trabajo_sync_id','') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and e.value->>'trabajo_sync_id' <> '00000000-0000-0000-0000-000000000000'
    and regexp_replace(upper(btrim(coalesce(e.value->>'numero_parada',''))),'[[:space:]]+','','g') ~ '^PA-[0-9]+$';

  for v_uuid, v_total in
    select lower(e.value->>'trabajo_sync_id'), count(*)::integer
    from jsonb_array_elements(v_identificados) e(value)
    group by lower(e.value->>'trabajo_sync_id')
    order by lower(e.value->>'trabajo_sync_id')
  loop
    if v_total = 1 then
      select e.value into v_item
      from jsonb_array_elements(v_identificados) with ordinality e(value, ordinality)
      where lower(e.value->>'trabajo_sync_id') = v_uuid
      limit 1;

      select * into v_work
      from app_private.manteniment_t_trabajos
      where sync_id = v_uuid::uuid;

      if v_work.id is null then
        v_cuarentena := v_cuarentena || jsonb_build_array(jsonb_build_object(
          'trabajo_sync_id', v_uuid,
          'fila', v_item->>'fila',
          'motivo', 'UUID_UNICO_SIN_IDENTIDAD_CANONICA'
        ));
        continue;
      end if;

      select * into v_job
      from public.trabajos_etapa_hotel
      where id = v_work.trabajo_hotel_id;

      select r.* into v_record
      from public.registros_hotel r
      join public.pizarras p on p.id = r.pizarra_id
      where r.seguimiento_id = v_work.seguimiento_id
      order by (p.estado='en_curso') desc, p.fecha desc,
               r.actualizado_en desc nulls last, r.id desc
      limit 1;

      if v_job.id is null
         or v_record.id is null
         or v_record.cancelado
         or v_record.retirado_hotel_activo
         or v_record.estado in ('recuperado','reserva_liberada','anulado')
         or regexp_replace(upper(btrim(coalesce(v_record.vehiculo_sustituido,''))),'[[:space:]]+','','g')
            is distinct from regexp_replace(upper(btrim(coalesce(v_item->>'dfm',''))),'[[:space:]]+','','g')
         or regexp_replace(upper(btrim(coalesce(v_record.matricula_sustituido,''))),'[[:space:]]+','','g')
            is distinct from regexp_replace(upper(btrim(coalesce(v_item->>'matricula',''))),'[[:space:]]+','','g')
         or regexp_replace(upper(btrim(coalesce(v_record.numero_parada,''))),'^PA[- ]*','','g')
            is distinct from regexp_replace(upper(btrim(coalesce(v_item->>'numero_parada',''))),'^PA[- ]*','','g')
         or translate(upper(btrim(coalesce(v_work.designacion,''))),'ÁÉÍÓÚÜ','AEIOUU')
            is distinct from translate(upper(btrim(coalesce(v_item->>'designacion',''))),'ÁÉÍÓÚÜ','AEIOUU')
      then
        v_cuarentena := v_cuarentena || jsonb_build_array(jsonb_build_object(
          'trabajo_sync_id', v_uuid,
          'fila', v_item->>'fila',
          'motivo', 'UUID_UNICO_CONTEXTO_HISTORICO_O_INCOHERENTE'
        ));
        continue;
      end if;

      v_resueltos := v_resueltos || jsonb_build_array(v_item);
      continue;
    end if;

    select * into v_work
    from app_private.manteniment_t_trabajos
    where sync_id = v_uuid::uuid;

    if v_work.id is null then
      v_cuarentena := v_cuarentena || jsonb_build_array(jsonb_build_object(
        'trabajo_sync_id', v_uuid,
        'filas', v_total,
        'motivo', 'UUID_REPETIDO_SIN_IDENTIDAD_CANONICA'
      ));
      continue;
    end if;

    select * into v_job
    from public.trabajos_etapa_hotel
    where id = v_work.trabajo_hotel_id;

    if v_job.id is null then
      v_cuarentena := v_cuarentena || jsonb_build_array(jsonb_build_object(
        'trabajo_sync_id', v_uuid,
        'filas', v_total,
        'motivo', 'UUID_REPETIDO_SIN_TRABAJO_CANONICO'
      ));
      continue;
    end if;

    select c.codigo, c.nombre into v_catalog
    from public.catalogo_tipos_trabajo c
    where c.codigo = v_job.tipo_trabajo
    limit 1;

    select r.* into v_record
    from public.registros_hotel r
    join public.pizarras p on p.id = r.pizarra_id
    where r.seguimiento_id = v_work.seguimiento_id
    order by (p.estado='en_curso') desc, p.fecha desc,
             r.actualizado_en desc nulls last, r.id desc
    limit 1;

    -- La identidad primaria de una fila importada es su clave_fila exacta
    -- acreditada previamente en fuentes. Así no se confunden fecha de golpe,
    -- fecha prevista de app y entrada real a taller.
    select count(*)::integer into v_match_count
    from jsonb_array_elements(v_identificados) with ordinality e(value, ordinality)
    where lower(e.value->>'trabajo_sync_id') = v_uuid
      and exists (
        select 1
        from jsonb_array_elements(coalesce(v_work.fuentes, '[]'::jsonb)) f(value)
        where f.value->>'clave_fila' = e.value->>'clave_fila'
      )
      and regexp_replace(upper(btrim(coalesce(e.value->>'dfm',''))),'[[:space:]]+','','g')
          = regexp_replace(upper(btrim(coalesce(v_record.vehiculo_sustituido,''))),'[[:space:]]+','','g')
      and regexp_replace(upper(btrim(coalesce(e.value->>'matricula',''))),'[[:space:]]+','','g')
          = regexp_replace(upper(btrim(coalesce(v_record.matricula_sustituido,''))),'[[:space:]]+','','g')
      and regexp_replace(upper(btrim(coalesce(e.value->>'numero_parada',''))),'^PA[- ]*','','g')
          = regexp_replace(upper(btrim(coalesce(v_record.numero_parada,''))),'^PA[- ]*','','g');

    if v_match_count = 0 then
      v_cuarentena := v_cuarentena || jsonb_build_array(jsonb_build_object(
        'trabajo_sync_id', v_uuid,
        'filas', v_total,
        'motivo', 'UUID_REPETIDO_SIN_COINCIDENCIA_DE_PROCEDENCIA',
        'dfm', v_record.vehiculo_sustituido,
        'numero_parada', v_record.numero_parada,
        'designacion', v_work.designacion
      ));
      continue;
    elsif v_match_count > 1 then
      -- Un mismo UUID acredita varias filas actuales: el vínculo técnico está
      -- contaminado. No se decide entre episodios reales distintos.
      v_cuarentena := v_cuarentena || jsonb_build_array(jsonb_build_object(
        'trabajo_sync_id', v_uuid,
        'filas', v_total,
        'coincidencias_fuente', v_match_count,
        'motivo', 'UUID_REPETIDO_MULTIPLES_FILAS_ACREDITADAS'
      ));
      continue;
    end if;

    select e.value into v_item
    from jsonb_array_elements(v_identificados) with ordinality e(value, ordinality)
    where lower(e.value->>'trabajo_sync_id') = v_uuid
      and exists (
        select 1
        from jsonb_array_elements(coalesce(v_work.fuentes, '[]'::jsonb)) f(value)
        where f.value->>'clave_fila' = e.value->>'clave_fila'
      )
      and regexp_replace(upper(btrim(coalesce(e.value->>'dfm',''))),'[[:space:]]+','','g')
          = regexp_replace(upper(btrim(coalesce(v_record.vehiculo_sustituido,''))),'[[:space:]]+','','g')
      and regexp_replace(upper(btrim(coalesce(e.value->>'matricula',''))),'[[:space:]]+','','g')
          = regexp_replace(upper(btrim(coalesce(v_record.matricula_sustituido,''))),'[[:space:]]+','','g')
      and regexp_replace(upper(btrim(coalesce(e.value->>'numero_parada',''))),'^PA[- ]*','','g')
          = regexp_replace(upper(btrim(coalesce(v_record.numero_parada,''))),'^PA[- ]*','','g')
    order by e.ordinality
    limit 1;

    v_item := jsonb_set(v_item, '{designacion}', to_jsonb(v_work.designacion), true);
    v_resueltos := v_resueltos || jsonb_build_array(v_item);
  end loop;

  v_result := app_private.manteniment_importar_trabajos_alpha74_base(v_resueltos);
  return jsonb_set(v_result, '{vinculos_rechazados}', v_cuarentena, true);
end;
$function$;

comment on function app_private.manteniment_importar_trabajos(jsonb) is
  'SINCRO7: resuelve UUID repetidos por clave_fila acreditada y pone en cuarentena también UUID únicos cuyo contexto actual ya es histórico, retirado, cerrado o incoherente.';

commit;
