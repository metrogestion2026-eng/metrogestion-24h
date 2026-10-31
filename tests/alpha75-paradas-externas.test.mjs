import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { createExecutorHarness, HEADERS, IDS, scopeOf } from './helpers/alpha75-sync-executor-harness.mjs';

const blank = () => Array(19).fill('');
const row = (dfm, estado, stop = '') => {
  const value = blank();
  [value[0], value[1], value[4], value[7]] = [dfm, 'TEST-PLATE', stop, estado];
  return value;
};

function richTextBuilder(text = '', url = '') {
  return {
    setText(value) { text = value; return this; },
    setLinkUrl(value) { url = value; return this; },
    build() {
      const savedText = text, savedUrl = url;
      return {
        getText: () => savedText,
        getLinkUrl: () => savedUrl,
        copy: () => richTextBuilder(savedText, savedUrl),
      };
    },
  };
}

function archiveFixture(location) {
  let sequence = 0;
  const created = [];
  function folder(name, parent = null) {
    const id = `folder-test-${++sequence}`;
    const result = {
      name, parent, children: [],
      getId: () => id,
      getUrl: () => `https://drive.google.com/drive/folders/${id}`,
      getDateCreated: () => new Date('2026-01-01T00:00:00Z'),
      getFoldersByName(target) {
        const matches = this.children.filter(child => child.name === target);
        let index = 0;
        return { hasNext: () => index < matches.length, next: () => matches[index++] };
      },
      createFolder(target) {
        const child = folder(target, this);
        created.push(child);
        return child;
      },
    };
    parent?.children.push(result);
    return result;
  }
  const root = folder('A-FLOTA');
  const exchange = folder('7A INTERCAMBIO', root);
  const vehicle = location === 'missing' ? null : folder('EXT-TEST', location === 'exchange' ? exchange : root);
  return { root, exchange, vehicle, created, folder };
}

function fixture(version, rows, location = 'fleet') {
  const source = fs.readFileSync(new URL(`../r1-${version}/google-apps-script/sincronizar_manteniment.gs`, import.meta.url), 'utf8');
  const context = vm.createContext({ console });
  vm.runInContext(source, context);
  const archive = archiveFixture(location);
  const archiveId = vm.runInContext('METROGESTION.archivoFlotaFolderId', context);
  context.DriveApp = { getFolderById(id) { assert.equal(id, archiveId); return archive.root; } };
  context.SpreadsheetApp = { newRichTextValue: () => richTextBuilder() };
  // Keep the complete row-and-archive flow; assigned-work reconciliation has
  // independent coverage and no assigned work is needed in these fixtures.
  context.metrogestionAplicarAsignacionesTrabajos_ = () => 0;
  const data = [blank(), ...rows.map(value => value.slice())];
  const notes = data.map(blank);
  const richTexts = data.map(() => Array(19).fill(null));
  const sheet = {
    data, notes, richTexts, copies: [], inserted: 0, linkWrites: 0,
    getLastRow: () => data.length,
    insertRowAfter(index) {
      data.splice(index, 0, blank()); notes.splice(index, 0, blank());
      richTexts.splice(index, 0, Array(19).fill(null)); this.inserted++;
    },
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
        getRichTextValues: () => richTexts.slice(r - 1, r - 1 + nr).map(value => value.slice(c - 1, c - 1 + nc)),
        getRichTextValue: () => richTexts[r - 1][c - 1],
        setRichTextValue(value) {
          cells((y, x) => { data[y][x] = value.getText(); richTexts[y][x] = value; });
          sheet.linkWrites++; return this;
        },
        setValues(values) { cells((y, x) => { data[y][x] = values[y - r + 1][x - c + 1]; richTexts[y][x] = null; }); return this; },
        setValue(value) { cells((y, x) => { data[y][x] = value; richTexts[y][x] = null; }); return this; },
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
  return { context, sheet, state, command, archive };
}

// Alpha76 conserva íntegros su ejecutor y sus once recorridos anteriores.
// Alpha75 se prueba debajo por planificación + autorización + journal reales.
for (const version of ['alpha76']) {
  test(`${version}: intercambio sin ALTA completa la orden y enlaza su carpeta, incluso al reintentar`, () => {
    const { context, sheet, state, command, archive } = fixture(version, [row('FLEET-TEST', 'ALTA')], 'exchange');
    const apply = () => context.metrogestionAplicarComandos_(sheet, [command], state, [])[0];
    const result = apply();
    assert.equal(result.estado, 'aplicado');
    assert.equal(result.filas_archivo_enlazadas, 1);
    assert.equal(result.fila, 3);
    assert.equal(archive.created.length, 2);
    const [paradas, stop] = archive.created;
    assert.equal(paradas.name, 'PARADAS');
    assert.equal(paradas.parent, archive.vehicle);
    assert.equal(stop.name, command.payload.numero_parada);
    assert.equal(stop.parent, paradas);
    assert.equal(sheet.richTexts[2][4].getLinkUrl(), stop.getUrl());
    assert.equal(archive.root.children.some(folder => folder.name === 'EXT-TEST'), false);
    assert.equal(sheet.data.some(value => value[0] === 'EXT-TEST' && value[7] === 'ALTA'), false);
    vm.runInContext('METROGESTION_EXECUTION_CACHE.clear()', context);
    assert.equal(apply().fila, 3);
    assert.equal(sheet.inserted, 1);
    assert.equal(archive.created.length, 2);
    assert.equal(sheet.richTexts[2][4].getLinkUrl(), stop.getUrl());
  });

  test(`${version}: trabajos de intercambio reutilizan la carpeta ya enlazada entre carpetas duplicadas`, () => {
    const { context, sheet, state, command, archive } = fixture(version, [row('EXT-TEST', 'GC', 'PA-9999999'), row('EXT-TEST', 'AV', 'PA-9999999')], 'exchange');
    command.payload.solo_trabajos = true;
    const first = archive.folder('PARADAS', archive.vehicle);
    archive.folder('PA-9999999', first);
    const second = archive.folder('PARADAS', archive.vehicle);
    const preferred = archive.folder('PA-9999999', second);
    sheet.richTexts[1][4] = richTextBuilder('PA-9999999', preferred.getUrl()).build();
    const result = context.metrogestionAplicarComandos_(sheet, [command], state, [])[0];
    assert.equal(result.tipo, 'trabajos');
    if (version === 'alpha75') {
      assert.equal(result.filas_archivo_enlazadas, 0);
      assert.equal(sheet.inserted, 0);
      assert.equal(sheet.linkWrites, 0);
      assert.equal(sheet.richTexts[1][4].getLinkUrl(), preferred.getUrl());
      assert.equal(sheet.richTexts[2][4], null);
      assert.equal(archive.created.length, 0);
    } else {
      assert.equal(result.filas_archivo_enlazadas, 2);
      assert.equal(sheet.inserted, 0);
      assert.equal(sheet.linkWrites, 1);
      assert.equal(sheet.richTexts[1][4].getLinkUrl(), preferred.getUrl());
      assert.equal(sheet.richTexts[2][4].getLinkUrl(), preferred.getUrl());
      assert.equal(archive.created.length, 0);
    }
  });

  test(`${version}: conserva el archivo directo de flota`, () => {
    const { context, sheet, state, command, archive } = fixture(version, [row('EXT-TEST', 'ALTA')]);
    archive.folder('EXT-TEST', archive.exchange);
    context.metrogestionAplicarComandos_(sheet, [command], state, []);
    assert.equal(archive.created[0].parent, archive.vehicle);
    assert.equal(archive.exchange.children[0].children.length, 0);
  });

  test(`${version}: un archivo ausente informa y permite reintentar sin duplicar la fila`, () => {
    const { context, sheet, state, command, archive } = fixture(version, [row('FLEET-TEST', 'ALTA')], 'missing');
    const apply = () => context.metrogestionAplicarComandos_(sheet, [command], state, [])[0];
    assert.throws(apply, /A-FLOTA\/7A INTERCAMBIO/);
    assert.equal(sheet.inserted, 1);
    assert.equal(archive.created.length, 0);
    assert.equal(sheet.linkWrites, 0);
    const vehicle = archive.folder('EXT-TEST', archive.exchange);
    assert.equal(apply().estado, 'aplicado');
    assert.equal(sheet.inserted, 1);
    assert.equal(archive.created[0].parent, vehicle);
  });

  test(`${version}: archivos ambiguos o sin permiso no crean carpetas ni escriben enlaces`, () => {
    for (const duplicate of ['vehicle', 'exchange', 'access']) {
      const { context, sheet, state, command, archive } = fixture(version, [row('EXT-TEST', 'PARADA', 'PA-9999999')], 'exchange');
      if (duplicate === 'vehicle') archive.folder('EXT-TEST', archive.exchange);
      if (duplicate === 'exchange') archive.folder('7A INTERCAMBIO', archive.root);
      if (duplicate === 'access') context.DriveApp.getFolderById = () => { throw new Error('Sin permiso de prueba'); };
      assert.throws(() => context.metrogestionEnlazarArchivoParada_(sheet, command.payload.numero_parada, command.payload.dfm, state), /más de una carpeta|Sin permiso/);
      assert.equal(archive.created.length, 0);
      assert.equal(sheet.linkWrites, 0);
    }
  });

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

function executorFixture(rows, location = 'fleet') {
  const h = createExecutorHarness({ rows: [HEADERS, ...rows], dfmFolders: [] });
  const root = h.world.folders.get('synthetic-root'), exchange = root.add('7A INTERCAMBIO');
  const vehicle = location === 'missing' ? null : (location === 'exchange' ? exchange : root).add('EXT-TEST');
  const command = { tipo: 'parada', sync_id: IDS.stop, revision: 2,
    payload: { sync_id: IDS.stop, dfm: 'EXT-TEST', matricula: 'TEST-EXTERNAL', tipo: 'TR', upc: 'TEST',
      numero_parada: 'PA-9999999', sustituto: 'RES-TEST', estado: 'PARADA', fecha_parada: '2026-09-20',
      fecha_k: null, dias_parada: 2, marca: 'TEST', tancament: 'TANCAMENT 9', trabajos_crear: [], trabajos_asignados: [] } };
  let cycle;
  const apply = () => {
    if (!cycle) {
      command.payload_sha256 = createHash('sha256').update(JSON.stringify(command.payload)).digest('hex');
      h.call('metrogestionGuardarAlcanceOrdenes_', [scopeOf(command)]);
      cycle = h.newState([command]); h.save(cycle); h.clearEvents();
    } else if (cycle.fase === 'terminado') {
      // Reintroducir exactamente la misma referencia verifica el tombstone
      // confirmado: no debe reaplicar ni mandar otro ACK.
      cycle = h.newState([command]); h.save(cycle);
    }
    h.process(cycle);
    return Object.entries(h.properties).filter(([key]) => key.startsWith('METROGESTION_ORDEN_V1:'))
      .map(([, value]) => JSON.parse(value))[0].confirmacion;
  };
  const data = () => h.sheet.getRange(1, 1, h.sheet.getLastRow(), 19).getValues();
  const created = () => h.effects.filter(event => event.kind === 'drive' && event.method === 'createFolder');
  const inserted = () => h.effects.filter(event => event.method === 'insertRowAfter');
  const copies = () => h.effects.filter(event => event.method === 'copyTo').map(event => ({
    source: Number(event.args[0].match(/^R(\d+)/)[1]), target: event.range[0], columns: event.range[3] }));
  return { h, root, exchange, vehicle, command, apply, data, created, inserted, copies };
}

test('alpha75: intercambio sin ALTA completa la orden y enlaza su carpeta, incluso al reintentar', () => {
  const f = executorFixture([row('FLEET-TEST', 'ALTA')], 'exchange');
  const result = f.apply();
  assert.equal(result.estado, 'aplicado'); assert.equal(result.filas_archivo_enlazadas, 1); assert.equal(result.fila, 3);
  assert.equal(f.created().length, 2);
  const paradas = f.vehicle.children[0], stop = paradas.children[0];
  assert.equal(paradas.name, 'PARADAS'); assert.equal(paradas.parent, f.vehicle);
  assert.equal(stop.name, f.command.payload.numero_parada); assert.equal(stop.parent, paradas);
  assert.equal(f.h.sheet.at(3, 5).link, stop.getUrl());
  assert.equal(f.root.children.some(folder => folder.name === 'EXT-TEST'), false);
  assert.equal(f.data().some(value => value[0] === 'EXT-TEST' && value[7] === 'ALTA'), false);
  const after = f.h.snapshot(), effects = f.h.effects.length, http = f.h.httpCalls.length;
  assert.equal(f.apply().fila, 3);
  assert.equal(f.inserted().length, 1); assert.equal(f.created().length, 2);
  assert.deepEqual(f.h.snapshot(), after); assert.equal(f.h.effects.length, effects); assert.equal(f.h.httpCalls.length, http);
});

test('alpha75: trabajos de intercambio conservan el enlace existente sin resolver carpetas duplicadas', () => {
  const firstWork = row('EXT-TEST', 'GC', 'PA-9999999'); firstWork[8] = '20/09/2026';
  const f = executorFixture([firstWork, row('EXT-TEST', 'AV', 'PA-9999999')], 'exchange');
  f.command.tipo = 'trabajos';
  f.command.payload = { sync_id: IDS.stop, seguimiento_id: IDS.stop, numero_parada: 'PA-9999999', solo_trabajos: true,
    trabajos_crear: [], trabajos_asignados: [{ trabajo_sync_id: IDS.work, fila: 2, clave_fila: 'EXT-TEST|TEST-PLATE|||GC|2026-09-20' }] };
  const first = f.vehicle.add('PARADAS'); first.add('PA-9999999');
  const second = f.vehicle.add('PARADAS'), preferred = second.add('PA-9999999');
  f.h.sheet.at(2, 5).link = preferred.getUrl();
  const result = f.apply();
  assert.equal(result.tipo, 'trabajos'); assert.equal(result.filas_archivo_enlazadas, 0);
  assert.equal(f.inserted().length, 0); assert.equal(f.created().length, 0);
  assert.equal(f.h.effects.filter(event => event.method === 'setRichTextValue').length, 0);
  assert.equal(f.h.sheet.at(2, 5).link, preferred.getUrl()); assert.equal(f.h.sheet.at(3, 5).link, '');
  assert.equal(f.h.sheet.at(2, 5).note, `METROGESTION_T:${IDS.work}`);
});

test('alpha75: conserva el archivo directo de flota', () => {
  const f = executorFixture([row('EXT-TEST', 'ALTA')]);
  const alternate = f.exchange.add('EXT-TEST');
  f.apply();
  assert.equal(f.created()[0].parent, f.vehicle.getId());
  assert.equal(alternate.children.length, 0);
});

test('alpha75: PARADA reutiliza la carpeta canónica acreditada por un enlace existente entre duplicadas', () => {
  const f = executorFixture([row('EXT-TEST', 'GC', 'PA-9999999')], 'exchange');
  const oldParent = f.vehicle.add('PARADAS'); oldParent.add('PA-9999999');
  const chosenParent = f.vehicle.add('PARADAS'), chosen = chosenParent.add('PA-9999999');
  f.h.sheet.at(2, 5).link = chosen.getUrl();
  const result = f.apply();
  assert.equal(result.filas_archivo_enlazadas, 2);
  assert.equal(f.h.sheet.at(2, 5).link, chosen.getUrl());
  assert.equal(f.h.sheet.at(3, 5).link, chosen.getUrl());
  assert.equal(f.created().length, 0); assert.equal(f.inserted().length, 1);
  const before = f.h.snapshot(); f.apply(); assert.deepEqual(f.h.snapshot(), before);
});

test('alpha75: dos enlaces canónicos contradictorios bloquean PARADA antes de insertar o autorizar', () => {
  const f = executorFixture([row('EXT-TEST', 'GC', 'PA-9999999'), row('EXT-TEST', 'AV', 'PA-9999999')], 'exchange');
  const first = f.vehicle.add('PARADAS').add('PA-9999999'), second = f.vehicle.add('PARADAS').add('PA-9999999');
  f.h.sheet.at(2, 5).link = first.getUrl(); f.h.sheet.at(3, 5).link = second.getUrl();
  const before = f.h.snapshot();
  assert.throws(f.apply, /enlaces existentes contradictorios/);
  assert.deepEqual(f.h.snapshot(), before); assert.deepEqual(f.h.effects, []); assert.equal(f.h.httpCalls.length, 0);
});

test('alpha75: un archivo ausente rechaza sin insertar y permite reintentar con la misma orden', () => {
  const f = executorFixture([row('FLEET-TEST', 'ALTA')], 'missing'), before = f.h.snapshot();
  assert.throws(f.apply, /carpeta inequívoca/);
  assert.deepEqual(f.h.effects, []); assert.deepEqual(f.h.snapshot(), before); assert.equal(f.h.httpCalls.length, 0);
  const vehicle = f.exchange.add('EXT-TEST');
  assert.equal(f.apply().estado, 'aplicado');
  assert.equal(f.inserted().length, 1); assert.equal(f.created()[0].parent, vehicle.getId());
});

test('alpha75: archivos ambiguos o sin permiso no modifican la hoja ni crean carpetas', () => {
  for (const duplicate of ['vehicle', 'exchange', 'access']) {
    const f = executorFixture([row('FLEET-TEST', 'ALTA')], 'exchange');
    if (duplicate === 'vehicle') f.exchange.add('EXT-TEST');
    if (duplicate === 'exchange') f.root.add('7A INTERCAMBIO');
    if (duplicate === 'access') f.h.context.DriveApp.getFolderById = () => { throw new Error('Sin permiso de prueba'); };
    const before = f.h.snapshot();
    assert.throws(f.apply, /más de una carpeta|Sin permiso/);
    assert.deepEqual(f.h.effects, []); assert.deepEqual(f.h.snapshot(), before); assert.equal(f.h.httpCalls.length, 0);
  }
});

test('alpha75: externo con historia sin ALTA conserva todas las filas y no duplica al reintentar', () => {
  const history = row('EXT-TEST', 'PARADA', 'PA-9999998');
  history[6] = 'OLD-RESERVE'; history[10] = '2026-03-16'; history[16] = 'TANCAMENT 3';
  history[17] = 'ARRAY-MONTH'; history[18] = 'ARRAY-YEAR';
  const next = row('FLEET-TEST', 'ALTA'), f = executorFixture([history, row('EXT-TEST', 'GC'), next]);
  f.h.sheet.at(2, 1).note = 'HISTORICAL-NOTE'; f.h.sheet.at(4, 5).note = 'NEXT-VEHICLE-NOTE';
  assert.equal(f.apply().fila, 4);
  const values = f.data();
  assert.equal(values[3][7], 'PARADA'); assert.equal(values[3][6], 'RES-TEST'); assert.equal(values[3][10], '');
  assert.equal(values[3][16], 'TANCAMENT 9'); assert.equal(values[3][17], ''); assert.equal(values[3][18], '');
  assert.equal(f.h.sheet.at(4, 1).note, `METROGESTION_PARADA:${f.command.sync_id}`);
  assert.deepEqual(values[1], history); assert.deepEqual(values[4], next);
  assert.equal(f.h.sheet.at(5, 5).note, 'NEXT-VEHICLE-NOTE'); assert.equal(values[4][0], 'FLEET-TEST');
  assert.equal(f.apply().fila, 4); assert.equal(f.inserted().length, 1);
  assert.equal(f.data().filter(value => value[0] === 'EXT-TEST' && value[7] === 'ALTA').length, 0);
  assert.deepEqual(f.copies(), [{ source: 2, target: 4, columns: 17 }]);
});

test('alpha75: externo nuevo se añade al final sin copiar datos de flota', () => {
  const own = row('FLEET-TEST', 'ALTA'); own[16] = 'PRIVATE-VIN'; own[17] = 'ARRAY-MONTH';
  const f = executorFixture([own]);
  assert.equal(f.apply().fila, 3);
  const values = f.data();
  assert.equal(values[2][0], 'EXT-TEST'); assert.equal(values[2][1], 'TEST-EXTERNAL'); assert.equal(values[2][16], 'TANCAMENT 9');
  assert.deepEqual(values[1], own);
});

test('alpha75: solo trabajos históricos también sirven como plantilla sin crear ALTA', () => {
  const f = executorFixture([row('EXT-TEST', 'AV')]);
  assert.equal(f.apply().fila, 3); assert.equal(f.data()[2][7], 'PARADA');
});

test('alpha75: vehículo propio conserva plantilla ALTA y agrupación', () => {
  const f = executorFixture([row('EXT-TEST', 'ALTA'), row('EXT-TEST', 'AV'), row('OTHER', 'ALTA')]);
  assert.equal(f.apply().fila, 4); assert.deepEqual(f.copies(), [{ source: 2, target: 4, columns: 17 }]);
  assert.equal(f.data()[1][7], 'ALTA');
});

test('alpha75: AV24H destructivo queda bloqueado por el ejecutor protegido antes de cualquier efecto', () => {
  const f = executorFixture([row('FLEET-TEST', 'ALTA')]), before = f.h.snapshot();
  f.command.payload.ajuste_24h = { ...f.command.payload, seguimiento_id: f.command.sync_id, designacion: 'AV24H' };
  assert.throws(f.apply, /destructiva bloqueada/);
  assert.deepEqual(f.h.effects, []); assert.deepEqual(f.h.snapshot(), before); assert.equal(f.h.httpCalls.length, 0);
});

test('alpha75: identidad inválida o falta de plantilla no modifica filas', () => {
  for (const change of [{ dfm: '' }, { numero_parada: '' }]) {
    const f = executorFixture([row('FLEET-TEST', 'ALTA')]), before = f.h.snapshot();
    Object.assign(f.command.payload, change);
    assert.throws(f.apply, /acredita DFM y PA/);
    assert.deepEqual(f.h.effects, []); assert.deepEqual(f.h.snapshot(), before);
  }
  const empty = executorFixture([]), before = empty.h.snapshot();
  assert.throws(empty.apply, /filas de datos|plantilla/);
  assert.deepEqual(empty.h.effects, []); assert.deepEqual(empty.h.snapshot(), before);
});
