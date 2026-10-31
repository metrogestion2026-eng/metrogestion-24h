import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveHotelOperationalState } from '../r1-alpha75/src/hotel-operational-state.js';

test('2556: 24H realizada y MCD en curso prevalece sobre estado recuperado', () => {
  const ficha = { estado: 'recuperado', numero_parada: '2600261', vehiculo_sustituido: '2556', vehiculo_reserva: '2719' };
  const etapas = [
    { posicion: 1, tipo_etapa: '24H', estado: 'realizada', fecha_real: '2026-10-28T05:20:00Z' },
    { posicion: 2, tipo_etapa: 'entrada_taller', estado: 'en_curso', fecha_inicio_real: '2026-10-28T10:09:00Z' },
    { posicion: 3, tipo_etapa: 'otro', accion_sistema: 'recuperar_y_liberar', estado: 'pendiente' },
  ];
  assert.equal(deriveHotelOperationalState(ficha, etapas), 'en_taller');
  assert.equal(ficha.estado, 'recuperado');
  etapas[1].fecha_fin_real = '2026-10-29T08:00:00Z';
  assert.equal(deriveHotelOperationalState(ficha, etapas), 'terminado_pendiente_recogida');
  etapas[1].cancelado = true;
  assert.equal(deriveHotelOperationalState(ficha, etapas), 'recuperado');
});
