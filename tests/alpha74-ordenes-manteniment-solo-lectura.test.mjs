import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const read = file => readFile(path.join(root, file), 'utf8');

test('Alpha74 muestra la cola de MANTENIMENT solo al administrador principal', async () => {
  const panel = await read('r1-alpha74/src/panel-native.js');

  assert.match(panel, /admin \? readQuery\('Órdenes MANTENIMENT', supabase\.rpc\('listar_ordenes_manteniment_pendientes_alpha74'\)\)/);
  assert.match(panel, /if \(admin\) \{[\s\S]*MANTENIMENT · Sincronización/);
  assert.match(panel, /Vista administrativa de solo lectura/);
  assert.match(panel, /MANTENIMENT · Órdenes pendientes/);
  assert.match(panel, /exportable: false/);
  assert.doesNotMatch(panel, /supabase\.rpc\('(confirmar_comandos_manteniment|manteniment_confirmar_comandos)'/);
});

test('la consulta limitada protege sesión, dispositivo, rol y datos privados', async () => {
  const migration = await read(
    'supabase/migrations/20260906055809_alpha74_ordenes_manteniment_solo_lectura.sql'
  );

  assert.match(migration, /public\.usuario_activo\(\)/);
  assert.match(migration, /public\.dispositivo_autorizado\(\)/);
  assert.match(migration, /public\.es_administrador_principal\(\)/);
  assert.match(migration, /where o\.estado = 'pendiente'/);
  assert.match(migration, /limit 100/);
  assert.match(migration, /security invoker/);
  assert.match(migration, /revoke all on function public\.listar_ordenes_manteniment_pendientes_alpha74\(\)[\s\S]*from public, anon, authenticated/);
  assert.match(migration, /grant execute on function public\.listar_ordenes_manteniment_pendientes_alpha74\(\)[\s\S]*to authenticated, service_role/);
  const signatures = [...migration.matchAll(/returns table \(([\s\S]*?)\)\s*language/gi)]
    .map(match => match[1]);
  assert.equal(signatures.length, 2);
  signatures.forEach(signature => {
    assert.doesNotMatch(signature, /seguimiento_id/i);
    assert.doesNotMatch(signature, /sync_id/i);
    assert.doesNotMatch(signature, /payload/i);
  });
  assert.doesNotMatch(migration, /(insert into|update|delete from) app_private\.manteniment_parada_outbox/i);
});
