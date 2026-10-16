import assert from 'node:assert/strict';
import test from 'node:test';
import { deriveHotelOperationalState } from '../r1-alpha75/src/hotel-operational-state.js';

test('2527: segunda entrada AUTODIS abierta manda sobre la recogida antigua', () => {
  const ficha = {
    estado: 'en_taller',
    modalidad_operativa: '',
    modelo_flujo_taller: null,
  };
  const stages = [
    { id: 'in1', posicion: 1, tipo_etapa: 'entrada_taller', estado: 'realizada', fecha_real: '2026-08-28T07:20' },
    { id: 'out1', posicion: 2, tipo_etapa: 'recogida_taller', etapa_origen_id: 'in1', estado: 'realizada', fecha_real: '2026-09-26T12:59' },
    { id: 'in2', posicion: 3, tipo_etapa: 'entrada_taller', estado: 'realizada', fecha_real: '2026-09-26T08:15' },
    { id: 'out2', posicion: 4, tipo_etapa: 'recogida_taller', estado: 'pendiente' },
    { id: 'itv', posicion: 5, tipo_etapa: 'otro', estado: 'pendiente' },
    { id: 'recovery', posicion: 6, tipo_etapa: 'otro', accion_sistema: 'recuperar_y_liberar', estado: 'pendiente' },
  ];
  assert.equal(deriveHotelOperationalState(ficha, stages), 'en_taller');
});

test('una recogida programada de la última estancia da Pendiente de recoger, no Pendiente de recuperar', () => {
  const ficha = { estado: 'en_taller', modalidad_operativa: '' };
  const stages = [
    { id: 'in1', posicion: 1, tipo_etapa: 'entrada_taller', estado: 'realizada', fecha_real: '2026-10-01T08:00' },
    { id: 'out1', posicion: 2, tipo_etapa: 'recogida_taller', etapa_origen_id: 'in1', estado: 'realizada', fecha_real: '2026-10-02T08:00' },
    { id: 'in2', posicion: 3, tipo_etapa: 'entrada_taller', estado: 'realizada', fecha_real: '2026-10-03T08:00' },
    { id: 'out2', posicion: 4, tipo_etapa: 'recogida_taller', etapa_origen_id: 'in2', estado: 'programada', fecha_prevista: '2026-10-20T10:00' },
    { id: 'recovery', posicion: 5, tipo_etapa: 'otro', accion_sistema: 'recuperar_y_liberar', estado: 'pendiente' },
  ];
  assert.equal(deriveHotelOperationalState(ficha, stages), 'terminado_pendiente_recogida');
});

test('si la recogida de la estancia más reciente ya está realizada, entonces sí puede quedar Pendiente de recuperar', () => {
  const ficha = { estado: 'en_taller', modalidad_operativa: '' };
  const stages = [
    { id: 'in2', posicion: 1, tipo_etapa: 'entrada_taller', estado: 'realizada', fecha_real: '2026-10-03T08:00' },
    { id: 'out2', posicion: 2, tipo_etapa: 'recogida_taller', etapa_origen_id: 'in2', estado: 'realizada', fecha_real: '2026-10-04T08:00' },
    { id: 'recovery', posicion: 3, tipo_etapa: 'otro', accion_sistema: 'recuperar_y_liberar', estado: 'pendiente' },
  ];
  assert.equal(deriveHotelOperationalState(ficha, stages), 'recogido_pendiente_ruta');
});
