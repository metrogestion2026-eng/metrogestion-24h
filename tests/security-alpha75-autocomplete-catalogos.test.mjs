import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL('../' + path, import.meta.url), 'utf8');

test('el catálogo real de Alpha75 conserva desplegable y filtra mientras se escribe', async () => {
  const src = await read('r1-alpha75/src/editable-catalogue.js');
  assert.match(src, /matchingItems/);
  assert.match(src, /if \(!query\) return ordered;/);
  assert.doesNotMatch(src, /const query = normaliseCatalogueValue\(input\.value\)/);
  assert.match(src, /catalogueSearchText\(item\)\.includes\(query\)/);
  assert.match(src, /input\.addEventListener\('input', update\)/);
  assert.match(src, /input\.addEventListener\('focus'/);
  assert.match(src, /input\.addEventListener\('click'/);
  assert.match(src, /className: 'a71-catalogue-trigger'/);
  assert.match(src, /text: '▾'/);
  assert.match(src, /trigger\.addEventListener\('click'/);
  assert.match(src, /role: 'listbox'/);
  assert.match(src, /es un valor nuevo\. Se incorporará al listado cuando guardes la ficha/);
});

test('Tipo Taller y Centro usan el componente común activo', async () => {
  const stages = await read('r1-alpha75/src/hotel-editor-stages.js');
  assert.match(stages, /createEditableCatalogueField\('Tipo'/);
  assert.match(stages, /createEditableCatalogueField\('Taller'/);
  assert.match(stages, /createEditableCatalogueField\('Centro'/);
  assert.match(stages, /editable-catalogue\.js\?v=75\.26-taller-hitos-001/);
});

test('la caché del catálogo se renueva desde Hotel, Histórico, Panel y Nueva ficha', async () => {
  const revision = '75.26-taller-hitos-001';
  const dependencies = {
    'boot75.js': ['hotel-editor-stages.js', 'hotel-create.js', 'hotel-native.js', 'history-native.js', 'panel-native-hf23.js'],
    'hotel-native.js': ['hotel-create.js', 'hotel-editor.js'],
    'history-native.js': ['history-card.js'],
    'history-card.js': ['hotel-editor.js'],
    'panel-native-hf23.js': ['hotel-editor.js'],
    'hotel-editor.js': ['hotel-editor-main.js', 'hotel-editor-stages.js'],
    'hotel-create.js': ['hotel-editor-main.js', 'hotel-editor-stages.js'],
    'hotel-editor-main.js': ['editable-catalogue.js'],
    'hotel-editor-stages.js': ['editable-catalogue.js'],
  };
  for (const [file, imports] of Object.entries(dependencies)) {
    const source = await read(`r1-alpha75/src/${file}`);
    for (const dependency of imports) {
      assert.ok(source.includes(`./${dependency}?v=${revision}`), `${file} debe renovar ${dependency}`);
    }
  }
  const html = await read('r1-alpha75/index.html');
  assert.match(html, /editable-catalogue\.css\?v=75\.26-movimiento-taller-001/);
  assert.ok(html.includes(`./src/boot75.js?v=${revision}`));
});
