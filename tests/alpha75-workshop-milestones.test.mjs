import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeStageType, isWorkshopEntryStage, usesWorkshopMilestones,
  workshopMilestoneAction,
} from '../r1-alpha75/src/workshop-milestones.js';

const entry = extra => ({
  tipo_etapa: 'entrada_taller', modelo_flujo_taller: 'entrada_hitos_v1',
  estado: 'pendiente', cancelado: false,
  fecha_inicio_real: null, fecha_fin_real: null, fecha_real: null,
  ...extra,
});
const start = '2026-11-12T12:55:00.123456Z';
const finish = '2026-11-13T08:00:00.654321Z';
const pickup = '2026-11-13T09:00:00.987654Z';

test('catalogue spellings select the same explicit workshop model without rewriting the type', () => {
  for (const type of ['entrada_taller', 'ENTRADA TALLER', 'Entrada en taller', '  Entrada  en  taller  ']) {
    const value = entry({ tipo_etapa: type });
    assert.equal(normalizeStageType(type), 'entrada_taller');
    assert.equal(isWorkshopEntryStage(value), true);
    assert.equal(usesWorkshopMilestones(value), true);
    assert.equal(workshopMilestoneAction(value).hito, 'entrada');
    assert.equal(value.tipo_etapa, type);
  }
  for (const type of ['otro', 'recogida_taller', 'recuperar_ruta', 'trámite', '24H', '']) {
    assert.equal(isWorkshopEntryStage(entry({ tipo_etapa: type })), false);
    assert.equal(workshopMilestoneAction(entry({ tipo_etapa: type })), null);
  }
});

test('the next button follows entrada, terminado, recogido and disappears after a complete pickup', () => {
  const states = [
    [entry(), 'entrada', 'Entrada a taller', 'fecha_inicio_real'],
    [entry({ estado: 'en_curso', fecha_inicio_real: start }), 'terminado', 'Terminado en taller', 'fecha_fin_real'],
    [entry({ estado: 'en_curso', fecha_inicio_real: start, fecha_fin_real: finish }), 'recogido', 'Recogido de taller', 'fecha_real'],
  ];
  for (const [value, hito, label, field] of states) {
    const before = structuredClone(value);
    const action = workshopMilestoneAction(value);
    assert.equal(action.hito, hito);
    assert.equal(action.label, label);
    assert.equal(action.field, field);
    assert.deepEqual(value, before, 'Reading the action must not invent or round timestamps');
  }
  assert.equal(workshopMilestoneAction(entry({ estado: 'realizada', fecha_inicio_real: start,
    fecha_fin_real: finish, fecha_real: pickup })), null);
});

test('legacy, missing model, cancelled and annulled entries retain their separate flows', () => {
  for (const changes of [{ modelo_flujo_taller: 'legacy' }, { modelo_flujo_taller: undefined },
    { cancelado: true }, { estado: 'anulada' },
    { accion_sistema: 'recuperar_y_liberar' }, { accion_sistema: 'liberar_reserva' }]) {
    assert.equal(workshopMilestoneAction(entry(changes)), null);
  }
  assert.equal(usesWorkshopMilestones(entry(), 'legacy'), false);
});

test('missing, invalid, inverted and contradictory facts require correction before a quick action', () => {
  const cases = [
    [{ fecha_fin_real: finish }, /entrada/],
    [{ fecha_inicio_real: start, fecha_real: pickup }, /finalización/],
    [{ fecha_inicio_real: 'invalid' }, /entrada.*no es válida/],
    [{ fecha_inicio_real: start, fecha_fin_real: 'invalid' }, /finalización.*no es válida/],
    [{ fecha_inicio_real: finish, fecha_fin_real: start }, /anterior a la entrada/],
    [{ fecha_inicio_real: start, fecha_fin_real: pickup, fecha_real: finish }, /anterior a la finalización/],
    [{ estado: 'realizada', fecha_inicio_real: start, fecha_fin_real: finish }, /no tiene fecha real de recogida/],
    [{ estado: 'en_curso', fecha_inicio_real: start, fecha_fin_real: finish, fecha_real: pickup }, /no figura realizada/],
  ];
  for (const [changes, message] of cases) {
    const value = entry(changes), before = structuredClone(value);
    const action = workshopMilestoneAction(value);
    assert.equal(action.hito, null);
    assert.match(action.issue, message);
    assert.deepEqual(value, before);
  }
});
