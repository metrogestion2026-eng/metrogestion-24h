import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createExecutorHarness, defaultResponse, HEADERS, IDS, PROTOCOL,
  command, paradaRow, workPayload, workRow, scopeOf,
} from './helpers/alpha75-sync-executor-harness.mjs';

// This suite runs every product function from the distributed .gs unchanged.
// Synthetic Sheets/Drive/HTTP provide an observable platform, not writer mocks.
// A terminated execution stops all subsequent platform effects, including JS
// finally blocks. Restart creates a fresh VM over the SAME durable properties
// and sheet, as Apps Script does between executions.
const stopNote = id => `Nota humana de prueba\nMETROGESTION_PARADA:${id}`;
const workNote = id => `Nota humana de prueba\nMETROGESTION_T:${id}`;
const fixture = options => {
  const h = createExecutorHarness({ rows: [HEADERS, paradaRow()], cells: { '2,1': { note: stopNote(IDS.stop) } }, ...options });
  for (const name of ['metrogestionPlanificarOrdenCompleta_', 'metrogestionGuardarAlcanceOrdenes_'])
    assert.equal(typeof h.context[name], 'function', `The distributed candidate must implement ${name}`);
  return h;
};
const copy = value => JSON.parse(JSON.stringify(value));
const journal = h => Object.entries(h.properties)
  .filter(([key]) => key.startsWith('METROGESTION_ORDEN_V1:'))
  .map(([key, value]) => ({ key, value: JSON.parse(value) }));
const select = (h, orders) => h.call('metrogestionGuardarAlcanceOrdenes_', orders.map(scopeOf));
const prepare = (h, orders) => {
  select(h, orders);
  const state = h.newState(orders);
  h.save(state);
  h.clearEvents();
  return state;
};
const noSheetEffects = h => assert.deepEqual(h.effects, [], 'No sheet, filter, Drive or trigger effect is allowed');
function rejectsWithoutEffects(h, fn) {
  const before = h.snapshot();
  let caught;
  assert.throws(fn, error => {
    caught = error;
    assert.doesNotMatch(error.message, /not expose|is not a function|not defined|Unsupported synthetic|Invalid synthetic|dimensions|Unexpected synthetic/i,
      'An incomplete platform fixture must not be mistaken for a successful business guard');
    return true;
  });
  noSheetEffects(h);
  assert.deepEqual(h.snapshot(), before);
  assert.equal(h.httpCalls.filter(c => ['ack', 'ack_execution'].includes(c.method)).length, 0);
  return caught;
}
const plan = (h, order) => h.call('metrogestionPlanificarOrdenCompleta_', h.sheet, order);

test('full-order planning is read-only even when insertion, notes and archive links are needed', () => {
  const h = fixture({ rows: [HEADERS, paradaRow({ 5: '', 7: '', 8: 'ALTA', 17: '' })], cells: {} });
  const before = h.snapshot();
  const planned = plan(h, command({ payload: { trabajos_crear: [workPayload()] } }));
  assert.ok(planned);
  assert.deepEqual(h.snapshot(), before);
  noSheetEffects(h);
  assert.deepEqual(h.httpCalls, []);
});

test('a foreign PARADA UUID cannot be replaced through the same DFM/PA fallback', () => {
  const h = fixture({ cells: { '2,1': { note: stopNote(IDS.otherStop) } } });
  rejectsWithoutEffects(h, () => plan(h, command()));
});

test('a matching PARADA UUID cannot authorize a different DFM or PA', () => {
  for (const patch of [{ 1: 'TEST-DFM-02' }, { 5: 'PA-910002' }]) {
    const h = fixture({ rows: [HEADERS, paradaRow(patch)] });
    rejectsWithoutEffects(h, () => plan(h, command()));
  }
});

test('several PARADA technical UUIDs in one note are an identity conflict', () => {
  const h = fixture({ cells: { '2,1': { note: stopNote(IDS.stop) + `\nMETROGESTION_PARADA:${IDS.otherStop}` } } });
  rejectsWithoutEffects(h, () => plan(h, command()));
});

test('duplicate PARADA identities within one period never pick the first row', () => {
  const h = fixture({ rows: [HEADERS, paradaRow(), paradaRow()], cells: {
    '2,1': { note: stopNote(IDS.stop) }, '3,1': { note: stopNote(IDS.stop) },
  } });
  rejectsWithoutEffects(h, () => plan(h, command()));
});

for (const manualStop of ['P-910001', 'PA-910009']) {
  test(`unlinked manual PARADA ${manualStop} with the same DFM/date requires review, not a duplicate`, () => {
    const h = fixture({ rows: [HEADERS, paradaRow({ 5: manualStop })], cells: {} });
    rejectsWithoutEffects(h, () => plan(h, command()));
    assert.equal(h.sheet.getLastRow(), 2);
  });
}

test('a previous period remains open when the destination has a later manual conflict', () => {
  const h = fixture({ rows: [HEADERS, paradaRow({ 17: 'TANCAMENT 1' }), paradaRow({ 7: 'MANUAL-DIFFERENT' })],
    cells: { '2,1': { note: stopNote(IDS.stop) }, '3,1': { note: stopNote(IDS.stop) } }, filter: true });
  const order = command({ payload: { cierre_periodo_anterior: { tancament: 'TANCAMENT 1', fecha_k: '2026-09-30' } } });
  const state = prepare(h, [order]);
  rejectsWithoutEffects(h, () => h.process(state));
  assert.equal(h.sheet.getRange(2, 11).getDisplayValue(), '');
  assert.equal(state.confirmados, 0);
});

test('a foreign UUID in the previous period cannot be closed through DFM/PA fallback', () => {
  const h = fixture({ rows: [HEADERS, paradaRow({ 17: 'TANCAMENT 1' }), paradaRow()],
    cells: { '2,1': { note: stopNote(IDS.otherStop) }, '3,1': { note: stopNote(IDS.stop) } } });
  rejectsWithoutEffects(h, () => plan(h, command({ payload: {
    cierre_periodo_anterior: { tancament: 'TANCAMENT 1', fecha_k: '2026-09-30' },
  } })));
});

test('a work conflict later in one order cannot leave a PARADA recovery or note applied', () => {
  const h = fixture();
  const state = prepare(h, [command({ payload: { fecha_k: '2026-10-29', trabajos_crear: [workPayload({ trabajo_sync_id: 'invalid' })] } })]);
  rejectsWithoutEffects(h, () => h.process(state));
  assert.equal(h.sheet.getRange(2, 11).getDisplayValue(), '');
});

test('a later invalid new work cannot leave the earlier new work inserted or linked', () => {
  const h = fixture();
  rejectsWithoutEffects(h, () => plan(h, command({ payload: { solo_trabajos: true, trabajos_crear: [
    workPayload(), workPayload({ trabajo_sync_id: 'invalid', designacion: 'OTHER TEST WORK' }),
  ] } })));
  assert.equal(h.sheet.getLastRow(), 2);
});

test('an existing work UUID must also match business identity and PA', () => {
  for (const patch of [{ 1: 'FOREIGN-DFM' }, { 2: 'FOREIGN123' }, { 5: 'PA-910099' }, { 8: 'FOREIGN WORK' }, { 9: '02/10/2026' }]) {
    const h = fixture({ rows: [HEADERS, paradaRow(), workRow(patch)], cells: {
      '2,1': { note: stopNote(IDS.stop) }, '3,5': { note: workNote(IDS.work) },
    } });
    rejectsWithoutEffects(h, () => plan(h, command({ payload: { solo_trabajos: true, trabajos_crear: [workPayload()] } })));
  }
});

test('a work UUID duplicated across rows is ambiguous even when one row has the expected identity', () => {
  const h = fixture({ rows: [HEADERS, paradaRow(), workRow(), workRow({ 1: 'FOREIGN-DFM' })], cells: {
    '2,1': { note: stopNote(IDS.stop) }, '3,5': { note: workNote(IDS.work) }, '4,5': { note: workNote(IDS.work) },
  } });
  rejectsWithoutEffects(h, () => plan(h, command({ payload: { solo_trabajos: true, trabajos_crear: [workPayload()] } })));
});

test('a work row with two technical UUIDs cannot silently adopt either identity', () => {
  const h = fixture({ rows: [HEADERS, paradaRow(), workRow()], cells: {
    '3,5': { note: workNote(IDS.work) + `\nMETROGESTION_T:${IDS.otherWork}` },
  } });
  rejectsWithoutEffects(h, () => plan(h, command({ payload: { solo_trabajos: true, trabajos_crear: [workPayload()] } })));
});

test('a matching unlinked work identity cannot overwrite an existing foreign technical UUID', () => {
  const h = fixture({ rows: [HEADERS, paradaRow(), workRow()], cells: { '3,5': { note: workNote(IDS.otherWork) } } });
  rejectsWithoutEffects(h, () => plan(h, command({ payload: { solo_trabajos: true, trabajos_crear: [workPayload()] } })));
});

test('duplicate work identifiers in one payload are rejected before any effect', () => {
  const h = fixture();
  rejectsWithoutEffects(h, () => plan(h, command({ payload: { solo_trabajos: true, trabajos_crear: [
    workPayload(), workPayload({ designacion: 'DIFFERENT WORK' }),
  ] } })));
});

test('assignment cannot bind an identifier that already appears on a foreign work row', () => {
  const h = fixture({ rows: [HEADERS, paradaRow(), workRow({ 1: 'FOREIGN-DFM', 5: 'PA-910099' }), workRow({ 5: '' })],
    cells: { '3,5': { note: workNote(IDS.work) } } });
  const key = h.call('metrogestionClaveTrabajoPayload_', workPayload());
  rejectsWithoutEffects(h, () => plan(h, command({ payload: { solo_trabajos: true,
    trabajos_asignados: [{ trabajo_sync_id: IDS.work, clave_fila: key, fecha_entrada: '2026-10-29' }],
  } })));
});

test('a valid current queue still requires fresh authorization for the exact selected order', () => {
  const h = fixture();
  const order = command({ payload: { fecha_k: '2026-10-29' } });
  const state = prepare(h, [order]);
  h.process(state);
  assert.equal(state.confirmados, 1);
  assert.deepEqual(h.httpCalls.map(c => c.method), ['authorize', 'ack_execution']);
  const request = h.httpCalls[0].body.payload;
  assert.equal(request.version_ejecucion, PROTOCOL);
  assert.equal(request.escritura_segura_manual, true);
  assert.deepEqual(copy(request.alcance), [scopeOf(order)]);
  assert.deepEqual(copy(request.orden.payload), order.payload);
  assert.equal(request.orden.payload_sha256, order.payload_sha256);
  assert.match(request.request_id, /^[0-9a-f-]{36}$/i);
  assert.equal(h.sheet.getRange(2, 11).getDisplayValue(), '29/10/2026');
  assert.ok(h.effects.length > 0);
});

test('a valid work-only order can create a real synthetic row and acknowledge its exact identity', () => {
  const h = fixture();
  const order = command({ payload: { solo_trabajos: true, trabajos_crear: [workPayload()] } });
  const state = prepare(h, [order]);
  h.process(state);
  assert.equal(state.confirmados, 1);
  assert.equal(h.sheet.getLastRow(), 3);
  assert.equal(h.sheet.getRange(3, 1).getDisplayValue(), order.payload.trabajos_crear[0].dfm);
  assert.match(h.sheet.getRange(3, 5).getNote(), new RegExp(IDS.work));
  const confirmation = h.httpCalls.find(c => c.method === 'ack_execution').body.payload.confirmacion;
  assert.deepEqual(scopeOf(confirmation), scopeOf(order));
  assert.equal(confirmation.trabajos_creados.length, 1);
  assert.equal(confirmation.trabajos_creados[0].trabajo_sync_id, IDS.work);
  assert.deepEqual(copy(h.httpCalls.find(c => c.method === 'authorize').body.payload.orden.payload), order.payload,
    'DFM derived for local validation must never alter the delivered authorization payload');
});

test('a pure work envelope with contradictory DFM identities cannot derive an arbitrary vehicle', () => {
  const h = fixture();
  const foreign = workPayload({ trabajo_sync_id: IDS.otherWork, dfm: 'TEST-DFM-02', numero_parada: 'PA-910001', designacion: 'SECOND TEST WORK' });
  rejectsWithoutEffects(h, () => plan(h, command({ payload: { solo_trabajos: true, trabajos_crear: [workPayload(), foreign] } })));
});

test('a pure work envelope cannot smuggle PARADA fields into the delivered work-only contract', () => {
  const h = fixture();
  rejectsWithoutEffects(h, () => plan(h, command({ payload: { solo_trabajos: true,
    fecha_k: '2026-10-29', dfm: 'TEST-DFM-01', trabajos_crear: [workPayload()],
  } })));
});

test('a valid period rollover can close the prior segment and create the new one', () => {
  const h = fixture({ rows: [HEADERS, paradaRow({ 17: 'TANCAMENT 1' })] });
  const order = command({ payload: { cierre_periodo_anterior: { tancament: 'TANCAMENT 1', fecha_k: '2026-09-30' } } });
  const state = prepare(h, [order]);
  h.process(state);
  assert.equal(state.confirmados, 1);
  assert.equal(h.sheet.getLastRow(), 3);
  assert.equal(h.sheet.getRange(2, 11).getDisplayValue(), '30/09/2026');
  assert.equal(h.sheet.getRange(3, 17).getDisplayValue(), 'TANCAMENT 2');
  assert.match(h.sheet.getRange(3, 1).getNote(), new RegExp(IDS.stop));
});

test('authorization denied for a cached order leaves sheet, filter, Drive and queue untouched', () => {
  const h = fixture({ filter: true });
  const order = command({ payload: { fecha_k: '2026-10-29' } });
  const state = prepare(h, [order]);
  h.setHttp((body, world) => {
    const response = defaultResponse(body, world);
    response.autorizacion.autorizada = false;
    response.autorizacion.motivo = 'ORDEN_NO_VIGENTE';
    response.autorizacion.expira_en = response.autorizacion.autorizado_en;
    return response;
  });
  rejectsWithoutEffects(h, () => h.process(state));
  assert.deepEqual(h.httpCalls.map(c => c.method), ['authorize']);
  assert.equal(state.confirmados, 0);
  assert.deepEqual(copy(state.comandos), [order]);
});

test('absence of an explicitly stored scope cannot inherit the cached queue as permission', () => {
  const h = fixture({ filter: true });
  const state = h.newState([command({ payload: { fecha_k: '2026-10-29' } })]);
  h.save(state);
  h.clearEvents();
  rejectsWithoutEffects(h, () => h.process(state));
  assert.equal(h.httpCalls.length, 0);
});

for (const [name, mutate] of [
  ['another order type', o => { o.tipo = 'trabajos'; }],
  ['another UUID', o => { o.sync_id = IDS.otherStop; }],
  ['a newer revision', o => { o.revision++; }],
  ['a changed payload fingerprint', o => { o.payload_sha256 = 'a'.repeat(64); }],
]) {
  test(`an explicit scope never expands to ${name} from the cached queue`, () => {
    const h = fixture();
    const selected = command();
    select(h, [selected]);
    const queued = copy(selected); mutate(queued);
    const state = h.newState([queued]); h.save(state); h.clearEvents();
    rejectsWithoutEffects(h, () => h.process(state));
    assert.equal(h.httpCalls.length, 0);
  });
}

test('payload tampering with the old hash is sent to the read-only authority and cannot write on denial', () => {
  const h = fixture();
  const selected = command();
  const state = prepare(h, [selected]);
  state.comandos[0].payload.detalle = 'Tampered after delivery';
  h.setHttp((body, world) => {
    assert.notDeepEqual(body.payload.orden.payload, selected.payload);
    const response = defaultResponse(body, world);
    response.autorizacion.autorizada = false;
    response.autorizacion.motivo = 'ORDEN_NO_COINCIDE';
    response.autorizacion.expira_en = response.autorizacion.autorizado_en;
    return response;
  });
  rejectsWithoutEffects(h, () => h.process(state));
  assert.deepEqual(h.httpCalls.map(c => c.method), ['authorize']);
});

for (const [name, mutate] of [
  ['nonce', a => { a.request_id = IDS.otherStop; }],
  ['spreadsheet', a => { a.spreadsheet_id = 'another-spreadsheet'; }],
  ['UUID', a => { a.orden.sync_id = IDS.otherStop; }],
  ['revision', a => { a.orden.revision++; }],
  ['hash', a => { a.orden.payload_sha256 = 'b'.repeat(64); }],
  ['protocol', a => { a.protocolo = 'unknown'; }],
  ['read-only flag', a => { a.solo_lectura = false; }],
  ['scope echo', a => { a.alcance[0].revision++; }],
  ['script version', a => { a.version_script = 'alpha75-obsolete'; }],
  ['expiry', a => { a.expira_en = new Date(Date.now() - 1000).toISOString(); }],
]) {
  test(`a mismatched authorization ${name} cannot enable any effect`, () => {
    const h = fixture({ filter: true });
    const state = prepare(h, [command({ payload: { fecha_k: '2026-10-29' } })]);
    h.setHttp((body, world) => { const response = defaultResponse(body, world); mutate(response.autorizacion); return response; });
    rejectsWithoutEffects(h, () => h.process(state));
  });
}

test('a lost authorization response has no effects and the next attempt obtains a fresh nonce', () => {
  const h = fixture();
  const state = prepare(h, [command({ payload: { fecha_k: '2026-10-29' } })]);
  let first = true;
  h.setHttp((body, world) => {
    if (first && body.action === 'authorize') { first = false; throw new Error('Synthetic authorization response lost'); }
    return defaultResponse(body, world);
  });
  rejectsWithoutEffects(h, () => h.process(state));
  const nonce = h.httpCalls[0].body.payload.request_id;
  h.restart();
  h.process(h.load());
  assert.equal(h.httpCalls.filter(c => c.method === 'authorize').length, 2);
  assert.notEqual(h.httpCalls.filter(c => c.method === 'authorize')[1].body.payload.request_id, nonce);
});

test('a changed sheet after authorization is detected before the first commit effect', () => {
  const h = fixture({ filter: true });
  const order = command({ payload: { fecha_k: '2026-10-29' } });
  const state = prepare(h, [order]);
  h.setHttp((body, world) => {
    if (body.action === 'authorize') h.externalEdit(2, 7, { value: 'CONCURRENT-MANUAL' });
    return defaultResponse(body, world);
  });
  assert.throws(() => h.process(state));
  noSheetEffects(h);
  assert.equal(h.sheet.getRange(2, 7).getDisplayValue(), 'CONCURRENT-MANUAL');
  assert.equal(h.sheet.getRange(2, 11).getDisplayValue(), '');
  assert.equal(h.httpCalls.some(c => c.method === 'ack_execution'), false);
});

test('a changed effective formula value after authorization invalidates the PRE snapshot even with identical formula text', () => {
  const h = fixture({ cells: { '2,1': { note: stopNote(IDS.stop) }, '2,12': { value: 2, display: '2', formula: '=1+1' } } });
  const order = command({ payload: { fecha_k: '2026-10-29', dias_parada: 2 } });
  const state = prepare(h, [order]);
  h.setHttp((body, world) => {
    if (body.action === 'authorize') h.externalEdit(2, 12, { value: 3, display: '3' });
    return defaultResponse(body, world);
  });
  assert.throws(() => h.process(state));
  noSheetEffects(h);
  assert.equal(h.sheet.getRange(2, 12).getFormula(), '=1+1');
  assert.equal(h.sheet.getRange(2, 12).getValue(), 3);
  assert.equal(h.sheet.getRange(2, 11).getDisplayValue(), '');
  assert.equal(h.httpCalls.some(c => c.method === 'ack_execution'), false);
});

test('an oversized predicted applied receipt is rejected before the first effect', () => {
  const h = fixture();
  const works = Array.from({ length: 16 }, (_, i) => workPayload({
    trabajo_sync_id: `20000000-0000-4000-8000-${String(i + 100).padStart(12, '0')}`,
    designacion: `TEST ${i} ${'X'.repeat(650)}`,
  }));
  const order = command({ payload: { solo_trabajos: true, trabajos_crear: works } });
  const state = prepare(h, [order]);
  const error = rejectsWithoutEffects(h, () => h.process(state));
  assert.match(error.message, /recibo|durable|tamaño/i);
  assert.equal(h.sheet.getLastRow(), 2);
  assert.equal(state.confirmados, 0);
});

test('order 1 remains confirmed when order 2 fails; order 2 cannot mutate or be acknowledged', () => {
  const h = fixture({ rows: [HEADERS, paradaRow(), paradaRow({ 1: 'TEST-DFM-02', 5: 'PA-910002', 7: 'MANUAL-DIFFERENT' })],
    cells: { '2,1': { note: stopNote(IDS.stop) }, '3,1': { note: stopNote(IDS.otherStop) } }, filter: true });
  const first = command({ payload: { fecha_k: '2026-10-29' } });
  const second = command({ sync_id: IDS.otherStop, payload: { sync_id: IDS.otherStop, dfm: 'TEST-DFM-02', numero_parada: 'PA-910002' } });
  const state = prepare(h, [first, second]);
  h.process(state);
  assert.equal(state.confirmados, 1);
  assert.equal(state.comandos.length, 1);
  assert.equal(state.comandos[0].sync_id, second.sync_id);
  const committed = h.snapshot();
  h.clearEvents();
  assert.throws(() => h.process(state));
  noSheetEffects(h);
  assert.deepEqual(h.snapshot(), committed);
  assert.equal(state.confirmados, 1);
  assert.equal(h.httpCalls.some(c => c.method === 'ack_execution'), false);
});

test('a lost ACK response retries only the durable receipt with a new nonce, never the writes', () => {
  const h = fixture();
  const order = command({ payload: { fecha_k: '2026-10-29' } });
  const state = prepare(h, [order]);
  let lost = false;
  h.setHttp((body, world) => {
    if (body.action === 'ack_execution' && !lost) { lost = true; throw new Error('Synthetic ACK applied; response lost'); }
    return defaultResponse(body, world);
  });
  assert.throws(() => h.process(state));
  assert.equal(h.httpCalls.filter(c => c.method === 'ack_execution').length, 1);
  const sent = copy(h.httpCalls.find(c => c.method === 'ack_execution').body.payload);
  assert.ok(journal(h).length);
  const afterWrite = h.snapshot();
  h.restart();
  h.clearEvents();
  const recovered = h.load();
  h.process(recovered);
  noSheetEffects(h);
  assert.deepEqual(h.snapshot(), afterWrite);
  assert.deepEqual(h.httpCalls.map(c => c.method), ['ack_execution']);
  const resent = h.httpCalls[0].body.payload;
  assert.deepEqual(copy(resent.confirmacion), sent.confirmacion);
  assert.notEqual(resent.request_id, sent.request_id);
  assert.equal(recovered.confirmados, 1);
});

test('a crash after the confirmed journal but before advancing the queue cannot replay writes or ACK', () => {
  const h = fixture();
  const state = prepare(h, [command({ payload: { fecha_k: '2026-10-29' } })]);
  h.fault(e => e.kind === 'property' && e.key?.startsWith('METROGESTION_ORDEN_V1:')
    && JSON.parse(e.value).estado === 'confirmado', { crash: true });
  assert.throws(() => h.process(state));
  assert.equal(h.httpCalls.filter(c => c.method === 'ack_execution').length, 1);
  assert.equal(journal(h)[0].value.estado, 'confirmado');
  const committed = h.snapshot();
  h.restart(); h.clearEvents();
  const recovered = h.load();
  h.process(recovered);
  noSheetEffects(h);
  assert.deepEqual(h.httpCalls, []);
  assert.deepEqual(h.snapshot(), committed);
  assert.equal(recovered.confirmados, 1);
  assert.equal(recovered.comandos.length, 0);
  h.process(recovered);
  assert.equal(recovered.confirmados, 1);
});

for (const timing of ['before', 'after']) {
  test(`a crash ${timing} the first sheet effect keeps a durable intent and cannot replay after restart/reset`, () => {
    const h = fixture();
    const order = command({ payload: { fecha_k: '2026-10-29' } });
    const state = prepare(h, [order]);
    h.fault(e => e.kind === 'sheet', { timing, crash: true });
    assert.throws(() => h.process(state));
    assert.equal(h.httpCalls.some(c => c.method === 'ack_execution'), false);
    assert.ok(journal(h).length > 0, 'Intent must be independently durable BEFORE the first sheet write');
    const afterCrash = h.snapshot();
    const durable = copy(journal(h));
    h.restart(); h.clearEvents();
    assert.throws(() => h.process(h.load()));
    noSheetEffects(h);
    assert.deepEqual(h.snapshot(), afterCrash);
    assert.equal(h.httpCalls.some(c => c.method === 'ack_execution'), false);
    // Normal cycle storage and reselecting the same exact scope cannot erase an
    // independently stored uncertain intent or manufacture an applied receipt.
    try { select(h, [order]); } catch { /* refusing to reset the scope is also safe */ }
    const reset = h.newState([order]); h.save(reset); h.clearEvents();
    assert.throws(() => h.process(reset));
    noSheetEffects(h);
    assert.deepEqual(h.snapshot(), afterCrash);
    assert.ok(durable.every(entry => journal(h).some(current => current.key === entry.key)));
    assert.equal(h.httpCalls.some(c => c.method === 'ack_execution'), false);
  });
}

test('a legacy pending confirmation without a new durable applied receipt cannot send ACK', () => {
  const h = fixture();
  const order = command();
  const state = prepare(h, [order]);
  state.version = 'alpha75-legacy';
  delete state.version_ejecucion;
  state.confirmacionPendiente = { tipo: 'parada', sync_id: IDS.stop, revision: order.revision, estado: 'aplicado', fila: 2 };
  h.save(state); h.restart(); h.clearEvents();
  rejectsWithoutEffects(h, () => h.process(h.load()));
});

test('startup with no explicit scope never prepares imports, suspends filters or executes needs', () => {
  const h = fixture({ filter: true, cells: { '2,1': { formula: '=IMPORTRANGE("synthetic-source","A2:Q2")' } } });
  const before = h.snapshot();
  try { h.call('metrogestionEjecutarSincronizacion_', 'manual'); } catch { /* a closed public route may report the missing scope */ }
  noSheetEffects(h);
  assert.deepEqual(h.snapshot(), before);
  assert.equal(h.httpCalls.length, 0);
});

for (const route of ['metrogestionContinuarSincronizacion', 'metrogestionSincronizarProgramada', 'metrogestionReanudarProgramada']) {
  test(`${route} cannot bypass the absent explicit scope using a cached legacy cycle`, () => {
    const h = fixture({ filter: true });
    const state = h.newState([command()]);
    h.save(state);
    if (route === 'metrogestionReanudarProgramada') h.world.properties.set('METROGESTION_PROGRAMADA_CICLO', state.id);
    h.clearEvents();
    const before = h.snapshot();
    try { h.call(route, state.id); } catch { /* a blocked route may report the missing scope */ }
    noSheetEffects(h);
    assert.deepEqual(h.snapshot(), before);
    assert.equal(h.httpCalls.length, 0);
  });
}

test('a selected order scope cannot authorize the legacy automatic needs phase', () => {
  const h = fixture({ filter: true, rows: [HEADERS, paradaRow(), workRow({ 7: 'ITV', 8: 'ITV', 11: '01/10/2026' })] });
  const order = command();
  select(h, [order]);
  const state = h.newState([], { fase: 'necesidades', confirmados: 1, totalComandos: 1 });
  h.save(state); h.clearEvents();
  const before = h.snapshot();
  try { h.call('metrogestionEjecutarSincronizacion_', 'manual', state.id); } catch { /* phase may be explicitly blocked */ }
  noSheetEffects(h);
  assert.deepEqual(h.snapshot(), before);
  assert.equal(h.httpCalls.length, 0);
});

test('public entry retains all delivered orders durably while executing only the explicit scope, without redelivery', () => {
  const h = fixture({ rows: [HEADERS, paradaRow(), paradaRow({ 1: 'TEST-DFM-02', 5: 'PA-910002' })], cells: {
    '2,1': { note: stopNote(IDS.stop) }, '3,1': { note: stopNote(IDS.otherStop) },
  } });
  const first = command({ payload: { fecha_k: '2026-10-29' } });
  const second = command({ sync_id: IDS.otherStop, revision: 9,
    payload: { sync_id: IDS.otherStop, dfm: 'TEST-DFM-02', numero_parada: 'PA-910002', fecha_k: '2026-10-29' } });
  let delivered = false;
  h.setHttp((body, world) => {
    if (!body.action || body.action === 'sync') {
      const orders = delivered ? [] : [first, second];
      delivered = true;
      return { ok: true, resultado: { comandos_manteniment: orders, mensaje: 'Synthetic one-time delivery' } };
    }
    return defaultResponse(body, world);
  });
  select(h, [first]); h.clearEvents();
  const initial = h.call('metrogestionEjecutarSincronizacion_', 'manual');
  noSheetEffects(h);
  assert.deepEqual(copy(h.load().comandos), [first]);
  h.restart();
  h.call('metrogestionContinuarSincronizacion', initial.ciclo);
  assert.equal(h.load().fase, 'terminado');
  assert.equal(h.load().confirmados, 1);
  assert.equal(h.sheet.getRange(2, 11).getDisplayValue(), '29/10/2026');
  assert.equal(h.sheet.getRange(3, 11).getDisplayValue(), '');
  assert.deepEqual(h.httpCalls.filter(c => c.method === 'ack_execution').map(c => c.body.payload.confirmacion.sync_id), [IDS.stop]);
  // No server response will ever contain order 2 again. Selecting it explicitly
  // must recover its COMPLETE durable delivery and obtain current authorization.
  select(h, [second]); h.restart(); h.clearEvents();
  const resumed = h.call('metrogestionEjecutarSincronizacion_', 'manual');
  noSheetEffects(h);
  assert.deepEqual(copy(h.load().comandos), [second]);
  h.restart(); h.clearEvents();
  h.call('metrogestionContinuarSincronizacion', resumed.ciclo);
  assert.deepEqual(h.httpCalls.map(c => c.method), ['authorize', 'ack_execution']);
  assert.deepEqual(copy(h.httpCalls[0].body.payload.orden.payload), second.payload);
  assert.deepEqual(copy(h.httpCalls[0].body.payload.alcance), [scopeOf(second)]);
  assert.equal(h.sheet.getRange(3, 11).getDisplayValue(), '29/10/2026');
  assert.equal(h.load().confirmados, 1);
});

test('a missing selected reference cannot discard the other one-time deliveries in the received response', () => {
  const h = fixture();
  const first = command({ payload: { fecha_k: '2026-10-29' } });
  const absent = command({ sync_id: IDS.otherStop, revision: 99, payload: { sync_id: IDS.otherStop } });
  let delivered = false;
  h.setHttp((body, world) => {
    if (!body.action || body.action === 'sync') {
      const orders = delivered ? [] : [first]; delivered = true;
      return { ok: true, resultado: { comandos_manteniment: orders } };
    }
    return defaultResponse(body, world);
  });
  select(h, [absent]); h.clearEvents();
  rejectsWithoutEffects(h, () => h.call('metrogestionEjecutarSincronizacion_', 'manual'));
  select(h, [first]); h.restart(); h.clearEvents();
  const recovered = h.call('metrogestionEjecutarSincronizacion_', 'manual');
  noSheetEffects(h);
  assert.deepEqual(copy(h.load().comandos), [first]);
  h.call('metrogestionContinuarSincronizacion', recovered.ciclo);
  assert.equal(h.load().confirmados, 1);
  assert.equal(h.sheet.getRange(2, 11).getDisplayValue(), '29/10/2026');
});

test('a one-time sync response lost before client receipt cannot fabricate a delivery, progress or permission', () => {
  const h = fixture();
  select(h, [command()]); h.clearEvents();
  let lost = false;
  h.setHttp(body => {
    assert.ok(!body.action || body.action === 'sync');
    if (!lost) { lost = true; throw new Error('Synthetic sync response lost after server delivery'); }
    return { ok: true, resultado: { comandos_manteniment: [] } };
  });
  rejectsWithoutEffects(h, () => h.call('metrogestionEjecutarSincronizacion_', 'manual'));
  h.restart(); h.clearEvents();
  rejectsWithoutEffects(h, () => h.call('metrogestionEjecutarSincronizacion_', 'manual'));
  assert.ok(!h.load() || h.load().confirmados === 0);
  assert.deepEqual(journal(h), []);
});

test('starting an entirely confirmed scope performs no new sync and consumes no unrelated deliveries', () => {
  const h = fixture();
  const selected = command({ payload: { fecha_k: '2026-10-29' } });
  const unrelated = command({ sync_id: IDS.otherStop, payload: { sync_id: IDS.otherStop } });
  let syncCount = 0;
  h.setHttp((body, world) => {
    if (!body.action || body.action === 'sync') {
      syncCount++;
      return { ok: true, resultado: { comandos_manteniment: syncCount === 1 ? [selected] : [unrelated] } };
    }
    return defaultResponse(body, world);
  });
  select(h, [selected]);
  const initial = h.call('metrogestionEjecutarSincronizacion_', 'manual');
  h.call('metrogestionContinuarSincronizacion', initial.ciclo);
  assert.equal(h.load().fase, 'terminado');
  assert.equal(journal(h)[0].value.estado, 'confirmado');
  h.restart(); h.clearEvents();
  const repeated = h.call('metrogestionEjecutarSincronizacion_', 'manual');
  assert.equal(repeated.pendiente, false);
  assert.deepEqual(h.httpCalls, [], 'A fully confirmed explicit scope must not call the snapshot receiver again');
  assert.equal(syncCount, 1);
  noSheetEffects(h);
});
