import assert from 'node:assert/strict';
import test from 'node:test';
import { bindRecoveryPreview, deriveHotelOperationalState } from '../r1-alpha75/src/hotel-operational-state.js';

const ficha = (reserve = '') => ({
  id: 'TEST-PA24H', estado: 'realizada', tipo_movimiento: '24H',
  modelo_flujo_taller: 'entrada_hitos_v1',
  modalidad_operativa: reserve ? '' : 'sin_sustitucion', vehiculo_reserva: reserve,
  retirado_hotel_activo: false,
});
const completed = () => ({
  id: 'TEST-T24H', posicion: 1, tipo_etapa: '24H', estado: 'realizada',
  fecha_inicio_real: '2026-01-10T09:00:00Z', fecha_fin_real: '2026-01-10T10:00:00Z', fecha_real: '2026-01-10T10:00:00Z',
});

for (const reserve of ['', 'TEST-RESERVE']) {
  test(`una PA solo 24H conserva realizada ${reserve ? 'con' : 'sin'} sustitución`, () => {
    const record = ficha(reserve), stages = [completed()];
    const before = JSON.stringify({ record, stages });
    assert.equal(deriveHotelOperationalState(record, stages), 'realizada');
    assert.equal(JSON.stringify({ record, stages }), before);
    assert.equal(record.vehiculo_reserva, reserve);
    assert.equal(record.retirado_hotel_activo, false);
  });
}

test('una T24H completa no inventa confirmación de finalización de la PA', () => {
  assert.equal(deriveHotelOperationalState({ ...ficha(), estado: 'asistencia_24h' }, [completed()]), 't_pendientes');
});

test('una 24H todavía pendiente conserva la asistencia en curso', () => {
  assert.equal(deriveHotelOperationalState(ficha(), [{ ...completed(), estado: 'en_curso', fecha_fin_real: null, fecha_real: null }]), 'asistencia_24h');
});

const pendingTasks = [
  ['otra T genérica', { tipo_etapa: 'otro', estado: 'pendiente' }, 't_pendientes'],
  ['trámite', { tipo_etapa: 'TRÁMITE', estado: 'pendiente' }, 'tramite'],
  ['gestión', { tipo_etapa: 'GESTIÓN', estado: 'pendiente' }, 'gestion'],
  ['entrada sin ningún hito', { tipo_etapa: 'entrada_taller', estado: 'pendiente' }, 'pendiente_taller'],
  ['entrada programada', { tipo_etapa: 'entrada_taller', estado: 'programada', fecha_prevista: '2026-01-11T08:00:00Z' }, 'entrada_taller_programada'],
  ['taller en curso', { tipo_etapa: 'entrada_taller', estado: 'en_curso', fecha_inicio_real: '2026-01-10T11:00:00Z' }, 'en_taller'],
  ['taller acabado sin recogida', { tipo_etapa: 'entrada_taller', estado: 'realizada', fecha_inicio_real: '2026-01-10T11:00:00Z', fecha_fin_real: '2026-01-10T12:00:00Z' }, 'terminado_pendiente_recogida'],
];
for (const [label, stage, expected] of pendingTasks) {
  test(`la finalización de asistencia no oculta ${label} pendiente`, () => {
    assert.equal(deriveHotelOperationalState(ficha('TEST-RESERVE'), [completed(), { id: 'TEST-OTHER', posicion: 2, ...stage }]), expected);
  });
}

function withReserveConflict(stages, signedPreview) {
  // Modalidad realmente asignada por guardar_operativa al necesitar sustituto.
  const record = { ...ficha('TEST-RESERVE'), modalidad_operativa: 'reserva_en_reparacion' };
  if (signedPreview) {
    record.rec001 = { registro_id: record.id, conflicto: true, requiere_recuperacion: true, cierre_confirmable: false };
    bindRecoveryPreview(record, stages);
  }
  return record;
}

for (const signedPreview of [false, true]) {
  const previewLabel = signedPreview ? 'con lectura REC001 vinculada' : 'sin lectura REC001 vinculada';
  test(`reserva_en_reparacion con reserva conserva realizada de la PA solo24H ${previewLabel}`, () => {
    const stages = [completed()], record = withReserveConflict(stages, signedPreview);
    const before = JSON.stringify({ record, stages });
    assert.equal(deriveHotelOperationalState(record, stages), 'realizada');
    assert.equal(JSON.stringify({ record, stages }), before);
  });
  for (const [label, stage, expected] of pendingTasks) {
    test(`el conflicto de modalidad no oculta ${label} ${previewLabel}`, () => {
      const stages = [completed(), { id: 'TEST-OTHER', posicion: 2, ...stage }];
      const record = withReserveConflict(stages, signedPreview);
      const before = JSON.stringify({ record, stages });
      assert.equal(deriveHotelOperationalState(record, stages), expected);
      assert.equal(JSON.stringify({ record, stages }), before);
    });
  }
  test(`el conflicto sigue bloqueando inferir recuperación ${previewLabel}`, () => {
    const stages = [completed(), { id: 'TEST-RECOVERY', posicion: 2, tipo_etapa: 'otro',
      accion_sistema: 'recuperar_y_liberar', estado: 'realizada', fecha_real: '2026-01-11T09:00:00Z' }];
    const record = withReserveConflict(stages, signedPreview);
    assert.equal(deriveHotelOperationalState(record, stages), 'realizada');
    assert.equal(record.vehiculo_reserva, 'TEST-RESERVE');
    assert.equal(record.retirado_hotel_activo, false);
  });
}

test('la recuperación legítima conserva su pendiente y su cierre propio', () => {
  const record = ficha('TEST-RESERVE');
  const recovery = { id: 'TEST-RECOVERY', posicion: 2, tipo_etapa: 'otro', accion_sistema: 'recuperar_y_liberar', estado: 'pendiente' };
  assert.equal(deriveHotelOperationalState(record, [completed(), recovery]), 'recogido_pendiente_ruta');
  assert.equal(deriveHotelOperationalState(record, [completed(), { ...recovery, estado: 'realizada', fecha_real: '2026-01-11T09:00:00Z' }]), 'recuperado');
});

test('no aplica la excepción a una ficha sin T ni reinterpreta fichas legacy', () => {
  assert.equal(deriveHotelOperationalState({ ...ficha(), estado: 'pendiente_taller' }, []), 'pendiente_taller');
  assert.equal(deriveHotelOperationalState({ ...ficha(), modelo_flujo_taller: 'legacy' }, [completed()]), 'realizada');
  assert.equal(deriveHotelOperationalState({ ...ficha(), modelo_flujo_taller: 'legacy' },
    [completed(), { tipo_etapa: 'entrada_taller', estado: 'pendiente', posicion: 2 }]), 'realizada');
});
