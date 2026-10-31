import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  createExecutorHarness, defaultResponse, HEADERS, IDS, PROTOCOL,
  command, paradaRow, workPayload, workRow, scopeOf,
} from './helpers/alpha75-sync-executor-harness.mjs';

// Complement the independent adversarial suite with storage boundaries,
// complete source snapshots, readback failures and strict ACK correlation.
const copy = value => JSON.parse(JSON.stringify(value));
const journal = h => Object.entries(h.properties)
  .filter(([key]) => key.startsWith('METROGESTION_ORDEN_V1:')).map(([, value]) => JSON.parse(value));
function prepare(h, orders) {
  h.call('metrogestionGuardarAlcanceOrdenes_', orders.map(scopeOf));
  const state = h.newState(orders);
  h.save(state); h.clearEvents();
  return state;
}
const noEffects = h => assert.deepEqual(h.effects, []);

test('manual scope of 200 exact references survives fragmented storage and a fresh VM', () => {
  const h = createExecutorHarness();
  const refs = Array.from({ length: 200 }, (_, index) => ({ tipo: index % 2 ? 'trabajos' : 'parada',
    sync_id: `10000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    revision: index + 1, payload_sha256: createHash('sha256').update(`synthetic-${index}`).digest('hex') }));
  h.call('metrogestionGuardarAlcanceOrdenes_', refs);
  const manifest = JSON.parse(h.properties.METROGESTION_ALCANCE_ORDENES_V1);
  assert.ok(manifest.partes > 1);
  h.restart();
  assert.deepEqual(copy(h.call('metrogestionLeerAlcanceOrdenes_')), refs);
  noEffects(h);
  assert.equal(h.httpCalls.length, 0);
});

test('an interrupted scope replacement leaves the previously published exact selection readable', () => {
  const h = createExecutorHarness(), first = scopeOf(command()), second = scopeOf(command({ revision: 8 }));
  h.call('metrogestionGuardarAlcanceOrdenes_', [first]);
  h.fault(event => event.kind === 'property' && event.key === 'METROGESTION_ALCANCE_ORDENES_V1', { timing: 'before' });
  assert.throws(() => h.call('metrogestionGuardarAlcanceOrdenes_', [second]), /Synthetic platform failure/);
  h.restart();
  assert.deepEqual(copy(h.call('metrogestionLeerAlcanceOrdenes_')), [first]);
  noEffects(h);
});

test('complete sync photos retain both vehicles, stops, works and pending lines under a one-order selection', () => {
  const first = command(), second = command({ sync_id: IDS.otherStop, payload: { sync_id: IDS.otherStop,
    dfm: 'TEST-DFM-02', numero_parada: 'PA-910002' } });
  const h = createExecutorHarness({ rows: [HEADERS,
    paradaRow({ 5: '', 7: '', 8: 'ALTA', 17: 'TEST-VIN-01' }),
    paradaRow({ 1: 'TEST-DFM-02', 2: 'TEST5678', 5: '', 7: '', 8: 'ALTA', 17: 'TEST-VIN-02' }),
    paradaRow(), paradaRow({ 1: 'TEST-DFM-02', 2: 'TEST5678', 5: 'PA-910002' }),
    workRow({ 5: '' }), workRow({ 1: 'TEST-DFM-02', 2: 'TEST5678', 5: '' })],
  cells: { '4,1': { note: `METROGESTION_PARADA:${IDS.stop}` },
    '5,1': { note: `METROGESTION_PARADA:${IDS.otherStop}` } },
  http: (body, world) => body.action ? defaultResponse(body, world)
    : { ok: true, resultado: { comandos_manteniment: [first, second] } } });
  h.call('metrogestionGuardarAlcanceOrdenes_', [scopeOf(first)]);
  h.clearEvents();
  h.call('metrogestionEjecutarSincronizacion_', 'manual');
  const payload = h.httpCalls[0].body.payload;
  assert.equal(payload.version_ejecucion, PROTOCOL);
  assert.deepEqual(payload.filas.map(row => row.dfm), ['TEST-DFM-01', 'TEST-DFM-02']);
  assert.deepEqual(payload.paradas.map(row => row.sync_id).sort(), [IDS.stop, IDS.otherStop]);
  assert.deepEqual([...new Set(payload.trabajos.map(row => row.dfm))].sort(), ['TEST-DFM-01', 'TEST-DFM-02']);
  assert.deepEqual([...new Set(payload.pendientes.map(row => row.dfm))].sort(), ['TEST-DFM-01', 'TEST-DFM-02']);
  assert.equal(payload.checksum, createHash('sha256').update(JSON.stringify({ filas: payload.filas,
    paradas: payload.paradas, cierres_facturacion: payload.cierres_facturacion,
    trabajos: payload.trabajos, pendientes: payload.pendientes })).digest('hex'));
  assert.equal(h.load().comandos.length, 1);
  assert.equal(h.load().comandos[0].sync_id, first.sync_id);
  assert.equal(h.call('metrogestionLeerEntregasConservadas_').length, 2);
  noEffects(h);
});

test('new work with ISO dates but a departure before arrival is rejected before authorization or effects', () => {
  const h = createExecutorHarness(), order = command({ payload: { trabajos_crear: [workPayload({
    fecha_entrada: '2026-10-20', fecha_salida: '2026-10-19' })] } });
  const state = prepare(h, [order]), before = h.snapshot();
  assert.throws(() => h.process(state), /salida.*anterior/i);
  assert.deepEqual(h.snapshot(), before);
  noEffects(h); assert.equal(h.httpCalls.length, 0);
});

test('authorization accepts JSONB key order while preserving the exact array order and reference values', () => {
  const h = createExecutorHarness({ http: (body, world) => {
    const response = defaultResponse(body, world);
    if (body.action === 'authorize') response.autorizacion.alcance = response.autorizacion.alcance.map(ref => ({
      tipo: ref.tipo, revision: ref.revision, sync_id: ref.sync_id, payload_sha256: ref.payload_sha256 }));
    return response;
  } });
  const state = prepare(h, [command()]);
  h.process(state);
  assert.equal(state.confirmados, 1);
  assert.deepEqual(h.httpCalls.map(call => call.method), ['authorize', 'ack_execution']);
});

test('a native FilterCriteria color changed during authorize invalidates the plan before removing the filter', () => {
  const h = createExecutorHarness({ filter: true });
  let color = '#ffffff';
  const criterion = { getCriteriaType: () => null, getCriteriaValues: () => [], getHiddenValues: () => [], getVisibleValues: () => [],
    getVisibleBackgroundColor: () => ({ asRgbColor: () => ({ asHexString: () => color }) }),
    getVisibleForegroundColor: () => null };
  h.sheet.getFilter().getColumnFilterCriteria = column => column === 8 ? criterion : null;
  h.setHttp((body, world) => {
    const response = defaultResponse(body, world);
    if (body.action === 'authorize') color = '#ffff00';
    return response;
  });
  const state = prepare(h, [command()]);
  assert.throws(() => h.process(state), /cambió durante la autorización/);
  noEffects(h);
  assert.deepEqual(h.httpCalls.map(call => call.method), ['authorize']);
});

test('failure before durable intent persistence never reaches a first Sheet or Drive effect', () => {
  const h = createExecutorHarness(), order = command({ payload: { fecha_k: '2026-10-28' } });
  const state = prepare(h, [order]);
  h.fault(event => event.kind === 'property' && event.key?.startsWith('METROGESTION_ORDEN_V1:'), { timing: 'before' });
  assert.throws(() => h.process(state), /Synthetic platform failure/);
  noEffects(h); assert.deepEqual(journal(h), []);
  assert.deepEqual(h.httpCalls.map(call => call.method), ['authorize']);
  const firstNonce = h.httpCalls[0].body.payload.request_id;
  h.restart(); h.clearEvents(); h.process(h.load());
  assert.deepEqual(h.httpCalls.map(call => call.method), ['authorize', 'ack_execution']);
  assert.notEqual(h.httpCalls[0].body.payload.request_id, firstNonce);
});

test('failure after durable intent persistence cannot replay even if no Sheet effect has happened', () => {
  const h = createExecutorHarness(), state = prepare(h, [command()]);
  h.fault(event => event.kind === 'property' && event.key?.startsWith('METROGESTION_ORDEN_V1:'), { timing: 'after', crash: true });
  assert.throws(() => h.process(state));
  noEffects(h); assert.equal(journal(h)[0].estado, 'aplicando');
  h.restart(); h.clearEvents();
  assert.throws(() => h.process(h.load()), /incierto|pendiente/i);
  noEffects(h); assert.equal(h.httpCalls.length, 0);
});

test('a Drive folder creation interrupted after its effect preserves intent and never creates a duplicate on restart', () => {
  const h = createExecutorHarness(), state = prepare(h, [command({ payload: { fecha_k: '2026-10-28' } })]);
  h.fault(event => event.kind === 'drive' && event.method === 'createFolder', { timing: 'after', crash: true });
  assert.throws(() => h.process(state), /incierto/i);
  assert.equal(h.effects.filter(event => event.kind === 'drive').length, 1);
  assert.equal(journal(h)[0].estado, 'aplicando');
  const before = h.snapshot();
  h.restart(); h.clearEvents();
  assert.throws(() => h.process(h.load()), /incierto|pendiente/i);
  assert.deepEqual(h.snapshot(), before);
  noEffects(h); assert.equal(h.httpCalls.length, 0);
});

test('readback disagreement latches uncertainty and cannot yield an ACK', () => {
  const h = createExecutorHarness(), state = prepare(h, [command({ payload: { fecha_k: '2026-10-28' } })]);
  let changed = false;
  h.fault(event => {
    if (event.kind === 'flush' && !changed) { changed = true; h.externalEdit(2, 11, { value: '29/10/2026' }); }
    return false;
  }, { timing: 'after' });
  assert.throws(() => h.process(state), /incierto/i);
  assert.equal(journal(h)[0].estado, 'incierto');
  assert.deepEqual(h.httpCalls.map(call => call.method), ['authorize']);
  h.restart(); h.clearEvents();
  assert.throws(() => h.process(h.load()), /incierto|pendiente/i);
  noEffects(h); assert.equal(h.httpCalls.length, 0);
});

for (const [label, alter] of [
  ['legacy ok without correlated confirmation', () => ({ ok: true })],
  ['an ACK for another request', response => ({ ...response, confirmacion: { ...response.confirmacion, request_id: IDS.otherStop } })],
  ['an ACK with an unexpected top-level field', response => ({ ...response, permiso: true })],
]) {
  test(`${label} retains the applied receipt and the next attempt sends only the exact ACK`, () => {
    const h = createExecutorHarness({ http: (body, world) => body.action === 'ack_execution'
      ? alter(defaultResponse(body, world)) : defaultResponse(body, world) });
    const state = prepare(h, [command({ payload: { fecha_k: '2026-10-28' } })]);
    assert.throws(() => h.process(state), /acuse/i);
    assert.equal(journal(h)[0].estado, 'aplicado');
    assert.equal(h.load().confirmados, 0);
    const originalAck = copy(h.httpCalls.find(call => call.method === 'ack_execution').body.payload.confirmacion);
    const after = h.snapshot();
    h.setHttp(defaultResponse); h.restart(); h.clearEvents();
    h.process(h.load());
    assert.deepEqual(h.httpCalls.map(call => call.method), ['ack_execution']);
    assert.deepEqual(h.httpCalls[0].body.payload.confirmacion, originalAck);
    assert.deepEqual(h.snapshot(), after);
    noEffects(h);
    assert.equal(journal(h)[0].estado, 'confirmado');
  });
}

test('a changed post-application photograph blocks even ACK-only recovery without replaying mutations', () => {
  const h = createExecutorHarness({ http: (body, world) => {
    if (body.action === 'ack_execution') throw new Error('Synthetic lost ACK');
    return defaultResponse(body, world);
  } });
  const state = prepare(h, [command()]);
  assert.throws(() => h.process(state), /respuesta verificable/i);
  assert.equal(journal(h)[0].estado, 'aplicado');
  h.externalEdit(2, 13, { value: 'Comentario manual posterior' });
  h.restart(); h.clearEvents(); h.setHttp(defaultResponse);
  assert.throws(() => h.process(h.load()), /cambió después/i);
  noEffects(h); assert.equal(h.httpCalls.length, 0);
});

test('failure persisting a received batch leaves an uncertain request, never requests redelivery on retry', () => {
  const order = command(), h = createExecutorHarness({ http: () => ({ ok: true, resultado: { comandos_manteniment: [order] } }) });
  h.call('metrogestionGuardarAlcanceOrdenes_', [scopeOf(order)]); h.clearEvents();
  h.fault(event => event.kind === 'property' && /^METROGESTION_ENTREGA_V1:[0-9a-f-]{36}$/.test(event.key || ''), { timing: 'before' });
  assert.throws(() => h.call('metrogestionEjecutarSincronizacion_', 'manual'), /Synthetic platform failure/);
  assert.ok(h.properties.METROGESTION_SOLICITUD_ENTREGA_V1);
  assert.equal(h.httpCalls.length, 1); noEffects(h);
  h.restart(); h.clearEvents();
  assert.throws(() => h.call('metrogestionEjecutarSincronizacion_', 'manual'), /entrega.*incierto/i);
  assert.equal(h.httpCalls.length, 0); noEffects(h);
});

test('crash after publishing the complete inbox batch preserves its exact unselected order across restart', () => {
  const order = command(), second = command({ revision: 8 });
  let round = 0;
  const h = createExecutorHarness({ http: () => ({ ok: true, resultado: { comandos_manteniment: round++ ? [] : [order, second] } }) });
  h.call('metrogestionGuardarAlcanceOrdenes_', [scopeOf(order)]); h.clearEvents();
  h.fault(event => event.kind === 'property' && /^METROGESTION_ENTREGA_V1:[0-9a-f-]{36}$/.test(event.key || ''), { timing: 'after', crash: true });
  assert.throws(() => h.call('metrogestionEjecutarSincronizacion_', 'manual'));
  h.restart(); h.clearEvents();
  h.call('metrogestionEjecutarSincronizacion_', 'manual');
  assert.equal(h.call('metrogestionLeerEntregasConservadas_').length, 2);
  assert.deepEqual(copy(h.load().comandos), [order]);
  assert.equal(h.properties.METROGESTION_SOLICITUD_ENTREGA_V1, undefined);
  noEffects(h);
});
