create or replace function app_private.manteniment_inferir_taller_r(
  p_dfm text,
  p_taller text,
  p_tipo text,
  p_designacion text,
  p_marca_equipo text
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
      translate(upper(btrim(coalesce(p_marca_equipo, ''))), 'ÁÉÍÓÚÜ', 'AEIOUU') as marca
  )
  select case
    when taller <> '' then taller
    when dfm not like 'R%' then null
    when tipo like '%GESTION%' then 'UPC'
    when tipo like '%MANTENIMIENTO%' and designacion = 'BPW' then 'DIRECAUTO'
    when tipo like '%MANTENIMIENTO%' and designacion = 'MCD' and marca like '%THERMO KING%' then 'FRIGICOLL'
    when tipo like '%MANTENIMIENTO%' and designacion = 'MCD' and marca like '%CARRIER%' then 'FRIDIEL'
    when tipo like '%TRAMITE%' and designacion = 'ITV' then 'APPLUS (RED DE ITV)'
    when tipo like '%TRAMITE%' and designacion in ('TMG', 'ATP') then 'INVERYCA'
    when tipo like '%TRAMITE%' and designacion = 'EXTINTOR' then 'UPC'
    else null
  end
  from n;
$function$;

alter function app_private.manteniment_importar_trabajos(jsonb)
  rename to manteniment_importar_trabajos_base;

create function app_private.manteniment_importar_trabajos(p_trabajos jsonb)
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
    select app_private.manteniment_inferir_taller_r(
      item.value->>'dfm',
      item.value->>'taller',
      item.value->>'tipo_trabajo',
      item.value->>'designacion',
      item.value->>'marca_equipo'
    ) as taller
  ) inferred;

  return app_private.manteniment_importar_trabajos_base(v_trabajos);
end;
$function$;

revoke execute on function app_private.manteniment_inferir_taller_r(text,text,text,text,text)
  from public, anon, authenticated;
revoke execute on function app_private.manteniment_importar_trabajos_base(jsonb)
  from public, anon, authenticated;
revoke execute on function app_private.manteniment_importar_trabajos(jsonb)
  from public, anon, authenticated;

comment on function app_private.manteniment_inferir_taller_r(text,text,text,text,text) is
  'Completa F solo para semirremolques R cuando F está vacío, según G, H y Q.';
comment on function app_private.manteniment_importar_trabajos(jsonb) is
  'Normaliza el taller implícito de necesidades R y delega la importación Alpha74 base.';
