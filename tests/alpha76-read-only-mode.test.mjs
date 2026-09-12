import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const reader = await readFile('r1-alpha76/src/read-only-mode.js', 'utf8');
const hotel = await readFile('r1-alpha76/src/hotel-native.js', 'utf8');
const panel = await readFile('r1-alpha76/src/panel-native.js', 'utf8');

test('el modo simplificado depende de Hotel y Panel aunque otro módulo conserve edición', () => {
  assert.match(reader, /tipo_usuario === 'administrador_principal'/);
  assert.match(reader, /eligibleReader\(profile\)/);
  assert.match(reader, /const hotel = getModuleAccess\(profile, 'hotel'\)/);
  assert.match(reader, /const panel = getModuleAccess\(profile, 'resumen'\)/);
  assert.match(reader, /\(hotel\.view \|\| panel\.view\) && !hotel\.edit && !panel\.edit/);
});

test('la portada ofrece buscador, 24H editable, Hotel, Panel, guía y leyenda completa', () => {
  assert.match(reader, /Consulta de flota/);
  assert.match(reader, /Consulta · 24H editable/);
  assert.match(reader, /Buscar en Hotel/);
  assert.match(reader, /Crear o continuar una incidencia 24H/);
  assert.match(reader, /Abrir Hotel/);
  assert.match(reader, /Abrir Panel/);
  assert.match(reader, /Cómo consultar/);
  for (const colour of ['Amarillo', 'Blanco', 'Lila', 'Azul', 'Calabaza', 'Marrón', 'Azul claro']) {
    assert.match(reader, new RegExp(colour));
  }
  assert.match(reader, /Borde marrón/);
});

test('la portada no escribe datos y limita la navegación visible', () => {
  assert.doesNotMatch(reader, /\.(insert|update|delete|upsert|rpc)\s*\(/);
  assert.match(reader, /\['hotel', 'resumen'\]\.includes/);
  assert.match(reader, /access\.assistance24h\.view && button === assistanceButton/);
  assert.match(reader, /\[data-alpha34-24h\], \[data-h47-24h\]/);
  assert.match(reader, /a76-reader-hidden/);
  assert.match(reader, /button\.\$\{HIDDEN_CLASS\}/);
  assert.match(reader, /event\.stopImmediatePropagation\(\)/);
});

test('el buscador y el Panel abren la ficha filtrada en Hotel para lectura', () => {
  assert.match(reader, /sessionStorage\.setItem\(SEARCH_KEY/);
  assert.match(hotel, /sessionStorage\.getItem\('alpha76HotelSearch'\)/);
  assert.match(hotel, /hotelViewState\.search = incomingSearch/);
  assert.match(panel, /searchQuery: row\.dfm \|\| row\.numero_parada \|\| row\.matricula/);
  assert.match(panel, /moduleId === 'hotel' && !canEditHotel/);
  assert.match(panel, /sessionStorage\.setItem\('alpha76HotelSearch'/);
});
