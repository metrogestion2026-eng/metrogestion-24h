import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { saveErrorIssues, stageStateMismatchIssues } from '../r1-alpha72/src/hotel-editor-validation.js';

const root = process.cwd();
const index = await readFile(path.join(root, 'r1-alpha72/index.html'), 'utf8');
const editor = await readFile(path.join(root, 'r1-alpha72/src/hotel-editor.js'), 'utf8');
const stages = await readFile(path.join(root, 'r1-alpha72/src/hotel-editor-stages.js'), 'utf8');
const css = await readFile(path.join(root, 'r1-alpha72/editor-validation.css'), 'utf8');

const detail = {
  catalogos: {
    estados_etapa: [
      { codigo: 'recogida_realizada', nombre: 'Recogida realizada', estado_operativo: 'realizada' }
    ]
  },
  etapas: [{
    id: 't-1', client_key: 't-1', posicion: 3, nombre: 'Recogida taller',
    estado: 'pendiente', estado_catalogo_codigo: 'recogida_realizada', cancelado: false
  }]
};

const issues = stageStateMismatchIssues(detail);
assert.equal(issues.length, 1);
assert.equal(issues[0].key, 'stage:t-1:estado');
assert.match(issues[0].message, /3T · Recogida taller/);
assert.match(issues[0].message, /vuelve a seleccionar «Recogida realizada»/);

detail.etapas[0].estado = 'realizada';
assert.equal(stageStateMismatchIssues(detail).length, 0);
detail.etapas[0].estado = 'pendiente';
assert.equal(saveErrorIssues(detail, new Error('El estado personalizado de la T no corresponde con su estado operativo')).length, 1);
assert.equal(saveErrorIssues(detail, new Error('Otro error')).length, 0);

assert.match(index, /editor-validation\.css/);
assert.match(editor, /showValidationIssues/);
assert.match(editor, /Te he llevado a la casilla marcada en rojo/);
assert.match(stages, /dataset\.validationKey = `stage:/);
assert.match(css, /editor-field-needs-attention/);
assert.match(css, /has-validation-error/);

console.log('Alpha72: localización y resaltado de campos incompatibles verificados.');
