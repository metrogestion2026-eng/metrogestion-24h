import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const ui = fs.readFileSync(
  new URL('../r1-alpha74/src/assistance-followup.js', import.meta.url),
  'utf8'
);
const migration = fs.readFileSync(
  new URL('../supabase/migrations/20260910070000_alpha74_vincular_seguimiento_24h_hotel.sql', import.meta.url),
  'utf8'
);

test('Mis incidencias permite continuar una asistencia abierta', () => {
  assert.match(ui, /Continuar seguimiento 24H/);
  assert.match(ui, /Trasladado en grúa a taller/);
  assert.match(ui, /Taller de traslado/);
  assert.match(ui, /guardar_activacion_24h/);
});

test('el seguimiento valida grúa, reparación y horas obligatorias', () => {
  assert.match(ui, /Indica el taller al que lo lleva la grúa/);
  assert.match(ui, /Confirma que el vehículo está operativo y reparado/);
  assert.match(ui, /Indica la hora de fin de reparación/);
  assert.match(ui, /Entrada y Recogida de taller creadas en la parada/);
});

test('la incidencia se vincula a Hotel y reconcilia la parada al guardar', () => {
  assert.match(migration, /new\.registro_hotel_id := v_match\.id/);
  assert.match(migration, /new\.seguimiento_hotel_id := v_match\.seguimiento_id/);
  assert.match(migration, /after insert or update of trasladado_taller, taller_traslado, resultado, estado/);
  assert.match(migration, /manteniment_reconciliar_asistencia_alpha74\(new\.registro_hotel_id\)/);
  assert.match(migration, /revoke all on function app_private\./);
});

console.log('Alpha74: Mis incidencias reabre el seguimiento 24H y vincula su parada.');
