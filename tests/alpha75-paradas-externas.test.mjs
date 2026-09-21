import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import test from 'node:test';

const blank = () => Array(19).fill('');
const row = (dfm, estado, stop = '') => {
  const value = blank();
  [value[0], value[1], value[4], value[7]] = [dfm, 'TEST-PLATE', stop, estado];
  return value;
};

function fixture(version, rows) {
  const source = fs.readFileSync(new URL(`../r1-${version}/google-apps-script/sincronizar_manteniment.gs`, import.meta.url), 'utf8');
  const context = vm.createContext({ console });
  vm.runInContext(source, context);
  // Drive links and assignments are independent of the row insertion under test.
  context.metrogestionEnlazarArchivoParada_ = () => 0;
  context.metrogestionAplicarAsignacionesTrabajos_ = () => 0;
  const data = [blank(), ...rows.map(value => value.slice())];
  const notes = data.map(blank);
  const sheet = {
    data, notes, copies: [], inserted: 0,
    getLastRow: () => data.length,
    insertRowAfter(index) { data.splice(index, 0, blank()); notes.splice(index, 0, blank()); this.inserted++; },
    getRowHeight: () => 21,
    setRowHeight() {},
    getRange(r, c, nr = 1, nc = 1) {
      const cells = (fn) => {
        for (let y = 0; y < nr; y++) for (let x = 0; x < nc; x++) fn(r - 1 + y, c - 1 + x);
      };
      return {
        r, c, nr, nc,
        getValues: () => data.slice(r - 1, r - 1 + nr).map(value => value.slice(c - 1, c - 1 + nc)),
        getDisplayValues() { return this.getValues().map(value => value.map(String)); },
        getDisplayValue: () => String(data[r - 1][c - 1]),
        getNotes: () => notes.slice(r - 1, r - 1 + nr).map(value => value.slice(c - 1, c - 1 + nc)),
        setValues(values) { cells((y, x) => { data[y][x] = values[y - r + 1][x - c + 1]; }); return this; },
        setValue(value) { cells((y, x) => { data[y][x] = value; }); return this; },
        setNote(value) { cells((y, x) => { notes[y][x] = value; }); return this; },
        clearContent() { return this.setValue(''); },
        clearNote() { return this.setNote(''); },
        setNumberFormat() { return this; },
        setBackground() { return this; },
        getBackground: () => '#ffffff',
        copyTo(target) {
          sheet.copies.push({ source: r, target: target.r, columns: nc });
          target.setValues(this.getValues());
          const oldNotes = this.getNotes();
          for (let y = 0; y < nr; y++) for (let x = 0; x < nc; x++) notes[target.r - 1 + y][target.c - 1 + x] = oldNotes[y][x];
        },
      };
    },
  };
  const state = { values: data.map(value => value.slice()), notesA: data.map(() => ''), notesE: data.map(() => '') };
  const command = {
    sync_id: '11111111-1111-4111-8111-111111111111', revision: 2,
    payload: { dfm: 'EXT-TEST', matricula: 'TEST-EXTERNAL', tipo: 'TR', upc: 'TEST',
      numero_parada: 'PA-9999999', sustituto: 'RES-TEST', estado: 'PARADA',
      fecha_parada: '2026-09-20', fecha_k: null, dias_parada: 2, marca: 'TEST',
      tancament: 'TANCAMENT 9', trabajos_asignados: [] },
  };
  return { context, sheet, state, command };
}

for (const version of ['alpha75', 'alpha76']) {
  test(`${version}: externo con historia sin ALTA, reintento sin duplicar`, () => {
    const history = row('EXT-TEST', 'PARADA', 'PA-9999998');
    history[6] = 'OLD-RESERVE'; history[10] = '2026-03-16'; history[16] = 'TANCAMENT 3';
    history[17] = 'ARRAY-MONTH'; history[18] = 'ARRAY-YEAR';
    const nextVehicle = row('FLEET-TEST', 'ALTA');
    const { context, sheet, state, command } = fixture(version, [history, row('EXT-TEST', 'GC'), nextVehicle]);
    sheet.notes[1][0] = state.notesA[1] = 'HISTORICAL-NOTE';
    sheet.notes[3][4] = state.notesE[3] = 'NEXT-VEHICLE-NOTE';
    const apply = () => context.metrogestionAplicarComandos_(sheet, [command], state, [])[0];
    assert.equal(apply().fila, 4);
    assert.equal(sheet.data[3][7], 'PARADA');
    assert.equal(sheet.data[3][6], 'RES-TEST');
    assert.equal(sheet.data[3][10], '');
    assert.equal(sheet.data[3][16], 'TANCAMENT 9');
    assert.equal(sheet.data[3][17], '');
    assert.equal(sheet.data[3][18], '');
    assert.equal(sheet.notes[3][0], `METROGESTION_PARADA:${command.sync_id}`);
    assert.deepEqual(sheet.data[1], history);
    assert.deepEqual(sheet.data[4], nextVehicle);
    assert.equal(state.notesE[4], 'NEXT-VEHICLE-NOTE');
    assert.equal(state.values[4][0], 'FLEET-TEST');
    assert.equal(apply().fila, 4);
    assert.equal(sheet.inserted, 1);
    assert.equal(sheet.data.filter(value => value[0] === 'EXT-TEST' && value[7] === 'ALTA').length, 0);
    assert.deepEqual(sheet.copies, [{ source: 2, target: 4, columns: 17 }]);
  });

  test(`${version}: externo nuevo se añade al final sin copiar datos de flota`, () => {
    const own = row('FLEET-TEST', 'ALTA');
    own[16] = 'PRIVATE-VIN'; own[17] = 'ARRAY-MONTH';
    const { context, sheet, state, command } = fixture(version, [own]);
    assert.equal(context.metrogestionAplicarComandos_(sheet, [command], state, [])[0].fila, 3);
    assert.equal(sheet.data[2][0], 'EXT-TEST');
    assert.equal(sheet.data[2][1], 'TEST-EXTERNAL');
    assert.equal(sheet.data[2][16], 'TANCAMENT 9');
    assert.deepEqual(sheet.data[1], own);
  });

  test(`${version}: solo trabajos históricos también sirven sin crear ALTA`, () => {
    const { context, sheet, state, command } = fixture(version, [row('EXT-TEST', 'AV')]);
    assert.equal(context.metrogestionAplicarComandos_(sheet, [command], state, [])[0].fila, 3);
    assert.equal(sheet.data[2][7], 'PARADA');
  });

  test(`${version}: vehículo propio conserva plantilla ALTA y agrupación`, () => {
    const { context, sheet, state, command } = fixture(version, [row('EXT-TEST', 'ALTA'), row('EXT-TEST', 'AV'), row('OTHER', 'ALTA')]);
    assert.equal(context.metrogestionAplicarComandos_(sheet, [command], state, [])[0].fila, 4);
    assert.deepEqual(sheet.copies, [{ source: 2, target: 4, columns: 17 }]);
    assert.equal(sheet.data[1][7], 'ALTA');
  });

  test(`${version}: AV24H de externo se crea una sola vez`, () => {
    const { context, sheet, state, command } = fixture(version, [row('FLEET-TEST', 'ALTA')]);
    const adjustment = { ...command.payload, seguimiento_id: command.sync_id, designacion: 'AV24H' };
    context.metrogestionAplicarAjuste24h_(sheet, adjustment, state);
    context.metrogestionAplicarAjuste24h_(sheet, adjustment, state);
    assert.equal(sheet.inserted, 1);
    assert.equal(sheet.data[2][7], 'AV24H');
    assert.equal(sheet.data[2][0], 'EXT-TEST');
  });

  test(`${version}: identidad inválida o falta de plantilla no modifica filas`, () => {
    const { context, sheet, state, command } = fixture(version, [row('FLEET-TEST', 'ALTA')]);
    for (const change of [{ dfm: '' }, { numero_parada: '' }]) {
      assert.throws(() => context.metrogestionInsertarFilaParada_(sheet, { ...command.payload, ...change }, state), /válidos/);
    }
    assert.equal(sheet.inserted, 0);
    const empty = fixture(version, []);
    assert.throws(() => empty.context.metrogestionInsertarFilaParada_(empty.sheet, command.payload, empty.state), /plantilla/);
    assert.equal(empty.sheet.inserted, 0);
  });
}
