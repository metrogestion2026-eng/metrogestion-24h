import assert from 'node:assert/strict';
import test from 'node:test';
import { deriveHotelOperationalState } from '../r1-alpha75/src/hotel-operational-state.js';

test('Gestión pendiente mantiene Situación Gestión', () => {
  assert.equal(
    deriveHotelOperationalState(
      { estado: 'gestion', modelo_flujo_taller: 'entrada_hitos_v1' },
      [{ posicion: 1, tipo_etapa: 'GESTIÓN', estado: 'pendiente' }]
    ),
    'gestion'
  );
});

test('Gestión realizada lleva Situación a Realizada si no hay otra T posterior', () => {
  assert.equal(
    deriveHotelOperationalState(
      { estado: 'gestion', modelo_flujo_taller: 'entrada_hitos_v1' },
      [{ posicion: 1, tipo_etapa: 'GESTIÓN', estado: 'realizada', fecha_real: '2026-10-14T09:00' }]
    ),
    'realizada'
  );
});

test('si hay otra T posterior, manda la siguiente', () => {
  assert.equal(
    deriveHotelOperationalState(
      { estado: 'gestion', modelo_flujo_taller: 'entrada_hitos_v1' },
      [
        { posicion: 1, tipo_etapa: 'GESTIÓN', estado: 'realizada', fecha_real: '2026-10-14T09:00' },
        { posicion: 2, tipo_etapa: 'TRÁMITE', estado: 'pendiente' }
      ]
    ),
    'tramite'
  );
});
