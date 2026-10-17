import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile('r1-alpha75/google-apps-script/sincronizar_manteniment.gs', 'utf8');

test('la versión segura no sobrescribe una fila PARADA existente', () => {
  assert.match(source, /scriptVersion: 'alpha75-2026\.10\.17\.1'/);
  assert.match(source, /escrituraSeguraManual: true/);
  assert.match(source, /Solo se rellenan huecos/);
  assert.match(source, /metrogestionPlanRellenoSeguro_/);
  assert.match(source, /Conflicto manual en/);
  assert.match(source, /metrogestionCompletarCeldaSegura_/);
});

test('una reapertura destructiva queda bloqueada', () => {
  assert.match(source, /La reapertura requiere borrar K en MANTENIMENT/);
  assert.match(source, /La reapertura requiere borrar datos existentes y queda bloqueada/);
  assert.match(source, /La reapertura intenta borrar fechas de una fila existente/);
});

test('ALTA y AV24H destructivo quedan bloqueados en modo seguro', () => {
  assert.match(source, /actualización automática de ALTA está bloqueada/);
  assert.match(source, /ajuste AV24H puede reorganizar filas y queda bloqueado/);
});

test('trabajos nuevos reutilizan una fila equivalente antes de insertar', () => {
  assert.match(source, /const expectedKey = metrogestionClaveTrabajoPayload_\(work\)/);
  assert.match(source, /if \(exactRows\.length > 1\)/);
  assert.match(source, /if \(exactRows\.length === 1\)/);
  assert.match(source, /No se ha duplicado/);
  assert.match(source, /no se ha creado una copia/);
  assert.match(source, /if \(!rowNumber\) rowNumber = metrogestionInsertarFilaParada_/);
});

test('la nota técnica preserva notas humanas y el cache no suplanta datos manuales', () => {
  assert.match(source, /function metrogestionNotaConParada_/);
  assert.match(source, /paradaCell\.setNote\(metrogestionNotaConParada_/);
  assert.match(source, /\(nuevaFila \|\| !METROGESTION\.escrituraSeguraManual\)/);
});

test('asignar T solo completa E vacío y nunca pisa otra actuación', () => {
  assert.match(source, /if \(!String\(currentValue \|\| ''\)\.trim\(\)\)/);
  assert.match(source, /contiene otra actuación en E\. No se ha modificado/);
});
