-- SINCRO 7 · cuarentena de UUID técnicos obsoletos.
-- Si un UUID repetido no coincide con ninguna fila por identidad completa,
-- no se reasigna ni bloquea el resto del lote: queda fuera del importador y
-- se devuelve como vínculo rechazado para revisión. Si hay >1 coincidencias,
-- la ambigüedad real sigue bloqueando.

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

    select count(*)::integer into v_match_count
    from jsonb_array_elements(v_identificados) with ordinality e(value, ordinality)
    where lower(e.value->>'trabajo_sync_id') = v_uuid
      and e.value->>'fecha_necesidad' = to_char(v_work.fecha_necesidad, 'YYYY-MM-DD')
      and regexp_replace(upper(btrim(coalesce(e.value->>'dfm',''))),'[[:space:]]+','','g')
          = regexp_replace(upper(btrim(coalesce(v_record.vehiculo_sustituido,''))),'[[:space:]]+','','g')
      and regexp_replace(upper(btrim(coalesce(e.value->>'matricula',''))),'[[:space:]]+','','g')
          = regexp_replace(upper(btrim(coalesce(v_record.matricula_sustituido,''))),'[[:space:]]+','','g')
      and regexp_replace(upper(btrim(coalesce(e.value->>'numero_parada',''))),'^PA[- ]*','','g')
          = regexp_replace(upper(btrim(coalesce(v_record.numero_parada,''))),'^PA[- ]*','','g')
      and translate(upper(btrim(coalesce(e.value->>'designacion',''))),'ÁÉÍÓÚÜ','AEIOUU')
          in (
            translate(upper(btrim(coalesce(v_work.designacion,''))),'ÁÉÍÓÚÜ','AEIOUU'),
            translate(upper(btrim(coalesce(v_catalog.codigo,''))),'ÁÉÍÓÚÜ','AEIOUU'),
            translate(upper(btrim(coalesce(v_catalog.nombre,''))),'ÁÉÍÓÚÜ','AEIOUU'),
            translate(upper(btrim(coalesce(v_job.categoria_tecnica,''))),'ÁÉÍÓÚÜ','AEIOUU')
          );

    if v_match_count = 0 then
      v_cuarentena := v_cuarentena || jsonb_build_array(jsonb_build_object(
        'trabajo_sync_id', v_uuid,
        'filas', v_total,
        'motivo', 'UUID_REPETIDO_SIN_COINCIDENCIA_IDENTIDAD_COMPLETA',
        'dfm', v_record.vehiculo_sustituido,
        'numero_parada', v_record.numero_parada,
        'designacion', v_work.designacion,
        'fecha_necesidad_canonica', to_char(v_work.fecha_necesidad, 'YYYY-MM-DD')
      ));
      continue;
    elsif v_match_count > 1 then
      raise exception
        'MG_UUID_REPETIDO_AMBIGUO: UUID % tiene % filas y % coincidencias de identidad completa; revisión obligatoria',
        v_uuid, v_total, v_match_count;
    end if;

    select e.value into v_item
    from jsonb_array_elements(v_identificados) with ordinality e(value, ordinality)
    where lower(e.value->>'trabajo_sync_id') = v_uuid
      and e.value->>'fecha_necesidad' = to_char(v_work.fecha_necesidad, 'YYYY-MM-DD')
      and regexp_replace(upper(btrim(coalesce(e.value->>'dfm',''))),'[[:space:]]+','','g')
          = regexp_replace(upper(btrim(coalesce(v_record.vehiculo_sustituido,''))),'[[:space:]]+','','g')
      and regexp_replace(upper(btrim(coalesce(e.value->>'matricula',''))),'[[:space:]]+','','g')
          = regexp_replace(upper(btrim(coalesce(v_record.matricula_sustituido,''))),'[[:space:]]+','','g')
      and regexp_replace(upper(btrim(coalesce(e.value->>'numero_parada',''))),'^PA[- ]*','','g')
          = regexp_replace(upper(btrim(coalesce(v_record.numero_parada,''))),'^PA[- ]*','','g')
      and translate(upper(btrim(coalesce(e.value->>'designacion',''))),'ÁÉÍÓÚÜ','AEIOUU')
          in (
            translate(upper(btrim(coalesce(v_work.designacion,''))),'ÁÉÍÓÚÜ','AEIOUU'),
            translate(upper(btrim(coalesce(v_catalog.codigo,''))),'ÁÉÍÓÚÜ','AEIOUU'),
            translate(upper(btrim(coalesce(v_catalog.nombre,''))),'ÁÉÍÓÚÜ','AEIOUU'),
            translate(upper(btrim(coalesce(v_job.categoria_tecnica,''))),'ÁÉÍÓÚÜ','AEIOUU')
          )
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
  'SINCRO7: resuelve UUID repetidos por identidad completa; los repetidos sin coincidencia se ponen en cuarentena y no bloquean el lote, los ambiguos reales (>1 coincidencias) siguen bloqueando.';

commit;
