import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const main = fs.readFileSync(new URL('../r1-alpha75/src/hotel-editor-main.js', import.meta.url), 'utf8');
const script = fs.readFileSync(new URL('../r1-alpha75/google-apps-script/sincronizar_manteniment.gs', import.meta.url), 'utf8');

test('Hotel usa TIPO/configuración del maestro y no familia DFM/R', () => {
  assert.match(main, /setControl\(controls, detail\.ficha, 'tipo_unidad', vehicle\.tipo_manteniment \|\| ''\)/);
  assert.doesNotMatch(main, /tipo_unidad', vehicle\.categoria/);
  assert.match(main, /TIPO \/ Configuración/);
});

test('Hotel trata los datos maestros como solo lectura cuando el maestro está disponible', () => {
  assert.match(main, /masterReadOnly/);
  assert.match(main, /matricula_sustituido/);
  assert.match(main, /tipo_unidad/);
});

test('MANTENIMENT ALTA sella las ediciones humanas por campo', () => {
  assert.match(script, /function onEdit\(e\)/);
  assert.match(script, /METROGESTION_MAESTRO_COLUMNAS/);
  assert.match(script, /cambios_maestro: metrogestionCambiosMaestro_/);
});
