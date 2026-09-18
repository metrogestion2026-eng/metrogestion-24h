import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

const variant = process.env.METROGESTION_SCRIPT_TEST_VERSION || 'r1-alpha76';
const source = fs.readFileSync(new URL(`../${variant}/google-apps-script/sincronizar_manteniment.gs`, import.meta.url), 'utf8');
const id = '11111111-1111-4111-8111-111111111111';
const otherId = '22222222-2222-4222-8222-222222222222';
const key = 'R1320|TEST123|FRIDIEL|TRAMITE|EXTINTOR|2026-09-15';
const assignment = { trabajo_sync_id: id, fila: 5842, clave_fila: key, fecha_entrada: '2026-09-15', fecha_salida: '2026-09-16' };
const clone = value => JSON.parse(JSON.stringify(value));
const iso = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
function context() {
  const props = new Map();
  const api = { getProperty: key => props.get(key) ?? null, setProperty: (key, value) => props.set(key, value) };
  const c = vm.createContext({ console, Date, Map, Set, PropertiesService: { getScriptProperties: () => api },
    SpreadsheetApp: { flush() {} }, Utilities: { formatDate: date => iso(date) } });
  vm.runInContext(source, c);
  return c;
}
function work(type = 'EXTINTOR', date = '2026-09-15') {
  const row = Array(17).fill('');
  Object.assign(row, { 0: 'R1320', 1: 'TEST123', 5: 'FRIDIEL', 6: 'TRÁMITE', 7: type, 8: date });
  return row;
}
function sheet(input) {
  const s = { values: input.map(r => r.slice()), notes: input.map(() => Array(17).fill('')), colors: input.map(() => Array(17).fill('#ffffff')), fail: null };
  const hit = (op, row, column) => { if (s.fail?.(op, row, column)) { s.fail = null; throw new Error(`Corte: ${op}`); } };
  s.getLastRow = () => s.values.length;
  s.getFilter = () => null;
  s.getRowHeight = () => 21;
  s.setRowHeight = row => hit('height', row);
  s.insertRowAfter = row => { hit('insert', row); for (const [data, blank] of [[s.values, ''], [s.notes, ''], [s.colors, '#ffffff']]) data.splice(row, 0, Array(17).fill(blank)); };
  s.getRange = (row, column, height = 1, width = 1) => {
    const read = (data, format = x => x) => Array.from({ length: height }, (_, r) => data[row - 1 + r].slice(column - 1, column - 1 + width).map(format));
    const write = (data, value) => { for (let r = 0; r < height; r++) for (let col = 0; col < width; col++) data[row - 1 + r][column - 1 + col] = value; return range; };
    const range = {
      getDisplayValues: () => read(s.values, x => x instanceof Date ? iso(x) : String(x)), getValues: () => read(s.values),
      getDisplayValue: () => range.getDisplayValues()[0][0], getNotes: () => read(s.notes), getNote: () => read(s.notes)[0][0],
      getBackgrounds: () => read(s.colors), getBackground: () => read(s.colors)[0][0],
      setNote: value => { hit('note', row, column); return write(s.notes, value); }, clearNote: () => write(s.notes, ''),
      setBackground: value => { hit('background', row, column); return write(s.colors, value); },
      setValue: value => { hit('value', row, column); return write(s.values, value); }, clearContent: () => write(s.values, ''),
      setValues: data => { hit('values', row, column); data.forEach((r, i) => r.forEach((v, j) => { s.values[row - 1 + i][column - 1 + j] = v; })); return range; },
      setNumberFormat: () => range, clearDataValidations: () => range, copyTo: target => target.setBackground(s.colors[row - 1][column - 1]),
    };
    return range;
  };
  return s;
}
const header = Array(17).fill('');
function apply(c, s, commands = [assignment], reversion) {
  return c.metrogestionAplicarAsignacionesTrabajos_(s, commands, '2600121', c.metrogestionEstadoHojaLote_(s), [{ ...assignment, fila: 5842 }], reversion);
}

test('fila 5842 desplazada, pedido amarillo y UUID copiado a PARADA: solo escribe EXTINTOR', () => {
  const c = context();
  const parada = work('PARADA'); parada[4] = '2600121';
  const actual = work(); actual[4] = '2600121'; actual[5] = 'UPC'; actual[6] = '2600999';
  const s = sheet([header, parada, actual]);
  s.notes[1][4] = s.notes[2][4] = `METROGESTION_T:${id}`;
  s.colors[2][6] = '#ffff00';
  const beforeParada = clone(s.values[1]);
  apply(c, s);
  assert.deepEqual(s.values[1], beforeParada);
  assert.equal(iso(s.values[2][9]), '2026-09-15');
  assert.equal(iso(s.values[2][10]), '2026-09-16');
  assert.equal(s.colors[2][6], '#ffff00');
  const saved = clone(s.values);
  apply(c, s);
  assert.deepEqual(clone(s.values), saved);
});

test('necesidad pendiente desplazada con G amarilla se enlaza por su clave actual', () => {
  const c = context(); const actual = work(); actual[6] = '2600999';
  const s = sheet([header, work('PARADA'), actual]); s.colors[2][6] = '#ffff00';
  apply(c, s, [{ ...assignment, clave_fila: 'R1320|TEST123|FRIDIEL||EXTINTOR|2026-09-15' }]);
  assert.equal(s.values[2][4], '2600121');
  assert.equal(s.notes[2][4], `METROGESTION_T:${id}`);
});

test('una referencia antigua no sustituye el UUID válido ni escribe fechas en otra H', () => {
  const c = context(); const s = sheet([header, work('TMG'), work()]);
  s.notes[1][4] = `METROGESTION_T:${id}`;
  s.notes[2][4] = `METROGESTION_T:${otherId}`;
  s.values[2][4] = '2600121';
  const before = clone(s.values);
  apply(c, s);
  assert.deepEqual(s.values, before);
  assert.equal(s.notes[2][4], `METROGESTION_T:${otherId}`);
});

test('dos trabajos tras insertar filas no se excluyen por sus posiciones anteriores', () => {
  const c = context(); const s = sheet([header, work('PARADA'), work(), work('ITV')]);
  apply(c, s, [assignment, { ...assignment, fila: 3, trabajo_sync_id: otherId, clave_fila: key.replace('EXTINTOR', 'ITV') }]);
  assert.equal(s.notes[2][4], `METROGESTION_T:${id}`);
  assert.equal(s.notes[3][4], `METROGESTION_T:${otherId}`);
});

test('un duplicado en la misma orden no vuelve a escribir la fila; otra actuación se protege', () => {
  const c = context(); const s = sheet([header, work()]);
  apply(c, s, [assignment, assignment]);
  assert.equal(s.notes[1][4], `METROGESTION_T:${id}`);
  s.values[1][4] = '2600888';
  assert.throws(() => apply(c, s), /otra actuación/);
});

test('identidad ambigua no se resuelve por proximidad a una fila antigua', () => {
  const c = context(); const s = sheet([header, work(), work()]);
  assert.throws(() => apply(c, s), /varias filas/);
  assert.equal(s.values[1][4], ''); assert.equal(s.values[2][4], '');
});

test('la reapertura conserva el vínculo y solo limpia las fechas indicadas', () => {
  const c = context(); const s = sheet([header, work()]); apply(c, s);
  apply(c, s, [assignment], { trabajo_sync_ids: [id], limpiar_fecha_salida: true });
  assert.equal(iso(s.values[1][9]), '2026-09-15');
  assert.equal(s.values[1][10], '');
  assert.equal(s.notes[1][4], `METROGESTION_T:${id}`);
});

function cycleContext() {
  const c = context(); let saved;
  c.metrogestionGuardarCiclo_ = state => { saved = clone(state); };
  c.metrogestionEstadoHojaLote_ = () => ({});
  c.metrogestionSuspenderFiltro_ = () => null;
  c.metrogestionRestaurarFiltro_ = () => {};
  return { c, saved: () => clone(saved) };
}
function cycle() { return { id: 'ciclo-en-curso', hoja: 'hoja', fase: 'comandos', comandos: [{ sync_id: id, revision: 4 }], confirmados: 7, totalComandos: 8, creadas: 2, cierres: 3 }; }

test('actualiza la cola .4 con revisiones vigentes y conserva ID, avance y contadores', () => {
  const { c, saved } = cycleContext(); const state = cycle();
  c.metrogestionSolicitarCiclo_ = () => ({ syncResult: { comandos_manteniment: [{ sync_id: id, revision: 268 }] } });
  assert.equal(c.metrogestionActualizarCiclo_({}, state, 'manual', 'token'), true);
  assert.equal(saved().id, 'ciclo-en-curso');
  assert.equal(saved().confirmados, 7); assert.equal(saved().creadas, 2); assert.equal(saved().cierres, 3);
  assert.equal(saved().comandos[0].revision, 268);
  assert.equal(c.metrogestionActualizarCiclo_({}, state, 'manual', 'token'), false);
});

test('respuesta incompleta o fallo al renovar no reemplaza la cola guardada', () => {
  const { c } = cycleContext(); const state = cycle(); const before = clone(state);
  c.metrogestionSolicitarCiclo_ = () => ({ syncResult: {} });
  assert.throws(() => c.metrogestionActualizarCiclo_({}, state, 'manual', 'token'), /cola/);
  assert.deepEqual(state, before);
});

test('fallo de ACK retoma solo la confirmación, sin repetir escrituras en la hoja', () => {
  const { c, saved } = cycleContext(); const state = cycle(); let writes = 0;
  c.metrogestionAplicarComandos_ = () => { writes++; return [{ sync_id: id, revision: 4, estado: 'aplicado' }]; };
  c.metrogestionConfirmarComandos_ = () => { throw new Error('Red interrumpida'); };
  assert.throws(() => c.metrogestionProcesarOrdenesLote_({}, state, 'token', Infinity), /Red/);
  assert.equal(saved().confirmacionPendiente.revision, 4);
  assert.equal(c.metrogestionDiagnosticoSincronizacion().paso, 'Confirmando la orden aplicada con el servidor');
  c.metrogestionConfirmarComandos_ = () => {};
  c.metrogestionProcesarOrdenesLote_({}, saved(), 'token', Infinity);
  assert.equal(writes, 1); assert.equal(saved().confirmados, 8); assert.equal(saved().fase, 'necesidades');
});

test('el fallo original permanece visible aunque falle también restaurar el filtro', () => {
  const { c } = cycleContext();
  c.metrogestionAplicarComandos_ = () => { throw new Error('Necesidad ambigua'); };
  c.metrogestionRestaurarFiltro_ = () => { throw new Error('Filtro ocupado'); };
  assert.throws(() => c.metrogestionProcesarOrdenesLote_({}, cycle(), 'token', Infinity), /Necesidad ambigua.*Filtro ocupado/);
  assert.equal(c.metrogestionDiagnosticoSincronizacion().paso, 'Aplicando orden 8 de 8');
});

function needsSheet() {
  const alta = work('ALTA', '2020-01-01'); alta[9] = '2020-02-01';
  const done = work(); done[9] = done[10] = '2026-09-15'; done[12] = '2027-09-15';
  const s = sheet([header, alta, done]); s.colors[2][12] = '#ffff00';
  return s;
}
function drain(c, s) {
  for (let i = 0; i < 12; i++) {
    const plan = c.metrogestionLeerPlanNecesidades_(s);
    if (!plan.cambios.length && !plan.nuevas.length) return plan;
    c.metrogestionEjecutarPlanNecesidades_(s, plan, { cambios: 3, nuevas: plan.cambios.length ? 0 : 1, deadline: Infinity });
  }
  assert.fail('El plan no termina');
}
for (const cut of ['values', 'background', 'note', 'height']) {
  test(`corte al crear necesidad (${cut}): replanificar no duplica EXTINTOR`, () => {
    const c = context(); const s = needsSheet();
    // Guardar primero el origen, igual que el adaptador por tandas.
    let plan = c.metrogestionLeerPlanNecesidades_(s);
    c.metrogestionEjecutarPlanNecesidades_(s, plan, { cambios: 3, nuevas: 0, deadline: Infinity });
    plan = c.metrogestionLeerPlanNecesidades_(s);
    s.fail = (op, row, col) => row === 4 && op === cut && (cut !== 'note' || col === 9);
    assert.throws(() => c.metrogestionEjecutarPlanNecesidades_(s, plan, { cambios: 3, nuevas: 1, deadline: Infinity }), /Corte/);
    drain(c, s); drain(c, s);
    const next = s.values.filter(r => r[7] === 'EXTINTOR' && !r[9]);
    assert.equal(next.length, 1);
    assert.equal(iso(next[0][8]), '2027-09-15');
    assert.equal(s.values[2][9], '2026-09-15');
  });
}

test('necesidad manual ya existente se reutiliza; duplicados previos generan aviso sin otra copia', () => {
  const c = context(); const s = needsSheet();
  s.insertRowAfter(3); s.values[3] = work('EXTINTOR', '2027-09-15');
  drain(c, s); assert.equal(s.values.length, 4);
  s.insertRowAfter(4); s.values[4] = work('EXTINTOR', '2027-09-15');
  const plan = c.metrogestionLeerPlanNecesidades_(s);
  assert.equal(plan.nuevas.length, 0); assert.ok(plan.avisos.some(x => /Más de una/.test(x.motivo)));
});
