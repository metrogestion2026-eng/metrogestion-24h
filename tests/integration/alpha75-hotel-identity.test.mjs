import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = fileURLToPath(new URL('../../', import.meta.url));
const entry = '/r1-alpha26/src/modules/hotel.js';
const sources = new Set([entry, '/r1-alpha17/src/modules/hotel.js', '/r1-alpha17/src/dom.js']);

const apiDouble = `
export const supabase = { from(table) {
  const request = {table, orders: [], filters: []};
  const query = {
    select(fields) { request.fields = fields; return query; },
    eq(column, value) { request.filters.push([column, value]); return query; },
    order(column, options) { request.orders.push([column, options]); return query; },
    maybeSingle() { request.single = true; return query; },
    then(resolve, reject) { return globalThis.hotelTest.read(request).then(resolve, reject); }
  };
  return query;
}};`;
const editorDouble = `export async function openHotelEditor(id, { onSaved } = {}) {
  globalThis.hotelTest.editors.push(id);
  globalThis.hotelTest.saved = onSaved;
}`;
const createDouble = `export async function openHotelCreate({ onSaved } = {}) {
  globalThis.hotelTest.creates += 1;
  globalThis.hotelTest.created = onSaved;
}`;

async function startServer() {
  const requests = [];
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    requests.push(url.pathname + url.search);
    let content;
    if (url.pathname === '/') {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<!doctype html><html><head><meta charset="utf-8"></head><body><main id="module"></main></body></html>');
      return;
    }
    if (url.pathname === '/r1-alpha17/src/supabase.js') content = apiDouble;
    else if (url.pathname === '/r1-alpha17/src/modules/hotel-editor.js') content = 'export async function openHotelEditor() { throw new Error("Wrong legacy editor"); }';
    else if (url.pathname === '/r1-alpha24/src/modules/hotel-editor.js') content = editorDouble;
    else if (url.pathname === '/r1-alpha20/src/modules/hotel-create.js') content = createDouble;
    else if (sources.has(url.pathname)) content = await readFile(resolve(root, '.' + url.pathname), 'utf8');
    else { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': 'application/javascript', 'cache-control': 'no-store' });
    res.end(content);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { server, requests, origin: `http://127.0.0.1:${server.address().port}` };
}

const stage = (id, patch = {}) => ({
  id, posicion: 1, nombre: 'AV', estado: 'en_curso', tipo_etapa: 'entrada_taller',
  taller: 'Workshop A', centro: 'Centre A', lugar: 'Workshop A',
  fecha_inicio_real: '2026-10-21T05:38:00Z', observaciones: `Notes ${id}`, cancelado: false,
  ...patch,
});
const row = (id, stages, patch = {}) => ({
  id, dfm: id === 'record-a' ? '9001' : '9002', matricula: 'TEST',
  numero_parada: `TEST-${id}`, orden: 0, estado: 'en_taller', lugar: 'Workshop A',
  etapas_resumen: stages, ...patch,
});
const a = () => row('record-a', [
  stage('stage-a1'),
  stage('stage-a2', { posicion: 2, nombre: 'Recovery A', estado: 'pendiente', taller: '', centro: '', lugar: '', fecha_inicio_real: null }),
]);
const b = () => row('record-b', [
  stage('stage-b1', { nombre: 'GP', taller: 'Workshop B', centro: 'Centre B', lugar: 'Workshop B', fecha_inicio_real: '2026-10-14T10:21:00Z' }),
  stage('stage-b2', { posicion: 2, nombre: 'Pickup B', estado: 'pendiente', taller: 'Workshop B', centro: 'Centre B', lugar: 'Workshop B', fecha_inicio_real: null }),
], { lugar: 'Workshop B' });

async function preparePage(browser, origin, rowsQueue, { edit = true, permissionError = false } = {}) {
  const context = await browser.newContext({ locale: 'es-ES', timezoneId: 'Europe/Madrid', serviceWorkers: 'block' });
  const external = [];
  await context.route('**/*', route => {
    if (new URL(route.request().url()).origin !== origin) { external.push(route.request().url()); return route.abort(); }
    return route.continue();
  });
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin);
  await page.evaluate(({ rowsQueue, edit, permissionError }) => {
    const state = globalThis.hotelTest = {
      rowsQueue, edit, permissionError, calls: [], editors: [], creates: 0, pending: {}, detailMounts: 0,
      async read(request) {
        state.calls.push(request);
        if (request.table === 'pizarras') return { data: { id: 'board-test', fecha: '2026-11-01', estado: 'en_curso' }, error: null };
        if (request.table === 'hotel_edicion_piloto') return {
          data: ['record-a','record-b','record-c'].map(registro_hotel_id => ({ registro_hotel_id })),
          error: state.permissionError ? { message: 'Permission test error' } : null,
        };
        if (request.table !== 'hotel_actual_detalle') throw new Error('Unexpected table: ' + request.table);
        const next = state.rowsQueue.shift();
        if (!next) throw new Error('Unexpected extra Hotel query');
        if (next.hold) return new Promise((resolve, reject) => { state.pending[next.hold] = { resolve, reject, data: next.rows }; });
        return { data: structuredClone(next.rows), error: next.error || null };
      },
    };
    new MutationObserver(records => {
      for (const record of records) for (const node of record.addedNodes) {
        if (node.classList?.contains('stage-readonly-overlay')) state.detailMounts += 1;
      }
    }).observe(document.body, { childList: true });
  }, { rowsQueue, edit, permissionError });
  await page.evaluate(async entry => { globalThis.hotelModule = await import(entry); }, entry);
  return { context, page, errors, external };
}

async function draw(page) {
  await page.evaluate(async () => { await hotelModule.renderHotel(document.querySelector('#module'), { view: true, edit: hotelTest.edit }); });
}
async function closeDetail(page) { await page.locator('.stage-readonly-overlay button', { hasText: 'Cerrar' }).click(); }
async function assertDetail(page, recordId, stageId) {
  assert.equal(await page.locator('.stage-readonly-overlay').getAttribute('data-registro-id'), recordId);
  assert.equal(await page.locator('.stage-readonly-overlay').getAttribute('data-etapa-id'), stageId);
}

test('Hotel binds visible records, stages and actions to a single snapshot', { timeout: 60000 }, async t => {
  const { server, origin, requests } = await startServer();
  let browser;
  try {
    browser = await chromium.launch({
      ...(process.env.METROGESTION_BROWSER_EXECUTABLE ? { executablePath: process.env.METROGESTION_BROWSER_EXECUTABLE } : {}),
      headless: true,
      args: ['--no-sandbox', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost'],
    });

    await t.test('tied rows cannot borrow metadata or actions from a reversed second response', async () => {
      const fixture = await preparePage(browser, origin, [{ rows: [a(), b()] }, { rows: [b(), a()] }]);
      const { page } = fixture;
      try {
        await page.evaluate(() => {
          const container = document.querySelector('#module');
          container.__alpha26EditorHandler = event => {
            if (!event.target.closest('.hotel-open-editor')) return;
            event.stopImmediatePropagation();
            hotelTest.editors.push('obsolete-handler-target');
          };
          container.addEventListener('click', container.__alpha26EditorHandler, true);
        });
        await draw(page);
        const cardA = page.locator('.hotel-card[data-registro-id="record-a"]');
        const cardB = page.locator('.hotel-card[data-registro-id="record-b"]');
        assert.match(await cardA.locator('[data-etapa-id="stage-a1"] .hotel-stage-meta').textContent(), /^Workshop A · Centre A · Inicio: 21\/10\/26, 7:38$/);
        assert.equal(await cardA.locator('[data-etapa-id="stage-a2"] .hotel-stage-meta').textContent(), 'Sin fecha');
        assert.match(await cardB.locator('[data-etapa-id="stage-b1"] .hotel-stage-meta').textContent(), /Workshop B · Centre B · Inicio: 14\/10\/26, 12:21/);
        assert.equal(await page.evaluate(() => hotelTest.calls.filter(call => call.table === 'hotel_actual_detalle').length), 1);
        assert.deepEqual(await page.evaluate(() => hotelTest.calls.find(call => call.table === 'hotel_actual_detalle').orders.map(order => order[0])), ['orden', 'id']);

        await page.evaluate(() => {
          const card = document.querySelector('.hotel-card[data-registro-id="record-a"]');
          card.parentNode.append(card);
        });
        await cardA.locator('[data-etapa-id="stage-a1"]').click();
        await assertDetail(page, 'record-a', 'stage-a1');
        assert.match(await page.locator('.stage-readonly-panel').textContent(), /Notes stage-a1/);
        await closeDetail(page);
        await page.locator('.hotel-mode-button').click();
        await page.evaluate(() => {
          const card = document.querySelector('.hotel-card[data-registro-id="record-a"]');
          card.parentNode.append(card);
        });
        await cardB.locator('.hotel-open-editor').click();
        await cardA.locator('.hotel-open-editor').click();
        assert.deepEqual(await page.evaluate(() => hotelTest.editors), ['record-b', 'record-a']);
        assert.deepEqual(fixture.errors, []);
        assert.deepEqual(fixture.external, []);
      } finally { await fixture.context.close(); }
    });

    await t.test('stage sorting and cancelled history preserve the identity and own workshop of every T', async () => {
      const cancelled = stage('stage-cancelled', { posicion: 2, estado: 'anulada', cancelado: true, taller: 'Old Workshop', centro: 'Old Centre', lugar: 'Old Workshop' });
      const record = a();
      record.etapas_resumen = JSON.stringify([cancelled, record.etapas_resumen[1], record.etapas_resumen[0]]);
      const fixture = await preparePage(browser, origin, [{ rows: [record] }]);
      const { page } = fixture;
      try {
        await draw(page);
        assert.deepEqual(await page.locator('.hotel-stage-row').evaluateAll(nodes => nodes.map(node => node.dataset.etapaId)), ['stage-a1','stage-a2','stage-cancelled']);
        await page.locator('[data-etapa-id="stage-a2"]').click();
        await assertDetail(page, 'record-a', 'stage-a2');
        assert.match(await page.locator('.stage-readonly-head h2').textContent(), /Recovery A/);
        await closeDetail(page);
        await page.locator('.hotel-stage-history summary').click();
        await page.locator('[data-etapa-id="stage-cancelled"]').click();
        await assertDetail(page, 'record-a', 'stage-cancelled');
        assert.equal(await page.locator('[data-etapa-id="stage-cancelled"] .hotel-stage-meta').textContent(), 'Old Workshop · Old Centre');
        assert.deepEqual(fixture.errors, []);
      } finally { await fixture.context.close(); }
    });

    await t.test('mode changes recreate the current handlers and saving reloads the same complete presentation', async () => {
      const updated = a();
      updated.etapas_resumen[0] = stage('stage-a1', { taller: 'Updated Workshop', centro: 'Updated Centre', lugar: 'Updated Workshop' });
      const fixture = await preparePage(browser, origin, [{ rows: [a(),b()] }, { rows: [updated] }]);
      const { page } = fixture;
      try {
        await draw(page);
        for (let i = 0; i < 5; i++) await page.locator('.hotel-mode-button').click();
        await page.locator('.hotel-card[data-registro-id="record-a"] .hotel-open-editor').click();
        assert.deepEqual(await page.evaluate(() => hotelTest.editors), ['record-a']);
        await page.locator('[data-etapa-id="stage-a1"]').press('Enter');
        await assertDetail(page, 'record-a', 'stage-a1');
        assert.equal(await page.evaluate(() => hotelTest.detailMounts), 1);
        await closeDetail(page);
        await page.evaluate(async () => { await hotelTest.saved(); });
        assert.equal(await page.locator('.hotel-card[data-registro-id="record-b"]').count(), 0);
        assert.match(await page.locator('[data-etapa-id="stage-a1"] .hotel-stage-meta').textContent(), /^Updated Workshop · Updated Centre/);
        await page.locator('[data-etapa-id="stage-a1"]').press('Space');
        await assertDetail(page, 'record-a', 'stage-a1');
        assert.match(await page.locator('.stage-readonly-panel').textContent(), /Updated Workshop/);
        assert.equal(await page.evaluate(() => hotelTest.detailMounts), 2);
        assert.equal(await page.evaluate(() => hotelTest.calls.filter(call => call.table === 'hotel_actual_detalle').length), 2);
        assert.deepEqual(fixture.errors, []);
      } finally { await fixture.context.close(); }
    });

    await t.test('an older response cannot replace newer rows or revive a removed record', async () => {
      const updated = a();
      updated.etapas_resumen[0].taller = 'Current Workshop';
      const c = row('record-c', [stage('stage-c1', { nombre: 'New record' })]);
      const fixture = await preparePage(browser, origin, [{ hold: 'old', rows: [a(), b()] }, { rows: [updated, c] }]);
      const { page } = fixture;
      try {
        await page.evaluate(() => { globalThis.oldDraw = hotelModule.renderHotel(document.querySelector('#module'), { view: true, edit: true }); });
        await page.waitForFunction(() => Boolean(hotelTest.pending.old));
        await draw(page);
        await page.evaluate(async () => { hotelTest.pending.old.resolve({ data: hotelTest.pending.old.data, error: null }); await oldDraw; });
        assert.deepEqual(await page.locator('.hotel-card').evaluateAll(nodes => nodes.map(node => node.dataset.registroId)), ['record-a', 'record-c']);
        assert.match(await page.locator('[data-etapa-id="stage-a1"] .hotel-stage-meta').textContent(), /^Current Workshop/);
        await page.locator('[data-etapa-id="stage-c1"]').click();
        await assertDetail(page, 'record-c', 'stage-c1');
        assert.deepEqual(fixture.errors, []);
      } finally { await fixture.context.close(); }
    });

    await t.test('a rejected old request cannot propagate an error into the current screen', async () => {
      const fixture = await preparePage(browser, origin, [{ hold: 'oldError', rows: [a()] }, { rows: [b()] }]);
      const { page } = fixture;
      try {
        await page.evaluate(() => { globalThis.failedDraw = hotelModule.renderHotel(document.querySelector('#module'), { view: true, edit: true }); });
        await page.waitForFunction(() => Boolean(hotelTest.pending.oldError));
        await draw(page);
        await page.evaluate(async () => { hotelTest.pending.oldError.reject(new Error('Old connection failed')); await failedDraw; });
        assert.deepEqual(await page.locator('.hotel-card').evaluateAll(nodes => nodes.map(node => node.dataset.registroId)), ['record-b']);
        assert.equal(await page.locator('.notice.danger').count(), 0);
        assert.deepEqual(fixture.errors, []);
      } finally { await fixture.context.close(); }
    });

    await t.test('leaving Hotel suppresses delayed rendering and saved callbacks from the previous screen', async () => {
      const fixture = await preparePage(browser, origin, [{ rows: [a()] }, { hold: 'leave', rows: [b()] }]);
      const { page } = fixture;
      try {
        await draw(page);
        await page.locator('.hotel-mode-button').click();
        await page.locator('.hotel-open-editor').click();
        await page.evaluate(() => {
          globalThis.oldSaved = hotelTest.saved;
          globalThis.detachedButton = document.querySelector('.hotel-open-editor');
          globalThis.leavingDraw = hotelModule.renderHotel(document.querySelector('#module'), { view: true, edit: true });
        });
        await page.waitForFunction(() => Boolean(hotelTest.pending.leave));
        await page.evaluate(async () => {
          document.querySelector('#module').textContent = 'Another module';
          hotelTest.pending.leave.resolve({ data: hotelTest.pending.leave.data, error: null });
          await leavingDraw;
          await oldSaved();
          detachedButton.click();
        });
        assert.equal(await page.locator('#module').textContent(), 'Another module');
        assert.deepEqual(await page.evaluate(() => hotelTest.editors), ['record-a']);
        assert.equal(await page.evaluate(() => hotelTest.calls.filter(call => call.table === 'hotel_actual_detalle').length), 2);
        assert.deepEqual(fixture.errors, []);
      } finally { await fixture.context.close(); }
    });

    await t.test('create refreshes the same snapshot pipeline and read-only never exposes editor actions', async () => {
      const fixture = await preparePage(browser, origin, [{ rows: [] }, { rows: [a()] }, { rows: [a()] }]);
      const { page } = fixture;
      try {
        await draw(page);
        await page.locator('.hotel-mode-button').click();
        await page.getByRole('button', { name: '＋ Añadir ficha' }).click();
        assert.equal(await page.evaluate(() => hotelTest.creates), 1);
        await page.evaluate(async () => { await hotelTest.created(); });
        assert.match(await page.locator('[data-etapa-id="stage-a1"] .hotel-stage-meta').textContent(), /^Workshop A · Centre A/);
        await page.evaluate(async () => { hotelTest.edit = false; await hotelModule.renderHotel(document.querySelector('#module'), { view: true, edit: false }); });
        assert.equal(await page.locator('.hotel-open-editor, .hotel-mode-button').count(), 0);
        assert.equal(await page.getByRole('button', { name: '＋ Añadir ficha' }).count(), 0);
        await page.locator('[data-etapa-id="stage-a1"]').click();
        await assertDetail(page, 'record-a', 'stage-a1');
        assert.deepEqual(fixture.errors, []);
      } finally { await fixture.context.close(); }
    });

    await t.test('missing, duplicated or mismatched identities never choose a fallback target', async () => {
      const invalid = row('record-c', [stage(''),stage('shared-stage'),stage('wrong-parent', { registro_hotel_id: 'record-b' })]);
      const other = row('record-b', [stage('shared-stage')]);
      const fixture = await preparePage(browser, origin, [{ rows: [invalid, other] }], { permissionError: true });
      const { page } = fixture;
      try {
        await draw(page);
        assert.equal(await page.locator('.hotel-stage-row[role="button"]').count(), 0);
        await page.locator('.hotel-mode-button').click();
        assert.equal(await page.locator('.hotel-open-editor').count(), 0);
        await page.locator('.hotel-stage-row').first().click();
        assert.equal(await page.locator('.stage-readonly-overlay').count(), 0);
        assert.deepEqual(await page.evaluate(() => hotelTest.editors), []);
        assert.deepEqual(fixture.errors, []);
      } finally { await fixture.context.close(); }
    });
    assert.ok(requests.includes('/r1-alpha17/src/modules/hotel.js?v=75.25-hotel-identidad-001'));
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
});
