import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL('../' + path, import.meta.url), 'utf8');

const legacyIds = [
  'importacion_hotel',
  'transformacion_hotel',
  'revision_hotel',
  'presentacion_hotel',
];

test('Alpha75 retira las cuatro pestañas de previa heredadas de Alpha26', async () => {
  const source = await read('r1-alpha75/src/navigation-alpha75.js');
  for (const id of legacyIds) assert.match(source, new RegExp("'"+id+"'"));
  assert.match(source, /button\[data-module/);
  assert.match(source, /button\.remove\(\)/);
  assert.match(source, /MutationObserver/);
  assert.match(source, /display:none!important/);
});

test('la navegación propia se instala antes de arrancar el router Alpha26', async () => {
  const boot = await read('r1-alpha75/src/boot75.js');
  const navAt = boot.indexOf("import './navigation-alpha75.js?v=75.26-nav-current-001'");
  const routerAt = boot.indexOf("refreshHotelRouter(new URL('../../r1-alpha26/src/app.js'");
  assert.ok(navAt >= 0);
  assert.ok(routerAt > navAt);
});

test('la entrada publicada rompe la caché de la navegación antigua', async () => {
  const html = await read('r1-alpha75/index.html');
  assert.match(html, /boot75\.js\?v=75\.26-taller-hitos-001/);
});

test('las pestañas vigentes no forman parte de la lista retirada', async () => {
  const source = await read('r1-alpha75/src/navigation-alpha75.js');
  for (const id of ['hotel','t_programadas','reservas','historico','talleres','resumen']) {
    assert.doesNotMatch(source, new RegExp("'"+id+"'"));
  }
});
