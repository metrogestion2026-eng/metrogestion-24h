-- Alpha72: cronología automática de T realizadas y anotaciones manuales
-- independientes, editables, auditadas y ligadas al seguimiento lógico.

create table if not exists public.anotaciones_manuales_hotel (
  id uuid primary key default gen_random_uuid(),
  seguimiento_id uuid not null,
  registro_origen_id uuid references public.registros_hotel(id) on delete restrict,
  texto text not null check (length(btrim(texto)) between 1 and 4000),
  fecha_evento timestamptz not null default clock_timestamp(),
  origen text not null default 'manual' check (origen in ('manual', 'importada')),
  clave_importacion text,
  autor_id uuid references public.usuarios(id) on delete restrict,
  autor_nombre text not null default 'Usuario',
  modificado_por uuid references public.usuarios(id) on delete restrict,
  modificador_nombre text not null default 'Usuario',
  version integer not null default 1 check (version > 0),
  cancelada boolean not null default false,
  motivo_cancelacion text not null default '',
  cancelada_en timestamptz,
  cancelada_por uuid references public.usuarios(id) on delete restrict,
  creado_en timestamptz not null default clock_timestamp(),
  actualizado_en timestamptz not null default clock_timestamp(),
  constraint anotaciones_manuales_hotel_cancelacion_coherente check (
    (not cancelada and cancelada_en is null and cancelada_por is null)
    or (cancelada and cancelada_en is not null and cancelada_por is not null and btrim(motivo_cancelacion) <> '')
  )
);

create index if not exists anotaciones_manuales_hotel_seguimiento_idx
  on public.anotaciones_manuales_hotel (seguimiento_id, fecha_evento, id);
create index if not exists anotaciones_manuales_hotel_registro_idx
  on public.anotaciones_manuales_hotel (registro_origen_id);
create index if not exists anotaciones_manuales_hotel_autor_idx
  on public.anotaciones_manuales_hotel (autor_id);
create index if not exists anotaciones_manuales_hotel_modificado_idx
  on public.anotaciones_manuales_hotel (modificado_por);
create index if not exists anotaciones_manuales_hotel_cancelada_por_idx
  on public.anotaciones_manuales_hotel (cancelada_por);
create unique index if not exists anotaciones_manuales_hotel_importacion_uq
  on public.anotaciones_manuales_hotel (clave_importacion)
  where clave_importacion is not null;

alter table public.anotaciones_manuales_hotel enable row level security;

drop policy if exists anotaciones_manuales_hotel_select_secure
  on public.anotaciones_manuales_hotel;
create policy anotaciones_manuales_hotel_select_secure
  on public.anotaciones_manuales_hotel
  for select
  to authenticated
  using (
    (select public.usuario_activo())
    and (select public.dispositivo_autorizado())
    and (
      (select public.puede_ver_modulo('hotel'))
      or (select public.puede_ver_modulo('historico'))
    )
  );

revoke all on table public.anotaciones_manuales_hotel from public, anon, authenticated;
grant select on table public.anotaciones_manuales_hotel to authenticated;
grant all on table public.anotaciones_manuales_hotel to service_role;

drop trigger if exists auditar_anotaciones_manuales_hotel
  on public.anotaciones_manuales_hotel;
create trigger auditar_anotaciones_manuales_hotel
after insert or update on public.anotaciones_manuales_hotel
for each row execute function app_private.auditar_cambio_fila();

-- Conserva las anotaciones existentes de Alpha71. Se toma una sola copia por
-- seguimiento y se separa cada renglón para que no se duplique entre pizarras.
with latest as (
  select distinct on (r.seguimiento_id)
    r.id,
    r.seguimiento_id,
    r.observaciones,
    r.modificado_por,
    r.actualizado_en
  from public.registros_hotel r
  where btrim(coalesce(r.observaciones, '')) <> ''
  order by r.seguimiento_id, r.actualizado_en desc, r.id desc
), lines as (
  select
    l.id,
    l.seguimiento_id,
    btrim(x.linea) as texto,
    x.orden,
    l.modificado_por,
    l.actualizado_en
  from latest l
  cross join lateral regexp_split_to_table(l.observaciones, E'\\r?\\n')
    with ordinality as x(linea, orden)
  where btrim(x.linea) not in ('', '-')
)
insert into public.anotaciones_manuales_hotel (
  seguimiento_id, registro_origen_id, texto, fecha_evento, origen,
  clave_importacion, autor_id, autor_nombre, modificado_por,
  modificador_nombre, creado_en, actualizado_en
)
select
  l.seguimiento_id,
  l.id,
  left(l.texto, 4000),
  l.actualizado_en + (l.orden * interval '1 microsecond'),
  'importada',
  md5(l.seguimiento_id::text || '|' || lower(l.texto)),
  l.modificado_por,
  coalesce(nullif(btrim(concat_ws(' ', u.nombre, u.apellidos)), ''), 'Usuario'),
  l.modificado_por,
  coalesce(nullif(btrim(concat_ws(' ', u.nombre, u.apellidos)), ''), 'Usuario'),
  l.actualizado_en,
  l.actualizado_en
from lines l
left join public.usuarios u on u.id = l.modificado_por
on conflict (clave_importacion) where clave_importacion is not null do nothing;

create or replace function app_private.anotaciones_manuales_hotel_json(p_seguimiento_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public, app_private
as $function$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', n.id,
    'texto', n.texto,
    'fecha_evento', n.fecha_evento,
    'origen', n.origen,
    'autor_nombre', n.autor_nombre,
    'modificador_nombre', n.modificador_nombre,
    'version', n.version,
    'creado_en', n.creado_en,
    'actualizado_en', n.actualizado_en
  ) order by n.fecha_evento, n.id), '[]'::jsonb)
  from public.anotaciones_manuales_hotel n
  where n.seguimiento_id = p_seguimiento_id
    and not n.cancelada;
$function$;

create or replace function app_private.sincronizar_anotaciones_manuales_hotel(
  p_registro_id uuid,
  p_anotaciones jsonb
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $function$
declare
  v_actor uuid := auth.uid();
  v_actor_nombre text;
  v_seguimiento_id uuid;
  v_item jsonb;
  v_id uuid;
  v_texto text;
  v_version integer;
  v_changed integer;
  v_total integer := 0;
begin
  if v_actor is null
    or not public.usuario_activo()
    or not public.dispositivo_autorizado()
    or not public.puede_editar_modulo('hotel') then
    raise exception 'No tienes permiso para modificar las anotaciones de Hotel'
      using errcode = '42501';
  end if;

  if jsonb_typeof(coalesce(p_anotaciones, '[]'::jsonb)) <> 'array'
    or jsonb_array_length(coalesce(p_anotaciones, '[]'::jsonb)) > 100 then
    raise exception 'Las anotaciones deben ser una lista de hasta 100 elementos'
      using errcode = '22023';
  end if;

  select r.seguimiento_id into v_seguimiento_id
  from public.registros_hotel r
  where r.id = p_registro_id;
  if v_seguimiento_id is null then
    raise exception 'No se encuentra la ficha de Hotel'
      using errcode = 'P0002';
  end if;

  select coalesce(nullif(btrim(concat_ws(' ', u.nombre, u.apellidos)), ''), 'Usuario')
    into v_actor_nombre
  from public.usuarios u
  where u.id = v_actor and u.activo;
  if v_actor_nombre is null then
    raise exception 'El usuario no está activo' using errcode = '42501';
  end if;

  for v_item in select value from jsonb_array_elements(coalesce(p_anotaciones, '[]'::jsonb)) loop
    v_id := nullif(v_item->>'id', '')::uuid;
    v_texto := btrim(coalesce(v_item->>'texto', ''));
    v_version := greatest(coalesce(nullif(v_item->>'version', '')::integer, 1), 1);

    if v_id is null then
      if coalesce((v_item->>'eliminar')::boolean, false) or v_texto = '' then
        continue;
      end if;
      if length(v_texto) > 4000 then
        raise exception 'Cada anotación admite un máximo de 4.000 caracteres'
          using errcode = '22023';
      end if;
      insert into public.anotaciones_manuales_hotel (
        seguimiento_id, registro_origen_id, texto, autor_id, autor_nombre,
        modificado_por, modificador_nombre
      ) values (
        v_seguimiento_id, p_registro_id, v_texto, v_actor, v_actor_nombre,
        v_actor, v_actor_nombre
      );
      v_total := v_total + 1;
      continue;
    end if;

    if coalesce((v_item->>'eliminar')::boolean, false) then
      update public.anotaciones_manuales_hotel n
      set cancelada = true,
          motivo_cancelacion = 'Eliminada desde la edición de Hotel',
          cancelada_en = clock_timestamp(),
          cancelada_por = v_actor,
          modificado_por = v_actor,
          modificador_nombre = v_actor_nombre,
          version = n.version + 1,
          actualizado_en = clock_timestamp()
      where n.id = v_id
        and n.seguimiento_id = v_seguimiento_id
        and not n.cancelada
        and n.version = v_version;
    else
      if v_texto = '' or length(v_texto) > 4000 then
        raise exception 'La anotación debe contener entre 1 y 4.000 caracteres'
          using errcode = '22023';
      end if;
      update public.anotaciones_manuales_hotel n
      set texto = v_texto,
          modificado_por = v_actor,
          modificador_nombre = v_actor_nombre,
          version = n.version + 1,
          actualizado_en = clock_timestamp()
      where n.id = v_id
        and n.seguimiento_id = v_seguimiento_id
        and not n.cancelada
        and n.version = v_version
        and n.texto is distinct from v_texto;

      if not found then
        perform 1 from public.anotaciones_manuales_hotel n
        where n.id = v_id
          and n.seguimiento_id = v_seguimiento_id
          and not n.cancelada
          and n.version = v_version
          and n.texto = v_texto;
        if found then continue; end if;
      end if;
    end if;

    get diagnostics v_changed = row_count;
    if v_changed <> 1 then
      raise exception 'Otra sesión ha modificado esta anotación. Recarga la ficha antes de guardar.'
        using errcode = '40001';
    end if;
    v_total := v_total + 1;
  end loop;

  return v_total;
end;
$function$;

create or replace function app_private.obtener_ficha_hotel_edicion_alpha72(p_registro_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $function$
declare
  v_detail jsonb;
  v_seguimiento_id uuid;
begin
  v_detail := app_private.obtener_ficha_hotel_edicion_alpha71(p_registro_id);
  v_seguimiento_id := nullif(v_detail #>> '{ficha,seguimiento_id}', '')::uuid;
  v_detail := jsonb_set(v_detail, '{catalogos,modalidades_operativas}', coalesce((
    select jsonb_agg(jsonb_build_object(
      'codigo', c.codigo,
      'nombre', c.nombre,
      'comportamiento', c.comportamiento,
      'orden', c.orden
    ) order by c.orden, c.nombre)
    from public.catalogo_modalidades_operativas_hotel c
    where c.activo = true
  ), '[]'::jsonb), true);
  return jsonb_set(
    v_detail,
    '{anotaciones_manuales}',
    app_private.anotaciones_manuales_hotel_json(v_seguimiento_id),
    true
  );
end;
$function$;

create or replace function app_private.guardar_ficha_hotel_edicion_alpha72(
  p_registro_id uuid,
  p_version integer,
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
  v_codigo text;
  v_saved jsonb;
  v_version integer;
  v_notas integer;
  v_audit_count integer;
begin
  if auth.uid() is null or not public.dispositivo_autorizado() or not public.puede_editar_modulo('hotel') then
    raise exception 'No tienes permiso para modificar Hotel';
  end if;
  v_codigo := app_private.resolver_modalidad_operativa_hotel(p_ficha->>'modalidad_operativa');
  perform set_config('app.hotel_modalidad_operativa', v_codigo, true);
  v_saved := app_private.guardar_ficha_hotel_edicion_alpha71(
    p_registro_id, p_version, p_ficha, p_etapas, p_request_id
  );
  update public.registros_hotel
  set modalidad_operativa = v_codigo, modificado_por = auth.uid()
  where id = p_registro_id and modalidad_operativa is distinct from v_codigo;

  perform set_config('app.request_id', left(p_request_id, 200), true);
  perform set_config('app.audit_origin', 'metrogestion-alpha72-anotaciones', true);
  v_notas := app_private.sincronizar_anotaciones_manuales_hotel(
    p_registro_id,
    coalesce(p_ficha->'anotaciones_manuales', '[]'::jsonb)
  );

  select version into v_version from public.registros_hotel where id = p_registro_id;
  select count(*) into v_audit_count
  from public.auditoria_cambios
  where request_id = p_request_id;
  return v_saved || jsonb_build_object(
    'ok', true,
    'version', v_version,
    'modalidad_operativa', v_codigo,
    'anotaciones_guardadas', v_notas,
    'eventos_auditoria', v_audit_count,
    'detalle', app_private.obtener_ficha_hotel_edicion_alpha72(p_registro_id)
  );
end;
$function$;

create or replace function app_private.crear_ficha_hotel_con_etapas_alpha72(
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
  v_codigo text;
  v_created jsonb;
  v_registro_id uuid;
  v_numero_parada text;
  v_version integer;
  v_notas integer;
  v_audit_count integer;
begin
  if auth.uid() is null or not public.dispositivo_autorizado() or not public.puede_editar_modulo('hotel') then
    raise exception 'No tienes permiso para añadir fichas y T al Hotel';
  end if;
  v_codigo := app_private.resolver_modalidad_operativa_hotel(p_ficha->>'modalidad_operativa');
  perform set_config('app.hotel_modalidad_operativa', v_codigo, true);
  v_created := app_private.crear_ficha_hotel_con_etapas_alpha71(p_ficha, p_etapas, p_request_id);
  v_registro_id := (v_created->>'id')::uuid;
  v_numero_parada := nullif(btrim(v_created->>'numero_parada'), '');
  if v_numero_parada is null then
    raise exception 'La ficha recién creada no tiene número de parada';
  end if;
  update public.registros_hotel
  set modalidad_operativa = v_codigo, modificado_por = auth.uid()
  where id = v_registro_id;

  perform set_config('app.request_id', left(p_request_id, 200), true);
  perform set_config('app.audit_origin', 'metrogestion-alpha72-anotaciones', true);
  v_notas := app_private.sincronizar_anotaciones_manuales_hotel(
    v_registro_id,
    coalesce(p_ficha->'anotaciones_manuales', '[]'::jsonb)
  );

  select version into v_version from public.registros_hotel where id = v_registro_id;
  select count(*) into v_audit_count
  from public.auditoria_cambios
  where request_id = p_request_id;
  return v_created || jsonb_build_object(
    'ok', true,
    'id', v_registro_id,
    'numero_parada', v_numero_parada,
    'version', v_version,
    'modalidad_operativa', v_codigo,
    'anotaciones_guardadas', v_notas,
    'eventos_auditoria', v_audit_count,
    'detalle', app_private.obtener_ficha_hotel_edicion_alpha72(v_registro_id)
  );
end;
$function$;

revoke all on function app_private.anotaciones_manuales_hotel_json(uuid)
  from public, anon, authenticated;
revoke all on function app_private.sincronizar_anotaciones_manuales_hotel(uuid, jsonb)
  from public, anon, authenticated;
revoke all on function app_private.obtener_ficha_hotel_edicion_alpha72(uuid)
  from public, anon;
revoke all on function app_private.guardar_ficha_hotel_edicion_alpha72(uuid, integer, jsonb, jsonb, text)
  from public, anon;
revoke all on function app_private.crear_ficha_hotel_con_etapas_alpha72(jsonb, jsonb, text)
  from public, anon;

grant execute on function app_private.anotaciones_manuales_hotel_json(uuid)
  to service_role;
grant execute on function app_private.sincronizar_anotaciones_manuales_hotel(uuid, jsonb)
  to service_role;
grant execute on function app_private.obtener_ficha_hotel_edicion_alpha72(uuid)
  to authenticated, service_role;
grant execute on function app_private.guardar_ficha_hotel_edicion_alpha72(uuid, integer, jsonb, jsonb, text)
  to authenticated, service_role;
grant execute on function app_private.crear_ficha_hotel_con_etapas_alpha72(jsonb, jsonb, text)
  to authenticated, service_role;

-- Las funciones públicas siguen siendo wrappers SECURITY INVOKER creados por
-- la migración anterior. Se explicitan de nuevo sus permisos tras reemplazar
-- las implementaciones privadas.
revoke all on function public.obtener_ficha_hotel_edicion_alpha72(uuid)
  from public, anon;
revoke all on function public.guardar_ficha_hotel_edicion_alpha72(uuid, integer, jsonb, jsonb, text)
  from public, anon;
revoke all on function public.crear_ficha_hotel_con_etapas_alpha72(jsonb, jsonb, text)
  from public, anon;
grant execute on function public.obtener_ficha_hotel_edicion_alpha72(uuid)
  to authenticated, service_role;
grant execute on function public.guardar_ficha_hotel_edicion_alpha72(uuid, integer, jsonb, jsonb, text)
  to authenticated, service_role;
grant execute on function public.crear_ficha_hotel_con_etapas_alpha72(jsonb, jsonb, text)
  to authenticated, service_role;
