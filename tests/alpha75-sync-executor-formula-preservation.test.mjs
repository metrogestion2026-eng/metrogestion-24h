import test from 'node:test';
import assert from 'node:assert/strict';
import { createExecutorHarness, HEADERS, IDS, command, paradaRow, workRow, workPayload, scopeOf } from './helpers/alpha75-sync-executor-harness.mjs';
const blankL = '=IF(K2="","",K2-J2+1)', blankP = '=IF(L2="","",100*L2)';
function fixture({ cells = {}, ...extra } = {}) {
  const row = paradaRow(); while (row.length < 20) row.push(''); row[19] = 790001;
  return createExecutorHarness({ rows: [HEADERS, row], ...extra, cells: {
    '2,12': { value: '', display: '', formula: blankL },
    '2,16': { value: '', display: '', formula: blankP }, ...cells },
  });
}
function prepare(h, order) {
  h.call('metrogestionGuardarAlcanceOrdenes_', [scopeOf(order)]);
  const state = h.newState([order]); h.save(state); h.clearEvents(); return state;
}
function numericWrites(plan) { return plan.memory.operations.filter(o => o.range && [12,16].includes(o.range[1]) && ['setValue','setValues','clearContent'].includes(o.method)); }
function journals(h) { return Object.entries(h.properties).filter(([k]) => k.startsWith('METROGESTION_ORDEN_V1:')).map(([,v]) => JSON.parse(v)); }

test('F02 empty L/P formulas remain manual content through plan, execution, receipt and a confirmed retry', () => {
  const h = fixture(), order = command({ payload: { dias_parada: 5, km_facturables: 500 } });
  const state = prepare(h, order), plan = h.call('metrogestionPlanificarOrdenCompleta_', h.sheet, order);
  assert.equal(numericWrites(plan).length, 0);
  assert.equal(plan.memory.rows[1][11].formula, blankL);
  assert.equal(plan.memory.rows[1][15].formula, blankP);
  h.process(state);
  assert.equal(state.confirmados, 1);
  assert.equal(h.sheet.getRange(2,12).getFormula(), blankL);
  assert.equal(h.sheet.getRange(2,16).getFormula(), blankP);
  assert.equal(h.sheet.getRange(2,12).getValue(), '');
  assert.equal(h.sheet.getRange(2,20).getValue(), 790001);
  assert.equal(journals(h)[0].estado, 'confirmado');
  const before = h.snapshot(); h.restart(); h.clearEvents();
  h.process(h.newState([order]));
  assert.deepEqual(h.snapshot(), before); assert.deepEqual(h.effects, []); assert.deepEqual(h.httpCalls, []);
});

test('F03 a legitimate formula recalculation after completing K is verified without weakening the strict PRE snapshot', () => {
  const h = fixture(), order = command({ payload: { fecha_k: '2026-10-03', dias_parada: 3, km_facturables: 300 } });
  const flush = h.context.SpreadsheetApp.flush;
  h.context.SpreadsheetApp.flush = () => {
    if (h.sheet.getRange(2,11).getDisplayValue() === '03/10/2026') {
      Object.assign(h.sheet.at(2,12), { value: 3, display: '3' });
      Object.assign(h.sheet.at(2,16), { value: 300, display: '300' });
    }
    return flush();
  };
  const state = prepare(h, order); h.process(state);
  assert.equal(h.sheet.getRange(2,12).getValue(), 3);
  assert.equal(h.sheet.getRange(2,16).getValue(), 300);
  assert.equal(h.sheet.getRange(2,12).getFormula(), blankL);
  assert.equal(h.sheet.getRange(2,16).getFormula(), blankP);
  assert.equal(journals(h)[0].estado, 'confirmado');
  assert.equal(h.httpCalls.filter(x => x.method === 'ack_execution').length, 1);
});

test('F04 a formula changed during writes remains uncertain and cannot receive ACK', () => {
  const h = fixture(), order = command({ payload: { fecha_k: '2026-10-03' } });
  const flush = h.context.SpreadsheetApp.flush;
  h.context.SpreadsheetApp.flush = () => { h.sheet.at(2,16).formula = '=999'; return flush(); };
  const state = prepare(h, order);
  assert.throws(() => h.process(state), /Resultado incierto/);
  assert.equal(journals(h)[0].estado, 'incierto');
  assert.equal(h.httpCalls.some(x => x.method === 'ack_execution'), false);
});

test('F05 matching nonempty formula results are preserved, while a real conflicting manual value still blocks', () => {
  for (const actual of [5,6]) {
    const h = createExecutorHarness({ rows: [HEADERS,paradaRow()], cells: { '2,12': { value: actual, formula: `=${actual}` } } });
    const order = command({ payload: { dias_parada: 5 } }), state = prepare(h, order);
    if (actual === 5) { h.process(state); assert.equal(state.confirmados, 1); }
    else {
      assert.throws(() => h.process(state), /Conflicto manual/);
      assert.deepEqual(h.effects, []); assert.deepEqual(h.httpCalls, []);
    }
    assert.equal(h.sheet.getRange(2,12).getFormula(), `=${actual}`);
  }
});

test('F06 empty K formula in an existing PARADA is neither replaced nor represented as a closed cell', () => {
  const h = fixture({ cells: { '2,11': { value: '', formula: '=IF(FALSE,"closed","")' } } });
  const original = h.sheet.getRange(2,1,1,17).getBackgrounds();
  const state = prepare(h, command({ payload: { fecha_k: '2026-10-03' } }));
  h.process(state);
  assert.equal(h.sheet.getRange(2,11).getFormula(), '=IF(FALSE,"closed","")');
  assert.equal(h.sheet.getRange(2,11).getValue(), '');
  assert.deepEqual(h.sheet.getRange(2,1,1,17).getBackgrounds(), original);
});

test('F07 rollover cannot replace a calculated empty K or pretend that the previous period closed', () => {
  const h = fixture({ cells: { '2,11': { value: '', formula: '=""' } } });
  const order = command({ payload: { tancament: 'TANCAMENT 3', fecha_parada: '2026-11-01',
    cierre_periodo_anterior: { tancament: 'TANCAMENT 2', fecha_k: '2026-10-31' } } });
  const state = prepare(h, order), before = h.snapshot();
  assert.throws(() => h.process(state), /K.*fórmula/);
  assert.deepEqual(h.snapshot(), before); assert.deepEqual(h.effects, []); assert.deepEqual(h.httpCalls, []);
});

test('F08 shared fill protects I/J/K formulas, and formula-valued PA is never converted to RichText', () => {
  const h = createExecutorHarness({ rows: [HEADERS,paradaRow()], cells: {
    '2,5': { value: 'PA-910001', formula: '="PA-910001"' },
    '2,9': { value: '01/10/2026', formula: '=DATE(2026,10,1)' },
    '2,10': { value: '01/10/2026', formula: '=DATE(2026,10,1)' },
    '2,11': { value: '', formula: '=""' },
  } });
  const order = command({ payload: { fecha_k: '2026-10-03' } }), state = prepare(h, order);
  h.process(state);
  for (const [col,formula] of [[5,'="PA-910001"'],[9,'=DATE(2026,10,1)'],[10,'=DATE(2026,10,1)'],[11,'=""']]) assert.equal(h.sheet.getRange(2,col).getFormula(), formula);
  assert.equal(h.effects.some(x => x.method === 'setRichTextValue'), false);
});

test('F09 existing assigned work preserves empty J/K formulas without cache substitution or a false closure', () => {
  const row = workRow();
  const h = createExecutorHarness({ rows: [HEADERS,paradaRow(),row], cells: {
    '3,10': { value: '', formula: '=""' }, '3,11': { value: '', formula: '=""' },
  } });
  const assignment = { trabajo_sync_id: IDS.work, fila: 3,
    clave_fila: h.call('metrogestionClaveFilaTrabajo_', row, false), fecha_entrada: '2026-10-02', fecha_salida: '2026-10-03' };
  const order = command({ payload: { solo_trabajos: true, trabajos_asignados: [assignment] } });
  const state = prepare(h,order), plan = h.call('metrogestionPlanificarOrdenCompleta_',h.sheet,order);
  assert.equal(plan.memory.rows[2][9].value, ''); assert.equal(plan.memory.rows[2][10].value, '');
  h.process(state);
  assert.equal(h.sheet.getRange(3,10).getFormula(), '=""'); assert.equal(h.sheet.getRange(3,11).getFormula(), '=""');
  assert.equal(h.sheet.getRange(3,1).getBackground(), '#ffffff');
  assert.equal(state.confirmados,1);
});

test('F10 reused work with declared real dates preserves I/J/K formulas and does not colour an empty calculated exit', () => {
  const h = createExecutorHarness({ rows: [HEADERS,paradaRow(),workRow()], cells: {
    '3,9': { value: '01/10/2026', formula: '=DATE(2026,10,1)' },
    '3,10': { value: '', formula: '=""' }, '3,11': { value: '', formula: '=""' },
  } });
  const work = workPayload({ fecha_entrada: '2026-10-02', fecha_salida: '2026-10-03',
    origen_fecha_entrada: { hecho: 'entrada_taller', fecha_hora: '2026-10-02T09:00:00+02:00' },
    origen_fecha_salida: { hecho: 'recogida_taller', fecha_hora: '2026-10-03T09:00:00+02:00' } });
  const state = prepare(h,command({ payload: { solo_trabajos: true, trabajos_crear: [work] } }));
  h.process(state);
  assert.equal(h.sheet.getRange(3,9).getFormula(), '=DATE(2026,10,1)');
  assert.equal(h.sheet.getRange(3,10).getFormula(), '=""'); assert.equal(h.sheet.getRange(3,11).getFormula(), '=""');
  assert.equal(h.sheet.getRange(3,1).getBackground(), '#ffffff');
  assert.equal(state.confirmados,1);
});


test('F11 an empty calculated PA cannot be materialized or linked through either work path', () => {
  for (const kind of ['assigned','reused']) {
    const row = workRow({ 5:'' });
    const h = createExecutorHarness({ rows:[HEADERS,paradaRow(),row], cells:{ '3,5':{ value:'',formula:'=""' } } });
    const payload = kind === 'assigned'
      ? { solo_trabajos:true, trabajos_asignados:[{ trabajo_sync_id:IDS.work,fila:3,
          clave_fila:h.call('metrogestionClaveFilaTrabajo_',row,false),fecha_entrada:'',fecha_salida:'' }] }
      : { solo_trabajos:true,trabajos_crear:[workPayload()] };
    const state=prepare(h,command({payload})), before=h.snapshot();
    assert.throws(() => h.process(state),/actuación.*fórmula/);
    assert.deepEqual(h.snapshot(),before);assert.deepEqual(h.effects,[]);assert.deepEqual(h.httpCalls,[]);
  }
});
