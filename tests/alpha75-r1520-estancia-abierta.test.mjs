import assert from 'node:assert/strict';
import test from 'node:test';
import { deriveHotelOperationalState } from '../r1-alpha75/src/hotel-operational-state.js';

test('R1520: estancia GP abierta manda sobre entrada FRIGICOLL futura', () => {
  const ficha = { estado: 'en_taller', modalidad_operativa: '', modelo_flujo_taller: null };
  const stages = [
    { id:'gp-in', posicion:1, tipo_etapa:'entrada_taller', estado:'realizada', fecha_real:'2026-10-14T12:21' },
    { id:'gp-out', posicion:2, tipo_etapa:'recogida_taller', etapa_origen_id:'gp-in', estado:'pendiente' },
    { id:'fr-in', posicion:3, tipo_etapa:'entrada_taller', estado:'pendiente' },
    { id:'fr-out', posicion:4, tipo_etapa:'recogida_taller', etapa_origen_id:'fr-in', estado:'pendiente' },
    { id:'recovery', posicion:5, tipo_etapa:'otro', accion_sistema:'recuperar_y_liberar', estado:'pendiente' },
  ];
  assert.equal(deriveHotelOperationalState(ficha, stages), 'en_taller');
});

test('R1317: una recuperación ya iniciada manda sobre una estancia antigua incompleta', () => {
  const ficha = { estado: 'recogido_pendiente_ruta', modalidad_operativa: '', modelo_flujo_taller: null };
  const stages = [
    { id:'in', posicion:1, tipo_etapa:'entrada_taller', estado:'realizada', fecha_real:'2026-10-14T10:00' },
    { id:'recovery', posicion:4, tipo_etapa:'otro', accion_sistema:'recuperar_y_liberar', estado:'en_curso', fecha_inicio_real:'2026-10-15T06:22' },
  ];
  assert.equal(deriveHotelOperationalState(ficha, stages), 'recogido_pendiente_ruta');
});

test('2527 sigue En taller con segunda entrada abierta y primera recogida cerrada', () => {
  const ficha = { estado: 'en_taller', modalidad_operativa: '', modelo_flujo_taller: null };
  const stages = [
    { id:'in1', posicion:1, tipo_etapa:'entrada_taller', estado:'realizada', fecha_real:'2026-08-28T07:20' },
    { id:'out1', posicion:2, tipo_etapa:'recogida_taller', etapa_origen_id:'in1', estado:'realizada', fecha_real:'2026-09-26T12:59' },
    { id:'in2', posicion:3, tipo_etapa:'entrada_taller', estado:'realizada', fecha_real:'2026-09-26T08:15' },
    { id:'out2', posicion:4, tipo_etapa:'recogida_taller', estado:'pendiente' },
    { id:'recovery', posicion:6, tipo_etapa:'otro', accion_sistema:'recuperar_y_liberar', estado:'pendiente' },
  ];
  assert.equal(deriveHotelOperationalState(ficha, stages), 'en_taller');
});
