begin;

create or replace function app_private.crear_ficha_hotel_con_etapas_alpha71(
  p_ficha jsonb,
  p_etapas jsonb,
  p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $function$
declare
  v_created jsonb;
  v_saved jsonb;
  v_ficha_guardar jsonb;
  v_registro_id uuid;
  v_version integer;
  v_numero_parada text;
begin
  if auth.uid() is null
     or not public.dispositivo_autorizado()
     or not public.puede_editar_modulo('hotel') then
    raise exception 'No tienes permiso para añadir fichas y T al Hotel';
  end if;

  if jsonb_typeof(p_ficha) <> 'object'
     or jsonb_typeof(p_etapas) <> 'array'
     or octet_length(p_etapas::text) > 500000
     or jsonb_array_length(p_etapas) > 50 then
    raise exception 'Formato de ficha o T no válido';
  end if;

  v_created := app_private.crear_ficha_hotel_alpha71(p_ficha, p_request_id);
  v_registro_id := (v_created->>'id')::uuid;
  v_numero_parada := nullif(btrim(v_created->>'numero_parada'), '');

  if v_numero_parada is null then
    raise exception 'La ficha recién creada no tiene número de parada';
  end if;

  if jsonb_array_length(p_etapas) = 0 then
    return v_created || jsonb_build_object(
      'etapas_guardadas', 0,
      'trabajos_guardados', 0
    );
  end if;

  select r.version
    into v_version
  from public.registros_hotel r
  where r.id = v_registro_id
  for update;

  if v_version is null then
    raise exception 'La ficha recién creada no está disponible para añadir sus T';
  end if;

  -- El alta genera el número de parada. El segundo guardado debe reutilizarlo
  -- aunque la pantalla de creación enviara originalmente ese campo vacío.
  v_ficha_guardar := p_ficha || jsonb_build_object(
    'numero_parada', v_numero_parada
  );

  v_saved := app_private.guardar_ficha_hotel_edicion_alpha71(
    v_registro_id,
    v_version,
    v_ficha_guardar,
    p_etapas,
    p_request_id
  );

  return v_created || v_saved || jsonb_build_object(
    'id', v_registro_id,
    'numero_parada', v_numero_parada,
    'request_id', p_request_id
  );
end;
$function$;

revoke all on function app_private.crear_ficha_hotel_con_etapas_alpha71(jsonb, jsonb, text)
  from public, anon;
grant execute on function app_private.crear_ficha_hotel_con_etapas_alpha71(jsonb, jsonb, text)
  to authenticated, service_role;

commit;
