import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const c = vm.createContext({ console, Date });
const script = fs.readFileSync(new URL('../r1-alpha75/google-apps-script/sincronizar_manteniment.gs', import.meta.url), 'utf8');
vm.runInContext(script, c);
c.metrogestionRegistrarPaso_ = () => {};
c.PropertiesService = { getScriptProperties: () => ({ getProperty: () => null }) };
c.Utilities = { formatDate: () => '2026-09-17' };
const json = x => JSON.parse(JSON.stringify(x));
const make = (type, fields = {}, extra = {}) => {
  const values = Array(17).fill('');
  Object.assign(values, { 0: '9000', 1: '1234AAA', 6: 'TRÁMITE', 7: type, 14: 'IVECO' }, fields);
  return { values, note: '', colorH: '#ffffff', colorG: '#ffffff', colorM: '#ffff00', ...extra };
};
const alta = () => make('ALTA', { 8: '2021-01-10', 9: '2021-01-10', 10: '2021-01-10' });
const records = rows => rows.map((r, i) => ({ ...r, row: i + 2 }));
const plan = rows => json(c.metrogestionPlanificarNecesidades_(records(rows), '2026-09-17'));
const nextOf = (p, type) => p.nuevas.filter(n => n.values[7] === type);

class Sheet {
  constructor(rows) {
    this.rows = [make('CABECERA'), ...structuredClone(rows)];
    this.rows.forEach(r => { r.notes = Array(17).fill(''); r.notes[8] = r.note; r.colors = Array(17).fill(r.colorH); r.colors[6] = r.colorG; r.colors[12] = r.colorM; });
    this.failNextNote = false;
  }
  getRange(row, col, height = 1, width = 1) {
    assert.ok(col + width - 1 <= 17, 'No tocar las fórmulas R/S');
    const sheet = this;
    const each = fn => { for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) fn(sheet.rows[row + y - 1], col + x - 1, y, x); };
    const range = {
      getDisplayValues() { return Array.from({ length: height }, (_, y) => sheet.rows[row + y - 1].values.slice(col - 1, col - 1 + width).map(v => v instanceof Date ? c.metrogestionFechaIsoDesdeDate_(v) : String(v || ''))); },
      getBackground: () => sheet.rows[row - 1].colors[col - 1],
      getBackgrounds: () => Array.from({ length: height }, (_, y) => sheet.rows[row + y - 1].colors.slice(col - 1, col - 1 + width)),
      getNote: () => sheet.rows[row - 1].notes[col - 1],
      getNotes: () => Array.from({ length: height }, (_, y) => sheet.rows[row + y - 1].notes.slice(col - 1, col - 1 + width)),
      setValue(v) { each((r, i) => { r.values[i] = v; }); return range; },
      setValues(v) { each((r, i, y, x) => { r.values[i] = v[y][x]; }); return range; },
      setNote(v) { if (sheet.failNextNote && row === sheet.failureRow) { sheet.failNextNote = false; throw new Error('Interrupción'); } each((r, i) => { r.notes[i] = v; }); return range; },
      setBackground(v) { each((r, i) => { r.colors[i] = v; }); return range; },
      clearContent() { return range.setValue(''); },
      clearNote() { each((r, i) => { r.notes[i] = ''; }); return range; },
      clearDataValidations() { return range; },
      setNumberFormat() { return range; },
      copyTo(target, options) { if (!options?.formatOnly) target.setValues(range.getDisplayValues()); },
    };
    return range;
  }
  insertRowAfter(row) { const empty = make(''); empty.notes = Array(17).fill(''); empty.colors = Array(17).fill('#ffffff'); this.rows.splice(row, 0, empty); }
  getLastRow() { return this.rows.length; }
  getRowHeight() { return 21; }
  setRowHeight() {}
  records() { return this.rows.slice(1).map((r, i) => ({ row: i + 2, values: this.getRange(i + 2, 1, 1, 17).getDisplayValues()[0], note: r.notes[8], colorH: r.colors[7], colorM: r.colors[12], colorG: r.colors[6] })); }
  plan() { return c.metrogestionPlanificarNecesidades_(this.records(), '2026-09-17'); }
  sync() { const p = this.plan(); c.metrogestionEjecutarPlanNecesidades_(this, p); return p; }
}

test('ITV conserva el mes anterior; fuera de ventana toma J, con calendario bisiesto', () => {
  assert.equal(c.metrogestionSiguienteCaducidadItv_('2026-09-30', '2026-08-30'), '2027-09-30');
  assert.equal(c.metrogestionSiguienteCaducidadItv_('2026-09-30', '2026-08-29'), '2027-08-29');
  assert.equal(c.metrogestionSiguienteCaducidadItv_('2026-09-30', '2026-10-01'), '2027-10-01');
  assert.equal(c.metrogestionMoverAnos_('2024-02-29', 2), '2026-02-28');
  assert.equal(c.metrogestionFechaNecesidad_('1/4/27'), '2027-04-01');
  assert.throws(() => c.metrogestionFechaNecesidad_('31/02/2026'));
});

for (const [type, date] of [['RT', '2028-09-02'], ['TMG', '2028-09-02'], ['LKT', '2027-09-02'], ['SG', '2027-04-01']]) {
  test(`${type}: próxima fecha desde su referencia, sin copiar parada/pedido/documentación`, () => {
    const p = plan([alta(), make(type, { 4: 'PA-2600001', 6: '26001234', 8: '2026-04-01', 9: '2026-09-02', 14: 'CARRIER', 16: 'documento anterior' }, { colorG: '#ffff00' })]);
    const n = nextOf(p, type)[0]; assert.equal(n.values[8], date);
    [4, 9, 10, 11, 12, 13, 15, 16].forEach(i => assert.equal(n.values[i], ''));
    assert.equal(n.values[6], type === 'SG' ? 'GESTIÓN' : 'TRÁMITE');
  });
}

for (const type of ['ATP', 'EXTINTOR']) test(`${type}: M exacta, sin sumar otro año ni estimar`, () => {
  const src = make(type, { 8: '2026-01-01', 9: '2026-09-02', 12: '2027-05-01' });
  assert.equal(nextOf(plan([alta(), src]), type)[0].values[8], '2027-05-01');
  src.values[12] = '';
  const p = plan([alta(), src]); assert.equal(nextOf(p, type).length, 0); assert.match(p.avisos[0].motivo, /Falta/);
});

test('LKT requiere marca comprobada; Carrier trámite, otras gestión', () => {
  for (const [brand, category] of [['CARRIER', 'TRÁMITE'], ['Termo King', 'GESTIÓN'], ['DAIKIN', 'GESTIÓN']]) {
    const p = plan([alta(), make('LKT', { 8: '2026-01-01', 9: '2026-09-01', 14: brand })]);
    assert.equal(nextOf(p, 'LKT')[0].values[6], category);
  }
  const p = plan([alta(), make('LKT', { 8: '2026-01-01', 9: '2026-09-01', 14: 'IVECO' })]);
  assert.equal(nextOf(p, 'LKT').length, 0); assert.ok(p.avisos.some(w => /marca/.test(w.motivo)));
});

test('LINDEP: primera a cinco años de matriculación, luego K + tres; nunca J = K', () => {
  const a = alta(); a.values[14] = 'CARRIER';
  assert.equal(nextOf(plan([a]), 'LINDEP')[0].values[8], '2026-01-10');
  const started = make('LINDEP', { 8: '2026-01-10', 9: '2026-09-01' });
  assert.equal(nextOf(plan([a, started]), 'LINDEP').length, 0);
  assert.equal(plan([a, started]).cambios.filter(x => x.cierre).length, 0);
  started.values[10] = '2026-09-05';
  const p = plan([a, started]); assert.equal(nextOf(p, 'LINDEP')[0].values[8], '2029-09-05');
  assert.equal(p.cambios.find(x => x.fila === 3).values[10], '2026-09-05');
});

test('44TN y OTA cierran sin próxima; físicos conservan J/K y exclusiones intactas', () => {
  for (const type of ['44TN', 'OTA']) { const p = plan([alta(), make(type, { 8: '2026-01-01', 9: '2026-09-01' })]); assert.equal(p.nuevas.length, 0); assert.equal(p.cambios[0].values[10], '2026-09-01'); }
  for (const type of ['REPUESTOS', 'ACT', 'CV', 'REFORMA', 'PLATAFORMA', 'TELEMÁTICA']) {
    const p = plan([alta(), make(type, { 8: '2026-01-01', 9: '2026-09-01' })]); assert.equal(p.nuevas.length, 0); assert.equal(p.cambios.length, 0);
  }
});

test('reutiliza la próxima manual, y bloquea fechas o duplicados ambiguos', () => {
  const done = make('RT', { 8: '2026-01-01', 9: '2026-09-01', 10: '2026-09-01' });
  const future = make('RT', { 8: '2028-09-01' });
  assert.equal(nextOf(plan([alta(), done, future]), 'RT').length, 0);
  const mismatch = make('RT', { 8: '2028-10-01' });
  assert.ok(plan([alta(), done, mismatch]).avisos.some(w => /otra fecha/.test(w.motivo)));
  assert.ok(plan([alta(), done, future, future]).avisos.some(w => /Más de una/.test(w.motivo)));
});

test('solo el último ciclo renueva; bajas y futuros no se cierran', () => {
  const p = plan([alta(), make('RT', { 8: '2022-01-01', 9: '2022-01-01', 10: '2022-01-01' }), make('RT', { 8: '2024-01-01', 9: '2024-01-01', 10: '2024-01-01' })]);
  assert.equal(nextOf(p, 'RT').length, 1); assert.equal(nextOf(p, 'RT')[0].values[8], '2026-01-01');
  assert.equal(plan([alta(), make('BAJA'), make('RT', { 8: '2026-01-01', 9: '2026-09-01' })]).nuevas.length, 0);
  assert.equal(plan([alta(), make('44TN', { 8: '2026-01-01', 9: '2026-10-01' })]).cambios.length, 0);
});

test('dos sincronizaciones, corrección y reapertura mantienen una sola hija', () => {
  const sheet = new Sheet([alta(), make('RT', { 4: 'PA-1', 6: '26001234', 8: '2026-01-01', 9: '2026-09-01' }, { colorG: '#ffff00', note: 'Nota humana' })]);
  sheet.sync(); assert.equal(sheet.rows.length, 4);
  assert.equal(sheet.rows[2].colors[6], '#ffff00'); assert.equal(sheet.rows[2].colors[12], '#ffff00');
  assert.ok(sheet.rows[2].notes[8].startsWith('Nota humana\n'));
  assert.equal(sheet.sync().nuevas.length, 0);
  sheet.rows[2].values[9] = '2026-09-02'; sheet.rows[2].values[10] = '2026-09-02';
  sheet.sync(); assert.equal(c.metrogestionFechaIsoDesdeDate_(sheet.rows[3].values[8]), '2028-09-02');
  sheet.rows[2].values[9] = ''; sheet.rows[2].values[10] = '';
  sheet.sync(); assert.equal(sheet.rows[3].values[7], 'ANULADA');
  sheet.rows[2].values[9] = '2026-09-02'; sheet.rows[2].values[10] = '2026-09-02';
  sheet.sync(); assert.equal(sheet.rows[3].values[7], 'RT'); assert.equal(sheet.rows.length, 4);
});

test('corregir origen no mueve una hija que el usuario ha editado', () => {
  const sheet = new Sheet([alta(), make('RT', { 8: '2026-01-01', 9: '2026-09-01' })]); sheet.sync();
  sheet.rows[3].values[5] = 'TALLER ELEGIDO';
  sheet.rows[2].values[9] = '2026-09-02'; sheet.rows[2].values[10] = '2026-09-02';
  const p = sheet.sync(); assert.equal(p.nuevas.length, 0); assert.ok(p.avisos.some(w => /cambios/.test(w.motivo)));
  assert.equal(c.metrogestionFechaIsoDesdeDate_(sheet.rows[3].values[8]), '2028-09-01');
});

test('anular el último ciclo no resucita una renovación antigua', () => {
  const sheet = new Sheet([alta(), make('RT', { 8: '2022-01-01', 9: '2022-01-01', 10: '2022-01-01' }), make('RT', { 8: '2024-01-01', 9: '2024-01-01', 10: '2024-01-01' })]);
  sheet.sync(); sheet.rows[3].values[7] = 'ANULADA';
  const p = sheet.sync(); assert.equal(p.nuevas.length, 0); assert.equal(sheet.rows[4].values[7], 'ANULADA');
});

test('una nota copiada a otra unidad no permite mover su siguiente necesidad', () => {
  const sheet = new Sheet([alta(), make('RT', { 8: '2026-01-01', 9: '2026-09-01' })]); sheet.sync();
  sheet.rows[2].values[0] = 'OTRA';
  const p = sheet.sync(); assert.equal(p.nuevas.length, 0); assert.ok(p.avisos.some(w => /unidad|origen/.test(w.motivo)));
  assert.equal(sheet.rows[3].values[0], '9000');
});

test('REPUESTOS pedido y LINDEP entrada siguen pendientes hasta K en el envío', () => {
  for (const type of ['REPUESTOS', 'LINDEP', 'ACT', 'CV']) {
    const vals = [Array(17).fill(''), make(type, { 8: '2026-09-01', 9: '2026-09-02' }).values];
    const works = c.metrogestionLeerTrabajos_(vals, [[''], ['']], [['#fff'], ['#fff']], [['#fff'], ['#fff']], '2026-10-17', [['#fff'], ['#fff']]);
    assert.equal(works.length, 1); assert.equal(works[0].fecha_realizada, '2026-09-02'); assert.equal(works[0].fecha_recogida, '');
  }
});

test('interrupción tras insertar valores: el reintento reconoce la fila sin duplicarla', () => {
  const sheet = new Sheet([alta(), make('RT', { 8: '2026-01-01', 9: '2026-09-01' })]);
  sheet.failNextNote = true; sheet.failureRow = 4;
  assert.throws(() => sheet.sync(), /Interrupción/);
  assert.equal(sheet.rows.length, 4); assert.equal(sheet.sync().nuevas.length, 0); assert.equal(sheet.rows.length, 4);
});

test('la copia distribuida incluye exactamente el motor y adaptador revisados', () => {
  for (const file of ['manteniment-necesidades.js', 'manteniment-necesidades-adapter.js', 'manteniment-sync-batches.js']) {
    assert.ok(script.includes(fs.readFileSync(new URL(`../shared/${file}`, import.meta.url), 'utf8').trim()));
  }
});

test('94 renovaciones se completan con 3 cambios o 1 nueva por llamada, sin mezclarlos ni duplicarse', () => {
  const inputs = [];
  for (let i = 0; i < 94; i++) {
    const a = alta(); a.values[0] = String(1000 + i);
    const r = make('RT', { 0: a.values[0], 8: '2026-01-01', 9: '2026-09-01' });
    inputs.push(a, r);
  }
  const sheet = new Sheet(inputs);
  let created = 0, calls = 0;
  for (; calls < 160; calls++) {
    const result = c.metrogestionAplicarReglaAdministrativa_(sheet, { deadline: Infinity });
    assert.ok(result.cambiosAplicados <= 3); assert.ok(result.renovaciones <= 1);
    assert.ok(!result.cambiosAplicados || !result.renovaciones, 'No editar e insertar en la misma llamada');
    created += result.renovaciones;
    if (!result.pendiente) break;
  }
  assert.ok(calls > 94 && calls < 160); assert.equal(created, 94);
  assert.equal(sheet.rows.length, 1 + 188 + 94); assert.equal(sheet.plan().nuevas.length, 0);
});

test('si la comprobación del padre agota el tiempo no empieza la inserción', () => {
  const sheet = new Sheet([alta(), make('RT', { 8: '2026-01-01', 9: '2026-09-01' })]);
  c.metrogestionEjecutarPlanNecesidades_(sheet, sheet.plan(), { cambios: 3, nuevas: 0, deadline: Infinity });
  const p = sheet.plan(); let now = 0;
  c.Date = class extends Date { static now() { return now; } };
  sheet.getRowHeight = () => { now = 2000; return 21; };
  try {
    const result = c.metrogestionEjecutarPlanNecesidades_(sheet, p, { cambios: 3, nuevas: 1, deadline: 1000 });
    assert.equal(result.renovaciones, 0); assert.equal(result.pendiente, true); assert.equal(sheet.rows.length, 3);
  } finally { c.Date = Date; }
});

test('si vence el presupuesto de tiempo, no empieza escrituras ni pierde lo pendiente', () => {
  const sheet = new Sheet([alta(), make('RT', { 8: '2026-01-01', 9: '2026-09-01' })]);
  const p = sheet.plan();
  const result = c.metrogestionEjecutarPlanNecesidades_(sheet, p, { cambios: 12, nuevas: 4, deadline: 0 });
  assert.equal(result.renovaciones, 0); assert.equal(result.cambiosAplicados, 0); assert.equal(result.pendiente, true);
  assert.equal(sheet.rows.length, 3);
});
