-- Never rebuild unrelated historical visits when one need is synchronized.
do $migration$
declare
  definition text := pg_get_functiondef(
    'app_private.manteniment_importar_trabajos_alpha74_base(jsonb)'::regprocedure);
begin

  if (length(definition)-length(replace(definition,$old0$  select count(*) into v_candidate_count from tmp_alpha74_manteniment_candidates;$old0$,''))) / length($old0$  select count(*) into v_candidate_count from tmp_alpha74_manteniment_candidates;$old0$) <> 1 then
    raise exception 'El importador ha cambiado: no se puede limitar el lote (1)';
  end if;
  definition := replace(definition,$old0$  select count(*) into v_candidate_count from tmp_alpha74_manteniment_candidates;$old0$,$new0$  select count(*) into v_candidate_count from tmp_alpha74_manteniment_candidates;
  create temp table if not exists tmp_alpha75_visitas_del_lote (
    id uuid primary key
  ) on commit drop;
  truncate tmp_alpha75_visitas_del_lote;$new0$);

  if (length(definition)-length(replace(definition,$old1$  end loop;

  -- Se materializan únicamente las T que todavía no existen.$old1$,''))) / length($old1$  end loop;

  -- Se materializan únicamente las T que todavía no existen.$old1$) <> 1 then
    raise exception 'El importador ha cambiado: no se puede limitar el lote (2)';
  end if;
  definition := replace(definition,$old1$  end loop;

  -- Se materializan únicamente las T que todavía no existen.$old1$,$new1$    insert into tmp_alpha75_visitas_del_lote(id) values (v_visit.id)
    on conflict do nothing;
  end loop;

  -- Se materializan únicamente las T que todavía no existen.$new1$);

  if (length(definition)-length(replace(definition,$old2$      where v.seguimiento_id = v_follow.seguimiento_id
      order by v.fecha_necesidad, v.creado_en, v.id$old2$,''))) / length($old2$      where v.seguimiento_id = v_follow.seguimiento_id
      order by v.fecha_necesidad, v.creado_en, v.id$old2$) <> 1 then
    raise exception 'El importador ha cambiado: no se puede limitar el lote (3)';
  end if;
  definition := replace(definition,$old2$      where v.seguimiento_id = v_follow.seguimiento_id
      order by v.fecha_necesidad, v.creado_en, v.id$old2$,$new2$      where v.seguimiento_id = v_follow.seguimiento_id
        and exists (select 1 from tmp_alpha75_visitas_del_lote lote where lote.id = v.id)
      order by v.fecha_necesidad, v.creado_en, v.id$new2$);
  execute definition;
end;
$migration$;
