import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createExecutorHarness, HEADERS, command, workPayload, workRow, scopeOf,
} from './helpers/alpha75-sync-executor-harness.mjs';

const plain = value => JSON.parse(JSON.stringify(value));
function prepare(h, order) {
  h.call('metrogestionGuardarAlcanceOrdenes_', [scopeOf(order)]);
  const state = h.newState([order]);
  h.save(state);
  h.clearEvents();
  return state;
}
function retained(work, expected) {
  const h = createExecutorHarness();
  const order = command({ payload: { solo_trabajos: true, trabajos_crear: [work] } });
  const state = prepare(h, order), before = h.snapshot();
  assert.throws(() => h.process(state), expected);
  assert.deepEqual(h.snapshot(), before, 'A retained proposal must leave Sheets and Drive intact');
  assert.deepEqual(h.effects, []);
  assert.deepEqual(h.httpCalls, [], 'No authorize, sync, cancellation or ACK can precede this check');
  assert.equal(state.confirmados, 0);
  assert.deepEqual(plain(h.load().comandos), [order], 'The complete original proposal remains pending');
  assert.equal(Object.keys(h.properties).filter(k => k.startsWith('METROGESTION_ORDEN_V1:')).length, 0);
  h.restart(); h.clearEvents();
  assert.throws(() => h.process(h.load()), expected);
  assert.deepEqual(h.snapshot(), before);
  assert.deepEqual(h.httpCalls, []);
}

test('legacy creation dates remain pending across restart without inserting, authorizing or acknowledging', () => {
  const work = workPayload();
  for (const key of ['contrato_fechas_version', 'fecha_necesidad_origen', 'procedencia_fecha_necesidad',
    'contexto_operativo_vigente', 'fecha_programada_visita', 'fecha_inicio_real', 'fecha_fin_real', 'fecha_real']) delete work[key];
  retained(work, /contrato de fechas antiguo o no acreditado/i);
});

test('an archived or otherwise unaccredited context cannot recreate a manually reviewed row', () => {
  retained(workPayload({ contexto_operativo_vigente: false }), /contexto operativo vigente/i);
});

test('the current v2 producer with no source is retained even if it still supplies a legacy contextual date', () => {
  retained(workPayload({ fecha_necesidad_origen: null, procedencia_fecha_necesidad: 'no_acreditada',
    retener_propuesta: true, motivos_retencion: ['NECESIDAD_ORIGEN_NO_ACREDITADA'],
    fecha_necesidad: '2026-09-18', fecha_real: '2026-09-18T05:10:00+00:00' }), /libre de retenciones/i);
});

test('agenda, real date and legacy date never fill a missing origin date', () => {
  for (const patch of [
    { fecha_programada_visita: '2026-09-18T08:30:00+02:00' },
    { fecha_real: '2026-09-18T05:10:00+00:00' },
    { fecha_necesidad: '2026-09-18' },
  ]) retained(workPayload({ ...patch, fecha_necesidad_origen: null }), /origen no está acreditada/i);
});

test('a populated origin date with unknown provenance is not accepted as manual evidence', () => {
  retained(workPayload({ procedencia_fecha_necesidad: 'fecha_real' }), /origen no está acreditada/i);
});

test('a blank or noncanonical origin is retained instead of creating a need with empty I', () => {
  for (const value of [' ', '\t\n', ' 2026-09-18 ', '2026-9-18', 20260918]) {
    retained(workPayload({ fecha_necesidad_origen: value }), /origen no está acreditada/i);
  }
});

test('legacy J/K cannot be populated without explicit evidence of their actual facts', () => {
  retained(workPayload({ fecha_entrada: '2026-10-19', fecha_salida: '2026-10-19' }), /hecho real/i);
  retained(workPayload({ fecha_entrada: '2026-10-19', fecha_salida: '2026-10-19',
    fecha_inicio_real: '2026-07-12T08:00:00Z', fecha_fin_real: '2026-07-12T09:00:00Z',
    fecha_real: '2026-07-12T09:00:00Z' }), /hecho real/i);
  retained(workPayload({ fecha_salida: '2026-10-19',
    origen_fecha_salida: { hecho: 'fin_trabajo', fecha_hora: '2026-10-19T08:00:00Z' } }), /hecho real/i);
});

test('J/K must match the Madrid civil day of the explicit entry or pickup fact', () => {
  retained(workPayload({ fecha_entrada: '2026-10-19',
    origen_fecha_entrada: { hecho: 'entrada_taller', fecha_hora: '2026-10-19T23:30:00Z' } }), /día de Madrid/i);
  retained(workPayload({ fecha_salida: '2026-10-19',
    origen_fecha_salida: { hecho: 'recogida_taller', fecha_hora: '2026-07-12T09:00:00Z' } }), /día de Madrid/i);
});

test('an administrative completion cannot be invented from a physical work or another date', () => {
  retained(workPayload({ fecha_entrada: '2026-10-19', fecha_real: '2026-10-19T08:00:00Z',
    origen_fecha_entrada: { hecho: 'realizacion_administrativa', fecha_hora: '2026-10-19T08:00:00Z' } }), /administrativa/i);
  retained(workPayload({ tipo_trabajo: 'TRÁMITE', fecha_entrada: '2026-10-19', fecha_real: '2026-07-12T08:00:00Z',
    origen_fecha_entrada: { hecho: 'realizacion_administrativa', fecha_hora: '2026-10-19T08:00:00Z' } }), /administrativa/i);
});

test('physical pickup cannot precede the proved entry within the same civil day', () => {
  retained(workPayload({ fecha_entrada: '2026-10-19', fecha_salida: '2026-10-19',
    origen_fecha_entrada: { hecho: 'entrada_taller', fecha_hora: '2026-10-19T10:00:00Z' },
    origen_fecha_salida: { hecho: 'recogida_taller', fecha_hora: '2026-10-19T08:00:00Z' } }), /recogida física es anterior/i);
  const h = createExecutorHarness();
  const valid = workPayload({ fecha_entrada: '2026-10-19', fecha_salida: '2026-10-19',
    origen_fecha_entrada: { hecho: 'entrada_taller', fecha_hora: '2026-10-19T10:00:00+02:00' },
    origen_fecha_salida: { hecho: 'recogida_taller', fecha_hora: '2026-10-19T09:00:00Z' } });
  const order = command({ payload: { solo_trabajos: true, trabajos_crear: [valid] } });
  const state = prepare(h, order);
  h.process(state);
  assert.equal(state.confirmados, 1, 'Compare instants, not lexical timestamps with different offsets');
});

test('version and context flags cannot be passed as permissive strings', () => {
  retained(workPayload({ contrato_fechas_version: '2' }), /contrato de fechas antiguo/i);
  retained(workPayload({ contexto_operativo_vigente: 'true' }), /contexto operativo vigente/i);
  retained(workPayload({ retener_propuesta: 'false' }), /libre de retenciones/i);
  retained(workPayload({ retener_propuesta: false, motivos_retencion: ['ORIGEN_AMBIGUO'] }), /libre de retenciones/i);
  const missing = workPayload();
  delete missing.motivos_retencion;
  retained(missing, /libre de retenciones/i);
});

test('a partial contract cannot silently omit agenda or facts', () => {
  const work = workPayload();
  delete work.fecha_programada_visita;
  retained(work, /no distingue todos los hitos/i);
});

test('timestamps must be explicit, valid instants and never replace a civil origin date', () => {
  for (const value of ['2026-09-18', '2026-09-18T08:30:00', '2026-09-18T08:30:00+14:30',
    '2026-02-30T08:30:00Z', { date: '2026-09-18' }]) {
    retained(workPayload({ fecha_programada_visita: value }), /fecha|hito/i);
  }
  retained(workPayload({ fecha_necesidad_origen: '2026-09-18T08:30:00Z' }), /fecha/i);
});

test('an explicitly declared synthetic origin remains independent of agenda and facts through the full executor', () => {
  const h = createExecutorHarness();
  const work = workPayload({ fecha_necesidad: '2026-10-19', fecha_necesidad_origen: '2026-05-12',
    fecha_programada_visita: '2026-10-18T08:00:00+02:00',
    fecha_inicio_real: '2026-10-19T07:15:00+00:00', fecha_fin_real: '2026-10-19T08:20:00+00:00',
    fecha_real: '2026-10-19T08:20:00+00:00', fecha_entrada: '2026-10-19', fecha_salida: '2026-10-19',
    origen_fecha_entrada: { hecho: 'entrada_taller', fecha_hora: '2026-10-19T07:00:00Z' },
    origen_fecha_salida: { hecho: 'recogida_taller', fecha_hora: '2026-10-19T09:00:00Z' } });
  const order = command({ payload: { solo_trabajos: true, trabajos_crear: [work] } });
  const original = plain(order), state = prepare(h, order);
  h.process(state);
  assert.equal(h.sheet.getRange(3, 9).getDisplayValue(), '12/05/2026');
  assert.equal(h.sheet.getRange(3, 10).getDisplayValue(), '19/10/2026');
  assert.equal(h.sheet.getRange(3, 11).getDisplayValue(), '19/10/2026');
  assert.deepEqual(order, original);
  const authorization = h.httpCalls.find(call => call.method === 'authorize');
  assert.deepEqual(authorization.body.payload.orden.payload, original.payload,
    'The authorization keeps the original payload and its contextual date, not a rewritten copy');
  assert.equal(state.confirmados, 1);
  assert.equal(h.httpCalls.filter(call => call.method === 'ack_execution').length, 1);
  const before = h.snapshot();
  h.restart(); h.clearEvents(); h.process(h.load());
  assert.deepEqual(h.snapshot(), before);
  assert.deepEqual(h.effects, []);
  assert.deepEqual(h.httpCalls, []);
});

test('a matching manual origin is reused even when the old contextual date is different', () => {
  const h = createExecutorHarness({ rows: [HEADERS, workRow({ 9: '12/05/2026' })] });
  const work = workPayload({ fecha_necesidad_origen: '2026-05-12', fecha_necesidad: '2026-10-19',
    procedencia_fecha_necesidad: 'manteniment' });
  const order = command({ payload: { solo_trabajos: true, trabajos_crear: [work] } });
  const state = prepare(h, order);
  h.process(state);
  assert.equal(h.sheet.getLastRow(), 2);
  assert.equal(h.sheet.getRange(2, 9).getDisplayValue(), '12/05/2026');
  assert.ok(!h.effects.some(event => event.method === 'insertRowAfter'));
  assert.equal(state.confirmados, 1);
});

test('the importer carries an explicit manual workshop unchanged before a designation rule', () => {
  const h = createExecutorHarness();
  const values = [HEADERS, workRow({ 5: '', 6: 'TALLER MANUAL DE PRUEBA', 7: 'MECANICA', 8: 'RT' })];
  const backgrounds = values.map(() => ['#ffffff']);
  const result = plain(h.call('metrogestionLeerTrabajos_', values, values.map(() => ['']),
    backgrounds, backgrounds, '2026-12-31', backgrounds));
  assert.equal(result.length, 1);
  assert.equal(result[0].taller, 'TALLER MANUAL DE PRUEBA');
  assert.equal(result[0].fecha_necesidad, '2026-10-01');
  assert.equal(Object.hasOwn(result[0], 'fecha_programada_visita'), false,
    'An imported origin date must not create an agenda value');
});
