-- Preserve cancelled jobs and reject technical notes copied to another need.
do $migration$
declare definition text := pg_get_functiondef(
  'app_private.manteniment_importar_trabajos_alpha74_base(jsonb)'::regprocedure);
begin
  if (length(definition)-length(replace(definition,$old$      and x.designacion_norm not in ('ALTA', 'BAJA', 'PARADA', 'ANULADA', 'FIN', 'ARCHIVO', 'CARPETA', 'PRIMITIVA')$old$,''))) / length($old$      and x.designacion_norm not in ('ALTA', 'BAJA', 'PARADA', 'ANULADA', 'FIN', 'ARCHIVO', 'CARPETA', 'PRIMITIVA')$old$) <> 1 then
    raise exception 'El importador ha cambiado: no se puede validar el vínculo con seguridad';
  end if;
  execute replace(definition,$old$      and x.designacion_norm not in ('ALTA', 'BAJA', 'PARADA', 'ANULADA', 'FIN', 'ARCHIVO', 'CARPETA', 'PRIMITIVA')$old$,$new$      and x.designacion_norm not in ('ALTA', 'BAJA', 'PARADA', 'ANULADA', 'FIN', 'ARCHIVO', 'CARPETA', 'PRIMITIVA')
      -- Las notas copiadas y las T anuladas son histórico, no permiso de reapertura.
      and (x.trabajo_sync_id is null
        or (sync_work.id is not null
          and translate(upper(btrim(sync_work.designacion)), 'ÁÉÍÓÚÜ', 'AEIOUU')
            = translate(x.designacion_norm, 'ÁÉÍÓÚÜ', 'AEIOUU')))
      and (coalesce(sync_work.id,key_work.id) is null or exists (
        select 1 from app_private.manteniment_t_trabajos existing
        join public.trabajos_etapa_hotel job on job.id=existing.trabajo_hotel_id
        join public.etapas_hotel stage on stage.id=app_private.manteniment_etapa_actual(
          existing.seguimiento_id,job.etapa_hotel_id)
        where existing.id=coalesce(sync_work.id,key_work.id)
          and not job.cancelado and not stage.cancelado and stage.estado<>'anulada'
      ))$new$);
end;
$migration$;
