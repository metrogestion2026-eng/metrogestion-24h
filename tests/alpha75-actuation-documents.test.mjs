import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL('../' + path, import.meta.url), 'utf8');

test('el resumen documental abre todos los archivos sin desplegar las T', async () => {
  const shared = await read('r1-alpha67/src/stage-documents.js');
  assert.match(shared, /export function openActuationDocuments/);
  assert.match(shared, /Todos los archivos de la actuación se muestran aquí sin necesidad de desplegar las T/);
  assert.match(shared, /documentCard\(doc, false/);

  for (const path of ['r1-alpha75/src/hotel-card.js', 'r1-alpha76/src/hotel-card.js']) {
    const card = await read(path);
    assert.match(card, /openActuationDocuments\(stages, documentsByGroup\)/);
    assert.match(card, /a53-card-doc-summary-action/);
    assert.match(card, /role: 'button'/);
    assert.match(card, /event\.key !== 'Enter' && event\.key !== ' '/);
    assert.doesNotMatch(card, /reveal-stages/);
  }

  const collapse = await read('r1-alpha75/src/stages-collapse.js');
  assert.match(collapse, /setExpanded\(false\)/);
});

test('la publicación cambia de versión y rompe las cachés del visor documental', async () => {
  assert.equal((await read('r1-alpha75/VERSION')).trim(), 'r1.0.0-alpha.75.25-hf2');
  assert.equal((await read('r1-alpha76/VERSION')).trim(), 'r1.0.0-alpha.76.10-hf2');
  assert.match(await read('r1-alpha75/index.html'), /hotel-documents\.css\?v=actuation-documents-001/);
  assert.match(await read('r1-alpha75/src/hotel-card.js'), /hotel-documents\.js\?v=actuation-documents-001/);
  assert.match(await read('r1-alpha75/src/hotel-native.js'), /hotel-card\.js\?v=75\.25-doc-resumen-001/);
  assert.match(await read('r1-alpha75/src/boot75.js'), /hotel-native\.js\?v=75\.25-doc-resumen-001/);
});
