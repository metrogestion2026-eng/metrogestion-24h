import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const migration = await readFile(path.join(
  root,
  'supabase/migrations/20260905180500_alpha72_marcador_accesos_usuario.sql'
), 'utf8');
const presence = await readFile(path.join(root, 'r1-alpha69/src/presence-security.js'), 'utf8');
const alpha63Index = await readFile(path.join(root, 'r1-alpha63/index.html'), 'utf8');

assert.match(migration, /create table if not exists public\.accesos_usuario/);
assert.match(migration, /unique \(usuario_id, sesion_clave\)/);
assert.match(migration, /'auth:' \|\| new\.auth_session_id/);
assert.match(migration, /on conflict \(usuario_id, sesion_clave\) do update/);
assert.match(migration, /accedido_en = least/);
assert.match(migration, /ultimo_visto_en = greatest/);
assert.match(migration, /after insert or update of ultima_actividad_en/);
assert.match(migration, /when \(new\.estado = 'activo'\)/);
assert.match(migration, /alter table public\.accesos_usuario enable row level security/);
assert.match(migration, /revoke all on table public\.accesos_usuario from public, anon, authenticated/);
assert.match(migration, /acceso\.accedido_en >= v_inicio_hoy/);
assert.match(migration, /acceso\.accedido_en >= v_ahora - interval '7 days'/);
assert.match(migration, /'accesos_usuarios', v_accesos_usuarios/);
assert.match(migration, /'total_accesos_hoy', v_total_accesos_hoy/);

assert.match(presence, /Marcador de accesos de usuarios/);
assert.match(presence, /Cada sesión validada cuenta una sola vez/);
assert.match(presence, /Accesos de hoy/);
assert.match(presence, /Últimos 7 días/);
assert.match(presence, /Último acceso: /);
assert.match(presence, /Dispositivo: /);
assert.match(presence, /Accesos válidos hoy/);
assert.match(presence, /renderUserAccess\(status\.accesos_usuarios \|\| \[\]\)/);
assert.match(presence, /meta\[name="metrogestion-release"\]/);
assert.match(presence, /location\.pathname\.match\(\/\\\/r1-alpha\(\\d\+\)/);
assert.match(alpha63Index, /name="metrogestion-release" content="r1\.0\.0-alpha\.72"/);
assert.match(alpha63Index, /src="\.\.\/r1-alpha72\/src\/app\.js"/);
assert.match(alpha63Index, /src="\.\.\/r1-alpha72\/src\/hotel-native\.js"/);
assert.match(alpha63Index, /src="\.\.\/r1-alpha72\/src\/history-native\.js"/);
assert.match(alpha63Index, /src="\.\.\/r1-alpha72\/src\/panel-native\.js"/);

console.log('Alpha72: marcador de accesos únicos por sesión verificado.');
