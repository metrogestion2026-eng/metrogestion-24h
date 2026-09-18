import fs from 'node:fs';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';

const source75 = fs.readFileSync(new URL('../r1-alpha75/google-apps-script/sincronizar_manteniment.gs', import.meta.url), 'utf8');
const sourceAnterior = fs.readFileSync(new URL('../r1-alpha76/google-apps-script/sincronizar_manteniment.gs', import.meta.url), 'utf8');
const clone = value => JSON.parse(JSON.stringify(value));
const iso = date => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);

function harness(source = source75) {
  let now = Date.parse('2026-09-18T12:00:00Z'), saved;
  const props = new Map();
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  }
  const propsApi = { getProperty: key => props.get(key) ?? null, setProperty: (key, value) => props.set(key, value), deleteProperty: key => props.delete(key) };
  const c = vm.createContext({ console: { warn() {} }, Date: Clock, Map, Set,
    PropertiesService: { getScriptProperties: () => propsApi },
    Utilities: { formatDate: date => iso(date) },
    SpreadsheetApp: { flush() {} },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
  });
  vm.runInContext(source, c);
  c.metrogestionSha256_ = text => createHash('sha256').update(text).digest('hex');
  c.metrogestionLeerCiclo_ = () => saved ? clone(saved) : null;
  c.metrogestionGuardarCiclo_ = state => { saved = clone(state); };
  c.metrogestionLeerToken_ = () => 'test-token';
  const h = { c, props, readMs: 0, advance: ms => { now += ms; }, now: () => now,
    state: () => clone(saved), save: state => { saved = clone(state); }, scheduled: 0 };
  c.ScriptApp = { getProjectTriggers: () => [], newTrigger: () => {
    const trigger = { timeBased: () => trigger, after: () => trigger, create: () => { h.scheduled++; } };
    return trigger;
  } };
  return h;
}

function sheet(h, input) {
  const s = { values: input.map(r => r.slice()), notes: input.map(() => Array(17).fill('')), colors: input.map(() => Array(17).fill('#ffffff')) };
  s.getLastRow = () => s.values.length;
  s.getRowHeight = () => 21;
  s.setRowHeight = () => {};
  s.insertRowAfter = row => {
    for (const [data, blank] of [[s.values, ''], [s.notes, ''], [s.colors, '#ffffff']]) data.splice(row, 0, Array(17).fill(blank));
  };
  s.getRange = (row, column, height = 1, width = 1) => {
    const read = (data, format = value => value) => {
      if (height > 1) h.advance(h.readMs);
      return Array.from({ length: height }, (_, r) => data[row - 1 + r].slice(column - 1, column - 1 + width).map(format));
    };
    const write = (data, value) => { for (let r = 0; r < height; r++) for (let col = 0; col < width; col++) data[row - 1 + r][column - 1 + col] = value; return range; };
    const range = {
      getDisplayValues: () => read(s.values, value => value instanceof Date ? iso(value) : String(value)),
      getNote: () => s.notes[row - 1][column - 1], getNotes: () => read(s.notes),
      getBackground: () => s.colors[row - 1][column - 1], getBackgrounds: () => read(s.colors),
      setValue: value => write(s.values, value), setNote: value => write(s.notes, value),
      setBackground: value => write(s.colors, value), clearNote: () => write(s.notes, ''),
      setValues: values => { values.forEach((r, i) => r.forEach((v, j) => { s.values[row - 1 + i][column - 1 + j] = v; })); return range; },
      setNumberFormat: () => range, clearDataValidations: () => range, copyTo: target => target.setBackground(s.colors[row - 1][column - 1]),
    };
    return range;
  };
  return s;
}

function sgSheet(h, prepared = true) {
  const rows = [Array(17).fill('')];
  for (const [dfm, plate] of [['2724', '4590NGW'], ['2746', '7349NKN']]) {
    const alta = Array(17).fill('');
    Object.assign(alta, { 0: dfm, 1: plate, 7: 'ALTA', 8: '2020-01-01', 9: '2020-02-01' });
    const sg = Array(17).fill('');
    Object.assign(sg, { 0: dfm, 1: plate, 5: 'UPC', 6: 'GESTIÓN', 7: 'SG', 8: '2026-04-01', 9: '2026-04-01', 10: '2026-04-01' });
    rows.push(alta, sg);
  }
  const s = sheet(h, rows);
  s.colors[2].fill('#d9ead3'); s.colors[4].fill('#d9ead3');
  if (prepared) {
    const plan = h.c.metrogestionLeerPlanNecesidades_(s);
    h.c.metrogestionEjecutarPlanNecesidades_(s, plan, { cambios: 3, nuevas: 0, deadline: Infinity });
  }
  h.c.SpreadsheetApp.openById = () => ({ getName: () => 'MANTENIMIENTOS', getSheetByName: () => s });
  return s;
}

function startCycle(h) {
  h.save({ id: 'ciclo-conservado', hoja: '1PQE5VsjTvDFvQZcqedyQKIs3RbSySHFK4JPQXBD0XyU',
    version: vm.runInContext('METROGESTION.scriptVersion', h.c), fase: 'necesidades',
    comandos: [], confirmados: 33, totalComandos: 33, creadas: 0, cierres: 0, mensajeBase: 'Sincronización correcta.' });
}

test('el script anterior repite dos pendientes si la lectura supera su minuto inicial', () => {
  const h = harness(sourceAnterior), s = sgSheet(h);
  h.readMs = 25000;
  for (let i = 0; i < 3; i++) {
    const r = h.c.metrogestionAplicarReglaAdministrativa_(s, { deadline: h.now() + 60000 });
    assert.equal(r.renovaciones, 0); assert.equal(r.restantes, 2); assert.equal(r.pendiente, true);
  }
  assert.equal(s.values.length, 5);
});

test('Alpha75 crea las dos SG con lectura de 75 s, termina y no duplica al repetir', () => {
  const h = harness(), s = sgSheet(h); startCycle(h); h.readMs = 25000;
  const first = h.c.metrogestionContinuarSincronizacion('ciclo-conservado');
  assert.equal(first.pendiente, true); assert.match(first.mensaje, /1 por crear y 0 filas por actualizar/);
  const second = h.c.metrogestionContinuarSincronizacion('ciclo-conservado');
  assert.equal(second.pendiente, false); assert.equal(h.state().creadas, 2);
  assert.equal(h.state().confirmados, 33); assert.equal(h.state().id, 'ciclo-conservado');
  const children = s.values.filter(row => row[7] === 'SG' && !row[9]);
  assert.equal(children.length, 2); assert.ok(children.every(row => iso(row[8]) === '2027-04-01'));
  assert.ok(s.values.filter(row => row[7] === 'SG' && row[9]).every(row => row[9] === '2026-04-01' && row[10] === '2026-04-01'));
  const third = h.c.metrogestionContinuarSincronizacion('ciclo-conservado');
  assert.equal(third.pendiente, false); assert.equal(s.values.length, 7);
  const repeat = h.c.metrogestionAplicarReglaAdministrativa_(s);
  assert.equal(repeat.renovaciones, 0); assert.equal(repeat.restantes, 0);
});

test('guarda primero los padres y después inserta una necesidad por tanda', () => {
  const h = harness(), s = sgSheet(h, false); startCycle(h); h.readMs = 25000;
  h.c.metrogestionContinuarSincronizacion('ciclo-conservado');
  assert.equal(h.state().creadas, 0); assert.equal(h.state().nuevasPendientes, 2);
  assert.equal(h.state().cambiosPendientes, 0); assert.equal(s.values.length, 5);
  h.c.metrogestionContinuarSincronizacion('ciclo-conservado');
  h.c.metrogestionContinuarSincronizacion('ciclo-conservado');
  assert.equal(h.state().fase, 'terminado'); assert.equal(h.state().creadas, 2);
});

test('una lectura que consume el límite global se detiene sin insertar ni anunciar continuidad', () => {
  const h = harness(), s = sgSheet(h); startCycle(h); h.readMs = 90000;
  assert.throws(() => h.c.metrogestionContinuarSincronizacion('ciclo-conservado'), /lectura.*agotado.*2 próximas necesidades/);
  assert.equal(s.values.length, 5); assert.equal(h.state().creadas, 0); assert.equal(h.state().confirmados, 33);
});

test('tres planes idénticos sin avance detienen también la programación automática', () => {
  const h = harness(), s = sgSheet(h); startCycle(h); h.readMs = 25000;
  const hash = h.c.metrogestionSha256_;
  // Simula agotar el minuto entre planificar y entrar en el escritor.
  h.c.metrogestionSha256_ = value => { h.advance(61000); return hash(value); };
  for (let i = 0; i < 2; i++) assert.equal(h.c.metrogestionLanzarProgramada_('ciclo-conservado').pendiente, true);
  assert.throws(() => h.c.metrogestionLanzarProgramada_('ciclo-conservado'), /detenido la continuación automática.*2724.*2746/);
  assert.equal(h.scheduled, 2); assert.equal(s.values.length, 5);
  assert.equal(h.state().confirmados, 33); assert.equal(h.state().creadas, 0);
  assert.match(h.c.metrogestionDiagnosticoSincronizacion().paso, /Sin avance.*2724.*2746/);
});

test('actualizar el ciclo .5 conserva identificador, órdenes confirmadas y contadores', () => {
  const h = harness(), s = sgSheet(h); startCycle(h);
  h.save({ ...h.state(), version: 'alpha75-2026.09.17.5', creadas: 4, cierres: 6,
    planNecesidadesAnterior: 'antiguo', tandasNecesidadesRepetidas: 2 });
  assert.equal(h.c.metrogestionContinuarSincronizacion('ciclo-conservado').pendiente, true);
  assert.equal(h.state().creadas, 4); assert.equal(h.state().cierres, 6); assert.equal(h.state().confirmados, 33);
  assert.equal(h.state().version, 'alpha75-2026.09.18.1'); assert.equal(h.state().planNecesidadesAnterior, undefined);
  assert.equal(s.values.length, 5);
});

test('la pausa conserva la hoja y permite terminar la sincronización', () => {
  const h = harness(), s = sgSheet(h); startCycle(h);
  h.props.set('METROGESTION_NECESIDADES_PAUSADAS', 'true');
  const r = h.c.metrogestionContinuarSincronizacion('ciclo-conservado');
  assert.equal(r.pendiente, false); assert.equal(h.state().pausadas, true); assert.equal(s.values.length, 5);
});
