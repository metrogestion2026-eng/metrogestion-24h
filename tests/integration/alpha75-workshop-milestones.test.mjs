import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import {
  createWorkshopFixture, seedWorkshopScenario, workshopInventory, currentStage,
} from '../sql/workshop-scenarios.mjs';
import { startBrowserServer } from './browser-server.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const WRITE = 'registrar_hito_taller_alpha75';
const CONTEXT = 'obtener_contexto_taller_t_alpha75';
const writes = server => server.calls.filter(call => call.name === WRITE || call.name === 'marcar_t_realizada_rapida');

async function confirm(page, server, host, label, hito, { lostResponse = false } = {}) {
  const button = host.getByRole('button', { name: label, exact: true });
  await button.waitFor({ state: 'visible' });
  const count = writes(server).length;
  await button.click();
  assert.equal(await button.isDisabled(), true);
  assert.equal(writes(server).length, count, 'The first press only arms the confirmation');
  assert.match(await host.locator('.a75-quick-status').textContent(), /hora actual/);
  await page.waitForFunction(id => {
    const element = document.querySelector(`[data-stage-quick-id="${id}"] .a75-quick-button`);
    return element && !element.disabled;
  }, await host.getAttribute('data-stage-quick-id'));
  const [response] = await Promise.all([
    page.waitForResponse(value => value.url().endsWith('/__test/rpc')
      && value.request().postDataJSON().name === WRITE),
    host.locator('.a75-quick-button').click(),
  ]);
  let result;
  if (lostResponse) await assert.rejects(() => response.json());
  else result = await response.json();
  assert.equal(writes(server).length, count + 1);
  const request = writes(server).at(-1);
  assert.equal(request.name, WRITE);
  assert.equal(request.args.p_hito, hito);
  assert.deepEqual(Object.keys(request.args).sort(), ['p_etapa_id', 'p_hito', 'p_request_id', 'p_version']);
  assert.match(request.args.p_request_id, /^hito75_[a-f0-9]+$/);
  return result;
}

test('real Hotel buttons confirm one workshop fact at a time through PostgreSQL and update the same card', async t => {
  const fixture = await createWorkshopFixture({ native: true });
  let server, browser;
  const denied = [], pageErrors = [];
  try {
    const p = await seedWorkshopScenario(fixture.admin, { tag: 'UI_SEQUENCE' });
    const stale = await seedWorkshopScenario(fixture.admin, { tag: 'UI_STALE' });
    const lost = await seedWorkshopScenario(fixture.admin, { tag: 'UI_LOST' });
    server = await startBrowserServer(fixture.admin, { editor: true });
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
    page.setDefaultTimeout(15000);
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.goto(server.origin);
    await page.waitForFunction(() => window.__EDITOR_FIXTURE_READY__ === true);
    await page.locator('[data-module="hotel"]').click();
    await page.waitForFunction(() => document.querySelector('#module-content')?.dataset.alpha56HotelNative === '1');

    const card = page.locator(`.hotel-card[data-record-id="${p.id}"]`);
    await card.waitFor({ state: 'visible' });
    if (await card.locator('.a75-card-stages-toggle').getAttribute('aria-expanded') === 'false') {
      await card.locator('.a75-card-stages-toggle').click();
    }
    const originalCard = await card.elementHandle();
    const stage = card.locator(`[data-stage-id="${p.entry.id}"]`);
    const host = stage.locator(`[data-stage-quick-id="${p.entry.id}"]`);
    const recovery = card.locator(`[data-stage-id="${p.recovery.id}"]`);
    const before = await workshopInventory(fixture.admin, p.id);
    let loadCount = 0;
    page.on('load', () => { loadCount += 1; });

    for (const [hito, label, state, nextLabel] of [
      ['entrada', 'Entrada a taller', 'en_taller', 'Terminado en taller'],
      ['terminado', 'Terminado en taller', 'terminado_pendiente_recogida', 'Recogido de taller'],
      ['recogido', 'Recogido de taller', 'recogido_pendiente_ruta', null],
    ]) {
      const result = await confirm(page, server, host, label, hito);
      assert.equal(result.error, null, JSON.stringify(result.error));
      assert.equal(result.data.ok, true);
      await page.waitForFunction(({ id, expected }) => document.querySelector(`.hotel-card[data-record-id="${id}"]`)?.dataset.state === expected,
        { id: p.id, expected: state });
      assert.equal(await originalCard.evaluate((node, id) => node.isConnected
        && node === document.querySelector(`.hotel-card[data-record-id="${id}"]`), p.id), true);
      assert.match(await host.locator('.a75-quick-success').textContent(), /Operación registrada/);
      if (nextLabel) await host.getByRole('button', { name: nextLabel, exact: true }).waitFor();
      else {
        assert.equal(await host.locator('.a75-quick-button').count(), 0);
        assert.match(await host.locator('.a75-quick-success').textContent(), /Siguiente T: 2T.*Recuperar ruta y liberar reserva/);
      }
      assert.match(await recovery.locator('.hotel-stage-status').textContent(), /Pendiente/);
      assert.equal((await currentStage(fixture.admin, p.recovery.id)).estado, 'pendiente');
      assert.equal((await workshopInventory(fixture.admin, p.id)).reserva.estado, 'ocupada');
    }
    assert.equal(loadCount, 0, 'The same card must show all three milestones without reloading the app');
    assert.match(await stage.locator('.hotel-stage-status').textContent(), /Realizada/);
    const dates = await stage.locator('.hotel-stage-meta').textContent();
    assert.match(dates, /Entrada:/);
    assert.match(dates, /Terminado:/);
    assert.match(dates, /Recogido:/);
    assert.equal(await host.getByText('Datos pendientes de completar', { exact: false }).count(), 0);
    assert.equal(writes(server).filter(call => call.args.p_etapa_id === p.entry.id).length, 3);
    assert.equal(writes(server).filter(call => call.name === 'marcar_t_realizada_rapida').length, 0);
    const actual = await workshopInventory(fixture.admin, p.id);
    assert.deepEqual(actual.documentos, before.documentos);
    assert.deepEqual(actual.trabajos, before.trabajos);
    assert.deepEqual(actual.etapas.map(e => [e.id, e.grupo_documental_id, e.posicion]),
      before.etapas.map(e => [e.id, e.grupo_documental_id, e.posicion]));
    const batches = server.calls.filter(call => call.name === CONTEXT);
    assert.ok(batches.some(call => call.args.p_etapa_ids.includes(p.entry.id)));
    assert.ok(batches.every(call => call.args.p_etapa_ids.length <= 100));

    await t.test('stale version reports the conflict and refreshes the control without registering a fact', async () => {
      const otherCard = page.locator(`.hotel-card[data-record-id="${stale.id}"]`);
      if (await otherCard.locator('.a75-card-stages-toggle').getAttribute('aria-expanded') === 'false') {
        await otherCard.locator('.a75-card-stages-toggle').click();
      }
      const otherHost = otherCard.locator(`[data-stage-quick-id="${stale.entry.id}"]`);
      await otherHost.getByRole('button', { name: 'Entrada a taller', exact: true }).waitFor();
      await fixture.admin.query("UPDATE public.etapas_hotel SET observaciones='Cambio concurrente sintético' WHERE id=$1", [stale.entry.id]);
      const beforeRejected = await workshopInventory(fixture.admin, stale.id);
      const rejected = await confirm(page, server, otherHost, 'Entrada a taller', 'entrada');
      assert.match(rejected.error?.message || '', /ha cambiado/);
      await otherHost.locator('.a75-quick-status.danger').waitFor();
      assert.match(await otherHost.locator('.a75-quick-status.danger').textContent(), /ha cambiado/);
      assert.deepEqual(await workshopInventory(fixture.admin, stale.id), beforeRejected);
      assert.equal(await otherHost.locator('.a75-quick-success').count(), 0);
    });

    await t.test('lost response after commit is verified by readback and never repeats the write', async () => {
      const lostCard = page.locator(`.hotel-card[data-record-id="${lost.id}"]`);
      if (await lostCard.locator('.a75-card-stages-toggle').getAttribute('aria-expanded') === 'false') {
        await lostCard.locator('.a75-card-stages-toggle').click();
      }
      const sameCard = await lostCard.elementHandle();
      const lostHost = lostCard.locator(`[data-stage-quick-id="${lost.entry.id}"]`);
      const beforeLost = await workshopInventory(fixture.admin, lost.id);
      const count = writes(server).length;
      server.controls.loseNextWorkshopResponse = true;
      await confirm(page, server, lostHost, 'Entrada a taller', 'entrada', { lostResponse: true });
      await lostHost.locator('.a75-quick-success').filter({ hasText: 'Este hito consta guardado' }).waitFor();
      await lostHost.getByRole('button', { name: 'Terminado en taller', exact: true }).waitFor();
      await page.waitForFunction(id => document.querySelector(`.hotel-card[data-record-id="${id}"]`)?.dataset.state === 'en_taller', lost.id);
      assert.equal(writes(server).length, count + 1);
      assert.equal(await lostHost.locator('.a75-quick-status.danger').count(), 0);
      assert.equal(await sameCard.evaluate((node, id) => node.isConnected
        && node === document.querySelector(`.hotel-card[data-record-id="${id}"]`), lost.id), true);
      assert.equal(loadCount, 0);
      const afterLost = await workshopInventory(fixture.admin, lost.id);
      const saved = afterLost.etapas.find(e => e.id === lost.entry.id);
      assert.equal(saved.estado, 'en_curso');
      assert.ok(saved.fecha_inicio_real);
      assert.equal(saved.fecha_fin_real, null);
      assert.equal(saved.fecha_real, null);
      assert.equal(afterLost.ficha.fecha_entrada, saved.fecha_inicio_real);
      assert.equal(afterLost.reserva.estado, 'ocupada');
      assert.deepEqual(afterLost.documentos, beforeLost.documentos);
      assert.deepEqual(afterLost.trabajos, beforeLost.trabajos);
      assert.deepEqual(afterLost.etapas.find(e => e.id === lost.recovery.id), beforeLost.etapas.find(e => e.id === lost.recovery.id));
      await sameCard.dispose();
    });
    assert.deepEqual(pageErrors, []);
    assert.deepEqual(denied, []);
    const unexpected = server.failures.filter(failure => !/ha cambiado/.test(failure.message));
    assert.deepEqual(unexpected, []);
    if (process.env.METROGESTION_UI_SCREENSHOT_DIR) {
      await mkdir(process.env.METROGESTION_UI_SCREENSHOT_DIR, { recursive: true });
      await page.screenshot({ path: path.join(process.env.METROGESTION_UI_SCREENSHOT_DIR, 'workshop-three-milestones.png'), fullPage: true });
    }
    t.diagnostic(`Native PostgreSQL17 and Chromium ${browser.version()}; all transport confined to loopback`);
  } finally {
    await browser?.close();
    await server?.close();
    await fixture.destroy();
  }
});
