-- Bounded counters: global budget prevents rotation of client identifiers.
create table app_private.acceso_anonimo_cupos (
  ambito text not null,
  clave_hash text not null,
  minuto timestamptz not null,
  peticiones integer not null check (peticiones > 0),
  primary key (ambito, clave_hash, minuto)
);
create index acceso_anonimo_cupos_minuto_idx on app_private.acceso_anonimo_cupos(minuto);
alter table app_private.acceso_anonimo_cupos enable row level security;
revoke all on app_private.acceso_anonimo_cupos from public,anon,authenticated;
grant all on app_private.acceso_anonimo_cupos to service_role;
create policy acceso_anonimo_cupos_service on app_private.acceso_anonimo_cupos for all to service_role using (true) with check (true);

create or replace function app_private.consumir_cupo_acceso_anonimo(p_huella_hash text,p_ip_hash text)
returns boolean language plpgsql security definer
set search_path=pg_catalog,app_private
as $function$
declare
 v_minuto timestamptz:=date_trunc('minute',clock_timestamp());
 v_ambito text; v_clave text; v_limite integer; v_count integer;
begin
 if coalesce(p_huella_hash,'') !~ '^[0-9a-f]{64}$' or (coalesce(p_ip_hash,'')<>'' and p_ip_hash !~ '^[0-9a-f]{64}$') then return false; end if;
 delete from app_private.acceso_anonimo_cupos where minuto < v_minuto - interval '2 minutes';
 for v_ambito,v_clave,v_limite in
   select * from (values ('global','global',600),('red',coalesce(nullif(p_ip_hash,''),'sin_ip'),120),('huella',p_huella_hash,30)) c(ambito,clave,limite)
 loop
   v_count:=null;
   insert into app_private.acceso_anonimo_cupos as c(ambito,clave_hash,minuto,peticiones)
   values(v_ambito,v_clave,v_minuto,1)
   on conflict (ambito,clave_hash,minuto) do update set peticiones=c.peticiones+1
   where c.peticiones < v_limite
   returning peticiones into v_count;
   if v_count is null then return false; end if;
 end loop;
 return true;
end;
$function$;
revoke all on function app_private.consumir_cupo_acceso_anonimo(text,text) from public,anon,authenticated;
grant execute on function app_private.consumir_cupo_acceso_anonimo(text,text) to service_role;

CREATE OR REPLACE FUNCTION app_private.registrar_intento_acceso_anonimo(p_huella_hash text, p_ip_hash text, p_correo text, p_evento text, p_agente text, p_ruta text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'app_private'
AS $function$
declare
  v_id uuid;
  v_bloqueado boolean;
  v_evento text := lower(btrim(coalesce(p_evento, '')));
  v_incremento integer;
  v_apertura integer;
  v_rechazo integer;
begin
  if coalesce(p_huella_hash, '') !~ '^[0-9a-f]{64}$' then raise exception 'Huella no válida'; end if;
  if coalesce(p_ip_hash, '') <> '' and p_ip_hash !~ '^[0-9a-f]{64}$' then raise exception 'Red no válida'; end if;
  if v_evento not in ('vista_login','credenciales_rechazadas','comprobar_bloqueo') then
    raise exception 'Evento no válido';
  end if;

  if not app_private.consumir_cupo_acceso_anonimo(p_huella_hash, p_ip_hash) then
    return jsonb_build_object('ok',false,'rate_limited',true);
  end if;

  v_incremento := case when v_evento = 'comprobar_bloqueo' then 0 else 1 end;
  v_apertura := case when v_evento = 'vista_login' then 1 else 0 end;
  v_rechazo := case when v_evento = 'credenciales_rechazadas' then 1 else 0 end;

  insert into public.intentos_acceso_no_reconocido (
    huella_hash, ip_hash, correo_indicado, ultimo_evento,
    agente, ruta, primero_en, ultimo_en, repeticiones,
    aperturas_login, credenciales_rechazadas, ultimo_rechazo_en
  ) values (
    p_huella_hash, coalesce(p_ip_hash, ''),
    left(lower(btrim(coalesce(p_correo, ''))), 160), v_evento,
    left(coalesce(p_agente, ''), 500), left(coalesce(p_ruta, ''), 160),
    now(), now(), greatest(v_incremento, 1),
    v_apertura, v_rechazo,
    case when v_rechazo = 1 then now() else null end
  )
  on conflict (huella_hash) do update
  set ip_hash = case when excluded.ip_hash <> '' then excluded.ip_hash
                     else public.intentos_acceso_no_reconocido.ip_hash end,
      correo_indicado = case when excluded.correo_indicado <> '' then excluded.correo_indicado
                             else public.intentos_acceso_no_reconocido.correo_indicado end,
      ultimo_evento = case when excluded.ultimo_evento = 'comprobar_bloqueo'
                           then public.intentos_acceso_no_reconocido.ultimo_evento
                           else excluded.ultimo_evento end,
      agente = excluded.agente,
      ruta = excluded.ruta,
      ultimo_en = now(),
      repeticiones = public.intentos_acceso_no_reconocido.repeticiones + v_incremento,
      aperturas_login = public.intentos_acceso_no_reconocido.aperturas_login + v_apertura,
      credenciales_rechazadas = public.intentos_acceso_no_reconocido.credenciales_rechazadas + v_rechazo,
      ultimo_rechazo_en = case when v_rechazo = 1 then now()
                               else public.intentos_acceso_no_reconocido.ultimo_rechazo_en end
  returning id, bloqueado into v_id, v_bloqueado;

  return jsonb_build_object(
    'ok', true,
    'intento_id', v_id,
    'bloqueado', v_bloqueado
  );
end;
$function$
;

-- Defense in depth; no application-role grants are added.
alter table app_private.manteniment_sync_config enable row level security;
create policy manteniment_sync_config_service on app_private.manteniment_sync_config for all to service_role using (true) with check (true);
alter table app_private.reservas_pendientes_reaperturas enable row level security;
create policy reservas_pendientes_reaperturas_service on app_private.reservas_pendientes_reaperturas for all to service_role using (true) with check (true);
