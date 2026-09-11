import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migration = await readFile(
  new URL('../supabase/migrations/20260911134500_alpha74_sustitucion_momentanea_unificada.sql', import.meta.url),
  'utf8',
);
const editor = await readFile(new URL('../r1-alpha74/src/hotel-editor-main.js', import.meta.url), 'utf8');
const hotelUtils = await readFile(new URL('../r1-alpha53/src/hotel-utils.js', import.meta.url), 'utf8');

test('FLOTA prevalece si la unidad tiene sustitución momentánea activa', () => {
  const fleet = migration.indexOf("new.tipo_sustituto := 'FLOTA'");
  const reserve = migration.indexOf("new.tipo_sustituto := 'RESERVA'");
  assert.ok(fleet >= 0 && reserve > fleet);
  assert.match(migration, /s\.sustitucion_temporal/);
});

test('la unidad sustituta conserva su estado base y se presenta en marrón', () => {
  assert.match(migration, /then 'sustitucion_momentanea' else r\.estado end as estado/);
  assert.match(migration, /then 'marron'/);
  assert.doesNotMatch(migration, /set estado = 'sustitucion_momentanea'/);
});

test('Hotel muestra Sustitución momentánea como estado operativo', () => {
  assert.match(hotelUtils, /sustitucion_momentanea:'Sustitución momentánea'/);
  assert.match(editor, /Sustitución momentánea activa/);
  assert.match(editor, /stateEditor\.setDisabled\(detail\.ficha\.cancelado \|\| detail\.ficha\.sustitucion_temporal\)/);
});
