import test from 'node:test';
import assert from 'node:assert/strict';
import { createExecutorHarness, defaultResponse, HEADERS, IDS, command, paradaRow,
  workRow, workPayload, scopeOf } from './helpers/alpha75-sync-executor-harness.mjs';

// Synthetic T identity 6839 deliberately differs from its physical position.
// The real distributed GS runs unchanged; only Google platform objects are fake.
const identified = (row, id) => Object.assign(Array.from({ length: 20 }, (_, i) => row[i] ?? ''), { 19: id });
const stopNote = `METROGESTION_PARADA:${IDS.stop}`;
function fixture(extra = {}) {
  return createExecutorHarness({ rows: [HEADERS, identified(paradaRow(), 6839)],
    cells: { '2,1': { note: stopNote } }, ...extra });
}
function select(h, order = command()) {
  h.call('metrogestionGuardarAlcanceOrdenes_', [scopeOf(order)]);
  h.clearEvents();
  return order;
}
function prepare(h, order) {
  select(h, order);
  const state = h.newState([order]); h.save(state); h.clearEvents();
  return state;
}
function capture(h, handler) {
  select(h);
  let payload;
  h.setHttp((body, world) => {
    payload = body.payload;
    return handler ? handler(body, world) : { ok: true, resultado: { comandos_manteniment: [] } };
  });
  h.call('metrogestionSolicitarCiclo_', h.sheet, 'manual', 'synthetic-token');
  return payload;
}
const journal = h => Object.entries(h.properties).filter(([key]) => key.startsWith('METROGESTION_ORDEN_V1:'))
  .map(([key, value]) => ({ key, value: JSON.parse(value) }));

test('all five feeds carry raw T separately from physical fila, preserving UUID and work key', () => {
  const h = fixture({ rows: [HEADERS,
    identified(paradaRow({ 8: 'ALTA', 5: '', 17: 'TEST-BASTIDOR' }), 6838),
    identified(paradaRow({ 11: '10/10/2026', 12: '10', 16: '12.345' }), 6839),
    identified(workRow({ 5: '', 6: 'TEST-TALLER' }), 6840)],
  cells: { '3,1': { note: stopNote } } });
  const before = h.snapshot(), payload = capture(h);
  for (const [feed, id, row] of [['filas', 6838, 2], ['paradas', 6839, 3],
    ['cierres_facturacion', 6839, 3], ['trabajos', 6840, 4], ['pendientes', 6840, 4]]) {
    assert.equal(payload[feed][0].id_fila, id, feed);
    assert.equal(payload[feed][0].fila, row, feed);
  }
  assert.equal(payload.paradas[0].sync_id, IDS.stop);
  assert.equal(payload.cierres_facturacion[0].km_facturables, 12345);
  assert.equal(payload.trabajos[0].clave_fila, 'TEST-DFM-01|TEST1234|TEST-TALLER|MECANICA|TEST REVISION|2026-10-01');
  assert.deepEqual(h.snapshot(), before); assert.deepEqual(h.effects, []);
});

test('reordering and inserting a row changes location but never ID_FILA 6839', () => {
  const h = fixture({ rows: [HEADERS, identified(paradaRow(), 6839),
    identified(workRow(), 6840)], cells: { '2,1': { note: stopNote } } });
  const initial = capture(h).paradas[0];
  const stop = h.sheet.rows.splice(1, 1)[0]; h.sheet.rows.push(stop);
  const reordered = capture(h).paradas[0];
  // External insertion is a pre-existing registered row before the next capture.
  const extra = identified(workRow({ 8: 'OTHER SYNTHETIC WORK' }), 6841);
  h.sheet.rows.splice(1, 0, extra.map(value => ({ value, note: '', formula: '', background: '#ffffff', format: '', link: '', validation: null })));
  h.world.registry.at(h.world.registry.getLastRow() + 1, 1).value = 6841;
  h.world.registry.at(h.world.registry.getLastRow(), 2).value = 'ACTIVA';
  const inserted = capture(h).paradas[0];
  assert.deepEqual([initial.id_fila, reordered.id_fila, inserted.id_fila], [6839, 6839, 6839]);
  assert.deepEqual([initial.fila, reordered.fila, inserted.fila], [2, 3, 4]);
});

for (const [name, options, expected] of [
  ['absent T', { cells: { '2,20': { value: '' } } }, /ID_FILA ausente/],
  ['fractional T', { cells: { '2,20': { value: 6839.5 } } }, /ID_FILA ausente o inválido/],
  ['calculated T', { cells: { '2,20': { value: 6839, formula: '=6839' } } }, /ID_FILA calculado/],
  ['wrong header', { cells: { '1,20': { value: 'FILA' } } }, /cabecera literal ID_FILA/],
  ['duplicate T', { rows: [HEADERS, identified(paradaRow(), 6839), identified(workRow(), 6839)] }, /ID_FILA 6839 duplicado/],
  ['unknown registry ID', { registryRows: [['ID_FILA', 'ESTADO'], [6840, 'ACTIVA']] }, /ID_FILA 6839 no consta ACTIVA/],
  ['deleted registry ID', { registryRows: [['ID_FILA', 'ESTADO'], [6839, 'BORRADA']] }, /ID_FILA 6839 no consta ACTIVA/],
]) test(`${name} blocks before HTTP, allocation or any sheet mutation`, () => {
  const h = fixture(options); select(h);
  const before = h.snapshot();
  assert.throws(() => h.call('metrogestionSolicitarCiclo_', h.sheet, 'manual', 'synthetic-token'), expected);
  assert.deepEqual(h.httpCalls, []); assert.deepEqual(h.effects, []);
  assert.deepEqual(h.snapshot(), before);
  assert.equal(h.events.some(event => event.kind === 'property'), false);
});

test('an order moved between raw T and visible A:T is rejected instead of relabelling its data', () => {
  const h = fixture({ rows: [HEADERS, identified(paradaRow(), 6839), identified(workRow(), 6840)] }); select(h);
  const getRange = h.sheet.getRange.bind(h.sheet);
  let moved = false;
  h.sheet.getRange = (...args) => {
    const range = getRange(...args);
    if (args[1] === 1 && args[3] === 20) {
      const read = range.getDisplayValues.bind(range);
      range.getDisplayValues = () => {
        if (!moved) { [h.sheet.rows[1], h.sheet.rows[2]] = [h.sheet.rows[2], h.sheet.rows[1]]; moved = true; }
        return read();
      };
    }
    return range;
  };
  assert.throws(() => h.call('metrogestionSolicitarCiclo_', h.sheet, 'manual', 'synthetic-token'), /ID_FILA no coincide/);
  assert.deepEqual(h.httpCalls, []); assert.deepEqual(h.effects, []);
});

test('movement while reading notes invalidates the complete snapshot before HTTP', () => {
  const h = fixture({ rows: [HEADERS, identified(paradaRow(), 6839), identified(workRow(), 6840)] }); select(h);
  const getRange = h.sheet.getRange.bind(h.sheet);
  let moved = false;
  h.sheet.getRange = (...args) => {
    const range = getRange(...args), read = range.getNotes.bind(range);
    range.getNotes = () => {
      const notes = read();
      if (!moved) { [h.sheet.rows[1], h.sheet.rows[2]] = [h.sheet.rows[2], h.sheet.rows[1]]; moved = true; }
      return notes;
    };
    return range;
  };
  assert.throws(() => h.call('metrogestionSolicitarCiclo_', h.sheet, 'manual', 'synthetic-token'), /ID_FILA cambió durante la lectura/);
  assert.deepEqual(h.httpCalls, []); assert.deepEqual(h.effects, []);
});

test('HTTP400 identifies the sent snapshot after a reorder during HTTP, not the current row', () => {
  const h = fixture({ rows: [HEADERS, identified(paradaRow(), 6839), identified(workRow({ 1: 'OTHER-TEST' }), 6840)] });
  assert.throws(() => capture(h, () => {
    [h.sheet.rows[1], h.sheet.rows[2]] = [h.sheet.rows[2], h.sheet.rows[1]];
    return { status: 400, body: { message: 'Los kilómetros de la fila 2 no son válidos.' } };
  }), /ID_FILA 6839 · DFM TEST-DFM-01 \(posición 2 en la lectura enviada\)/);
  assert.equal(h.sheet.getRange(2, 20).getValue(), 6840);
  assert.deepEqual(h.effects, []);
  assert.equal(h.properties.METROGESTION_SOLICITUD_ENTREGA_V1, undefined);
});

test('an unpositioned HTTP400 message is preserved without inventing ID_FILA', () => {
  const h = fixture();
  assert.throws(() => capture(h, () => ({ status: 400, body: { error: 'Orden incompatible; referencia 6839.' } })),
    { message: 'Orden incompatible; referencia 6839.' });
});

test('closed formula errors name ID_FILA and DFM while preserving both formulas', () => {
  const h = fixture({ cells: { '2,1': { note: stopNote }, '2,11': { value: '10/10/2026' },
    '2,12': { formula: '=K2-J2+1', value: 10 }, '2,16': { formula: '=643*L2', value: -12345, display: '-12.345' } } });
  select(h); const before = h.snapshot();
  assert.throws(() => h.call('metrogestionSolicitarCiclo_', h.sheet, 'manual', 'synthetic-token'),
    /Los kilómetros de ID_FILA 6839 · DFM TEST-DFM-01.*no contiene un número válido/);
  assert.deepEqual(h.snapshot(), before); assert.deepEqual(h.effects, []); assert.deepEqual(h.httpCalls, []);
});

test('T is part of the photo hash and changing only T during authorize prevents every effect and ACK', () => {
  const h = fixture({ rows: [HEADERS, identified(paradaRow(), 6839), identified(workRow(), 6840)] });
  const first = h.call('metrogestionLeerFotografiaOrden_', h.sheet);
  const order = command({ payload: { fecha_k: '2026-10-29' } }), state = prepare(h, order);
  h.setHttp((body, world) => {
    if (body.action === 'authorize') {
      h.externalEdit(2, 20, { value: 6840 }); h.externalEdit(3, 20, { value: 6839 });
    }
    return defaultResponse(body, world);
  });
  assert.throws(() => h.process(state), /cambió durante la autorización/);
  const after = h.call('metrogestionLeerFotografiaOrden_', h.sheet);
  assert.notEqual(h.call('metrogestionHuellaFotoOrden_', first, true), h.call('metrogestionHuellaFotoOrden_', after, true));
  assert.deepEqual(h.effects, []); assert.equal(h.httpCalls.some(call => call.method === 'ack_execution'), false);
  assert.equal(journal(h).length, 0);
});

test('a row moved before planning is located by UUID then bound to ID_FILA, with formulas preserved', () => {
  const h = fixture({ rows: [HEADERS, identified(paradaRow(), 6839), identified(workRow(), 6840)], cells: {
    '2,1': { note: stopNote }, '2,12': { formula: '=IF(K2="","",K2-J2+1)', value: '' },
    '2,16': { formula: '=IF(L2="","",643*L2)', value: '' } } });
  [h.sheet.rows[1], h.sheet.rows[2]] = [h.sheet.rows[2], h.sheet.rows[1]];
  // Sheets moves the native references with the row; the fixture is no formula engine.
  h.sheet.at(3, 12).formula = '=IF(K3="","",K3-J3+1)';
  h.sheet.at(3, 16).formula = '=IF(L3="","",643*L3)';
  const order = command({ payload: { fecha_k: '2026-10-29' } }), state = prepare(h, order);
  const plan = h.call('metrogestionPlanificarOrdenCompleta_', h.sheet, order);
  assert.ok(plan.memory.operations.some(op => op.ids_rango?.includes(6839)));
  assert.ok(plan.memory.operations.find(op => op.method === 'enlazarArchivo').ids_archivo.includes(6839));
  h.process(state);
  assert.equal(h.sheet.getRange(3, 20).getValue(), 6839);
  assert.equal(h.sheet.getRange(3, 11).getDisplayValue(), '29/10/2026');
  assert.equal(h.sheet.getRange(2, 11).getDisplayValue(), '');
  assert.equal(h.sheet.getRange(3, 12).getFormula(), '=IF(K3="","",K3-J3+1)');
  assert.equal(h.sheet.getRange(3, 16).getFormula(), '=IF(L3="","",643*L3)');
  assert.equal(state.confirmados, 1);
  assert.deepEqual(scopeOf(h.httpCalls.find(call => call.method === 'ack_execution').body.payload.confirmacion), scopeOf(order));
});

test('new trailing row receives a fresh registry ID only after the planned writes and has a verified T receipt', () => {
  const h = fixture(), order = command({ payload: { solo_trabajos: true, trabajos_crear: [workPayload()] } });
  const state = prepare(h, order), plan = h.call('metrogestionPlanificarOrdenCompleta_', h.sheet, order);
  assert.equal(plan.memory.operations.find(op => op.method === 'insertRowAfter').id_fila_local, 6839);
  const copy = plan.memory.operations.find(op => op.method === 'copyTo');
  assert.deepEqual([...copy.ids_rango], [6839]); assert.match(copy.ids_destino[0], /^NUEVA:/);
  assert.match(plan.memory.operations.find(op => op.method === 'setRowHeight').id_fila_local, /^NUEVA:/);
  h.process(state);
  assert.equal(h.sheet.getRange(2, 20).getValue(), 6839);
  assert.equal(h.sheet.getRange(3, 20).getValue(), 900001);
  assert.equal(h.world.registry.getRange(3, 1).getValue(), 900001);
  assert.equal(h.world.registry.getRange(3, 2).getValue(), 'ACTIVA');
  assert.equal(journal(h)[0].value.version_fotografia, h.config.fotografiaVersion);
  assert.equal(state.confirmados, 1);
});

test('movement between two write operations stops the next effect and retains an uncertain journal without ACK', () => {
  const h = fixture({ rows: [HEADERS, identified(paradaRow(), 6839), identified(workRow(), 6840)] });
  const order = command({ payload: { fecha_k: '2026-10-29' } }), state = prepare(h, order);
  const effect = h.world.effect.bind(h.world);
  let moved = false;
  h.world.effect = (event, change) => {
    effect(event, change);
    if (!moved && event.kind === 'sheet' && event.method === 'setValue') {
      [h.sheet.rows[1], h.sheet.rows[2]] = [h.sheet.rows[2], h.sheet.rows[1]];
      moved = true;
    }
  };
  assert.throws(() => h.process(state), /Resultado incierto/);
  assert.equal(moved, true);
  assert.equal(h.effects.length, 1);
  assert.equal(h.sheet.getRange(3, 20).getValue(), 6839);
  assert.equal(h.sheet.getRange(3, 11).getDisplayValue(), '29/10/2026');
  assert.equal(h.sheet.getRange(2, 11).getDisplayValue(), '');
  assert.equal(journal(h)[0].value.estado, 'incierto');
  assert.equal(h.httpCalls.some(call => call.method === 'ack_execution'), false);
});

test('a previously applied receipt without T is retained without ACK; confirmed legacy receipts remain settled', () => {
  for (const confirmed of [false, true]) {
    const h = fixture(), order = command({ payload: { fecha_k: '2026-10-29' } }), state = prepare(h, order);
    h.setHttp((body, world) => {
      if (body.action === 'ack_execution') throw new Error('Synthetic lost ACK');
      return defaultResponse(body, world);
    });
    assert.throws(() => h.process(state), /respuesta verificable de ack_execution/);
    const saved = journal(h)[0]; delete saved.value.version_fotografia;
    saved.value.estado = confirmed ? 'confirmado' : 'aplicado';
    h.world.properties.set(saved.key, JSON.stringify(saved.value));
    h.restart(); h.clearEvents();
    if (confirmed) { h.process(h.load()); assert.equal(h.load().confirmados, 1); }
    else assert.throws(() => h.process(h.load()), /recibo aplicado anterior no acredita ID_FILA/);
    assert.deepEqual(h.effects, []); assert.deepEqual(h.httpCalls, []);
    assert.equal(journal(h)[0].value.estado, confirmed ? 'confirmado' : 'aplicado');
  }
});

test('planner errors identify the snapshot T; a stale assignment position is never reinterpreted as T', () => {
  const h = fixture({ cells: { '2,1': { note: stopNote }, '2,8': { value: 'OTHER-WORK' } } });
  assert.throws(() => h.call('metrogestionPlanificarOrdenCompleta_', h.sheet, command()),
    /ID_FILA 6839 · DFM TEST-DFM-01 \(posición 2 en la fotografía del plan\)/);
  const rows = [3, 4].map(rowNumber => ({ rowNumber, values: workRow(), key: 'TEST-DFM-01|TEST1234|TEST-TALLER|MECANICA|TEST REVISION|2026-10-01',
    syncId: '', stop: '910001', pending: true }));
  assert.throws(() => h.call('metrogestionResolverAsignacion_', { fila: 2, trabajo_sync_id: IDS.work,
    clave_fila: rows[0].key }, rows, '910001', new Set()), /posición histórica 2/);
  assert.deepEqual(h.effects, []); assert.deepEqual(h.httpCalls, []);
});
