-- Alpha75 · No confundir una Entrada sin Recogida independiente con un conflicto.
-- Base esperada del importador hf1: fedf69806c3896275b291817a0ae389b

do $apply$
declare
  v_ddl text;
  v_new text;
  v_old_fragment text := $old$
        if v_pickup_id is null then
          v_pos := v_pos + 1;
          insert into public.etapas_hotel(
            registro_hotel_id, seguimiento_id, grupo_documental_id, nombre,
            posicion, estado, estado_catalogo_codigo, tipo_etapa, taller_id,
            centro_taller_id, lugar, fecha_prevista, observaciones, cancelado,
            creado_por, modificado_por, etapa_origen_id
          ) values (
            v_follow.registro_id, gen_random_uuid(), v_visit_stage.grupo_recogida_id,
            'Recogida ' || v_visit_stage.taller, v_pos, 'pendiente', 'pendiente',
            'recogida_taller', v_taller_id, v_centro_id, v_visit_stage.taller,
            null, 'Generada desde las necesidades pendientes de MANTENIMENT.',
            false, v_actor, v_actor, v_entry_id
          ) on conflict (etapa_origen_id)
            where etapa_origen_id is not null and cancelado = false
            do nothing
          returning id into v_pickup_id;
          if v_pickup_id is not null then
            v_created_stages := v_created_stages + 1;
          else
            -- Solo se absorbe el conflicto de una recogida de la misma entrada.
            select e.id into v_pickup_id
            from public.etapas_hotel e
            where e.etapa_origen_id = v_entry_id and not e.cancelado
              and e.registro_hotel_id = v_follow.registro_id
              and e.tipo_etapa = 'recogida_taller'
            limit 1 for update;
            if v_pickup_id is null then
              raise exception 'La entrada ya tiene una etapa activa incompatible; no se ha duplicado';
            end if;
          end if;
        end if;
$old$;
  v_new_fragment text := $new$
        if v_pickup_id is null then
          -- El modelo entrada_hitos_v1 y las entradas declaradas sin recogida
          -- resuelven la recogida como hito de la propia Entrada. No debe
          -- interpretarse el bloqueo del trigger como un conflicto.
          if app_private.etapa_manteniment_sin_recogida_alpha74(v_entry_id) then
            update app_private.manteniment_t_visitas
            set grupo_recogida_id = null,
                actualizado_en = clock_timestamp()
            where id = v_visit_stage.id
              and grupo_recogida_id is not null;
            v_pickup_id := null;
          else
            v_pos := v_pos + 1;
            insert into public.etapas_hotel(
              registro_hotel_id, seguimiento_id, grupo_documental_id, nombre,
              posicion, estado, estado_catalogo_codigo, tipo_etapa, taller_id,
              centro_taller_id, lugar, fecha_prevista, observaciones, cancelado,
              creado_por, modificado_por, etapa_origen_id
            ) values (
              v_follow.registro_id, gen_random_uuid(), v_visit_stage.grupo_recogida_id,
              'Recogida ' || v_visit_stage.taller, v_pos, 'pendiente', 'pendiente',
              'recogida_taller', v_taller_id, v_centro_id, v_visit_stage.taller,
              null, 'Generada desde las necesidades pendientes de MANTENIMENT.',
              false, v_actor, v_actor, v_entry_id
            ) on conflict (etapa_origen_id)
              where etapa_origen_id is not null and cancelado = false
              do nothing
            returning id into v_pickup_id;
            if v_pickup_id is not null then
              v_created_stages := v_created_stages + 1;
            else
              select e.id into v_pickup_id
              from public.etapas_hotel e
              where e.etapa_origen_id = v_entry_id and not e.cancelado
                and e.registro_hotel_id = v_follow.registro_id
                and e.tipo_etapa = 'recogida_taller'
              limit 1 for update;
              if v_pickup_id is null then
                raise exception 'La entrada ya tiene una etapa activa incompatible; no se ha duplicado';
              end if;
            end if;
          end if;
        end if;
$new$;
begin
  select pg_get_functiondef(p.oid)
    into v_ddl
  from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='app_private'
    and p.proname='manteniment_importar_trabajos_alpha74_base';

  if md5(v_ddl) <> 'fedf69806c3896275b291817a0ae389b' then
    raise exception 'Definición inesperada %, no se aplica el parche', md5(v_ddl);
  end if;
  if strpos(v_ddl, v_old_fragment) = 0 then
    raise exception 'No se encontró el bloque exacto a sustituir';
  end if;

  v_new := replace(v_ddl, v_old_fragment, v_new_fragment);
  execute v_new;
end;
$apply$;
