import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const activation = readFileSync(new URL('../r1-alpha34/src/app.js', import.meta.url), 'utf8');
const followup = readFileSync(new URL('../r1-alpha74/src/assistance-followup.js', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../supabase/migrations/20260911093000_alpha74_sustituto_estado_24h.sql', import.meta.url), 'utf8');
const hotfix = readFileSync(new URL('../supabase/migrations/20260911100000_alpha74_24h_sustituto_sin_temporal.sql', import.meta.url), 'utf8');

test('el paso 7 pide situación y sustituto cuando corresponde', () => {
  assert.match(activation, /Situación actual/);
  assert.match(activation, /Pendiente de repuestos/);
  assert.match(activation, /DFM del vehículo sustituto/);
  assert.match(activation, /Matrícula del vehículo sustituto/);
  assert.match(activation, /resultado==='necesita_sustitucion'/);
});

test('Mis incidencias permite completar la misma información', () => {
  assert.match(followup, /estado_seguimiento: currentState\.value/);
  assert.match(followup, /vehiculo_sustituto: substituteDfm\.value/);
  assert.match(followup, /matricula_sustituto: substitutePlate\.value/);
});

test('el DFM exacto autocompleta la matrícula del sustituto en ambos formularios', () => {
  assert.match(activation, /sd\.oninput=autofillSubstitute/);
  assert.match(activation, /state\.matricula_sustituto=String\(found\.matricula/);
  assert.match(followup, /substituteDfm\.addEventListener\('input', autofillSubstitute\)/);
  assert.match(followup, /substitutePlate\.value = String\(vehicle\.matricula/);
  assert.match(followup, /from\('vehiculos'\)\.select\('id,dfm,matricula,marca'\)/);
});

test('la ficha recibe el estado y el vehículo sustituto', () => {
  assert.match(migration, /estado = v_estado_hotel/);
  assert.match(migration, /vehiculo_reserva = case when v_resultado = 'necesita_sustitucion'/);
  assert.match(migration, /matricula_reserva = case when v_resultado = 'necesita_sustitucion'/);
  assert.match(migration, /when 'pendiente_repuestos' then 'pendiente_repuestos'/);
  assert.match(migration, /manteniment_encolar_parada/);
});

test('la sustitución normal del 24H no activa la opción temporal con fecha límite', () => {
  assert.match(hotfix, /vehiculo_reserva = case when v_resultado = 'necesita_sustitucion'/);
  assert.doesNotMatch(hotfix, /sustitucion_temporal\s*=/);
  assert.doesNotMatch(hotfix, /motivo_sustitucion_temporal\s*=/);
});
