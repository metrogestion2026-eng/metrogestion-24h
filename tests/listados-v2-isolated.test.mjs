import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');

test('Listados V2 está aislado de la cadena heredada', () => {
  const html = source('r1-alpha75/listados-v2.html');
  const js = source('r1-alpha75/src/listados-v2.js');
  assert.match(html, /listados-v2\.js\?v=lab1/);
  assert.doesNotMatch(html, /app\.js|hotel-native|r1-alpha50|r1-alpha31|r1-alpha30|r1-alpha29/);
  assert.doesNotMatch(js, /r1-alpha50|r1-alpha31|r1-alpha30|r1-alpha29|module-nav|module-content/);
});

test('Listados V2 consulta DFM por periodo en servidor y no precarga todo', () => {
  const js = source('r1-alpha75/src/listados-v2.js');
  assert.match(js, /\.from\('facturacion_dfm_periodos'\)[\s\S]*\.eq\('periodo', dom\.period\.value\)/);
  assert.doesNotMatch(js, /Promise\.all\([\s\S]*(facturacion_dfm_periodos|facturacion_r_sustituciones|listado_paradas_operativas)/);
  assert.doesNotMatch(js, /\.select\('\*'\)/);
});

test('Listados V2 tiene una sola configuración R y cuatro vistas propias', () => {
  const html = source('r1-alpha75/listados-v2.html');
  const js = source('r1-alpha75/src/listados-v2.js');
  assert.equal((html.match(/id="v2-r-config"/g) || []).length, 1);
  for (const view of ['dfm','r','paradas','24h']) assert.match(html, new RegExp('data-view="' + view + '"'));
  assert.equal((js.match(/Precio fijo por sustitución R/g) || []).length, 1);
});
