import assert from 'node:assert/strict';
import test from 'node:test';
import { deriveHotelOperationalState, hasStageDrivenSituation } from '../r1-alpha75/src/hotel-operational-state.js';

test('legacy conserva el esquema anterior con T de recogida', () => {
  assert.equal(deriveHotelOperationalState(
    { estado: 'en_taller', modelo_flujo_taller: 'legacy' },
    [
      { tipo_etapa: 'entrada_taller', estado: 'realizada' },
      { tipo_etapa: 'recogida_taller', fecha_prevista: '2026-10-15T09:00' },
    ]
  ), 'terminado_pendiente_recogida');
});

test('nuevo flujo: antes de programar Entrada conserva las dos fases previas', () => {
  const stages = [{ posicion: 1, tipo_etapa: 'entrada_taller', estado: 'pendiente' }];
  assert.equal(deriveHotelOperationalState(
    { estado: 'planificado', modelo_flujo_taller: 'entrada_hitos_v1' }, stages
  ), 'planificado');
  assert.equal(deriveHotelOperationalState(
    { estado: 'pendiente_taller', modelo_flujo_taller: 'entrada_hitos_v1' }, stages
  ), 'pendiente_taller');
  assert.equal(hasStageDrivenSituation({ modelo_flujo_taller: 'entrada_hitos_v1' }, stages), false);
});

test('nuevo flujo: Entrada programada inicia dependencia automática', () => {
  const stages = [{ posicion: 1, tipo_etapa: 'entrada_taller', fecha_prevista: '2026-10-14T18:36' }];
  assert.equal(deriveHotelOperationalState(
    { estado: 'pendiente_taller', modelo_flujo_taller: 'entrada_hitos_v1' }, stages
  ), 'entrada_taller_programada');
  assert.equal(hasStageDrivenSituation({ modelo_flujo_taller: 'entrada_hitos_v1' }, stages), true);
});

test('nuevo flujo: Fecha entrada => taller; Acabado => pendiente de recoger', () => {
  assert.equal(deriveHotelOperationalState(
    { estado: 'entrada_taller_programada', modelo_flujo_taller: 'entrada_hitos_v1' },
    [{ posicion: 1, tipo_etapa: 'entrada_taller', fecha_inicio_real: '2026-10-14T18:40' }]
  ), 'en_taller');

  assert.equal(deriveHotelOperationalState(
    { estado: 'en_taller', modelo_flujo_taller: 'entrada_hitos_v1' },
    [{
      posicion: 1, tipo_etapa: 'entrada_taller',
      fecha_inicio_real: '2026-10-14T18:40',
      fecha_fin_real: '2026-10-14T21:00'
    }]
  ), 'terminado_pendiente_recogida');
});

test('nuevo flujo: Recogido sin más T => pendiente de recuperar', () => {
  assert.equal(deriveHotelOperationalState(
    { estado: 'terminado_pendiente_recogida', modelo_flujo_taller: 'entrada_hitos_v1' },
    [{ posicion: 1, tipo_etapa: 'entrada_taller', fecha_real: '2026-10-14T21:30' }]
  ), 'recogido_pendiente_ruta');
});

test('nuevo flujo: Recogido toma la situación de la siguiente T', () => {
  assert.equal(deriveHotelOperationalState(
    { estado: 'terminado_pendiente_recogida', modelo_flujo_taller: 'entrada_hitos_v1' },
    [
      { posicion: 1, tipo_etapa: 'entrada_taller', fecha_real: '2026-10-14T21:30' },
      { posicion: 2, tipo_etapa: 'entrada_taller', fecha_prevista: '2026-10-15T08:00' },
    ]
  ), 'entrada_taller_programada');
});

test('nuevo flujo: recuperación realizada => Recuperado', () => {
  assert.equal(deriveHotelOperationalState(
    { estado: 'recogido_pendiente_ruta', modelo_flujo_taller: 'entrada_hitos_v1' },
    [
      { posicion: 1, tipo_etapa: 'entrada_taller', fecha_real: '2026-10-14T21:30' },
      {
        posicion: 2, tipo_etapa: 'otro', accion_sistema: 'recuperar_y_liberar',
        estado: 'realizada', fecha_real: '2026-10-15T09:00'
      },
    ]
  ), 'recuperado');
});
