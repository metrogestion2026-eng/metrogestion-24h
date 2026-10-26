import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { loadEditableHotelRecords } from '../r1-alpha75/src/hotel-editable-records.js';
import { refreshConfirmedHotelSave } from '../r1-alpha75/src/hotel-save-completion.js';

function mockPermissions(records, { failBatch = -1, reject = false } = {}) {
  const calls = [];
  return {
    calls,
    from(table) {
      assert.equal(table, 'hotel_edicion_piloto');
      return {
        select(columns) { assert.equal(columns, 'registro_hotel_id'); return this; },
        eq(column, value) { assert.equal(column, 'activo'); assert.equal(value, true); return this; },
        async in(column, ids) {
          assert.equal(column, 'registro_hotel_id');
          assert.ok(ids.length <= 80);
          calls.push([...ids]);
          if (calls.length - 1 === failBatch) {
            if (reject) throw new Error('Sin conexión');
            return { data: null, error: { message: 'Sin permiso' } };
          }
          return { data: records.filter(row => ids.includes(row.registro_hotel_id)).slice(0, 1000), error: null };
        },
      };
    },
  };
}
const row = registro_hotel_id => ({ registro_hotel_id });

 test('fichas actuales posteriores a las primeras mil autorizaciones', async () => {
  const records = Array.from({ length: 1100 }, (_, i) => row(`TEST-${i}`));
  const ids = ['TEST-1097', 'TEST-1098', 'TEST-1099'];
  assert.equal(records.slice(0, 1000).filter(r => ids.includes(r.registro_hotel_id)).length, 0);
  const client = mockPermissions(records);
  assert.deepEqual(await loadEditableHotelRecords(client, ids, true), { data: ids.map(row), error: null });
  assert.deepEqual(client.calls, [ids]);
});

 test('lector no consulta ni recibe autorizaciones de edición', async () => {
  const client = mockPermissions([row('TEST-A')]);
  assert.deepEqual(await loadEditableHotelRecords(client, ['TEST-A'], false), { data: [], error: null });
  assert.equal(client.calls.length, 0);
});

 test('lista vacía y IDs repetidos no amplían el ámbito', async () => {
  const client = mockPermissions([row('TEST-A')]);
  await loadEditableHotelRecords(client, [], true);
  assert.equal(client.calls.length, 0);
  await loadEditableHotelRecords(client, [null, 'TEST-A', 'TEST-A'], true);
  assert.deepEqual(client.calls, [['TEST-A']]);
});

 test('no se concede edición a una ficha ausente de autorizaciones', async () => {
  const result = await loadEditableHotelRecords(mockPermissions([row('TEST-A')]), ['TEST-A', 'TEST-B'], true);
  assert.deepEqual(result.data, [row('TEST-A')]);
});

 test('la agrupación limita consultas y no corta una pizarra grande', async () => {
  const ids = Array.from({ length: 1105 }, (_, i) => `TEST-${i}`);
  const client = mockPermissions(ids.map(row));
  const result = await loadEditableHotelRecords(client, ids, true);
  assert.deepEqual(result.data, ids.map(row));
  assert.equal(client.calls.length, 14);
});

 test('fallo parcial o excepción no dejan autorizaciones parciales', async () => {
  const ids = Array.from({ length: 90 }, (_, i) => `TEST-${i}`);
  for (const reject of [false, true]) {
    const result = await loadEditableHotelRecords(mockPermissions(ids.map(row), { failBatch: 1, reject }), ids, true);
    assert.deepEqual(result.data, []);
    assert.ok(result.error);
  }
});

 test('no se conserva caché de autorización entre consultas', async () => {
  assert.equal((await loadEditableHotelRecords(mockPermissions([row('TEST-A')]), ['TEST-A'], true)).data.length, 1);
  assert.equal((await loadEditableHotelRecords(mockPermissions([]), ['TEST-A'], true)).data.length, 0);
});

 test('cerrar una ficha confirmada no espera a la recarga del listado', async () => {
  const events = [];
  let resolveRefresh;
  let scheduledClose;
  const refresh = new Promise(resolve => { resolveRefresh = resolve; });
  const pending = refreshConfirmedHotelSave({
    close: () => events.push('cerrado'),
    schedule: (callback, delay) => { assert.equal(delay, 350); scheduledClose = callback; events.push('cierre-programado'); },
    refresh: () => { events.push('refresco'); return refresh; },
  });
  assert.deepEqual(events, ['cierre-programado', 'refresco']);
  scheduledClose();
  assert.equal(events.at(-1), 'cerrado');
  resolveRefresh();
  assert.equal(await pending, true);
});

 test('fallo del listado no se propaga como fallo de escritura ni de documentos', async () => {
  let warnings = 0;
  assert.equal(await refreshConfirmedHotelSave({
    close: () => {}, schedule: () => {},
    refresh: async () => { throw new Error('Lectura fallida'); },
    onRefreshError: () => { warnings++; },
  }), false);
  assert.equal(warnings, 1);
});

 test('documentos pendientes refrescan sin cerrar su editor de reintento', async () => {
  let refreshed = 0;
  assert.equal(await refreshConfirmedHotelSave({
    close: null, schedule: () => assert.fail('No debe cerrar'),
    refresh: async () => { refreshed++; },
  }), true);
  assert.equal(refreshed, 1);
});

const source = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
 test('Pizarra e Histórico cargan exactamente el mismo editor corregido', () => {
  for (const path of ['hotel-native.js', 'history-card.js']) {
    assert.match(source(`r1-alpha75/src/${path}`), /hotel-editor\.js\?v=75\.23-hf25/);
  }
  assert.match(source('r1-alpha75/src/history-native.js'), /history-card\.js\?v=75\.23-hf28/);
  const html = source('r1-alpha75/index.html');
  const boot = source('r1-alpha75/src/boot75.js');
  assert.ok(html.includes('boot75.js?v=75.24'));
  for (const name of ['app', 'hotel-native', 'history-native']) {
    assert.ok(boot.includes(`${name}.js?v=75.24`));
  }
});

 test('el guardado mantiene RPC, identidad, versión y protección contra doble clic', () => {
  const editor = source('r1-alpha75/src/hotel-editor.js');
  assert.match(editor, /if \(saving\) return;/);
  assert.match(editor, /guardar_ficha_hotel_edicion_alpha73/);
  assert.match(editor, /p_identidad: loadedIdentity/);
  assert.match(editor, /p_version: Number\(detail.ficha.version\)/);
  assert.match(editor, /p_request_id: saveRequestId/);
  assert.match(editor, /pendingDocumentRetry/);
  assert.match(editor, /refreshSavedView\(true\)/);
  assert.doesNotMatch(editor, /await onSaved\?\./);
  assert.doesNotMatch(editor, /MANTENIMENT sincronizado/);
});


test('la 75.24 comprueba versión publicada sin caché y usa un solo arranque', () => {
  const html = source('r1-alpha75/index.html');
  const refresh = source('r1-alpha75/src/version-refresh.js');
  const manifest = JSON.parse(source('r1-alpha75/manifest.webmanifest'));
  assert.ok(html.includes('version-refresh.js?v=75.24'));
  assert.ok(html.includes('boot75.js?v=75.24'));
  assert.doesNotMatch(html, /src\/app\.js\?v=|hotel-native\.js\?v=|history-native\.js\?v=|panel-native-hf23\.js\?v=/);
  assert.match(html, /Cache-Control/);
  assert.match(refresh, /cache:\s*'no-store'/);
  assert.match(refresh, /new URL\('\.\/app\.js', import\.meta\.url\)/);
  assert.match(refresh, /const VERSION =/);
  assert.match(refresh, /window\.location\.replace/);
  assert.equal(manifest.start_url, './?v=75.24');
});

test('solo app.js puede escribir la versión visible de Metrogestión 75.24', () => {
  const srcUrl = new URL('../r1-alpha75/src/', import.meta.url);
  const jsFiles = readdirSync(srcUrl).filter(name => name.endsWith('.js'));
  const writers = jsFiles.filter(name => /querySelector\(['"]#app-version['"]\)/.test(source(`r1-alpha75/src/${name}`)));
  assert.deepEqual(writers, ['app.js']);
  assert.match(source('r1-alpha75/src/app.js'), /r1\.0\.0-alpha\.75\.24/);
  assert.doesNotMatch(source('r1-alpha75/src/hotel-native.js'), /#app-version|alpha75VersionNode/);
});

test('75.24 declara propiedad de Listados antes de cargar la herencia', () => {
  const boot = source('r1-alpha75/src/boot75.js');
  const ownerAt = boot.indexOf("listados: 'alpha75'");
  const appAt = boot.indexOf("import('./app.js?v=75.24')");
  assert.ok(ownerAt >= 0);
  assert.ok(appAt > ownerAt);
  for (const legacy of ['r1-alpha29','r1-alpha30','r1-alpha31','r1-alpha50']) {
    assert.match(boot, new RegExp(legacy));
  }
});

test('los Listados heredados ceden su propiedad cuando alpha75 es el dueño', () => {
  const sources = {
    a29: source('r1-alpha29/src/app.js'),
    a30: source('r1-alpha30/src/app.js'),
    a31: source('r1-alpha31/src/app.js'),
    a50: source('r1-alpha50/src/app.js'),
  };
  for (const value of Object.values(sources)) {
    assert.match(value, /LISTADOS_OWNED_BY_ALPHA75/);
  }
  assert.match(sources.a29, /if\(nav&&!LISTADOS_OWNED_BY_ALPHA75\)/);
  assert.match(sources.a30, /if\(nav&&!LISTADOS_OWNED_BY_ALPHA75\)/);
  assert.match(sources.a31, /enhanceListados\(\)\{if\(LISTADOS_OWNED_BY_ALPHA75\)return;/);
  assert.match(sources.a50, /if\(!LISTADOS_OWNED_BY_ALPHA75\)nav\?\.addEventListener/);
});

test('Listados 75.24 es una única implementación integrada y bajo demanda', () => {
  const listados = source('r1-alpha75/src/listados-module.js');
  const app = source('r1-alpha75/src/app.js');
  assert.match(app, /listados-module\.js\?v=75\.24/);
  assert.match(listados, /\.eq\('periodo', period\)/);
  assert.doesNotMatch(listados, /\.select\('\*'\)/);
  assert.doesNotMatch(listados, /Promise\.all\([\s\S]*(facturacion_dfm_periodos|facturacion_r_sustituciones|listado_paradas_operativas)/);
  assert.equal((listados.match(/Precio fijo por sustitución R/g) || []).length, 1);
  for (const view of ["['dfm'", "['r'", "['paradas'", "['24h'"]) assert.ok(listados.includes(view));
  assert.match(listados, /dataset\.alpha75Listados = '1'/);
});
