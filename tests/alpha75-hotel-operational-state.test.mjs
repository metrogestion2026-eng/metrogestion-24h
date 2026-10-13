import assert from 'node:assert/strict';
import test from 'node:test';
import { deriveHotelOperationalState } from '../r1-alpha75/src/hotel-operational-state.js';

test('entrada programada => Entrada taller programada', () => {
  assert.equal(deriveHotelOperationalState(
    { estado: 'pendiente_taller' },
    [
      { tipo_etapa: 'entrada_taller', fecha_prevista: '2026-10-14T18:36' },
      { tipo_etapa: 'recogida_taller', estado: 'pendiente' },
      { tipo_etapa: 'otro', accion_sistema: 'recuperar_y_liberar', estado: 'pendiente' },
    ]
  ), 'entrada_taller_programada');
});

test('entrada iniciada o realizada => En taller', () => {
  assert.equal(deriveHotelOperationalState(
    { estado: 'pendiente_taller' },
    [{ tipo_etapa: 'entrada_taller', fecha_inicio_real: '2026-10-14T18:40' }]
  ), 'en_taller');
  assert.equal(deriveHotelOperationalState(
    { estado: 'pendiente_taller' },
    [{ tipo_etapa: 'entrada_taller', fecha_real: '2026-10-14T18:40' }]
  ), 'en_taller');
});

test('recogida programada => pendiente de recoger; realizada => pendiente de recuperar', () => {
  assert.equal(deriveHotelOperationalState(
    { estado: 'en_taller' },
    [
      { tipo_etapa: 'entrada_taller', estado: 'realizada' },
      { tipo_etapa: 'recogida_taller', fecha_prevista: '2026-10-15T09:00' },
    ]
  ), 'terminado_pendiente_recogida');
  assert.equal(deriveHotelOperationalState(
    { estado: 'en_taller' },
    [
      { tipo_etapa: 'entrada_taller', estado: 'realizada' },
      { tipo_etapa: 'recogida_taller', fecha_real: '2026-10-15T09:00' },
    ]
  ), 'recogido_pendiente_ruta');
});

test('recuperación realizada => Recuperado', () => {
  assert.equal(deriveHotelOperationalState(
    { estado: 'recogido_pendiente_ruta' },
    [{ tipo_etapa: 'otro', accion_sistema: 'recuperar_y_liberar', fecha_real: '2026-10-15T10:00' }]
  ), 'recuperado');
});

test('conserva diagnóstico/autorización/repuestos mientras el vehículo sigue en taller', () => {
  for (const estado of ['pendiente_diagnostico', 'pendiente_autorizacion', 'pendiente_repuestos']) {
    assert.equal(deriveHotelOperationalState(
      { estado },
      [{ tipo_etapa: 'entrada_taller', estado: 'realizada' }]
    ), estado);
  }
});


test('antes de programar la entrada conserva la situación previa independiente de las T', () => {
  const stages = [{ tipo_etapa: 'entrada_taller', estado: 'pendiente' }];
  assert.equal(deriveHotelOperationalState({ estado: 'planificado' }, stages), 'planificado');
  assert.equal(deriveHotelOperationalState({ estado: 'pendiente_taller' }, stages), 'pendiente_taller');
});
