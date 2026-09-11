import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migration = await readFile('supabase/migrations/20260911133000_alpha75_t_modificacion_operativa.sql', 'utf8');
const editor = await readFile('r1-alpha75/src/hotel-editor.js', 'utf8');

test('anular o cambiar una entrada aplica sus dependencias operativas', () => {
  assert.match(migration, /reconciliar_dependencias_t_alpha75/);
  assert.match(migration, /la Entrada de taller vinculada ya no está activa/);
  assert.match(migration, /recogidas_anuladas/);
  assert.match(migration, /recogidas_restauradas/);
});

test('las fechas de MANTENIMENT se recalculan desde las T activas', () => {
  assert.match(migration, /recalcular_fechas_manteniment_alpha75/);
  assert.match(migration, /not e\.cancelado/);
  assert.match(migration, /e\.estado = 'realizada'/);
  assert.match(migration, /fecha_realizada is distinct from/);
  assert.match(migration, /manteniment_encolar_parada/);
});

test('el editor informa del efecto real aplicado y no lo presenta como anotación', () => {
  assert.match(editor, /efecto operativo aplicado/);
  assert.match(editor, /MANTENIMENT recalculada/);
  assert.match(editor, /aplicando el efecto operativo de las T en Hotel, Panel y MANTENIMENT/);
});
