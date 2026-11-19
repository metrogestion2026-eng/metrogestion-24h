-- ONLY SYNTHETIC isolated PG17 workshop fixtures.
-- The real audit trigger definition requires columns already present in
-- Supabase testing; this old local fixture had only id/request_id.
-- Adding columns here never alters connected Supabase.
ALTER TABLE public.auditoria_cambios
 ADD COLUMN IF NOT EXISTS tabla text,
 ADD COLUMN IF NOT EXISTS registro_id uuid,
 ADD COLUMN IF NOT EXISTS accion text,
 ADD COLUMN IF NOT EXISTS datos_anteriores jsonb,
 ADD COLUMN IF NOT EXISTS datos_nuevos jsonb,
 ADD COLUMN IF NOT EXISTS usuario_id uuid,
 ADD COLUMN IF NOT EXISTS origen text;

DO $s13$
BEGIN
 IF to_regprocedure('app_private.request_header(text)') IS NULL THEN
   EXECUTE 'CREATE FUNCTION app_private.request_header(p_name text) RETURNS text LANGUAGE sql STABLE AS $h$ SELECT NULL::text $h$';
 END IF;
END;
$s13$;
