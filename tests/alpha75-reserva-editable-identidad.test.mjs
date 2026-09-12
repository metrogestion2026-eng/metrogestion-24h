import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const editor = await readFile('r1-alpha75/src/hotel-editor.js', 'utf8');
const migration = await readFile('supabase/migrations/20260912112000_reserva_editable_fuera_identidad_ficha.sql', 'utf8');

test('la reserva es editable y no forma parte de la identidad inmutable en Alpha75', () => {
  const identityBlock = editor.match(/function editionIdentity\(ficha\) \{[\s\S]*?\n\}/)?.[0] || '';
  assert.match(identityBlock, /registro_id/);
  assert.match(identityBlock, /numero_parada/);
  assert.match(identityBlock, /vehiculo_sustituido/);
  assert.doesNotMatch(identityBlock, /vehiculo_reserva/);
  assert.doesNotMatch(identityBlock, /matricula_reserva/);
  assert.match(editor, /identityConfirmation\(detail\.ficha\)/);
});

test('Supabase protege la ficha y permite cambiar la reserva', () => {
  assert.match(migration, /p_identidad->>'registro_id'/);
  assert.match(migration, /p_identidad->>'numero_parada'/);
  assert.match(migration, /p_identidad->>'vehiculo_sustituido'/);
  assert.doesNotMatch(migration, /p_identidad->>'vehiculo_reserva'/);
  assert.doesNotMatch(migration, /p_identidad->>'matricula_reserva'/);
  assert.match(migration, /e\.registro_hotel_id = p_registro_id/);
  assert.match(migration, /t\.etapa_hotel_id::text = v_etapa->>'id'/);
});
