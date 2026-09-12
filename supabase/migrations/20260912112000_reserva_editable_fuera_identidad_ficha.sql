begin;

create or replace function app_private.guardar_ficha_hotel_edicion_alpha73(
  p_registro_id uuid,
  p_version integer,
  p_ficha jsonb,
  p_etapas jsonb,
  p_identidad jsonb,
  p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $function$
declare
  v_actual public.registros_hotel%rowtype;
  v_etapa jsonb;
  v_trabajo jsonb;
  v_saved jsonb;
begin
  if auth.uid() is null
    or not public.usuario_activo()
    or not public.dispositivo_autorizado()
    or not public.puede_editar_modulo('hotel') then
    raise exception 'No tienes permiso para modificar Hotel'
      using errcode = '42501';
  end if;

  if jsonb_typeof(p_identidad) <> 'object'
    or octet_length(p_identidad::text) > 4000 then
    raise exception 'La identidad de la ficha no es válida'
      using errcode = '22023';
  end if;
  if jsonb_typeof(p_etapas) <> 'array' then
    raise exception 'La lista de T no es válida'
      using errcode = '22023';
  end if;

  select r.* into v_actual
  from public.registros_hotel r
  where r.id = p_registro_id
  for update;
  if not found then
    raise exception 'Ficha de Hotel no encontrada'
      using errcode = 'P0002';
  end if;

  if coalesce(p_identidad->>'registro_id', '') <> v_actual.id::text
    or coalesce(p_identidad->>'seguimiento_id', '') <> v_actual.seguimiento_id::text
    or coalesce(p_identidad->>'pizarra_id', '') <> v_actual.pizarra_id::text
    or btrim(coalesce(p_identidad->>'numero_parada', ''))
         <> btrim(coalesce(v_actual.numero_parada, ''))
    or upper(btrim(coalesce(p_identidad->>'vehiculo_sustituido', '')))
         <> upper(btrim(coalesce(v_actual.vehiculo_sustituido, '')))
    or upper(btrim(coalesce(p_identidad->>'matricula_sustituido', '')))
         <> upper(btrim(coalesce(v_actual.matricula_sustituido, ''))) then
    raise exception 'La identidad de la ficha ha cambiado. Cierra y vuelve a abrirla antes de guardar.'
      using errcode = '40001';
  end if;

  for v_etapa in select value from jsonb_array_elements(p_etapas) loop
    if nullif(v_etapa->>'id', '') is not null
      and not exists (
        select 1
        from public.etapas_hotel e
        where e.id::text = v_etapa->>'id'
          and e.registro_hotel_id = p_registro_id
      ) then
      raise exception 'Una T no pertenece a la ficha abierta. Recarga antes de guardar.'
        using errcode = '40001';
    end if;

    if jsonb_typeof(coalesce(v_etapa->'trabajos', '[]'::jsonb)) <> 'array' then
      raise exception 'La lista de trabajos de una T no es válida'
        using errcode = '22023';
    end if;
    for v_trabajo in
      select value
      from jsonb_array_elements(coalesce(v_etapa->'trabajos', '[]'::jsonb))
    loop
      if nullif(v_trabajo->>'id', '') is not null
        and not exists (
          select 1
          from public.trabajos_etapa_hotel t
          join public.etapas_hotel e on e.id = t.etapa_hotel_id
          where t.id::text = v_trabajo->>'id'
            and t.etapa_hotel_id::text = v_etapa->>'id'
            and e.registro_hotel_id = p_registro_id
        ) then
        raise exception 'Un trabajo no pertenece a la T y ficha abiertas. Recarga antes de guardar.'
          using errcode = '40001';
      end if;
    end loop;
  end loop;

  v_saved := app_private.guardar_ficha_hotel_edicion_alpha72(
    p_registro_id,
    p_version,
    p_ficha,
    p_etapas,
    p_request_id
  );
  return v_saved || jsonb_build_object('identidad_validada', true);
end;
$function$;

comment on function app_private.guardar_ficha_hotel_edicion_alpha73(uuid, integer, jsonb, jsonb, jsonb, text) is
  'Protege la identidad real de la ficha y sus T; la reserva y su matrícula son datos operativos editables.';

commit;
