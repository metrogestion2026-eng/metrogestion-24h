import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const read = file => readFile(path.join(root, file), 'utf8');

test('Alpha73 muestra y confirma la identidad inmutable antes del guardado completo', async () => {
  const editor = await read('r1-alpha73/src/hotel-editor.js');

  assert.match(editor, /String\(detail\.ficha\?\.id \|\| ''\) !== String\(registroId \|\| ''\)/);
  assert.match(editor, /Object\.freeze\(editionIdentity\(detail\.ficha\)\)/);
  assert.match(editor, /sameEditionIdentity\(editionIdentity\(detail\.ficha\), loadedIdentity\)/);
  assert.match(editor, /FICHA QUE SE VA A GUARDAR/);
  assert.match(editor, /Vehículo:/);
  assert.match(editor, /Parada:/);
  assert.match(editor, /Reserva:/);
  assert.match(editor, /otra ficha que haya usado la misma reserva/);
  assert.match(editor, /guardar_ficha_hotel_edicion_alpha73/);
  assert.match(editor, /p_identidad: loadedIdentity/);
});

test('la base de datos verifica ficha, seguimiento, pizarra, parada, vehículos, T y trabajos', async () => {
  const migration = await read('supabase/migrations/20260905200000_alpha73_bloqueo_identidad_ficha.sql');

  assert.match(migration, /security definer/);
  assert.match(migration, /public\.usuario_activo\(\)/);
  assert.match(migration, /public\.dispositivo_autorizado\(\)/);
  assert.match(migration, /public\.puede_editar_modulo\('hotel'\)/);
  for (const field of [
    'registro_id', 'seguimiento_id', 'pizarra_id', 'numero_parada',
    'vehiculo_sustituido', 'matricula_sustituido', 'vehiculo_reserva', 'matricula_reserva'
  ]) assert.match(migration, new RegExp(field));
  assert.match(migration, /e\.registro_hotel_id = p_registro_id/);
  assert.match(migration, /t\.etapa_hotel_id::text = v_etapa->>'id'/);
  assert.match(migration, /app_private\.guardar_ficha_hotel_edicion_alpha72/);
  assert.match(migration, /'identidad_validada', true/);
  assert.match(migration, /revoke all on function public\.guardar_ficha_hotel_edicion_alpha73[\s\S]*from public, anon, authenticated/);
  assert.match(migration, /grant execute on function public\.guardar_ficha_hotel_edicion_alpha73[\s\S]*to authenticated, service_role/);
});

test('la reparación de R1443 es exacta, reversible y no borra físicamente anotaciones', async () => {
  const migration = await read('supabase/migrations/20260905200000_alpha73_bloqueo_identidad_ficha.sql');

  assert.match(migration, /R1443/);
  assert.match(migration, /2600151/);
  assert.match(migration, /R1269/);
  assert.match(migration, /reparado tapa de filtro suelta/);
  assert.match(migration, /recuperado\./);
  assert.match(migration, /set cancelada = true/);
  assert.doesNotMatch(migration, /delete\s+from\s+public\.anotaciones_manuales_hotel/i);
});
