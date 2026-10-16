-- Alpha75 · El rollover diario debe conservar la modalidad operativa.
-- Caso de regresión: 2675 / PA-2600202 perdió sin_sustitucion al copiar la Pizarra.

do $patch$
declare
  v_ddl text;
  v_new text;
begin
  select pg_get_functiondef(p.oid)
    into v_ddl
  from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='app_private'
    and p.proname='crear_pizarra_diaria';

  if v_ddl is null then
    raise exception 'No se localiza crear_pizarra_diaria';
  end if;

  v_new := replace(
    v_ddl,
    'cancelado_en, cancelado_por, creado_por, modificado_por, tipo_sustituto, trazo_marron',
    'cancelado_en, cancelado_por, creado_por, modificado_por, tipo_sustituto, trazo_marron, modalidad_operativa'
  );
  v_new := replace(
    v_new,
    'false, null, false, '''', null, null, v_actor, v_actor, r.tipo_sustituto, r.trazo_marron',
    'false, null, false, '''', null, null, v_actor, v_actor, r.tipo_sustituto, r.trazo_marron, r.modalidad_operativa'
  );

  if v_new = v_ddl or strpos(v_new,'modalidad_operativa') = 0 then
    raise exception 'No se pudo parchear el rollover de modalidad operativa';
  end if;

  execute v_new;
end;
$patch$;
