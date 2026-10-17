import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile('r1-alpha75/google-apps-script/sincronizar_manteniment.gs', 'utf8');

test('escritura segura queda identificada por versión y flag local', () => {
  assert.match(source, /scriptVersion: 'alpha75-2026\.10\.17\.1'/);
  assert.match(source, /escrituraSeguraManual: true/);
});

test('fila PARADA existente solo completa huecos y bloquea conflictos', () => {
  assert.match(source, /function metrogestionPlanRellenoSeguro_/);
  assert.match(source, /Conflicto manual en/);
  assert.match(source, /function metrogestionCompletarCeldaSegura_/);
  assert.match(source, /Solo se rellenan huecos/);
});

test('fila manual equivalente se reutiliza antes de insertar trabajo nuevo', () => {
  assert.match(source, /const expectedKey = metrogestionClaveTrabajoPayload_\(work\)/);
  assert.match(source, /if \(exactRows\.length === 1\)/);
  assert.match(source, /if \(!rowNumber\) rowNumber = metrogestionInsertarFilaParada_/);
  assert.match(source, /No se ha duplicado/);
});

test('operaciones destructivas permanecen bloqueadas', () => {
  assert.match(source, /actualización automática de ALTA está bloqueada/);
  assert.match(source, /ajuste AV24H puede reorganizar filas y queda bloqueado/);
  assert.match(source, /La reapertura requiere borrar datos existentes y queda bloqueada/);
});

test('vinculación de T no pisa otra actuación', () => {
  assert.match(source, /if \(!String\(currentValue \|\| ''\)\.trim\(\)\)/);
  assert.match(source, /contiene otra actuación en E\. No se ha modificado/);
});

test('notas humanas se preservan al añadir marcadores técnicos', () => {
  assert.match(source, /function metrogestionNotaConParada_/);
  assert.match(source, /metrogestionNotaConParada_\(paradaCell\.getNote\(\), syncId\)/);
});
