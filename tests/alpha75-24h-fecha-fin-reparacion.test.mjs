import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const followups = await Promise.all(['74', '75', '76'].map(version => readFile(
  new URL(`../r1-alpha${version}/src/assistance-followup.js`, import.meta.url),
  'utf8',
)));
const migration = await readFile(
  new URL('../supabase/migrations/20260912122000_fecha_fin_reparacion_24h.sql', import.meta.url),
  'utf8',
);

test('el seguimiento 24H pide fecha y hora reales de finalización', () => {
  for (const followup of followups) {
    assert.match(followup, /field\('Fecha de fin de reparación'.*'date'\)/);
    assert.match(followup, /Indica la fecha de fin de reparación/);
    assert.match(followup, /fecha_fin_reparacion: result\.value === 'operativo_reparado' \? finishDate\.value : ''/);
    assert.match(followup, /fecha_fin_reparacion,hora_fin_reparacion/);
  }
});

test('Supabase conserva la fecha final y protege el cierre completo', () => {
  assert.match(migration, /add column if not exists fecha_fin_reparacion date/);
  assert.match(migration, /Debes indicar la fecha de fin de reparación/);
  assert.match(migration, /fecha_fin_reparacion=v_fecha_fin_reparacion/);
  assert.match(migration, /new\.fecha_fin_reparacion \+ new\.hora_fin_reparacion/);
  assert.match(migration, /fecha_fin_reparacion >= fecha_activacion/);
});

test('cerrar 24H conserva Pendiente de recuperar cuando aún queda recuperar ruta', () => {
  assert.match(migration, /e\.accion_sistema = 'recuperar_y_liberar'/);
  assert.match(migration, /set estado = 'recogido_pendiente_ruta'/);
  assert.match(migration, /guardar_activacion_24h_cierre_fecha_alpha75/);
});
