-- Alpha72: permitir varias entradas sucesivas a taller dentro de una parada.
--
-- El catálogo visible de una T se resolvía únicamente por `posicion`. Durante
-- la reconciliación se generan recogidas y se reordenan las T; una T generada
-- podía ocupar temporalmente la posición de otra T del formulario y heredar
-- su estado visible. El resultado era el falso error
-- "El estado personalizado de la T no corresponde con su estado operativo".
--
-- Las T ya guardadas se identifican por su UUID. La posición solo se usa como
-- respaldo para una T nueva enviada por el editor, que todavía no tiene UUID.

create or replace function app_private.sincronizar_catalogo_estado_etapa()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $function$
declare
  v_context_id uuid;
  v_payload jsonb;
  v_codigo text;
  v_operativo text;
  v_editor_save boolean;
begin
  begin
    v_context_id := nullif(
      current_setting('app.hotel_catalogos_registro_id', true),
      ''
    )::uuid;
    v_payload := coalesce(
      nullif(current_setting('app.hotel_catalogos_etapas', true), '')::jsonb,
      '[]'::jsonb
    );
    v_editor_save := current_setting('app.audit_origin', true) = 'metrogestion-r1-editor';
  exception when others then
    v_context_id := null;
    v_payload := '[]'::jsonb;
    v_editor_save := false;
  end;

  if v_context_id = new.registro_hotel_id then
    -- Una T existente se reconoce por su identidad estable, aunque cambie de
    -- posición durante la reconciliación o existan varias entradas a taller.
    select nullif(btrim(value->>'estado_catalogo_codigo'), '')
      into v_codigo
    from jsonb_array_elements(v_payload)
    where nullif(value->>'id', '') = new.id::text
    limit 1;

    -- Solo las T creadas desde el formulario llegan sin UUID. En ese caso la
    -- posición es válida mientras se ejecuta el guardado principal del editor,
    -- nunca durante la creación automática de recogidas ni el reordenado.
    if v_codigo is null and v_editor_save then
      select nullif(btrim(value->>'estado_catalogo_codigo'), '')
        into v_codigo
      from jsonb_array_elements(v_payload)
      where nullif(value->>'id', '') is null
        and nullif(value->>'posicion', '')::integer = new.posicion
      limit 1;
    end if;
  end if;

  if v_codigo is not null then
    select c.estado_operativo
      into v_operativo
    from public.catalogo_estados_etapa_hotel c
    where c.codigo = v_codigo
      and c.activo = true;

    if v_operativo is null or v_operativo <> new.estado then
      raise exception 'El estado personalizado de la T no corresponde con su estado operativo';
    end if;
    new.estado_catalogo_codigo := v_codigo;
  elsif tg_op = 'INSERT' then
    new.estado_catalogo_codigo := new.estado;
  elsif new.estado is distinct from old.estado
    and new.estado_catalogo_codigo is not distinct from old.estado_catalogo_codigo then
    new.estado_catalogo_codigo := new.estado;
  end if;

  select c.estado_operativo
    into v_operativo
  from public.catalogo_estados_etapa_hotel c
  where c.codigo = new.estado_catalogo_codigo
    and c.activo = true;

  if v_operativo is null or v_operativo <> new.estado then
    raise exception 'El estado visible de la T no es válido';
  end if;
  return new;
end;
$function$;

revoke all on function app_private.sincronizar_catalogo_estado_etapa()
  from public, anon, authenticated;
