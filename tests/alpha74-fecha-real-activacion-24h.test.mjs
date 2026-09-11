import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const activation = readFileSync(new URL('../r1-alpha34/src/app.js', import.meta.url), 'utf8');
const followup = readFileSync(new URL('../r1-alpha74/src/assistance-followup.js', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../supabase/migrations/20260911081500_alpha74_fecha_real_activacion_24h.sql', import.meta.url), 'utf8');

test('Activar 24H pide fecha y hora reales y propone hoy en Madrid', () => {
  assert.match(activation, /Fecha de activación','date'/);
  assert.match(activation, /fecha_activacion:state\.fecha_activacion\|\|madridToday\(\)/);
  assert.match(activation, /Indica la fecha real de activación/);
});

test('Mis incidencias permite corregir fecha y hora de activación', () => {
  assert.match(followup, /Fecha real de activación/);
  assert.match(followup, /Hora real de activación/);
  assert.match(followup, /fecha_activacion: activationDate\.value/);
  assert.match(followup, /hora_activacion: activationTime\.value/);
});

test('la fecha real gobierna la cronología y la ficha sin crear históricos antiguos', () => {
  assert.match(migration, /add column if not exists fecha_activacion date/);
  assert.match(migration, /p_activacion\.fecha_activacion/);
  assert.match(migration, /set fecha_parada = new\.fecha_activacion/);
  assert.match(migration, /disable trigger user[\s\S]*enable trigger user/);
  assert.match(migration, /guardar_activacion_24h_con_fecha_alpha74/);
});
