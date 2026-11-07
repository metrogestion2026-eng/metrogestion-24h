import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  activeStageCount,
  moveActiveStageToPosition,
  renumberActiveStages,
} from '../r1-alpha75/src/stage-order.js';

const stage = (name, posicion, extra = {}) => ({ name, posicion, cancelado: false, ...extra });

test('insertar una T en la posición 2 desplaza la antigua 2 a la 3', () => {
  const first = stage('Primera', 1);
  const recovery = stage('Recuperar ruta', 2);
  const extinguisher = stage('EXTINTOR', 2);
  const stages = [first, recovery, extinguisher];

  const result = moveActiveStageToPosition(stages, extinguisher, 2);

  assert.deepEqual(stages.map(item => item.name), ['Primera', 'EXTINTOR', 'Recuperar ruta']);
  assert.deepEqual(stages.map(item => item.posicion), [1, 2, 3]);
  assert.deepEqual(result, { from: 3, to: 2, count: 3 });
});

test('mover una T hacia abajo compacta y renumera todas las activas', () => {
  const first = stage('Primera', 1);
  const second = stage('Segunda', 2);
  const third = stage('Tercera', 3);
  const stages = [first, second, third];

  moveActiveStageToPosition(stages, first, 3);

  assert.deepEqual(stages.map(item => item.name), ['Segunda', 'Tercera', 'Primera']);
  assert.deepEqual(stages.map(item => item.posicion), [1, 2, 3]);
});

test('las T anuladas conservan su hueco histórico y no participan en el orden activo', () => {
  const first = stage('Primera', 1);
  const cancelled = stage('Anulada histórica', 2, { cancelado: true });
  const second = stage('Segunda', 2);
  const third = stage('Tercera', 3);
  const stages = [first, cancelled, second, third];

  moveActiveStageToPosition(stages, third, 1);

  assert.equal(stages[1], cancelled);
  assert.equal(cancelled.posicion, 2);
  assert.deepEqual(stages.filter(item => !item.cancelado).map(item => item.name), ['Tercera', 'Primera', 'Segunda']);
  assert.deepEqual(stages.filter(item => !item.cancelado).map(item => item.posicion), [1, 2, 3]);
  assert.equal(activeStageCount(stages), 3);
});

test('las posiciones fuera de rango se ajustan al principio o al final', () => {
  const first = stage('Primera', 1);
  const second = stage('Segunda', 2);
  const third = stage('Tercera', 3);
  const stages = [first, second, third];

  moveActiveStageToPosition(stages, third, 0);
  assert.deepEqual(stages.map(item => item.name), ['Tercera', 'Primera', 'Segunda']);

  moveActiveStageToPosition(stages, third, 99);
  assert.deepEqual(stages.map(item => item.name), ['Primera', 'Segunda', 'Tercera']);
  assert.deepEqual(stages.map(item => item.posicion), [1, 2, 3]);
});

test('renumerar activas no altera las anuladas', () => {
  const cancelled = stage('Anulada', 8, { cancelado: true });
  const stages = [stage('A', 7), cancelled, stage('B', 12)];

  renumberActiveStages(stages);

  assert.deepEqual(stages.map(item => item.posicion), [1, 8, 2]);
});

test('el editor aplica la posición como inserción y no como valor duplicable', async () => {
  const source = await readFile(new URL('../r1-alpha75/src/hotel-editor-stages.js', import.meta.url), 'utf8');
  assert.match(source, /moveActiveStageToPosition\(detail\.etapas, stage, position\.value\)/);
  assert.match(source, /position\.addEventListener\('change'/);
  assert.match(source, /las siguientes se desplazan automáticamente/);
  assert.doesNotMatch(source, /bindText\(position, stage, 'posicion'/);
});
