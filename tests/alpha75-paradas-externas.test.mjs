import vm from 'node:vm';
import assert from 'node:assert/strict';
import test from 'node:test';
import { fixture, row, richTextBuilder } from './helpers/manteniment-sheet.mjs';

for (const version of ['alpha75', 'alpha76']) {
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
    assert.equal(result.filas_archivo_enlazadas, 2);
    assert.equal(sheet.inserted, 0);
    assert.equal(sheet.linkWrites, 1);
    assert.equal(sheet.richTexts[1][4].getLinkUrl(), preferred.getUrl());
    assert.equal(sheet.richTexts[2][4].getLinkUrl(), preferred.getUrl());
    assert.equal(archive.created.length, 0);
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
