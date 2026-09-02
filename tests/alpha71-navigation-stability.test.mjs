import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const panelSource = await readFile(new URL('../r1-alpha71/src/panel-native.js', import.meta.url), 'utf8');
const hotelSource = await readFile(new URL('../r1-alpha71/src/hotel-native.js', import.meta.url), 'utf8');

assert.match(panelSource, /function panelOwnsContent\(\)/, 'El Panel debe comprobar que conserva la vista.');
assert.match(
  panelSource,
  /if \(automatic && !panelOwnsContent\(\)\)[\s\S]*?stopAutoRefresh\(\);[\s\S]*?return;/,
  'Un refresco automático obsoleto no puede recuperar el Panel.',
);
assert.match(
  panelSource,
  /new MutationObserver\([\s\S]*?!refreshTimer \|\| panelOwnsContent\(\)[\s\S]*?stopAutoRefresh\(\)/,
  'El temporizador debe detenerse aunque otro módulo intercepte el clic.',
);
assert.match(
  hotelSource,
  /delete content\.dataset\.alpha70Panel;[\s\S]*?delete content\.dataset\.alpha52Panel;/,
  'Hotel debe cancelar la propiedad residual del Panel antes de consultar datos.',
);
assert.match(
  hotelSource,
  /const hotelViewState = \{[\s\S]*?filter: 'all',[\s\S]*?search: '',[\s\S]*?editMode: false/,
  'Hotel debe conservar el filtro, la búsqueda y el modo de edición durante una recarga.',
);
assert.match(
  hotelSource,
  /className: 'a71-hotel-summary'/,
  'El resumen de Alpha71 debe estar aislado de los filtros heredados.',
);
assert.doesNotMatch(
  hotelSource,
  /const summary = element\('div', \{ className: 'summary-grid' \}/,
  'El resumen de Alpha71 no debe ser capturado por los controladores antiguos.',
);

console.log('Alpha71: navegación, filtro y edición estable verificados.');
