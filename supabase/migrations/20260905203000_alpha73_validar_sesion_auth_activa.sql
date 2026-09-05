-- Refuerzo común de autenticación: además de comprobar la fecha de emisión
-- del JWT, cada operación protegida exige que su session_id siga existiendo
-- en Auth, pertenezca al mismo usuario y no haya alcanzado not_after.

create or replace function app_private.sesion_auth_activa()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, auth
as $function$
  select coalesce((
    select
      s.user_id = auth.uid()
      and (s.not_after is null or s.not_after > clock_timestamp())
    from auth.sessions s
    where s.id::text = nullif(auth.jwt()->>'session_id', '')
  ), false);
$function$;

create or replace function app_private.credencial_vigente()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, app_private
as $function$
  select coalesce((
    select
      app_private.jwt_emitido_en() is not null
      and app_private.jwt_emitido_en() + interval '5 seconds'
          >= date_trunc('second', u.credenciales_actualizadas_en)
      and app_private.sesion_auth_activa()
    from public.usuarios u
    where u.id = auth.uid()
  ), false);
$function$;

revoke all on function app_private.sesion_auth_activa()
  from public, anon, authenticated;
grant execute on function app_private.sesion_auth_activa()
  to service_role;

comment on function app_private.sesion_auth_activa()
  is 'Comprueba que el JWT corresponde a una sesión Auth existente, del mismo usuario y no vencida.';
comment on function app_private.credencial_vigente()
  is 'Invalida credenciales anteriores al cambio de clave y JWT cuya sesión Auth ya no está activa.';
