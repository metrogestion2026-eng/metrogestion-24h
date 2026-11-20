import test from 'node:test';
import assert from 'node:assert/strict';
import {createExecutorHarness, HEADERS, paradaRow} from './helpers/alpha75-sync-executor-harness.mjs';

function make(opts = {}) {
  return createExecutorHarness({rows: [HEADERS, paradaRow()], ...opts});
}
function syntheticRange(h, row, firstColumn, lastColumn = firstColumn) {
  return {
    getSheet: () => h.sheet, getRow: () => row, getLastRow: () => row,
    getColumn: () => firstColumn, getLastColumn: () => lastColumn,
  };
}
const act = (h, changeType) => h.call('metrogestionIdentidadFilasCambio', {
  source: h.world.book, changeType
});

test('S14 INSERT_ROW asigna T nueva desde contador y registro, no desde número físico', () => {
  const h = make();
  const result = act(h, 'INSERT_ROW');
  assert.equal(result, undefined);
  assert.equal(h.sheet.getRange(2, 20).getValue(), 6970);
  assert.equal(h.world.registroFilas.contador, 6970);
  assert.equal(h.world.registroFilas.filas.length, 1);
  assert.equal(h.world.registroFilas.filas[0][0], 6970);
  assert.equal(h.world.registroFilas.filas[0][1], 'ACTIVA');
  assert.equal(h.world.registroFilas.filas[0][4], 'INSERT_ROW');
  assert.equal(h.world.documentLockHeld, false);
});

test('S14 edición A:S completa T cuando un INSERT_ROW se perdió', () => {
  const h = make();
  h.call('metrogestionIdentidadFilasEdicion', {range: syntheticRange(h, 2, 8)});
  assert.equal(h.sheet.getRange(2, 20).getValue(), 6970);
  assert.equal(h.world.registroFilas.filas[0][4], 'EDICION_FILA_NUEVA');
});

test('S14 pulsar Verificar ID_FILA nunca asigna ni marca bajas', () => {
  const h = make();
  h.call('metrogestionVerificarIdentidadFilas');
  assert.equal(h.sheet.getRange(2, 20).getValue(), '');
  assert.equal(h.world.registroFilas.filas.length, 0);
  assert.equal(h.world.registroFilas.contador, 6969);
  assert.deepEqual(h.effects, []);
  assert.ok(h.events.some(e => e.kind === 'ui' && e.method === 'alert'));
});

test('S14 inserción no declara BORRADA una T activa momentáneamente ausente', () => {
  const h = make();
  h.world.registroFilas.filas.push([6800, 'ACTIVA', new Date('2026-11-19T09:00:00Z'), '', 'INSERT_ROW']);
  assert.throws(() => act(h, 'INSERT_ROW'), /T activas desaparecidas/);
  assert.equal(h.world.registroFilas.filas[0][1], 'ACTIVA');
  assert.equal(h.world.registroFilas.contador, 6969);
  assert.equal(h.sheet.getRange(2, 20).getValue(), '');
  assert.equal(h.world.documentLockHeld, false);
});

test('S14 OTHER nunca convierte una ausencia en baja sin acreditación', () => {
  const h = make();
  h.world.registroFilas.filas.push([6800, 'ACTIVA', new Date(), '', 'INSERT_ROW']);
  assert.throws(() => act(h, 'OTHER'), /diferencias de ID/);
  assert.equal(h.world.registroFilas.filas[0][1], 'ACTIVA');
  assert.equal(h.world.registroFilas.contador, 6969);
});

test('S14 detecta T duplicada sin renumerar ninguna de las dos', () => {
  const h = make({rows: [HEADERS, paradaRow(), paradaRow()],
    cells: {'2,20': {value: 6800}, '3,20': {value: 6800}}});
  h.world.registroFilas.filas.push([6800, 'ACTIVA', new Date(), '', 'INSERT_ROW']);
  assert.throws(() => act(h, 'INSERT_ROW'), /duplicado T=6800/);
  assert.equal(h.sheet.getRange(2, 20).getValue(), 6800);
  assert.equal(h.sheet.getRange(3, 20).getValue(), 6800);
  assert.equal(h.world.registroFilas.contador, 6969);
});

test('S14 fórmula o texto en T no es identidad canónica', () => {
  const h = make({cells: {'2,20': {value: 100, formula: '=99+1'}}});
  assert.throws(() => h.call('metrogestionAuditarIdentidadFilas_'), /contiene una fórmula/);
  assert.equal(h.world.registroFilas.filas.length, 0);
});

test('S14 edición directa T bloquea nuevos efectos automáticos hasta investigación', () => {
  const h = make();
  act(h, 'INSERT_ROW');
  const before = h.sheet.getRange(2, 20).getValue();
  assert.throws(() => h.call('metrogestionIdentidadFilasEdicion',
    {range: syntheticRange(h, 2, 20)}), /T solo lectura/);
  assert.match(h.properties.METROGESTION_ID_FILA_BLOQUEO, /intento de edición directa de T/);
  assert.throws(() => act(h, 'INSERT_ROW'), /Bloqueado hasta cotejo humano/);
  assert.equal(h.sheet.getRange(2, 20).getValue(), before);
  assert.equal(h.world.registroFilas.contador, 6970);
});

test('S14 vigilancia no escribe en hoja ni acepta huecos silenciosamente', () => {
  const h = make();
  assert.throws(() => h.call('metrogestionVigilarIdentidadSoloLectura'), /T vacías/);
  assert.equal(h.sheet.getRange(2, 20).getValue(), '');
  assert.deepEqual(h.effects, []);
  assert.match(h.properties.METROGESTION_ID_FILA_ULTIMO_ERROR, /S14/);
});
