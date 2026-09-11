begin;

-- PostgreSQL elimina la Í al aplicar [A-Z0-9], por lo que "24H · Avería"
-- queda como 24HAVERA. Se incorpora esa forma normalizada al reconciliador.
do $do$
declare
  v_definicion text;
  v_original constant text :=
    'in (''24H'', ''24HAVERIA'', ''AVERIA24H'', ''ASISTENCIA24H'')';
  v_corregida constant text :=
    'in (''24H'', ''24HAVERIA'', ''24HAVERA'', ''AVERIA24H'', ''ASISTENCIA24H'')';
begin
  select pg_get_functiondef(
    'app_private.manteniment_reconciliar_asistencia_alpha74(uuid)'::regprocedure
  ) into v_definicion;

  if strpos(v_definicion, v_original) = 0 then
    raise exception 'No se localiza el selector esperado de la T 24H';
  end if;

  execute replace(v_definicion, v_original, v_corregida);
end;
$do$;

-- Correccion puntual de datos excluida del repositorio publico.


commit;
