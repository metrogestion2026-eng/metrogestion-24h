begin;

create unique index if not exists catalogo_tipos_trabajo_nombre_uq
  on public.catalogo_tipos_trabajo (lower(btrim(nombre)));

create or replace function app_private.guardar_tipos_trabajo_etapa(
  p_etapa_id uuid,
  p_cambios jsonb,
  p_request_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_etapa public.etapas_hotel%rowtype;
  v_cambio jsonb;
  v_trabajo public.trabajos_etapa_hotel%rowtype;
  v_trabajo_id uuid;
  v_version integer;
  v_tipo_input text;
  v_tipo_codigo text;
  v_tipo_nombre text;
  v_ordinal integer;
  v_request_id text;
  v_insertadas integer := 0;
  v_actualizadas integer := 0;
  v_propagadas integer := 0;
  v_filas integer := 0;
begin
  if auth.uid() is null
     or not public.dispositivo_autorizado()
     or not (
       public.puede_editar_modulo('hotel')
       or public.puede_editar_modulo('historico')
       or public.puede_editar_modulo('t_programadas')
     ) then
    raise exception 'No tienes permiso para editar los trabajos de esta T';
  end if;

  if p_etapa_id is null then
    raise exception 'No se ha indicado la T';
  end if;
  if jsonb_typeof(coalesce(p_cambios, '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(p_cambios, '[]'::jsonb)) > 50 then
    raise exception 'El listado de cambios no es válido';
  end if;

  select * into v_etapa
  from public.etapas_hotel
  where id = p_etapa_id;
  if not found then
    raise exception 'La T indicada no existe';
  end if;

  v_request_id := coalesce(nullif(btrim(p_request_id), ''), 'tipo_' || replace(gen_random_uuid()::text, '-', ''));
  if v_request_id !~ '^[A-Za-z0-9_-]{8,80}$' then
    raise exception 'Identificador de guardado no válido';
  end if;

  perform set_config('app.request_id', v_request_id, true);
  perform set_config('app.audit_origin', 'metrogestion-r1-tipos-trabajo', true);
  perform set_config('app.audit_reason', 'Edición del tipo de trabajo desde la ficha de la T', true);

  for v_cambio in
    select value from jsonb_array_elements(coalesce(p_cambios, '[]'::jsonb))
  loop
    if jsonb_typeof(v_cambio) <> 'object' then
      raise exception 'Uno de los cambios no tiene un formato válido';
    end if;

    v_trabajo_id := nullif(v_cambio->>'id', '')::uuid;
    v_version := nullif(v_cambio->>'version', '')::integer;
    v_tipo_input := btrim(coalesce(v_cambio->>'tipo', ''));

    if v_trabajo_id is null or v_version is null then
      raise exception 'Falta identificar el trabajo o su versión';
    end if;
    if length(v_tipo_input) < 1 or length(v_tipo_input) > 80 then
      raise exception 'El tipo de trabajo debe tener entre 1 y 80 caracteres';
    end if;

    select * into v_trabajo
    from public.trabajos_etapa_hotel
    where id = v_trabajo_id
      and etapa_hotel_id = p_etapa_id
    for update;
    if not found then
      raise exception 'Uno de los trabajos ya no pertenece a esta T';
    end if;
    if v_trabajo.version <> v_version then
      raise exception 'El trabajo ha cambiado desde que abriste la ficha. Vuelve a cargarlo.';
    end if;
    if v_trabajo.cancelado then
      raise exception 'Un trabajo anulado no puede cambiar de tipo. Restáuralo primero.';
    end if;

    select ordinal into v_ordinal
    from (
      select id, row_number() over(order by creado_en, id)::integer as ordinal
      from public.trabajos_etapa_hotel
      where etapa_hotel_id = p_etapa_id
    ) orden
    where id = v_trabajo_id;

    v_tipo_codigo := null;
    v_tipo_nombre := null;

    select c.codigo, c.nombre
      into v_tipo_codigo, v_tipo_nombre
    from public.catalogo_tipos_trabajo c
    where c.activo = true
      and upper(c.codigo) = upper(v_tipo_input)
    limit 1;

    if v_tipo_codigo is null then
      select c.codigo, c.nombre
        into v_tipo_codigo, v_tipo_nombre
      from public.catalogo_tipos_trabajo c
      where c.activo = true
        and lower(btrim(c.nombre)) = lower(v_tipo_input)
      limit 1;
    end if;

    if v_tipo_codigo is null then
      v_tipo_codigo := 'USR_' || upper(substr(md5(lower(v_tipo_input)), 1, 12));
      insert into public.catalogo_tipos_trabajo(
        codigo, nombre, requiere_expediente, requiere_diagnostico, activo
      ) values (
        v_tipo_codigo, v_tipo_input, false, false, true
      )
      on conflict do nothing;
      get diagnostics v_filas = row_count;
      v_insertadas := v_insertadas + v_filas;

      select c.codigo, c.nombre
        into v_tipo_codigo, v_tipo_nombre
      from public.catalogo_tipos_trabajo c
      where c.activo = true
        and lower(btrim(c.nombre)) = lower(v_tipo_input)
      limit 1;

      if v_tipo_codigo is null then
        raise exception 'No se pudo incorporar el nuevo tipo al listado';
      end if;
    end if;

    with equivalentes as (
      select
        t.id,
        row_number() over(
          partition by t.etapa_hotel_id
          order by t.creado_en, t.id
        )::integer as ordinal
      from public.trabajos_etapa_hotel t
      join public.etapas_hotel e on e.id = t.etapa_hotel_id
      where e.seguimiento_id = v_etapa.seguimiento_id
    )
    update public.trabajos_etapa_hotel t
    set tipo_trabajo = v_tipo_codigo,
        modificado_por = auth.uid()
    from equivalentes eq
    where t.id = eq.id
      and eq.ordinal = v_ordinal
      and t.tipo_trabajo is distinct from v_tipo_codigo;
    get diagnostics v_filas = row_count;

    if v_filas > 0 then
      v_actualizadas := v_actualizadas + 1;
      v_propagadas := v_propagadas + greatest(v_filas - 1, 0);
    end if;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'request_id', v_request_id,
    'tipos_nuevos', v_insertadas,
    'trabajos_actualizados', v_actualizadas,
    'copias_historicas_actualizadas', v_propagadas,
    'catalogo', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'codigo', c.codigo,
          'nombre', c.nombre,
          'requiere_expediente', c.requiere_expediente,
          'requiere_diagnostico', c.requiere_diagnostico
        ) order by lower(c.nombre), c.codigo
      )
      from public.catalogo_tipos_trabajo c
      where c.activo = true
    ), '[]'::jsonb),
    'trabajos', coalesce((
      select jsonb_agg(
        to_jsonb(t) || jsonb_build_object('tipo_nombre', coalesce(c.nombre, t.tipo_trabajo))
        order by t.creado_en, t.id
      )
      from public.trabajos_etapa_hotel t
      left join public.catalogo_tipos_trabajo c on c.codigo = t.tipo_trabajo
      where t.etapa_hotel_id = p_etapa_id
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.guardar_tipos_trabajo_etapa(
  p_etapa_id uuid,
  p_cambios jsonb,
  p_request_id text default null
)
returns jsonb
language sql
set search_path = pg_catalog, app_private
as $$
  select app_private.guardar_tipos_trabajo_etapa(p_etapa_id, p_cambios, p_request_id);
$$;

revoke all on function public.guardar_tipos_trabajo_etapa(uuid,jsonb,text) from public;
revoke all on function public.guardar_tipos_trabajo_etapa(uuid,jsonb,text) from anon;
grant execute on function public.guardar_tipos_trabajo_etapa(uuid,jsonb,text) to authenticated;

commit;
