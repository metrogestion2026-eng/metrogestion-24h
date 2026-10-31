import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyHotelEditorSave } from '../r1-alpha75/src/hotel-editor-save-result.js';

const expected = {
  requestId: 'editor_synthetic_request', version: 4,
  identity: { registro_id: 'SYN-PA', seguimiento_id: 'SYN-TRACKING', pizarra_id: 'SYN-BOARD' },
};
function receipt(version = 4) {
  return { error: null, data: { ok: true, request_id: expected.requestId, identidad_validada: true,
    version, detalle: { ficha: { id: 'SYN-PA', seguimiento_id: 'SYN-TRACKING', pizarra_id: 'SYN-BOARD', version }, etapas: [] } } };
}

test('recibo real identificado confirma también una anotación que no incrementa la versión de PA', () => {
  for (const version of [4, 5, 9]) {
    const result = receipt(version);
    assert.deepEqual(classifyHotelEditorSave(result, expected), { state: 'confirmed', saved: result.data });
  }
});

test('el error de red resuelto del SDK es incierto, incluso si trae un código aparentemente válido', () => {
  for (const code of ['', '23514', 'PGRST000']) {
    const result = { success: false, error: { message: 'TypeError: Failed to fetch', code }, data: null, status: 0 };
    assert.deepEqual(classifyHotelEditorSave(result, expected), { state: 'uncertain' });
  }
});

test('errores sin código de rechazo identificable no permiten asumir rollback', () => {
  for (const code of [undefined, '', 'HTTP_502', 'FETCH_ERROR', '08006', '08007', '40003', '00000']) {
    assert.equal(classifyHotelEditorSave({ data: null, error: { message: 'Fallo sintético', code } }, expected).state, 'uncertain');
  }
});

test('un rechazo SQL o PostgREST reconocido conserva su error para corregir el borrador', () => {
  for (const code of ['23514', 'P0001', '42501', 'PGRST202']) {
    const error = { code, message: 'Rechazo sintético confirmado' };
    assert.deepEqual(classifyHotelEditorSave({ data: null, error }, expected), { state: 'rejected', error });
  }
});

test('respuestas vacías, contradictorias u ok falso sin error reconocido son inciertas', () => {
  for (const result of [null, undefined, {}, { data: null, error: null }, { data: { ok: false }, error: null },
    { ...receipt(), error: { code: '23514', message: 'Contradice el éxito' } }]) {
    assert.equal(classifyHotelEditorSave(result, expected).state, 'uncertain');
  }
});

test('otro request, ficha, seguimiento o pizarra nunca confirma este guardado', () => {
  for (const change of [
    result => { result.data.request_id = 'other'; },
    result => { result.data.detalle.ficha.id = 'OTHER-PA'; },
    result => { result.data.detalle.ficha.seguimiento_id = 'OTHER-TRACKING'; },
    result => { result.data.detalle.ficha.pizarra_id = 'OTHER-BOARD'; },
  ]) {
    const result = receipt(); change(result);
    assert.equal(classifyHotelEditorSave(result, expected).state, 'uncertain');
  }
});

test('un recibo incompleto o con versión incoherente conserva la incertidumbre', () => {
  for (const change of [
    result => { delete result.data.identidad_validada; },
    result => { result.data.version = 3; result.data.detalle.ficha.version = 3; },
    result => { result.data.version = '4'; },
    result => { result.data.detalle.ficha.version = 5; },
    result => { delete result.data.detalle; },
    result => { delete result.data.detalle.etapas; },
  ]) {
    const result = receipt(); change(result);
    assert.equal(classifyHotelEditorSave(result, expected).state, 'uncertain');
  }
});

test('clasificar no modifica el recibo ni la identidad enviada', () => {
  const result = receipt(), before = structuredClone(result), identity = structuredClone(expected);
  classifyHotelEditorSave(result, expected);
  assert.deepEqual(result, before);
  assert.deepEqual(expected, identity);
});
