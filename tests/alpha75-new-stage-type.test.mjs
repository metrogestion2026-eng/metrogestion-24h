import test from 'node:test';
import assert from 'node:assert/strict';
import { newStageTypeIssues } from '../r1-alpha75/src/hotel-editor-validation.js';

function newStage(type = '') {
  return {
    id: null,
    client_key: 'new-stage-test',
    posicion: 2,
    nombre: 'Entrada prevista',
    tipo_etapa: type,
    cancelado: false,
    trabajos: [],
    _pendingDocuments: [{ file: { name: 'documento-local.pdf', size: 1 } }]
  };
}

test('una T nueva activa exige elegir o escribir su tipo antes de guardar', () => {
  for (const type of ['', '  ', null, undefined]) {
    const stage = newStage(type);
    const issues = newStageTypeIssues({ etapas: [stage] });
    assert.equal(issues.length, 1);
    assert.equal(issues[0].key, 'stage:new-stage-test:tipo_etapa');
    assert.match(issues[0].message, /2T · Entrada prevista: elige un tipo de T o escribe uno nuevo/);
  }
});

test('permite un tipo del catálogo y un tipo nuevo escrito libremente', () => {
  for (const type of ['entrada_taller', 'otro', 'Trámite de documentación', '  Tipo nuevo  ']) {
    assert.deepEqual(newStageTypeIssues({ etapas: [newStage(type)] }), []);
  }
});

test('no añade requisitos a T existentes ni a nuevas T anuladas', () => {
  const existing = { ...newStage(), id: 'existing-stage' };
  const cancelled = { ...newStage(), cancelado: true };
  assert.deepEqual(newStageTypeIssues({ etapas: [existing, cancelled] }), []);
  assert.deepEqual(newStageTypeIssues({ etapas: [] }), []);
});

test('validar conserva el borrador y los documentos preparados', () => {
  const detail = { etapas: [newStage()] };
  const before = structuredClone(detail);
  newStageTypeIssues(detail);
  assert.deepEqual(detail, before);
});
