create or replace function app_private.manteniment_inferir_taller_alpha74(
  p_dfm text,
  p_taller text,
  p_tipo text,
  p_designacion text,
  p_marca_equipo text,
  p_marca_vehiculo text
)
returns text
language sql
immutable
set search_path = 'pg_catalog'
as $function$
  with n as (
    select
      upper(regexp_replace(btrim(coalesce(p_dfm, '')), '[[:space:]]+', '', 'g')) as dfm,
      btrim(coalesce(p_taller, '')) as taller,
      translate(upper(btrim(coalesce(p_tipo, ''))), 'ÁÉÍÓÚÜ', 'AEIOUU') as tipo,
      translate(upper(btrim(coalesce(p_designacion, ''))), 'ÁÉÍÓÚÜ', 'AEIOUU') as designacion,
      translate(upper(btrim(coalesce(p_marca_equipo, ''))), 'ÁÉÍÓÚÜ', 'AEIOUU') as marca_equipo,
      translate(upper(btrim(coalesce(p_marca_vehiculo, ''))), 'ÁÉÍÓÚÜ', 'AEIOUU') as marca_vehiculo
  )
  select case
    when taller <> '' then taller
    when dfm = '' then null
    when tipo like '%GESTION%' then 'UPC'
    when tipo like '%MANTENIMIENTO%' and designacion = 'BPW' then 'DIRECAUTO'
    when dfm like 'R%' and tipo like '%MANTENIMIENTO%' and designacion = 'MCD' and marca_equipo like '%THERMO KING%' then 'FRIGICOLL'
    when dfm like 'R%' and tipo like '%MANTENIMIENTO%' and designacion = 'MCD' and marca_equipo like '%CARRIER%' then 'FRIDIEL'
    when dfm not like 'R%' and designacion in ('MCD', 'AV') and (marca_vehiculo like '%MERCEDES%' or marca_vehiculo like '%BENZ%') then 'STERN MOTOR'
    when dfm not like 'R%' and designacion in ('MCD', 'AV') and marca_vehiculo like '%IVECO%' then 'AUTO DISTRIBUCIÓN'
    when dfm not like 'R%' and designacion in ('MCD', 'AV') and marca_vehiculo ~ '(^|[^A-Z0-9])MAN([^A-Z0-9]|$)' then 'MAN'
    when dfm not like 'R%' and designacion in ('MCD', 'AV') and marca_vehiculo like '%VOLVO%' then 'VOLVO'
    when tipo like '%TRAMITE%' and designacion = 'RT' then 'AUTODIS'
    when tipo like '%TRAMITE%' and designacion = 'ITV' then 'APPLUS (RED DE ITV)'
    when tipo like '%TRAMITE%' and designacion in ('TMG', 'ATP') then 'INVERYCA'
    when tipo like '%TRAMITE%' and designacion = 'EXTINTOR' then 'UPC'
    else null
  end
  from n;
$function$;

create or replace function app_private.manteniment_importar_trabajos(p_trabajos jsonb)
returns jsonb
language plpgsql
security definer
set search_path = 'pg_catalog', 'app_private'
as $function$
declare
  v_trabajos jsonb;
begin
  if p_trabajos is null or jsonb_typeof(p_trabajos) <> 'array' then
    return app_private.manteniment_importar_trabajos_base(p_trabajos);
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
      item.value->>'dfm',
      item.value->>'taller',
      item.value->>'tipo_trabajo',
      item.value->>'designacion',
      item.value->>'marca_equipo',
      item.value->>'marca_vehiculo'
    ) as taller
  ) inferred;

  return app_private.manteniment_importar_trabajos_base(v_trabajos);
end;
$function$;

revoke execute on function app_private.manteniment_inferir_taller_alpha74(text,text,text,text,text,text)
  from public, anon, authenticated;
revoke execute on function app_private.manteniment_importar_trabajos(jsonb)
  from public, anon, authenticated;

comment on function app_private.manteniment_inferir_taller_alpha74(text,text,text,text,text,text) is
  'Completa el taller implícito para necesidades R y DFM; si la regla no es inequívoca conserva F vacío.';
comment on function app_private.manteniment_importar_trabajos(jsonb) is
  'Normaliza el taller implícito de necesidades R y DFM y delega la importación Alpha74 base.';
