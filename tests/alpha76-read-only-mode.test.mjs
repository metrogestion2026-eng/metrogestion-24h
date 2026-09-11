import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const reader = await readFile('r1-alpha76/src/read-only-mode.js', 'utf8');
const hotel = await readFile('r1-alpha76/src/hotel-native.js', 'utf8');
const panel = await readFile('r1-alpha76/src/panel-native.js', 'utf8');

test('el modo simplificado solo se activa para un perfil realmente sin edición', () => {
  assert.match(reader, /tipo_usuario === 'administrador_principal'/);
  assert.match(reader, /permission\?\.editar === true/);
  assert.match(reader, /eligibleReader\(profile\)/);
  assert.match(reader, /getModuleAccess\(profile, 'hotel'\)\.view/);
  assert.match(reader, /getModuleAccess\(profile, 'resumen'\)\.view/);
});

test('la portada de lectura ofrece buscador, Hotel, Panel, guía y leyenda completa', () => {
  assert.match(reader, /Consulta de flota/);
  assert.match(reader, /Solo lectura/);
  assert.match(reader, /Buscar en Hotel/);
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
  assert.match(reader, /a76-reader-hidden/);
});

test('el buscador y el Panel abren la ficha filtrada en Hotel para lectura', () => {
  assert.match(reader, /sessionStorage\.setItem\(SEARCH_KEY/);
  assert.match(hotel, /sessionStorage\.getItem\('alpha76HotelSearch'\)/);
  assert.match(hotel, /hotelViewState\.search = incomingSearch/);
  assert.match(panel, /searchQuery: row\.dfm \|\| row\.numero_parada \|\| row\.matricula/);
  assert.match(panel, /moduleId === 'hotel' && !canEditHotel/);
  assert.match(panel, /sessionStorage\.setItem\('alpha76HotelSearch'/);
});
