import assert from 'node:assert/strict';
import test from 'node:test';
import { deriveHotelOperationalState } from '../r1-alpha75/src/hotel-operational-state.js';

test('legacy: la situación operativa es manual aunque las T sugieran otra cosa', () => {
  const ficha = { estado: 'en_taller', modelo_flujo_taller: null };
  const stages = [
    { posicion:1, tipo_etapa:'entrada_taller', estado:'realizada', fecha_real:'2026-10-14T10:00' },
    { posicion:2, tipo_etapa:'recogida_taller', estado:'realizada', fecha_real:'2026-10-15T10:00' },
    { posicion:3, tipo_etapa:'otro', accion_sistema:'recuperar_y_liberar', estado:'pendiente' },
  ];
  assert.equal(deriveHotelOperationalState(ficha, stages), 'en_taller');
});

test('legacy: una selección manual Pendiente de taller se conserva', () => {
  const ficha = { estado: 'pendiente_taller', modelo_flujo_taller: null };
  const stages = [
    { posicion:1, tipo_etapa:'entrada_taller', estado:'realizada', fecha_real:'2026-10-14T10:00' },
  ];
  assert.equal(deriveHotelOperationalState(ficha, stages), 'pendiente_taller');
});

test('entrada_hitos_v1 continúa calculando la situación desde las T', () => {
  const ficha = { estado: 'pendiente_taller', modelo_flujo_taller: 'entrada_hitos_v1' };
  const stages = [
    { posicion:1, tipo_etapa:'entrada_taller', estado:'en_curso', fecha_inicio_real:'2026-10-16T08:00' },
  ];
  assert.equal(deriveHotelOperationalState(ficha, stages), 'en_taller');
});
