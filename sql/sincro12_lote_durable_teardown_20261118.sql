-- SINCRO12: limpieza SOLO del laboratorio ficticio, nunca Supabase.
\set ON_ERROR_STOP on
DO $guard$
BEGIN
 IF current_database()<>'sincro11_lab' THEN
  RAISE EXCEPTION 'S12_TEARDOWN_SOLO_SINCRO11_LAB';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_namespace WHERE nspname='s12_lab') THEN
  RAISE EXCEPTION 'S12_TEARDOWN_ESQUEMA_AUSENTE';
 END IF;
END $guard$;
DROP SCHEMA s12_lab CASCADE;
DO $guard$
BEGIN
 IF EXISTS(SELECT 1 FROM pg_namespace WHERE nspname='s12_lab') THEN
  RAISE EXCEPTION 'S12_TEARDOWN_NO_LIMPIO';
 END IF;
END $guard$;
