import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');

test('las operaciones protegidas exigen una sesión Auth real y vigente', async () => {
  const migration = await readFile(path.join(
    root,
    'supabase/migrations/20260905203000_alpha73_validar_sesion_auth_activa.sql'
  ), 'utf8');

  assert.match(migration, /create or replace function app_private\.sesion_auth_activa\(\)/);
  assert.match(migration, /security definer/);
  assert.match(migration, /set search_path = pg_catalog, auth/);
  assert.match(migration, /from auth\.sessions s/);
  assert.match(migration, /auth\.jwt\(\)->>'session_id'/);
  assert.match(migration, /s\.user_id = auth\.uid\(\)/);
  assert.match(migration, /s\.not_after is null or s\.not_after > clock_timestamp\(\)/);
  assert.match(migration, /and app_private\.sesion_auth_activa\(\)/);
  assert.match(migration, /revoke all on function app_private\.sesion_auth_activa\(\)[\s\S]*from public, anon, authenticated/);
  assert.doesNotMatch(migration, /grant execute on function app_private\.sesion_auth_activa\(\)[\s\S]*to authenticated/);
});
