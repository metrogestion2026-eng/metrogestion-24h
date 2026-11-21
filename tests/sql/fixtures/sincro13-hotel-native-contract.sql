-- SINCRO13 / solely private synthetic schema for current Hotel runtime tests.
-- Not a migration. No operational rows, real identities, secrets, networks or service-role permissions.
-- The fixture already contains genuine Hotel tables, workshop triggers and their
-- parent/child stage identities; add only the missing S13 receipt/approval contracts.

CREATE TABLE IF NOT EXISTS app_private.manteniment_entregas_continuidad_alpha75 (
  sync_id uuid NOT NULL,revision integer NOT NULL,
  seguimiento_id uuid NOT NULL,
  origen text NOT NULL,
  entregado_en timestamptz NOT NULL,
  payload jsonb NOT NULL,
  PRIMARY KEY(sync_id,revision)
);
CREATE TABLE IF NOT EXISTS app_private.sincro13_recibos_t (
  spreadsheet_id text NOT NULL,
  id_fila bigint NOT NULL,
  trabajo_sync_id uuid NOT NULL,
  orden_sync_id uuid NOT NULL,
  orden_revision integer NOT NULL,
  estado text NOT NULL,
  origen text NOT NULL,
  asignado_en timestamptz NOT NULL,
  PRIMARY KEY (spreadsheet_id,id_fila)
);
CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE
AS $$SELECT jsonb_build_object('session_id','aaaaaaaa-0000-4000-8000-000000000001');$$;
CREATE OR REPLACE FUNCTION app_private.sesion_auth_activa()
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT auth.uid() IS NOT NULL;
$$;
CREATE OR REPLACE FUNCTION app_private.usuario_activo()
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS(SELECT 1 FROM public.usuarios WHERE id=auth.uid() AND activo);
$$;
CREATE OR REPLACE FUNCTION app_private.dispositivo_autorizado()
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT public.dispositivo_autorizado();
$$;
CREATE OR REPLACE FUNCTION app_private.es_administrador_principal()
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT auth.uid() IS NOT NULL AND public.es_administrador_principal();
$$;
