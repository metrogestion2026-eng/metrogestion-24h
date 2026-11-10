-- MG75-RECUPERACION-ACTIVA-001
-- Una T explícita de recuperación pendiente/programada/en curso debe proyectar
-- recogido_pendiente_ruta sin exigir una T separada de recogida_taller.

do $migration$
declare
  definition text := pg_get_functiondef(
    'app_private.proyectar_situacion_operativa_hotel_alpha75(uuid)'::regprocedure
  );
  old_block text := $old$        select e.id, e.lugar
        into v_stage
        from public.etapas_hotel e
        where e.registro_hotel_id = p_registro_id
          and not e.cancelado
          and e.estado = 'en_curso'
        order by e.fecha_inicio_real desc nulls last, e.posicion, e.id
        limit 1;

        if found then
          v_lugar := coalesce(nullif(btrim(v_stage.lugar), ''), v_r.lugar);
          v_estado := case
            when v_r.estado in ('tramite','gestion','en_taller','asistencia_24h')
              then v_r.estado
            else 't_pendientes'
          end;
          v_motivo := 'otra_t_en_curso';$old$;
  new_block text := $new$        select e.id, e.lugar, e.tipo_etapa, e.accion_sistema
        into v_stage
        from public.etapas_hotel e
        where e.registro_hotel_id = p_registro_id
          and not e.cancelado
          and e.estado = 'en_curso'
        order by e.fecha_inicio_real desc nulls last, e.posicion, e.id
        limit 1;

        if found then
          v_lugar := coalesce(nullif(btrim(v_stage.lugar), ''), v_r.lugar);
          if coalesce(v_stage.accion_sistema,'') = 'recuperar_y_liberar'
             or lower(coalesce(v_stage.tipo_etapa,'')) in ('recuperar_ruta','recuperar') then
            v_estado := 'recogido_pendiente_ruta';
            v_motivo := 'recuperacion_en_curso';
          else
            v_estado := case
              when v_r.estado in ('tramite','gestion','en_taller','asistencia_24h')
                then v_r.estado
              else 't_pendientes'
            end;
            v_motivo := 'otra_t_en_curso';
          end if;$new$;
begin
  if position(old_block in definition) = 0 then
    raise exception 'MG75-RECUPERACION-ACTIVA-001: bloque esperado no localizado';
  end if;
  definition := replace(definition, old_block, new_block);
  execute definition;
end;
$migration$;

do $backfill$
declare
  v_id uuid;
begin
  perform set_config('app.request_id','recuperacion_activa_20261110',true);
  perform set_config('app.audit_origin','metrogestion-r1-recuperacion-activa',true);
  perform set_config('app.manteniment_importando_paradas','1',true);

  for v_id in
    select distinct r.id
    from public.registros_hotel r
    join public.pizarras p on p.id=r.pizarra_id and p.estado='en_curso'
    join public.etapas_hotel e on e.registro_hotel_id=r.id
    where not r.cancelado
      and not r.retirado_hotel_activo
      and not e.cancelado
      and e.estado in ('pendiente','programada','en_curso')
      and (
        e.accion_sistema='recuperar_y_liberar'
        or lower(coalesce(e.tipo_etapa,'')) in ('recuperar_ruta','recuperar')
      )
  loop
    perform app_private.sincronizar_situacion_operativa_hotel_alpha75(v_id,true);
  end loop;
end;
$backfill$;

do $check$
begin
  if exists (
    select 1
    from public.registros_hotel r
    join public.pizarras p on p.id=r.pizarra_id and p.estado='en_curso'
    join public.etapas_hotel e on e.registro_hotel_id=r.id
    where not r.cancelado
      and not r.retirado_hotel_activo
      and not e.cancelado
      and e.estado='en_curso'
      and (
        e.accion_sistema='recuperar_y_liberar'
        or lower(coalesce(e.tipo_etapa,'')) in ('recuperar_ruta','recuperar')
      )
      and r.estado <> 'recogido_pendiente_ruta'
  ) then
    raise exception 'MG75-RECUPERACION-ACTIVA-001: queda recuperación en curso fuera de Pendiente de recuperar';
  end if;
end;
$check$;
