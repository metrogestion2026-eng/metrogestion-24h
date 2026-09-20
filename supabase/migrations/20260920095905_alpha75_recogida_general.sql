-- J is workshop entry, K is pickup. Reconcile the existing visit by F + J.
-- Preserve current private-function ACLs and unrelated importer behavior.
create or replace function app_private.manteniment_requiere_recogida_alpha75(
  p_designacion text, p_tipo text, p_taller text
) returns boolean language sql immutable
set search_path = pg_catalog
as $function$
  select case
    when upper(btrim(coalesce(p_designacion,''))) in ('REPUESTOS','ACT','LINDEP','CV') then true
    else btrim(coalesce(p_taller,'')) <> ''
      and upper(btrim(p_taller)) <> 'TM'
      and upper(btrim(coalesce(p_designacion,''))) not in
        ('ITV','44TN','RT','TMG','LKT','SG','EXT','EXTINTOR','ATP','OTA')
      and translate(upper(coalesce(p_tipo,'')), 'ÁÉÍÓÚÜ', 'AEIOUU') not like '%TRAMITE%'
      and translate(upper(coalesce(p_tipo,'')), 'ÁÉÍÓÚÜ', 'AEIOUU') not like '%GESTION%'
  end;
$function$;
revoke all on function app_private.manteniment_requiere_recogida_alpha75(text,text,text)
  from public, anon, authenticated;
grant execute on function app_private.manteniment_requiere_recogida_alpha75(text,text,text)
  to service_role;

do $migration$
declare
  definition text := pg_get_functiondef(
    'app_private.manteniment_importar_trabajos_alpha74_base(jsonb)'::regprocedure);
begin
  if (length(definition) - length(replace(definition, $old0$      and x.pendiente_fondo_blanco$old0$, '')))
      / length($old0$      and x.pendiente_fondo_blanco$old0$) <> 1 then
    raise exception 'El importador ha cambiado: no se puede aplicar el cambio 1 con seguridad';
  end if;
  definition := replace(definition, $old0$      and x.pendiente_fondo_blanco$old0$, $new0$      and (
        x.pendiente_fondo_blanco
        or sync_work.id is not null or key_work.id is not null
        or (x.numero_parada <> '' and x.fecha_recogida is null
            and (x.fecha_realizada is null or app_private.manteniment_requiere_recogida_alpha75(
              x.designacion_norm, x.tipo_norm, x.taller_norm)))
      )$new0$);
  if (length(definition) - length(replace(definition, $old1$        or (x.designacion_norm in ('REPUESTOS', 'ACT', 'LINDEP', 'CV') and x.fecha_recogida is null)$old1$, '')))
      / length($old1$        or (x.designacion_norm in ('REPUESTOS', 'ACT', 'LINDEP', 'CV') and x.fecha_recogida is null)$old1$) <> 1 then
    raise exception 'El importador ha cambiado: no se puede aplicar el cambio 2 con seguridad';
  end if;
  definition := replace(definition, $old1$        or (x.designacion_norm in ('REPUESTOS', 'ACT', 'LINDEP', 'CV') and x.fecha_recogida is null)$old1$, $new1$        or (x.fecha_recogida is null and (
          x.designacion_norm in ('REPUESTOS', 'ACT', 'LINDEP', 'CV')
          or ((x.numero_parada <> '' or sync_work.id is not null or key_work.id is not null)
              and app_private.manteniment_requiere_recogida_alpha75(
                x.designacion_norm, x.tipo_norm, x.taller_norm))
        ))$new1$);
  if (length(definition) - length(replace(definition, $old2$          and e.estado <> 'realizada'
          and e.fecha_real is null
          and e.fecha_fin_real is null$old2$, '')))
      / length($old2$          and e.estado <> 'realizada'
          and e.fecha_real is null
          and e.fecha_fin_real is null$old2$) <> 2 then
    raise exception 'El importador ha cambiado: no se puede aplicar el cambio 3 con seguridad';
  end if;
  definition := replace(definition, $old2$          and e.estado <> 'realizada'
          and e.fecha_real is null
          and e.fecha_fin_real is null$old2$, $new2$          and e.estado <> 'anulada'
          and (
            (e.estado <> 'realizada' and e.fecha_real is null and e.fecha_fin_real is null)
            or (v_modalidad = 'taller' and e.tipo_etapa = 'entrada_taller'
                and v_group.fecha_realizada is not null
                and (coalesce(e.fecha_real, e.fecha_inicio_real, e.fecha_fin_real)
                  at time zone 'Europe/Madrid')::date = v_group.fecha_realizada)
          )$new2$);
  if (length(definition) - length(replace(definition, $old3$            and e.estado <> 'realizada'
            and e.fecha_real is null
            and e.fecha_fin_real is null$old3$, '')))
      / length($old3$            and e.estado <> 'realizada'
            and e.fecha_real is null
            and e.fecha_fin_real is null$old3$) <> 1 then
    raise exception 'El importador ha cambiado: no se puede aplicar el cambio 4 con seguridad';
  end if;
  definition := replace(definition, $old3$            and e.estado <> 'realizada'
            and e.fecha_real is null
            and e.fecha_fin_real is null$old3$, $new3$            and e.estado <> 'anulada'
            and (
              (e.estado <> 'realizada' and e.fecha_real is null and e.fecha_fin_real is null)
              or (v_modalidad = 'taller' and e.tipo_etapa = 'entrada_taller'
                  and v_group.fecha_realizada is not null
                  and (coalesce(e.fecha_real, e.fecha_inicio_real, e.fecha_fin_real)
                    at time zone 'Europe/Madrid')::date = v_group.fecha_realizada)
            )$new3$);
  if (length(definition) - length(replace(definition, $old4$      insert into app_private.manteniment_t_visitas($old4$, '')))
      / length($old4$      insert into app_private.manteniment_t_visitas($old4$) <> 1 then
    raise exception 'El importador ha cambiado: no se puede aplicar el cambio 5 con seguridad';
  end if;
  definition := replace(definition, $old4$      insert into app_private.manteniment_t_visitas($old4$, $new4$      -- Una entrada ya informada no autoriza a inventar una segunda visita.
      if v_modalidad = 'taller' and v_group.fecha_realizada is not null
         and v_entry_id is null then
        raise exception 'La necesidad de % tiene entrada en J, pero no existe una única T compatible en la actuación; revise el enlace antes de continuar',
          v_group.taller;
      end if;

      insert into app_private.manteniment_t_visitas($new4$);
  if (length(definition) - length(replace(definition, $old5$      -- recogida. Solo se reutiliza una T aún no realizada cuyo nombre o lugar
      -- normalizado coincide exactamente con F. AUTODIS no coincide con$old5$, '')))
      / length($old5$      -- recogida. Solo se reutiliza una T aún no realizada cuyo nombre o lugar
      -- normalizado coincide exactamente con F. AUTODIS no coincide con$old5$) <> 1 then
    raise exception 'El importador ha cambiado: no se puede aplicar el cambio 6 con seguridad';
  end if;
  definition := replace(definition, $old5$      -- recogida. Solo se reutiliza una T aún no realizada cuyo nombre o lugar
      -- normalizado coincide exactamente con F. AUTODIS no coincide con$old5$, $new5$      -- recogida. Se reutiliza la entrada sin realizar o la entrada cuya fecha
      -- real coincide con J; el taller debe coincidir exactamente con F.
      -- AUTODIS no coincide con$new5$);
  execute definition;
end;
$migration$;
