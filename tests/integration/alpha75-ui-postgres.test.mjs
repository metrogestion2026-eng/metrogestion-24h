import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createLocalFixture, FIXTURE_ACTOR, one, snapshotProtectedFacts } from '../sql/local-postgres-harness.mjs';
import { startBrowserServer } from './browser-server.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const DATE = '2026-10-20';

async function capture(page, name) {
  const directory = process.env.METROGESTION_UI_SCREENSHOT_DIR;
  if (!directory) return;
  await mkdir(directory, { recursive: true });
  await page.screenshot({ path: path.join(directory, name), fullPage: true });
}

async function seedUi(db) {
  await db.query(await readFile(new URL('./fixtures/hotel-views.sql', import.meta.url), 'utf8'));
  for (const [dfm, plate, reserve] of [
    ['TEST-UI-TRANSFER', 'TESTUI01', false], ['TEST-UI-FOLLOWUP', 'TESTUI02', false],
    ['TEST-UI-RETRY', 'TESTUI03', false], ['R-TEST', 'TEST123', true],
  ]) {
    await db.query(`INSERT INTO public.vehiculos(dfm,matricula,marca,modelo,km_actual,fin_contrato_km,fin_contrato_fecha,reserva)
      VALUES($1,$2,'Marca sintética','Modelo sintético',10000,900000,'2099-01-01',$3)`, [dfm, plate, reserve]);
  }
  await db.query(`INSERT INTO public.usuarios(id,nombre,apellidos,correo,tipo_usuario,permisos,activo)
    VALUES($1,'Persona','Sintética','fixture@example.invalid','operador',
      '{"resumen":{"ver":true},"hotel":{"ver":true},"activar24h":{"ver":true,"editar":true}}',true)`, [FIXTURE_ACTOR]);
}

async function activation(db, caseNumber) {
  return (await one(db, 'SELECT to_jsonb(a) AS value FROM public.activaciones_24h a WHERE numero_caso=$1', [caseNumber]))?.value;
}

async function workshop(db, dfm, request, extra = {}) {
  const payload = { vehiculo_sustituido: dfm, tipo_movimiento: 'TALLER', estado: 'pendiente_taller',
    fecha_parada: '2026-10-21', lugar: 'Taller sintético independiente', ...extra };
  return (await one(db, 'SELECT public.crear_ficha_hotel($1::jsonb,$2) AS value', [JSON.stringify(payload), request])).value;
}

async function prepareActivation(page, dfm, caseNumber) {
  await page.locator('[data-alpha34-24h]').click();
  await page.locator('#h24-dfm').fill(dfm);
  await page.locator('#h24-dfm').press('Tab');
  await page.locator('#h24-km').fill('10000');
  const next = page.locator('.h24-nav .button.primary');
  await next.click();
  assert.equal(await page.locator('.h24-status.danger').count(), 0,
    await page.locator('.h24-status.danger').allTextContents());
  await page.locator('#h24-safe').check();
  await page.locator('#h24-people').check();
  await page.locator('#h24-phone').fill('612345678');
  await next.click();
  await page.locator('#h24-location').fill('Ubicación sintética');
  await page.locator('#h24-fault').fill('Avería sintética de integración');
  await next.click();
  await page.locator('#h24-confirm').check();
  await next.click();
  await next.click();
  await page.locator('#h24-case').fill(caseNumber);
  await page.locator('#h24-date').fill(DATE);
  await page.locator('#h24-time').fill('10:00');
}

async function saveWizard(page) {
  const response = page.waitForResponse(value => value.url().endsWith('/__test/rpc'));
  await page.locator('.h24-nav .button.primary').click();
  const result = await (await response).json();
  assert.equal(result.error, null, result.error?.message);
  await page.waitForFunction(() => !document.querySelector('.h24-nav .button.primary')?.disabled);
  return result.data;
}

async function openFollowup(page, id) {
  await page.locator('#fixture-incidents-button').click();
  const card = page.locator(`.a50-card[data-activation-id="${id}"]`);
  await card.locator('[data-a74-followup]').click();
  return page.getByRole('dialog');
}

async function assertHotel(page, id, state, label) {
  await page.locator('#fixture-hotel-button').click();
  const card = page.locator(`.hotel-card[data-record-id="${id}"]`);
  await card.waitFor();
  assert.equal(await card.getAttribute('data-state'), state);
  assert.equal(await card.getAttribute('data-derived-state'), state);
  assert.equal((await card.locator('.hotel-status-badge').textContent()).toLocaleLowerCase('es-ES'), label.toLocaleLowerCase('es-ES'));
  await capture(page, '02-hotel.png');
  return card;
}

async function assertPanelReadback(page, db, record) {
  await page.locator('[data-module="resumen"]').click();
  await page.locator('.a52-updated').filter({ hasText: 'Actualizado' }).waitFor();
  assert.equal(await page.locator('.a52-error').count(), 0);
  const counts = await one(db, `SELECT
    (SELECT count(*)::int FROM public.hotel_actual_detalle) AS cards,
    (SELECT count(*)::int FROM public.hotel_actual_detalle WHERE estado='asistencia_24h') AS current24h,
    (SELECT count(*)::int FROM public.hotel_actual_detalle WHERE estado='recogido_pendiente_ruta') AS recovery,
    (SELECT count(*)::int FROM public.activaciones_24h WHERE estado NOT IN ('cerrada','anulada')) AS open24h`);
  for (const [label, value] of [['Fichas activas', counts.cards], ['24H en curso', counts.current24h],
    ['Pendientes de recuperar', counts.recovery], ['24H abiertas', counts.open24h]]) {
    // Locate the exact production label without depending on CSS position.
    const exact = page.locator('.a52-metric').filter({ has: page.getByText(label, { exact: true }) });
    assert.equal(await exact.locator('strong').textContent(), String(value), label);
  }
  await page.locator('.a52-metric').filter({ has: page.getByText('Fichas activas', { exact: true }) }).click();
  const detail = page.locator('.a52-detail');
  assert.match(await detail.textContent(), new RegExp(record.dfm));
  assert.match(await detail.textContent(), /Realizada/);
  await capture(page, '03-panel.png');
}

test('Chromium real → RPC pública PostgreSQL17 → vistas Hotel y Panel', { timeout: 180000 }, async t => {
  const fixture = await createLocalFixture({ prefix: 'ui' });
  let server, browser;
  const denied = [], pageErrors = [];
  try {
    await seedUi(fixture.admin);
    const protectedBefore = await snapshotProtectedFacts(fixture.admin);
    server = await startBrowserServer(fixture.admin);
    browser = await chromium.launch({
      ...(process.env.METROGESTION_BROWSER_EXECUTABLE ? { executablePath: process.env.METROGESTION_BROWSER_EXECUTABLE } : {}),
      headless: true,
      proxy: { server: server.origin, bypass: '127.0.0.1,localhost' },
      args: ['--no-sandbox', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost'],
    });
    const context = await browser.newContext({ timezoneId: 'Europe/Madrid', locale: 'es-ES', serviceWorkers: 'block' });
    await context.route('**/*', route => {
      if (new URL(route.request().url()).origin === server.origin) return route.continue();
      denied.push(route.request().url());
      return route.abort();
    });
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    page.on('pageerror', error => pageErrors.push(error.message));
    const load = async () => {
      await page.goto(server.origin);
      try { await page.waitForFunction(() => window.__UI_FIXTURE_READY__ === true); }
      catch (error) { throw new Error(`UI fixture did not initialize: ${JSON.stringify({ pageErrors, failures: server.failures })}`, { cause: error }); }
    };
    t.diagnostic(`PostgreSQL ${fixture.metadata.server.version}; browser ${browser.version()}; timezone Europe/Madrid`);
    await load();

    await t.test('alta completa, doble clic, validación y cierre por traslado conservan PA de taller previa', async () => {
      const priorWorkshop = await workshop(fixture.admin, 'TEST-UI-TRANSFER', 'ui_existing_workshop');
      const before = await one(fixture.admin, 'SELECT to_jsonb(r) AS value FROM public.registros_hotel r WHERE id=$1', [priorWorkshop.id]);
      await load();
      await prepareActivation(page, 'TEST-UI-TRANSFER', 'TEST-UI-CASE-TRANSFER');
      const callsBefore = server.calls.length;
      server.controls.delayNextSave = 150;
      await page.locator('.h24-nav .button.primary').dblclick();
      await page.locator('#h24-current-state').waitFor();
      assert.equal(server.calls.length - callsBefore, 1);
      const opened = await activation(fixture.admin, 'TEST-UI-CASE-TRANSFER');
      assert.equal(opened.estado, 'abierta');
      assert.notEqual(opened.registro_hotel_id, priorWorkshop.id);
      await page.locator('#h24-result').selectOption('trasladado_taller');
      assert.equal(await page.locator('#h24-transfer').isChecked(), true);
      await page.locator('#h24-workshop').fill('Taller de traslado sintético');
      await page.locator('#h24-current-state').selectOption('realizada');
      await page.locator('#h24-repair-end-date').fill(DATE);
      await page.locator('#h24-repair-end').fill('09:59');
      await page.locator('.h24-nav .button.primary').click();
      assert.match(await page.locator('.h24-status.danger').textContent(), /anterior a la activación/);
      assert.equal(server.calls.length - callsBefore, 1);
      assert.equal(await page.locator('#h24-oper').isChecked(), false);
      await page.locator('#h24-repair-end').fill('11:00');
      await capture(page, '01-assistance-form.png');
      const confirmed = await saveWizard(page);
      assert.equal(confirmed.id, opened.id);
      assert.equal(confirmed.estado, 'cerrada');
      assert.equal(confirmed.resultado, 'trasladado_taller');
      const stored = await activation(fixture.admin, 'TEST-UI-CASE-TRANSFER');
      assert.equal(stored.estado_operativo_confirmado, false);
      assert.equal(stored.trasladado_taller, true);
      const stages = (await fixture.admin.query('SELECT estado,tipo_etapa,fecha_fin_real FROM public.etapas_hotel WHERE registro_hotel_id=$1', [stored.registro_hotel_id])).rows;
      assert.equal(stages.length, 1);
      assert.equal(stages[0].tipo_etapa, '24H');
      assert.equal(stages[0].estado, 'realizada');
      assert.equal(stages[0].fecha_fin_real.toISOString(), '2026-10-20T09:00:00.000Z');
      assert.deepEqual(await one(fixture.admin, 'SELECT to_jsonb(r) AS value FROM public.registros_hotel r WHERE id=$1', [priorWorkshop.id]), before);
      await assertHotel(page, stored.registro_hotel_id, 'realizada', 'Realizada');
      await assertPanelReadback(page, fixture.admin, stored);
    });

    await t.test('el diálogo real finaliza sustitución pendiente, reserva sigue ocupada y taller posterior tiene otra PA', async () => {
      await load();
      await prepareActivation(page, 'TEST-UI-FOLLOWUP', 'TEST-UI-CASE-FOLLOWUP');
      await saveWizard(page);
      await page.locator('#h24-current-state').waitFor();
      await page.locator('#h24-result').selectOption('necesita_sustitucion');
      await page.locator('#h24-sub-dfm').fill('R-TEST');
      await page.locator('#h24-sub-dfm').press('Tab');
      await saveWizard(page);
      const opened = await activation(fixture.admin, 'TEST-UI-CASE-FOLLOWUP');
      assert.equal(opened.estado, 'abierta');
      const dialog = await openFollowup(page, opened.id);
      assert.equal(await dialog.getByLabel('Fecha real de activación', { exact: true }).inputValue(), DATE);
      assert.equal(await dialog.getByLabel('Hora real de activación', { exact: true }).inputValue(), '10:00');
      await dialog.getByLabel('Situación actual').selectOption('realizada');
      assert.equal(await dialog.getByLabel('Resultado').inputValue(), 'necesita_sustitucion');
      await dialog.getByLabel('Fecha de fin de asistencia', { exact: true }).fill(DATE);
      await dialog.getByLabel('Hora de fin de asistencia', { exact: true }).fill('11:30');
      await capture(page, '04-followup-form.png');
      const previousStages = (await fixture.admin.query('SELECT to_jsonb(e) AS value FROM public.etapas_hotel e WHERE registro_hotel_id=$1', [opened.registro_hotel_id])).rows;
      const response = page.waitForResponse(value => value.url().endsWith('/__test/rpc'));
      await dialog.getByRole('button', { name: 'Guardar seguimiento', exact: true }).click();
      const result = await (await response).json();
      assert.equal(result.error, null, JSON.stringify({ error: result.error, payload: server.calls.at(-1)?.args.p_payload, previousStages }));
      await dialog.waitFor({ state: 'detached' });
      const card = page.locator(`.a50-card[data-activation-id="${opened.id}"]`);
      assert.equal(await card.locator('.a50-state').textContent(), 'CERRADA');
      assert.match(await card.locator('.a74-follow-success').textContent(), /Asistencia 24H finalizada/);
      const stored = await activation(fixture.admin, 'TEST-UI-CASE-FOLLOWUP');
      assert.equal(stored.resultado, 'necesita_sustitucion');
      assert.equal(stored.estado_operativo_confirmado, false);
      const actual = await one(fixture.admin, `SELECT r.estado,r.vehiculo_reserva,r.retirado_hotel_activo,r.fecha_retirado_hotel,
        (SELECT estado FROM public.reservas_hotel WHERE vehiculo_codigo='R-TEST') AS reserve_state
        FROM public.registros_hotel r WHERE id=$1`, [stored.registro_hotel_id]);
      assert.deepEqual(actual, { estado: 'realizada', vehiculo_reserva: 'R-TEST', retirado_hotel_activo: false, fecha_retirado_hotel: null, reserve_state: 'ocupada' });
      const followingWorkshop = await workshop(fixture.admin, stored.dfm, 'ui_following_workshop');
      assert.notEqual(followingWorkshop.id, stored.registro_hotel_id);
      const identities = (await fixture.admin.query('SELECT numero_parada,seguimiento_id FROM public.registros_hotel WHERE vehiculo_sustituido=$1', [stored.dfm])).rows;
      assert.equal(new Set(identities.map(row => row.numero_parada)).size, 2);
      assert.equal(new Set(identities.map(row => row.seguimiento_id)).size, 2);
      await assert.rejects(workshop(fixture.admin, stored.dfm, 'ui_duplicate_reserve', { vehiculo_reserva: 'R-TEST', matricula_reserva: 'TEST123' }), /continúa asignado/);
      const hotel = await assertHotel(page, stored.registro_hotel_id, 'realizada', 'Realizada');
      assert.match(await hotel.locator('.hotel-substitute-line').textContent(), /R-TEST/);
      await assertPanelReadback(page, fixture.admin, stored);
    });

    await t.test('respuesta perdida después del commit reintenta el alta con misma identidad de petición', async () => {
      await load();
      await prepareActivation(page, 'TEST-UI-RETRY', 'TEST-UI-CASE-RETRY');
      const before = server.calls.length;
      server.controls.loseNextCreateResponse = true;
      await page.locator('.h24-nav .button.primary').click();
      await page.locator('.h24-status.danger').waitFor();
      assert.match(await page.locator('.h24-status.danger').textContent(), /No se pudo guardar/);
      const committed = await activation(fixture.admin, 'TEST-UI-CASE-RETRY');
      assert.ok(committed.id);
      const replay = await saveWizard(page);
      assert.equal(replay.id, committed.id);
      assert.equal(replay.reutilizada, true);
      assert.equal(server.calls.length - before, 2);
      assert.equal(server.calls[before].args.p_id, null);
      assert.equal(server.calls[before + 1].args.p_id, null);
      assert.equal(server.calls[before].args.p_request_id, server.calls[before + 1].args.p_request_id);
      assert.deepEqual(server.calls[before].args.p_payload, server.calls[before + 1].args.p_payload);
      assert.equal((await one(fixture.admin, 'SELECT count(*)::int AS n FROM public.registros_hotel WHERE vehiculo_sustituido=$1', [committed.dfm])).n, 1);
    });

    await t.test('un rechazo real de PostgreSQL conserva el diálogo, borrador y asistencia abierta', async () => {
      const opened = await activation(fixture.admin, 'TEST-UI-CASE-RETRY');
      await fixture.admin.query(`INSERT INTO public.etapas_hotel(registro_hotel_id,nombre,posicion,tipo_etapa,estado)
        VALUES($1,'T24H adicional sintética',2,'24H','pendiente')`, [opened.registro_hotel_id]);
      const before = await one(fixture.admin, 'SELECT to_jsonb(a) AS value FROM public.activaciones_24h a WHERE id=$1', [opened.id]);
      const dialog = await openFollowup(page, opened.id);
      await dialog.getByLabel('Resultado').selectOption('trasladado_taller');
      await dialog.getByLabel('Taller de traslado', { exact: true }).fill('Taller sintético');
      await dialog.getByLabel('Situación actual').selectOption('realizada');
      await dialog.getByLabel('Fecha de fin de asistencia', { exact: true }).fill(DATE);
      await dialog.getByLabel('Hora de fin de asistencia', { exact: true }).fill('11:00');
      const response = page.waitForResponse(value => value.url().endsWith('/__test/rpc'));
      await dialog.getByRole('button', { name: 'Guardar seguimiento', exact: true }).click();
      const rejected = await (await response).json();
      assert.match(rejected.error.message, /única T/);
      assert.equal(await dialog.isVisible(), true);
      assert.equal(await dialog.getByLabel('Hora de fin de asistencia', { exact: true }).inputValue(), '11:00');
      assert.match(await dialog.textContent(), /No se pudo guardar/);
      assert.equal(await page.locator(`.a50-card[data-activation-id="${opened.id}"] .a50-state`).textContent(), 'ABIERTA');
      assert.deepEqual(await one(fixture.admin, 'SELECT to_jsonb(a) AS value FROM public.activaciones_24h a WHERE id=$1', [opened.id]), before);
    });

    assert.deepEqual(await snapshotProtectedFacts(fixture.admin), protectedBefore);
    assert.deepEqual(denied, [], 'The UI attempted an unexpected external request');
    assert.deepEqual(pageErrors, [], 'The actual frontend modules reported an uncaught error');
    assert.ok(server.readTables.includes('hotel_actual_detalle'));
    assert.ok(server.readTables.includes('activaciones_24h'));
    assert.ok(server.failures.every(error => /única T/.test(error.message)), JSON.stringify(server.failures));
    t.diagnostic('Only loopback HTTP and the dedicated PostgreSQL Unix socket were used; SQL fixture database is removed in finally.');
  } finally {
    if (browser) await browser.close();
    if (server) await server.close();
    await fixture.destroy();
  }
});
