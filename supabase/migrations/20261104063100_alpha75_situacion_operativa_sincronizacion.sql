-- MG75-SITUACION-OPERATIVA-001 · sincronización, autocorrección y controles.

create or replace function app_private.debe_permanecer_activa_hotel_alpha75(
  p_registro_id uuid
)
returns boolean
language sql
security definer
set search_path to 'pg_catalog', 'public', 'app_private'
as $function$
  select coalesce(
    (
      app_private.proyectar_situacion_operativa_hotel_alpha75(p_registro_id)
      ->> 'activa_recomendada'
    )::boolean,
    false
  );
$function$;

create or replace function app_private.sincronizar_situacion_operativa_hotel_alpha75(
  p_registro_id uuid,
  p_permitir_retirada boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'app_private'
as $function$
declare
  v_r public.registros_hotel%rowtype;
  v_projection jsonb;
  v_estado text;
  v_lugar text;
  v_activa boolean;
  v_cambiar_lugar boolean := false;
  v_retirar boolean := false;
  v_actualizado boolean := false;
  v_prev_guard text;
  v_prev_origin text;
begin
  select *
  into v_r
  from public.registros_hotel
  where id = p_registro_id
  for update;

  if not found then
    return jsonb_build_object(
      'ok', false,
      'motivo', 'ficha_no_encontrada',
      'registro_id', p_registro_id
    );
  end if;

  v_projection :=
    app_private.proyectar_situacion_operativa_hotel_alpha75(p_registro_id);
  v_estado := nullif(v_projection->>'estado_proyectado', '');
  v_lugar := v_projection->>'lugar_proyectado';
  v_activa := coalesce(
    (v_projection->>'activa_recomendada')::boolean,
    true
  );

  if v_r.cancelado or v_r.retirado_hotel_activo then
    return v_projection || jsonb_build_object(
      'ok', true,
      'actualizado', false,
      'retirada_aplicada', false
    );
  end if;

  v_cambiar_lugar :=
    nullif(btrim(coalesce(v_lugar, '')), '') is not null
    and not app_private.lugares_hotel_equivalentes_alpha75(
      v_r.lugar,
      v_lugar
    );

  v_retirar := p_permitir_retirada and not v_activa;

  if v_r.estado is distinct from v_estado
     or v_cambiar_lugar
     or v_retirar then
    v_prev_guard := current_setting('app.situacion_operativa_hotel', true);
    v_prev_origin := current_setting('app.audit_origin', true);
    perform set_config('app.situacion_operativa_hotel', '1', true);
    if nullif(v_prev_origin, '') is null then
      perform set_config(
        'app.audit_origin',
        'metrogestion-r1-situacion-operativa',
        true
      );
    end if;

    update public.registros_hotel
    set estado = coalesce(v_estado, estado),
        lugar = case
          when v_cambiar_lugar then v_lugar
          else lugar
        end,
        retirado_hotel_activo = case
          when v_retirar then true
          else retirado_hotel_activo
        end,
        fecha_retirado_hotel = case
          when v_retirar then coalesce(
            fecha_retirado_hotel,
            clock_timestamp()
          )
          else fecha_retirado_hotel
        end,
        modificado_por = coalesce(
          auth.uid(),
          modificado_por,
          creado_por
        )
    where id = p_registro_id;

    v_actualizado := found;
    perform set_config(
      'app.situacion_operativa_hotel',
      coalesce(v_prev_guard, ''),
      true
    );
    perform set_config(
      'app.audit_origin',
      coalesce(v_prev_origin, ''),
      true
    );
  end if;

  return
    app_private.proyectar_situacion_operativa_hotel_alpha75(p_registro_id)
    || jsonb_build_object(
      'ok', true,
      'actualizado', v_actualizado,
      'retirada_aplicada', v_retirar
    );
end;
$function$;

create or replace function app_private.sincronizar_situacion_operativa_hotel_trigger_alpha75()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'app_private'
as $function$
declare
  v_registro_id uuid;
begin
  if current_setting('app.situacion_operativa_hotel', true) = '1' then
    return null;
  end if;

  if tg_table_name = 'etapas_hotel' then
    if tg_op = 'DELETE' then
      v_registro_id := old.registro_hotel_id;
    else
      v_registro_id := new.registro_hotel_id;
    end if;
  else
    v_registro_id := new.id;
  end if;

  if v_registro_id is not null then
    perform app_private.sincronizar_situacion_operativa_hotel_alpha75(
      v_registro_id,
      true
    );
  end if;

  return null;
end;
$function$;

drop trigger if exists zzzzzz_etapas_hotel_situacion_operativa_alpha75
  on public.etapas_hotel;
create constraint trigger zzzzzz_etapas_hotel_situacion_operativa_alpha75
after insert or update or delete on public.etapas_hotel
deferrable initially deferred
for each row
execute function app_private.sincronizar_situacion_operativa_hotel_trigger_alpha75();

drop trigger if exists zzzzzz_registros_hotel_situacion_operativa_alpha75
  on public.registros_hotel;
create constraint trigger zzzzzz_registros_hotel_situacion_operativa_alpha75
after insert or update on public.registros_hotel
deferrable initially deferred
for each row
execute function app_private.sincronizar_situacion_operativa_hotel_trigger_alpha75();

do $function$
declare
  v_id uuid;
begin
  perform set_config(
    'app.request_id',
    'situacion_operativa_20261104',
    true
  );
  perform set_config(
    'app.audit_origin',
    'metrogestion-r1-situacion-operativa',
    true
  );

  for v_id in
    select r.id
    from public.registros_hotel r
    join public.pizarras p on p.id = r.pizarra_id
    where p.estado = 'en_curso'
      and not r.cancelado
    order by r.orden, r.id
  loop
    perform app_private.sincronizar_situacion_operativa_hotel_alpha75(
      v_id,
      true
    );
  end loop;
end;
$function$;

do $function$
begin
  if exists (
    select 1
    from public.registros_hotel r
    join public.pizarras p
      on p.id = r.pizarra_id
     and p.estado = 'en_curso'
    join public.etapas_hotel e
      on e.registro_hotel_id = r.id
     and not e.cancelado
     and e.tipo_etapa = 'entrada_taller'
     and e.estado = 'en_curso'
     and e.fecha_inicio_real is not null
     and coalesce(e.fecha_fin_real, e.fecha_real) is null
    where not r.cancelado
      and not r.retirado_hotel_activo
      and r.estado not in (
        'en_taller',
        'pendiente_diagnostico',
        'pendiente_autorizacion',
        'pendiente_repuestos'
      )
  ) then
    raise exception 'MG75-SITUACION-OPERATIVA-001: queda una entrada de taller activa con estado de cabecera incoherente';
  end if;

  if exists (
    select 1
    from public.registros_hotel r
    join public.pizarras p
      on p.id = r.pizarra_id
     and p.estado = 'en_curso'
    where not r.cancelado
      and not r.retirado_hotel_activo
      and not app_private.debe_permanecer_activa_hotel_alpha75(r.id)
  ) then
    raise exception 'MG75-SITUACION-OPERATIVA-001: queda una ficha terminada sin sustitución dentro de Activas';
  end if;
end;
$function$;
