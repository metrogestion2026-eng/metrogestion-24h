-- Prepared during the security review. Not applied to production.
-- Preserve the existing function identity and EXECUTE grants.
create or replace function app_private.es_administrador_principal()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, app_private
as $function$
  select exists (
    select 1
    from public.usuarios u
    where u.id = auth.uid()
      and u.activo = true
      and u.debe_cambiar_clave = false
      and u.tipo_usuario = 'administrador_principal'
      and app_private.credencial_vigente()
  );
$function$;

comment on function app_private.es_administrador_principal()
  is 'Exige administrador activo, contraseña definitiva y sesión Auth vigente para todos los controles que usan este predicado.';
