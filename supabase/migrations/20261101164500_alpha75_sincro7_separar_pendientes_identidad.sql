-- SINCRO 7 · separar el inventario completo de necesidades del importador con identidad v2.
-- La fotografía completa sigue llegando y se conserva. Solo los trabajos con UUID + PA
-- acreditados entran en el importador de T; el resto permanece en el feed de pendientes.

create or replace function app_private.manteniment_importar_trabajos(p_trabajos jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'app_private'
as $function$
declare
  v_identificados jsonb := '[]'::jsonb;
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

  return app_private.manteniment_importar_trabajos_alpha74_base(v_identificados);
end;
$function$;
