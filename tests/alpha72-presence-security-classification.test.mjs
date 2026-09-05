import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const migration = await readFile(path.join(
  root,
  'supabase/migrations/20260905174500_alpha72_clasificar_accesos_presencia.sql'
), 'utf8');
const indexMigration = await readFile(path.join(
  root,
  'supabase/migrations/20260905175500_alpha72_indice_acceso_reconocido_por.sql'
), 'utf8');
const presence = await readFile(path.join(root, 'r1-alpha69/src/presence-security.js'), 'utf8');

assert.match(migration, /aperturas_login integer not null default 0/);
assert.match(migration, /credenciales_rechazadas integer not null default 0/);
assert.match(migration, /ultimo_rechazo_en timestamptz/);
assert.match(migration, /reconocido_en timestamptz/);
assert.match(migration, /v_evento = 'vista_login'/);
assert.match(migration, /v_evento = 'credenciales_rechazadas'/);
assert.match(migration, /set reconocido_en = now\(\)/);
assert.match(migration, /and bloqueado = false/);
assert.match(migration, /dispositivo\.token_hash = i\.huella_hash/);
assert.match(migration, /i\.ultimo_rechazo_en > i\.reconocido_en/);
assert.match(migration, /bloqueo_origen/);
assert.match(migration, /rechazos_credenciales/);
assert.match(indexMigration, /intentos_acceso_reconocido_por_idx/);
assert.match(indexMigration, /where reconocido_por is not null/);

assert.match(presence, /location\.pathname\.match\(\/\\\/r1-alpha/);
assert.doesNotMatch(presence, /const VERSION = 'r1\.0\.0-alpha\.69'/);
assert.match(presence, /Una apertura es solo una visita a la pantalla de identificación/);
assert.match(presence, /Aperturas: /);
assert.match(presence, /Contraseñas rechazadas: /);
assert.match(presence, /El dispositivo ya está revocado/);
assert.match(presence, /Con contraseña rechazada/);

console.log('Alpha72: accesos, rechazos, huellas reconocidas y bloqueos clasificados.');
