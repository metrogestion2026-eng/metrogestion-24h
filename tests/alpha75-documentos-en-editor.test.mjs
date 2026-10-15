import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const editor = await readFile('r1-alpha75/src/hotel-editor.js', 'utf8');
const stages = await readFile('r1-alpha75/src/hotel-editor-stages.js', 'utf8');
const pending = await readFile('r1-alpha75/src/editor-pending-documents.js', 'utf8');
const native = await readFile('r1-alpha75/src/hotel-native.js', 'utf8');
const html = await readFile('r1-alpha75/index.html', 'utf8');

test('Edición completa carga los documentos de las T', () => {
  assert.match(editor, /loadDocumentsForGroups/);
  assert.match(editor, /documentsByGroup/);
  assert.match(editor, /canEditDocuments: true/);
});

test('cada T existente muestra el cargador documental dentro del editor', () => {
  assert.match(stages, /stage\.id\s*\?\s*createStageDocuments/);
  assert.match(stages, /Añade PDF o fotografías directamente desde esta pantalla de edición/);
  assert.match(stages, /canEdit: canEditDocuments/);
});

test('una T nueva permite preparar documentos antes de guardarla', () => {
  assert.match(stages, /createPendingStageDocuments\(stage, \{ markDirty \}\)/);
  assert.match(pending, /se vincularán automáticamente a la T en cuanto pulses/);
  assert.match(pending, /_pendingDocuments/);
  assert.match(pending, /Máximo 25 MB por archivo/);
});

test('el guardado crea primero la T y después vincula sus documentos', () => {
  assert.match(editor, /collectPendingStageDocuments\(detail\.etapas\)/);
  assert.match(editor, /uploadPendingStageDocuments/);
  assert.match(editor, /Ficha y T guardadas\. Vinculando ahora los documentos preparados/);
  assert.match(pending, /registrar_documento_t/);
  assert.match(pending, /No se ha podido identificar de forma inequívoca/);
});

test('un fallo documental reintenta solo archivos y no vuelve a crear la T', () => {
  assert.match(editor, /pendingDocumentRetry/);
  assert.match(editor, /Reintentando únicamente los documentos pendientes; la ficha y la T no se vuelven a crear/);
  assert.match(editor, /Reintentar documentos/);
  assert.match(pending, /entry\.documents\.shift\(\)/);
});

test('hf15 fuerza toda la cadena documental del editor', () => {
  assert.match(html, /hotel-native\.js\?v=75\.23-hf17/);
  assert.match(native, /hotel-editor\.js\?v=75\.23-hf15/);
  assert.match(editor, /hotel-editor-stages\.js\?v=75\.23-hf15/);
  assert.match(editor, /editor-pending-documents\.js\?v=75\.23-hf15/);
  assert.match(stages, /editor-pending-documents\.js\?v=75\.23-hf15/);
});
