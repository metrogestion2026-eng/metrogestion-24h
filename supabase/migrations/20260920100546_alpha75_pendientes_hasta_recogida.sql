-- Keep the pending list consistent with workshop entry and pickup.
do $migration$
declare definition text := pg_get_functiondef(
  'app_private.listar_necesidades_manteniment_pendientes_alpha74()'::regprocedure);
begin
  if (length(definition)-length(replace(definition,$old0$      and app_private.manteniment_fecha_cierre_necesidad(mt.designacion,
        coalesce(mt.fecha_realizada, (coalesce(e.fecha_real, e.fecha_fin_real) at time zone 'Europe/Madrid')::date),
        mt.fecha_recogida) is null$old0$,''))) / length($old0$      and app_private.manteniment_fecha_cierre_necesidad(mt.designacion,
        coalesce(mt.fecha_realizada, (coalesce(e.fecha_real, e.fecha_fin_real) at time zone 'Europe/Madrid')::date),
        mt.fecha_recogida) is null$old0$) <> 1 then
    raise exception 'El lector de pendientes ha cambiado (1)';
  end if;
  definition := replace(definition,$old0$      and app_private.manteniment_fecha_cierre_necesidad(mt.designacion,
        coalesce(mt.fecha_realizada, (coalesce(e.fecha_real, e.fecha_fin_real) at time zone 'Europe/Madrid')::date),
        mt.fecha_recogida) is null$old0$,$new0$      and (case when e.tipo_etapa='entrada_taller'
          and app_private.manteniment_requiere_recogida_alpha75(mt.designacion,mt.tipo_trabajo,mt.taller)
        then coalesce(mt.fecha_recogida, (
          select (coalesce(pickup.fecha_real,pickup.fecha_fin_real) at time zone 'Europe/Madrid')::date
          from public.etapas_hotel pickup
          where pickup.registro_hotel_id=e.registro_hotel_id
            and pickup.etapa_origen_id=e.id and pickup.tipo_etapa='recogida_taller'
            and not pickup.cancelado and pickup.estado='realizada'
          order by pickup.posicion,pickup.id limit 1))
        else app_private.manteniment_fecha_cierre_necesidad(mt.designacion,
          coalesce(mt.fecha_realizada,(coalesce(e.fecha_real,e.fecha_fin_real) at time zone 'Europe/Madrid')::date),
          mt.fecha_recogida) end) is null$new0$);
  if (length(definition)-length(replace(definition,$old1$      and (x.pendiente_fondo_blanco or (x.numero_parada ~* '^PA-[0-9]+$' and x.fecha_j is null))$old1$,''))) / length($old1$      and (x.pendiente_fondo_blanco or (x.numero_parada ~* '^PA-[0-9]+$' and x.fecha_j is null))$old1$) <> 1 then
    raise exception 'El lector de pendientes ha cambiado (2)';
  end if;
  definition := replace(definition,$old1$      and (x.pendiente_fondo_blanco or (x.numero_parada ~* '^PA-[0-9]+$' and x.fecha_j is null))$old1$,$new1$      and (x.pendiente_fondo_blanco
        or ((x.numero_parada ~* '^PA-[0-9]+$' or nullif(x.trabajo_sync_id,'') is not null)
          and (x.fecha_j is null or app_private.manteniment_requiere_recogida_alpha75(
            x.designacion,x.tipo_trabajo,x.taller))))$new1$);
  if (length(definition)-length(replace(definition,$old2$      and (x.fecha_j is null or upper(btrim(x.designacion)) in ('REPUESTOS','ACT','LINDEP','CV'))$old2$,''))) / length($old2$      and (x.fecha_j is null or upper(btrim(x.designacion)) in ('REPUESTOS','ACT','LINDEP','CV'))$old2$) <> 1 then
    raise exception 'El lector de pendientes ha cambiado (3)';
  end if;
  definition := replace(definition,$old2$      and (x.fecha_j is null or upper(btrim(x.designacion)) in ('REPUESTOS','ACT','LINDEP','CV'))$old2$,$new2$      and (x.fecha_j is null or upper(btrim(x.designacion)) in ('REPUESTOS','ACT','LINDEP','CV')
        or ((x.numero_parada ~* '^PA-[0-9]+$' or nullif(x.trabajo_sync_id,'') is not null)
          and app_private.manteniment_requiere_recogida_alpha75(x.designacion,x.tipo_trabajo,x.taller)))$new2$);
  if (length(definition)-length(replace(definition,$old3$      and (mt.id is null or app_private.manteniment_fecha_cierre_necesidad(mt.designacion,
        coalesce(mt.fecha_realizada,(coalesce(e.fecha_real,e.fecha_fin_real) at time zone 'Europe/Madrid')::date),
        mt.fecha_recogida) is null)$old3$,''))) / length($old3$      and (mt.id is null or app_private.manteniment_fecha_cierre_necesidad(mt.designacion,
        coalesce(mt.fecha_realizada,(coalesce(e.fecha_real,e.fecha_fin_real) at time zone 'Europe/Madrid')::date),
        mt.fecha_recogida) is null)$old3$) <> 1 then
    raise exception 'El lector de pendientes ha cambiado (4)';
  end if;
  definition := replace(definition,$old3$      and (mt.id is null or app_private.manteniment_fecha_cierre_necesidad(mt.designacion,
        coalesce(mt.fecha_realizada,(coalesce(e.fecha_real,e.fecha_fin_real) at time zone 'Europe/Madrid')::date),
        mt.fecha_recogida) is null)$old3$,$new3$      and (mt.id is null or (case when e.tipo_etapa='entrada_taller'
          and app_private.manteniment_requiere_recogida_alpha75(mt.designacion,mt.tipo_trabajo,mt.taller)
        then coalesce(mt.fecha_recogida, (
          select (coalesce(pickup.fecha_real,pickup.fecha_fin_real) at time zone 'Europe/Madrid')::date
          from public.etapas_hotel pickup
          where pickup.registro_hotel_id=e.registro_hotel_id
            and pickup.etapa_origen_id=e.id and pickup.tipo_etapa='recogida_taller'
            and not pickup.cancelado and pickup.estado='realizada'
          order by pickup.posicion,pickup.id limit 1))
        else app_private.manteniment_fecha_cierre_necesidad(mt.designacion,
          coalesce(mt.fecha_realizada,(coalesce(e.fecha_real,e.fecha_fin_real) at time zone 'Europe/Madrid')::date),
          mt.fecha_recogida) end) is null)$new3$);
  execute definition;
end;
$migration$;
