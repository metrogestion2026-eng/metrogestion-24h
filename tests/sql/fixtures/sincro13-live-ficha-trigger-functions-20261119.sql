-- SINCRO13: READ-ONLY captured CURRENT function definitions from connected TEST

-- Supabase on 2026-11-19. NO USER DATA, NO SECRETS, TEST-DB ONLY.

CREATE OR REPLACE FUNCTION app_private.asignar_numero_parada_nuevo()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'app_private'
AS $function$
declare
  v_num bigint;
  v_explicito text;
  v_reservado text;
begin
  if current_setting('app.clonando_pizarra', true) = '1' then
    return new;
  end if;

  v_reservado := nullif(
    current_setting('app.numero_parada_reservada_alpha75', true),
    ''
  );
  v_explicito := nullif(btrim(coalesce(new.numero_parada, '')), '');

  if v_explicito is not null then
    if v_explicito ~ '^[0-9]+$'
       and exists (
         select 1
         from app_private.numeros_parada_temporales_alpha75 t
         where t.numero_parada = v_explicito::bigint
           and t.expira_en > clock_timestamp()
           and v_explicito is distinct from v_reservado
       ) then
      raise exception 'El número de parada está reservado por otra ficha en edición';
    end if;
    return new;
  end if;

  if v_reservado is not null then
    if v_reservado !~ '^[0-9]+$' then
      raise exception 'El número de parada reservado no es válido';
    end if;
    v_num := v_reservado::bigint;
    if app_private.numero_parada_usado_alpha75(v_num) then
      raise exception 'El número de parada reservado ya está utilizado';
    end if;
    new.numero_parada := v_num::text;
    return new;
  end if;

  loop
    v_num := nextval('public.numero_parada_seq');
    exit when not app_private.numero_parada_usado_alpha75(v_num)
      and not exists (
        select 1
        from app_private.numeros_parada_temporales_alpha75 t
        where t.numero_parada = v_num
      );
  end loop;

  new.numero_parada := v_num::text;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION app_private.manteniment_registro_hotel_trigger()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'app_private'
AS $function$
begin
  if coalesce(current_setting('app.manteniment_importando_paradas', true), '') = '1' then return new; end if;
  if exists (
    select 1 from app_private.manteniment_parada_sync s
    where s.seguimiento_id = new.seguimiento_id
  ) then
    perform app_private.manteniment_encolar_parada(new.seguimiento_id);
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION app_private.numero_parada_usado_alpha75(p_numero bigint)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  select p_numero is not null and exists (
    select 1
    from public.registros_hotel r
    where regexp_replace(coalesce(r.numero_parada, ''), '[^0-9]+', '', 'g') = p_numero::text
  );
$function$;

CREATE OR REPLACE FUNCTION app_private.reabrir_cierre_al_reactivar_registro_hotel()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'app_private'
AS $function$
begin
  -- El editor Alpha72 prepara el payload antes de guardar para conservar el
  -- control optimista de versiones de las T. Las demas vias se reparan aqui.
  if current_setting('app.audit_origin', true) = 'metrogestion-r1-editor' then
    return new;
  end if;

  if (
       old.cancelado
       or old.retirado_hotel_activo
       or old.estado in ('recuperado', 'reserva_liberada', 'anulado')
     )
     and not new.cancelado
     and not new.retirado_hotel_activo
     and new.estado not in ('recuperado', 'reserva_liberada', 'anulado') then
    perform app_private.reabrir_cierre_ficha_hotel(
      new.id,
      coalesce(auth.uid(), new.modificado_por, new.creado_por)
    );
  end if;

  return new;
end;
$function$;

