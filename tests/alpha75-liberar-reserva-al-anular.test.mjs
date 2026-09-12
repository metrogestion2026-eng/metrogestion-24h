import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migration = await readFile(
  'supabase/migrations/20260912110000_liberar_reserva_al_anular_y_reactivar_pa2600152.sql',
  'utf8'
);

test('anular una ficha libera toda la asignación operativa de su reserva', () => {
  assert.match(migration, /if new\.cancelado then/);
  assert.match(migration, /new\.vehiculo_reserva := ''/);
  assert.match(migration, /new\.matricula_reserva := ''/);
  assert.match(migration, /new\.etiqueta_reserva := ''/);
  assert.match(migration, /new\.tipo_sustituto := ''/);
  assert.match(migration, /new\.sustitucion_temporal := false/);
  assert.match(migration, /before insert or update of cancelado/);
});

test('PA-2600152 se reactiva sin reserva y sin crear otra parada lógica', () => {
  assert.match(migration, /v_source_id constant uuid := '47dbe8b1-56f7-44da-af6f-6d514067723b'/);
  assert.match(migration, /seguimiento_id = v_follow_id/);
  assert.match(migration, /app_private\.asegurar_reactivacion_historica\(v_source_id\)/);
  assert.match(migration, /btrim\(coalesce\(vehiculo_reserva, ''\)\) = ''/);
  assert.match(migration, /11 T \(7 activas y 4 anuladas\)/);
});
