import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const editor = await readFile('r1-alpha75/src/hotel-editor.js', 'utf8');
const stages = await readFile('r1-alpha75/src/hotel-editor-stages.js', 'utf8');
const html = await readFile('r1-alpha75/index.html', 'utf8');

test('Edición completa carga los documentos de las T', () => {
  assert.match(editor, /loadDocumentsForGroups/);
  assert.match(editor, /documentsByGroup/);
  assert.match(editor, /canEditDocuments: true/);
});

test('cada T existente muestra el cargador documental dentro del editor', () => {
  assert.match(stages, /createStageDocuments/);
  assert.match(stages, /Añade PDF o fotografías directamente desde esta pantalla de edición/);
  assert.match(stages, /canEdit: canEditDocuments && Boolean\(stage\.id\)/);
});

test('hf12 fuerza la carga del editor actualizado', () => {
  assert.match(html, /hotel-native\.js\?v=75\.23-hf12/);
});
