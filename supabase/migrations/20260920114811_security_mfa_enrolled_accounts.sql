-- Enrolment remains voluntary. Once verified, MFA is enforced by the server.
create or replace function app_private.credencial_vigente()
returns boolean language sql stable security definer
set search_path=pg_catalog,public,app_private
as $function$
  select coalesce((
    select
      app_private.jwt_emitido_en() is not null
      and app_private.jwt_emitido_en() + interval '5 seconds'
          >= date_trunc('second', u.credenciales_actualizadas_en)
      and app_private.sesion_auth_activa()
      and (
        coalesce(auth.jwt()->>'aal','aal1') = 'aal2'
        or not exists (
          select 1 from auth.mfa_factors f
          where f.user_id=auth.uid() and f.status='verified'
        )
      )
    from public.usuarios u where u.id=auth.uid()
  ),false);
$function$;
