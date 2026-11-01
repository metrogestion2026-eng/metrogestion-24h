import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createExecutorHarness, HEADERS, IDS, command, paradaRow, workPayload, workRow, scopeOf,
} from './helpers/alpha75-sync-executor-harness.mjs';

// Synthetic identities/positions only. Tests execute the distributed GS parser,
// memory adapter, planner and gate; none of those product functions is replaced.
const copy = value => JSON.parse(JSON.stringify(value));
const insertion = row => ({ method: 'insertRowAfter', row });
function fixture({ row = 6, column = 16, formula = '=P3', r1c1, filter = false, cells = {} } = {}) {
  const rows = [HEADERS, ...Array.from({ length: 11 }, () => Array(17).fill(''))];
  rows[11][0] = 'TEST-END';
  const h = createExecutorHarness({ rows, maxRows: 20, filter,
    cells: { [`${row},${column}`]: { formula, value: 1, ...(r1c1 ? { formulaR1C1: r1c1 } : {}) }, ...cells } });
  const photo = h.call('metrogestionLeerFotografiaOrden_', h.sheet);
  return { h, photo, diagnose: operations => h.call('metrogestionDiagnosticarInsercionesOrden_', photo, operations) };
}

for (const [name, cut, sourceAfter, targetAfter, invariant] of [
  ['both cells before the insertion', 8, 6, 3, true],
  ['both cells after the insertion', 2, 7, 4, true],
  ['insertion separates source and target', 4, 7, 3, false],
  ['insertion immediately after source leaves source in place', 6, 6, 3, true],
  ['insertion immediately after target moves only source', 3, 7, 3, false],
]) {
  test(`R1C1 position diagnosis: ${name}`, () => {
    const { h, photo, diagnose } = fixture();
    const before = h.snapshot(), original = copy(photo);
    const result = diagnose([insertion(cut)]), item = result.formulas[0], ref = item.referencias[0];
    assert.equal(item.fila_despues, sourceAfter);
    assert.equal(ref.fila_despues, targetAfter);
    assert.equal(ref.desplazamiento_antes, -3);
    assert.equal(ref.desplazamiento_despues, targetAfter - sourceAfter);
    assert.equal(item.invariante, invariant);
    assert.equal(result.formulas_originales_invariantes, invariant);
    assert.equal(result.cobertura_estructural_completa, false);
    assert.equal(result.habilita_ejecucion, false);
    assert.deepEqual(copy(photo), original);
    assert.deepEqual(h.snapshot(), before);
    assert.deepEqual(h.effects, []); assert.deepEqual(h.httpCalls, []);
  });
}

test('several insertions use their sequential current positions, not original row numbers or a boolean', () => {
  const { h, photo, diagnose } = fixture({ row: 8, formula: '=P5' });
  const memory = h.call('metrogestionHojaEnMemoria_', h.sheet, photo);
  memory.insertRowAfter(2);
  memory.getRange(2, 1).setNote('TEST NOTE');
  memory.insertRowAfter(5);
  const result = diagnose(memory.operations);
  assert.deepEqual(copy(result.inserciones), [{ operacion: 1, despues_de: 2 }, { operacion: 3, despues_de: 5 }]);
  assert.equal(result.formulas[0].fila_despues, 10);
  assert.equal(result.formulas[0].referencias[0].fila_despues, 7);
  assert.equal(result.formulas_originales_invariantes, true);
  const reversed = diagnose([insertion(5), insertion(2)]);
  assert.equal(reversed.formulas[0].referencias[0].fila_despues, 6);
  assert.equal(reversed.formulas_originales_invariantes, false);
  assert.throws(() => diagnose(true), /operaciones reales.*no un indicador/);
  assert.throws(() => diagnose([insertion(0)]), /fila de inserción acreditada/);
  assert.throws(() => memory.insertRowAfter(memory.getLastRow() + 1), /fila existente/);
  assert.deepEqual(h.effects, []); assert.deepEqual(h.httpCalls, []);
});

test('small exhaustive oracle transports original cell identities through actual insertion positions', () => {
  // Independent oracle: move labelled row identities in an array, then locate
  // source/target identities. It does not reuse the product row-map function.
  for (let source = 2; source <= 8; source++) for (let target = 1; target <= 8; target++) {
    const { diagnose } = fixture({ row: source, formula: `=P${target}` });
    for (let cut = 1; cut <= 8; cut++) {
      const identities = Array.from({ length: 12 }, (_, i) => i + 1);
      identities.splice(cut, 0, null);
      const expectedOffset = identities.indexOf(target) - identities.indexOf(source);
      const result = diagnose([insertion(cut)]).formulas[0].referencias[0];
      assert.equal(result.desplazamiento_despues, expectedOffset, `source=${source}, target=${target}, cut=${cut}`);
      assert.equal(result.invariante, expectedOffset === target - source);
    }
  }
});

for (const [name, r1c1, invariant, own, targetAfter] of [
  ['unqualified local reference moves with the sheet', '=R[-3]C', true, true, 4],
  ['qualified local reference moves with the sheet', '=MANTENIMENT!R[-3]C', true, true, 4],
  ['quoted local name moves with the sheet', "='MANTENIMENT'!R[-3]C", true, true, 4],
  ['relative reference into another sheet does not move its target', "='OTHER SHEET'!R[-3]C", false, false, 3],
  ['absolute row on another sheet stays absolute', "='OTHER''S SHEET'!R3C16", true, false, 3],
  ['absolute local target shifts and needs a modelled rewrite', '=R3C16', false, true, 4],
  ['absolute header remains fixed', '=R1C16', true, true, 1],
  ['same-row reference retains zero relative displacement', '=RC[-1]', true, true, 7],
]) {
  test(`sheet and absolute-reference diagnosis: ${name}`, () => {
    const { diagnose } = fixture({ formula: '=TEST', r1c1 });
    const result = diagnose([insertion(2)]), ref = result.formulas[0].referencias[0];
    assert.equal(result.formulas_originales_invariantes, invariant);
    assert.equal(ref.hoja_propia, own);
    assert.equal(ref.fila_despues, targetAfter);
  });
}

test('a bounded range is recognised completely and a cut inside it cannot pass as invariant', () => {
  const { diagnose } = fixture({ formula: '=SUM(P2:P4)' });
  const beforeBoth = diagnose([insertion(1)]);
  assert.equal(beforeBoth.formulas[0].referencias.length, 2);
  assert.equal(beforeBoth.formulas_originales_invariantes, true);
  assert.equal(diagnose([insertion(3)]).formulas_originales_invariantes, false);
});

test('a mixed absolute-header to current-row range can expand while its R1C1 expression stays invariant', () => {
  const { diagnose } = fixture({ formula: '=SUM($A$1:P6)' });
  const result = diagnose([insertion(3)]);
  assert.equal(result.formulas_originales_invariantes, true);
  const [start, end] = result.formulas[0].referencias;
  assert.equal(start.rango, end.rango);
  assert.equal(start.fila_despues, 1); assert.equal(end.fila_despues, 7);
  // Expression identity does not imply identical range membership or permit.
  assert.equal(result.habilita_ejecucion, false);
  assert.equal(result.cobertura_estructural_completa, false);
});

test('literal strings and escaped quotes cannot manufacture references; scalar expressions stay covered', () => {
  const { diagnose } = fixture({ formula: '=TEST', r1c1: '=IF(RC[-1]="R[-999]C";"a ""quoted"" RC";ROUND(-RC[-1]+2.5E1;0))' });
  const result = diagnose([insertion(2)]);
  assert.equal(result.formulas[0].referencias.length, 2);
  assert.equal(result.formulas_originales_invariantes, true);
});

for (const r1c1 of [
  '=INDIRECT("R1C1";FALSE)', '=OFFSET(RC;-1;0)', '=SUM(a_named_range)',
  '=SUM(C1:C17)', '=SUM(R1:R10)', '=SUM(R1C1:R)', '=SUM(R1C1:R99C1)',
  '=SUM(R1C1:R1C18)', "=SUM('OTHER'!R1C1:R2C1)", '=R[-3]Cfoo',
  '=R[-3]C[0]R[1]C', '=R[01]C', '=R[-999]C', '=R9007199254740993C1',
  '=R[-3]C+unknown(RC)', '=R[-3]C#', '=SUM(RC', '=RC)', '=1+*RC',
  '=IF(RC="unclosed;1;0)', "='UNCLOSED!R1C1", "='[BOOK]OTHER'!R1C1", '=SUM({RC;R[1]C})',
]) {
  test(`closed grammar or bounded coverage rejects ${r1c1}`, () => {
    const { h, photo, diagnose } = fixture({ formula: '=TEST', r1c1 });
    const result = diagnose([insertion(3)]);
    assert.equal(result.formulas_originales_invariantes, false);
    assert.ok(result.formulas[0].motivo);
    assert.throws(() => h.call('metrogestionExigirFormulasPlanificables_', photo, [insertion(3)]), /inserción no está acreditada/);
    assert.deepEqual(h.effects, []); assert.deepEqual(h.httpCalls, []);
  });
}

for (const formula of ['=ARRAYFORMULA(A2:A12)', '=IMPORTRANGE("TEST";"A1:Q2")', '=QUERY(A1:Q12;"select A")']) {
  test(`A:Q array/import guard stays closed with and without insertion: ${formula}`, () => {
    const { h, photo, diagnose } = fixture({ formula });
    assert.equal(diagnose([insertion(8)]).formulas_originales_invariantes, false);
    for (const operations of [[], [insertion(8)]]) {
      assert.throws(() => h.call('metrogestionExigirFormulasPlanificables_', photo, operations), /requiere revisión/);
    }
    assert.deepEqual(h.effects, []); assert.deepEqual(h.httpCalls, []);
  });
}

test('diagnosis exposes filter-restoration and validation limits without claiming to model them', () => {
  const { h, diagnose } = fixture({ filter: { 8: { type: 'CUSTOM_FORMULA', values: ['=A2>0'] } },
    cells: { '2,8': { validation: { type: 'VALUE_IN_RANGE', values: [{ rango: 'A1:A5' }] } },
      '3,8': { validation: { type: 'CUSTOM_FORMULA', values: ['=A3<>0'] } },
      '4,8': { validation: { type: 'VALUE_IN_LIST', values: ['A', 'B'] } } } });
  const result = diagnose([insertion(8)]);
  assert.deepEqual(copy(result.filtro.anclas_desplazadas), { fila: 1, filas: 21 });
  assert.deepEqual(copy(result.filtro.restauracion_actual), { fila: 1, filas: 20 });
  assert.equal(result.filtro.restauracion_conserva_anclas, false);
  assert.equal(result.filtro.criterios_con_referencias_no_modelados, true);
  assert.deepEqual(copy(result.validaciones_con_referencias_no_modeladas).map(item => item.tipo), ['VALUE_IN_RANGE', 'CUSTOM_FORMULA']);
  assert.equal(result.cobertura_estructural_completa, false);
  assert.equal(result.habilita_ejecucion, false);
  assert.deepEqual(h.effects, []); assert.deepEqual(h.httpCalls, []);
});

test('a fully invariant A:Q diagnosis does not open a cross-row insertion rejected by the existing gate', () => {
  const { h, photo, diagnose } = fixture();
  const operations = [insertion(8)];
  assert.equal(diagnose(operations).formulas_originales_invariantes, true);
  assert.throws(() => h.call('metrogestionExigirFormulasPlanificables_', photo, operations),
    /conserva su expresión R1C1.*falta cobertura estructural.*no habilita/);
  assert.deepEqual(h.effects, []); assert.deepEqual(h.httpCalls, []);
});

test('actual executor rejects an invariant but previously gated insertion before authorize, writes or journal', () => {
  const h = createExecutorHarness({ rows: [HEADERS, paradaRow(), workRow({ 8: 'OTHER EXISTING TEST WORK' })],
    cells: { '2,1': { note: `METROGESTION_PARADA:${IDS.stop}` }, '3,16': { formula: '=P2', value: 1 } } });
  const order = command({ payload: { solo_trabajos: true, trabajos_crear: [workPayload()] } });
  h.call('metrogestionGuardarAlcanceOrdenes_', [scopeOf(order)]);
  const state = h.newState([order]); h.save(state); h.clearEvents();
  const before = h.snapshot();
  assert.throws(() => h.process(state), /falta cobertura estructural.*no habilita/);
  assert.deepEqual(h.snapshot(), before);
  assert.deepEqual(h.effects, []); assert.deepEqual(h.httpCalls, []);
  assert.equal(Object.keys(h.properties).some(key => key.startsWith('METROGESTION_ORDEN_V1:')), false);
});

test('previously covered same-row formulas still produce a plan with an explicit diagnostic-only result', () => {
  const h = createExecutorHarness({ rows: [HEADERS, paradaRow()],
    cells: { '2,1': { note: `METROGESTION_PARADA:${IDS.stop}` }, '2,16': { formula: '=O2', value: 'TEST' } } });
  const planned = h.call('metrogestionPlanificarOrdenCompleta_', h.sheet,
    command({ payload: { solo_trabajos: true, trabajos_crear: [workPayload()] } }));
  assert.ok(planned.memory.operations.some(op => op.method === 'insertRowAfter'));
  assert.equal(planned.diagnostico_inserciones.formulas_originales_invariantes, true);
  assert.equal(planned.diagnostico_inserciones.habilita_ejecucion, false);
  assert.deepEqual(h.effects, []); assert.deepEqual(h.httpCalls, []);
  const signed = planned.plan_sha256;
  planned.diagnostico_inserciones.formulas_originales_invariantes = false;
  assert.notEqual(h.call('metrogestionFirmaPlanOrden_', planned), signed);
});
