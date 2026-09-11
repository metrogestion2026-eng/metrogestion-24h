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

do $do$
declare
  v_registro_id uuid;
begin
  select r.id into v_registro_id
  from public.activaciones_24h a
  join public.registros_hotel r on r.id = a.registro_hotel_id
  where regexp_replace(upper(btrim(a.dfm)), '[[:space:]]+', '', 'g') = '2625'
    and upper(btrim(coalesce(r.tipo_movimiento, ''))) = '24H'
    and coalesce(a.estado, '') <> 'anulada'
  order by a.actualizado_en desc, a.creado_en desc
  limit 1;

  if v_registro_id is not null then
    perform app_private.manteniment_reconciliar_asistencia_alpha74(v_registro_id);
  end if;
end;
$do$;

commit;
