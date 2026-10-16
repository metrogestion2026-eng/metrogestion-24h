import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { deriveHotelOperationalState } from '../r1-alpha75/src/hotel-operational-state.js';

test('2675 sin sustitución: una recogida antigua no domina una entrada posterior en taller', () => {
  const ficha = {
    estado: 'en_taller',
    modalidad_operativa: 'sin_sustitucion',
    modelo_flujo_taller: null,
  };
  const stages = [
    { id: 'sideco-in', posicion: 1, tipo_etapa: 'entrada_taller', estado: 'realizada', fecha_real: '2026-09-30T06:29' },
    { id: 'sideco-out', posicion: 2, tipo_etapa: 'recogida_taller', etapa_origen_id: 'sideco-in', estado: 'realizada', fecha_real: '2026-10-05T13:28' },
    { id: 'repuestos', posicion: 3, tipo_etapa: 'TRÁMITE', estado: 'realizada', fecha_real: '2026-10-05T13:30' },
    { id: 'fridiel-in', posicion: 4, tipo_etapa: 'entrada_taller', estado: 'realizada', fecha_real: '2026-10-16T07:24' },
    { id: 'fridiel-out', posicion: 5, tipo_etapa: 'recogida_taller', etapa_origen_id: 'fridiel-in', estado: 'pendiente' },
    { id: 'tmg', posicion: 6, tipo_etapa: 'otro', estado: 'pendiente' },
    { id: 'recovery', posicion: 7, tipo_etapa: 'otro', accion_sistema: 'recuperar_y_liberar', estado: 'pendiente', cancelado: true },
  ];
  assert.equal(deriveHotelOperationalState(ficha, stages), 'en_taller');
});

test('sin sustitución nunca deriva Pendiente de recuperar por una recuperación automática', () => {
  const ficha = { estado: 'en_taller', modalidad_operativa: 'sin_sustitucion' };
  const stages = [
    { id: 'in', posicion: 1, tipo_etapa: 'entrada_taller', estado: 'realizada', fecha_real: '2026-10-16T07:24' },
    { id: 'out', posicion: 2, tipo_etapa: 'recogida_taller', etapa_origen_id: 'in', estado: 'pendiente' },
    { id: 'recovery', posicion: 3, tipo_etapa: 'otro', accion_sistema: 'recuperar_y_liberar', estado: 'pendiente' },
  ];
  assert.equal(deriveHotelOperationalState(ficha, stages), 'en_taller');
});

test('el editor no marca todas las T cuando el servidor da un error genérico sin discrepancia real', async () => {
  const source = await readFile('r1-alpha75/src/hotel-editor-validation.js', 'utf8');
  assert.match(source, /if \(mismatches\.length\) return mismatches;/);
  assert.match(source, /return \[\];/);
  assert.doesNotMatch(source, /filter\(stage => !stage\.cancelado\)\.map/);
});

test('hf18 fuerza la carga de la nueva derivación y validación', async () => {
  const main = await readFile('r1-alpha75/src/hotel-editor-main.js', 'utf8');
  const editor = await readFile('r1-alpha75/src/hotel-editor.js', 'utf8');
  const html = await readFile('r1-alpha75/index.html', 'utf8');
  assert.match(main, /hotel-operational-state\.js\?v=75\.23-hf18/);
  assert.match(editor, /hotel-editor-validation\.js\?v=75\.23-hf18/);
  assert.match(html, /hotel-native\.js\?v=75\.23-hf18/);
});
