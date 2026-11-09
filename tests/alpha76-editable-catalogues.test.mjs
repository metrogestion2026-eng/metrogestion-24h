import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL('../' + path, import.meta.url), 'utf8');

test('Alpha76 autocompleta catálogos al escribir y no usa flecha', async () => {
  const src = await read('r1-alpha76/src/editable-catalogue.js');
  assert.match(src, /filteredItems/);
  assert.match(src, /catalogueSearchText\(item\)\.includes\(query\)/);
  assert.match(src, /input\.addEventListener\('input', update\)/);
  assert.match(src, /input\.addEventListener\('focus'/);
  assert.match(src, /role: 'listbox'/);
  assert.match(src, /es un valor nuevo\. Se incorporará al listado cuando guardes la ficha/);
  assert.doesNotMatch(src, /a71-catalogue-trigger/);
  assert.doesNotMatch(src, /text: '▾'/);
});

test('Tipo Taller y Centro usan el componente común de Alpha76', async () => {
  const stages = await read('r1-alpha76/src/hotel-editor-stages.js');
  assert.match(stages, /createEditableCatalogueField\('Tipo'/);
  assert.match(stages, /createEditableCatalogueField\('Taller'/);
  assert.match(stages, /createEditableCatalogueField\('Centro'/);
  assert.match(stages, /editable-catalogue\.js\?v=76\.10-autocomplete-001/);
});

test('la entrada real Alpha76 rompe la caché hasta el componente corregido', async () => {
  const root = await read('index.html');
  const html = await read('r1-alpha76/index.html');
  const boot = await read('r1-alpha76/src/boot76.js');
  const editor = await read('r1-alpha76/src/hotel-editor.js');
  const hotel = await read('r1-alpha76/src/hotel-native.js');
  const historyCard = await read('r1-alpha76/src/history-card.js');
  const history = await read('r1-alpha76/src/history-native.js');
  assert.match(root, /href="r1-alpha76\//);
  assert.match(html, /editable-catalogue\.css\?v=76\.10-autocomplete-001/);
  assert.match(html, /boot76\.js\?v=76\.10-autocomplete-001/);
  assert.match(boot, /app\.js\?v=76\.10-hf4/);
  assert.match(boot, /hotel-native\.js\?v=76\.10-autocomplete-001/);
  assert.match(boot, /history-native\.js\?v=76\.10-autocomplete-001/);
  assert.match(hotel, /hotel-editor\.js\?v=76\.10-autocomplete-001/);
  assert.match(historyCard, /hotel-editor\.js\?v=76\.10-autocomplete-001/);
  assert.match(history, /history-card\.js\?v=76\.10-autocomplete-001/);
  assert.match(editor, /hotel-editor-stages\.js\?v=76\.10-autocomplete-001/);
  assert.equal((await read('r1-alpha76/VERSION')).trim(), 'r1.0.0-alpha.76.10-hf4');
  assert.match(await read('r1-alpha76/src/app.js'), /r1\.0\.0-alpha\.76\.10-hf4/);
});
