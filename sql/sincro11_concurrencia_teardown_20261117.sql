-- Limpieza explícita en la BD ficticia, bajo CI. Sin DROP en base real.
\set ON_ERROR_STOP on
BEGIN;
DO $guard$
BEGIN
 IF current_database()<>'sincro11_lab' THEN
   RAISE EXCEPTION 'S11_CI_NO_LAB: se niega a borrar fuera del laboratorio';
 END IF;
END $guard$;
DROP SCHEMA IF EXISTS s11_ci CASCADE;
COMMIT;
DO $check$
BEGIN
 IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname='s11_ci') THEN
  RAISE EXCEPTION 'S11_CI: persiste un esquema de laboratorio inesperadamente';
 END IF;
END $check$;