import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDetail, fichaPayload, stagesPayload } from '../r1-alpha17/src/modules/hotel-editor-utils.js';
import { createEditorTimestampRestorer } from '../r1-alpha75/src/hotel-editor-timestamps.js';

function sample() {
  return {
    ficha: { id: 'PA-SYNTHETIC', prioridad: 0,
      fecha_entrada: '2026-10-28T10:00:37.123456+00:00',
      fecha_limite_sustitucion: '2026-10-30T08:59:12.987654+00:00' },
    etapas: [{ id: 'T-SYNTHETIC-A', posicion: 1,
      fecha_prevista: '2026-10-25T00:30:37.123456+00:00',
      fecha_inicio_real: '2026-10-25T00:30:37.123456+00:00',
      fecha_fin_real: '2026-10-25T01:30:37.654321+00:00',
      fecha_real: '2026-10-25T02:45:12.000009+00:00', trabajos: [] },
    { id: 'T-SYNTHETIC-B', posicion: 2,
      fecha_inicio_real: '2026-10-25T01:30:37.123456+00:00', trabajos: [] }],
  };
}

function editor(raw = sample()) {
  const detail = normalizeDetail(raw);
  const restore = createEditorTimestampRestorer(raw, detail);
  const save = () => restore(detail, fichaPayload(detail.ficha), stagesPayload(detail.etapas));
  return { raw, detail, restore, save };
}

test('guardar una nota conserva los seis campos con segundos, microsegundos y zona exactos', () => {
  const { raw, detail, save } = editor();
  detail.ficha.observaciones = 'Nota nueva';
  const result = save();
  for (const key of ['fecha_entrada', 'fecha_limite_sustitucion']) assert.equal(result.ficha[key], raw.ficha[key]);
  for (const key of ['fecha_prevista', 'fecha_inicio_real', 'fecha_fin_real', 'fecha_real']) {
    assert.equal(result.etapas[0][key], raw.etapas[0][key]);
  }
  assert.equal(result.ficha.observaciones, 'Nota nueva');
  assert.equal(detail.ficha.fecha_entrada, '2026-10-28T11:00');
});

test('las dos 02:30 de Madrid conservan sus instantes diferentes', () => {
  const { raw, detail, save } = editor();
  assert.equal(detail.etapas[0].fecha_inicio_real, '2026-10-25T02:30');
  assert.equal(detail.etapas[1].fecha_inicio_real, '2026-10-25T02:30');
  const result = save();
  assert.equal(result.etapas[0].fecha_inicio_real, raw.etapas[0].fecha_inicio_real);
  assert.equal(result.etapas[1].fecha_inicio_real, raw.etapas[1].fecha_inicio_real);
  assert.notEqual(result.etapas[0].fecha_inicio_real, result.etapas[1].fecha_inicio_real);
});

test('cambiar una fecha envía el nuevo valor local y no restaura el anterior', () => {
  const { detail, save } = editor();
  detail.ficha.fecha_entrada = '2026-10-28T12:34';
  detail.etapas[0].fecha_inicio_real = '2026-10-25T04:56';
  const result = save();
  assert.equal(result.ficha.fecha_entrada, '2026-10-28T12:34');
  assert.equal(result.etapas[0].fecha_inicio_real, '2026-10-25T04:56');
});

test('borrar explícitamente una fecha no se deshace al serializar', () => {
  const { detail, save } = editor();
  detail.ficha.fecha_limite_sustitucion = '';
  detail.etapas[0].fecha_prevista = '';
  const result = save();
  assert.equal(result.ficha.fecha_limite_sustitucion, '');
  assert.equal(result.etapas[0].fecha_prevista, '');
});

test('volver al valor visible inicial conserva el instante original', () => {
  const { raw, detail, save } = editor();
  const initial = detail.etapas[0].fecha_inicio_real;
  detail.etapas[0].fecha_inicio_real = '2026-10-25T04:56';
  detail.etapas[0].fecha_inicio_real = initial;
  assert.equal(save().etapas[0].fecha_inicio_real, raw.etapas[0].fecha_inicio_real);
});

test('reordenar T empareja por identidad, nunca por posición', () => {
  const { raw, detail, save } = editor();
  detail.etapas.reverse();
  detail.etapas[0].posicion = 1;
  detail.etapas[1].posicion = 2;
  const result = save();
  assert.equal(result.etapas[0].id, raw.etapas[1].id);
  assert.equal(result.etapas[0].fecha_inicio_real, raw.etapas[1].fecha_inicio_real);
  assert.equal(result.etapas[1].fecha_inicio_real, raw.etapas[0].fecha_inicio_real);
});

test('una T nueva no hereda el instante de otra T con la misma hora visible', () => {
  const { detail, save } = editor();
  detail.etapas.unshift({ id: null, client_key: 'new-stage', posicion: 3,
    fecha_inicio_real: '2026-10-25T02:30', trabajos: [] });
  assert.equal(save().etapas[0].fecha_inicio_real, '2026-10-25T02:30');
});

test('una T retirada del borrador no vuelve a añadirse', () => {
  const { detail, save } = editor();
  detail.etapas.splice(0, 1);
  const result = save();
  assert.equal(result.etapas.length, 1);
  assert.equal(result.etapas[0].id, 'T-SYNTHETIC-B');
});

test('otro registro o T con identidad ambigua no recupera valores de la captura', () => {
  const first = editor();
  first.detail.ficha.id = 'OTHER-PA';
  assert.equal(first.save().ficha.fecha_entrada, '2026-10-28T11:00');
  assert.equal(first.save().etapas[0].fecha_inicio_real, '2026-10-25T02:30');
  const second = editor();
  second.detail.etapas.push(structuredClone(second.detail.etapas[0]));
  assert.equal(second.save().etapas[0].fecha_inicio_real, '2026-10-25T02:30');
});

test('la captura no cambia cuando se modifica el objeto raw posteriormente', () => {
  const { raw, save } = editor();
  raw.ficha.fecha_entrada = 'different';
  raw.etapas[0].fecha_inicio_real = 'different';
  assert.equal(save().ficha.fecha_entrada, '2026-10-28T10:00:37.123456+00:00');
  assert.equal(save().etapas[0].fecha_inicio_real, '2026-10-25T00:30:37.123456+00:00');
});

test('la serialización conserva los objetos del borrador y del payload recibidos', () => {
  const { detail, restore } = editor();
  const ficha = fichaPayload(detail.ficha), etapas = stagesPayload(detail.etapas);
  const before = structuredClone({ detail, ficha, etapas });
  const result = restore(detail, ficha, etapas);
  assert.deepEqual({ detail, ficha, etapas }, before);
  assert.notEqual(result.ficha, ficha);
  assert.notEqual(result.etapas[0], etapas[0]);
});

test('campos ausentes, nulos o excluidos del payload no se inventan', () => {
  const { detail, restore } = editor({ ficha: { id: 'PA-SYNTHETIC', prioridad: 0, fecha_entrada: null }, etapas: [] });
  const result = restore(detail, {}, []);
  assert.deepEqual(result, { ficha: {}, etapas: [] });
  const full = editor();
  const omitted = full.restore(full.detail, {}, [{ id: 'T-SYNTHETIC-A' }]);
  assert.deepEqual(omitted, { ficha: {}, etapas: [{ id: 'T-SYNTHETIC-A' }] });
});
