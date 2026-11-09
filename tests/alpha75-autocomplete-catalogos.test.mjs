import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL('../' + path, import.meta.url), 'utf8');

test('el catálogo real de Alpha75 autocompleta mientras se escribe y no usa flecha', async () => {
  const src = await read('r1-alpha75/src/editable-catalogue.js');
  assert.match(src, /filteredItems/);
  assert.match(src, /catalogueSearchText\(item\)\.includes\(query\)/);
  assert.match(src, /input\.addEventListener\('input', update\)/);
  assert.match(src, /role: 'listbox'/);
  assert.match(src, /es un valor nuevo\. Se incorporará al listado cuando guardes la ficha/);
  assert.doesNotMatch(src, /a71-catalogue-trigger/);
  assert.doesNotMatch(src, /text: '▾'/);
  assert.match(src, /input\.addEventListener\('focus'/);
});

test('Tipo Taller y Centro usan el componente común activo', async () => {
  const stages = await read('r1-alpha75/src/hotel-editor-stages.js');
  assert.match(stages, /createEditableCatalogueField\('Tipo'/);
  assert.match(stages, /createEditableCatalogueField\('Taller'/);
  assert.match(stages, /createEditableCatalogueField\('Centro'/);
  assert.match(stages, /editable-catalogue\.js\?v=75\.26-autocomplete-001/);
});

test('la caché del editor activo se renueva hasta la entrada de Alpha75', async () => {
  assert.match(await read('r1-alpha75/src/hotel-editor.js'), /hotel-editor-stages\.js\?v=75\.26-autocomplete-001/);
  assert.match(await read('r1-alpha75/src/hotel-native.js'), /hotel-editor\.js\?v=75\.26-autocomplete-001/);
  const boot = await read('r1-alpha75/src/boot75.js');
  assert.match(boot, /hotel-editor-stages\.js\?v=75\.26-autocomplete-001/);
  assert.match(boot, /hotel-native\.js\?v=75\.26-autocomplete-001/);
  const html = await read('r1-alpha75/index.html');
  assert.match(html, /editable-catalogue\.css\?v=75\.26-autocomplete-001/);
  assert.match(html, /boot75\.js\?v=75\.26-autocomplete-001/);
});
