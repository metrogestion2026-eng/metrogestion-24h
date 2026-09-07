import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const app = readFileSync(new URL('../r1-alpha34/src/app.js', import.meta.url), 'utf8');
const migration = readFileSync(
  new URL('../supabase/migrations/20260907082720_activar24h_hora_fin_reparacion.sql', import.meta.url),
  'utf8',
);

test('la página 7 permite cerrar como vehículo operativo/reparado y pide la hora final', () => {
  assert.match(app, /Vehículo operativo\/reparado/);
  assert.match(app, /Hora de fin de reparación/);
  assert.match(app, /state\.resultado==='operativo_reparado'&&!state\.hora_fin_reparacion/);
  assert.match(app, /Guardar vehículo operativo\/reparado/);
  assert.match(app, /hora_fin_reparacion:state\.hora_fin_reparacion/);
  assert.match(app, /estado:state\.resultado==='operativo_reparado'\?'cerrada':'abierta'/);
  assert.match(app, /const openIncidences=/);
  assert.match(app, /if\(current===6\)\{await saveActivation\(\);openIncidences\(\);return;\}/);
});

test('la base de datos impide un cierre reparado sin hora ni confirmación operativa', () => {
  assert.match(migration, /add column if not exists hora_fin_reparacion time without time zone/);
  assert.match(migration, /resultado <> 'operativo_reparado'/);
  assert.match(migration, /hora_fin_reparacion is not null/);
  assert.match(migration, /and estado_operativo_confirmado/);
  assert.match(migration, /v_resultado = 'operativo_reparado'/);
  assert.match(migration, /v_estado := 'cerrada'/);
  assert.match(migration, /revoke all on function public\.guardar_activacion_24h\(uuid, jsonb, text\) from public, anon/);
});
