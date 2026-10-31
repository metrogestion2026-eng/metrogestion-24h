import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { FIXTURE_ACTOR, FIXTURE_BOARD, one, snapshotProtectedFacts } from '../sql/local-postgres-harness.mjs';
import { createContinuityFixture, seedContinuityPair } from '../sql/continuity-scenarios.mjs';
import { recoveryInventory } from '../sql/recovery-scenarios.mjs';
import { startBrowserServer } from './browser-server.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const PREVIEW = 'previsualizar_continuidad_sustitucion_alpha75';
const CONFIRM = 'confirmar_continuidad_sustitucion_alpha75';
const displayDate = value => String(value).split('-').reverse().join('/');

async function capture(page, name) {
  const directory = process.env.METROGESTION_UI_SCREENSHOT_DIR;
  if (!directory) return;
  await mkdir(directory, { recursive: true });
  await page.screenshot({ path: path.join(directory, name), fullPage: true });
}

async function waitForRpc(page, name, action) {
  const [response] = await Promise.all([
    page.waitForResponse(value => value.url().endsWith('/__test/rpc')
      && value.request().postDataJSON().name === name),
    action(),
  ]);
  return response.json();
}

async function openHotel(page, id, { edit = false } = {}) {
  await page.locator('[data-module="hotel"]').click();
  const card = page.locator(`.hotel-card[data-record-id="${id}"]`);
  await card.waitFor();
  await page.waitForFunction(() => document.querySelector('#module-content')?.dataset.alpha56HotelNative === '1');
  if (edit) {
    const readMode = page.getByRole('button', { name: '🔒 Modo lectura', exact: true });
    if (await readMode.count()) await readMode.click();
    await card.getByRole('button', { name: 'Continuar sustitución desde otra PA', exact: true }).waitFor();
  }
  assert.equal(await page.locator('#module-content > .notice.danger').count(), 0);
  return card;
}

async function openContinuity(page, pair) {
  const card = await openHotel(page, pair.destination.id, { edit: true });
  const opened = await waitForRpc(page, PREVIEW,
    () => card.getByRole('button', { name: 'Continuar sustitución desde otra PA', exact: true }).click());
  assert.equal(opened.error, null, JSON.stringify(opened.error));
  assert.equal(opened.data.destino.id, pair.destination.id);
  const dialog = page.getByRole('dialog', { name: 'Continuidad del mismo sustituto', exact: true });
  const origin = dialog.getByLabel('PA de origen', { exact: true });
  const entry = dialog.getByLabel('Entrada real en taller', { exact: true });
  await origin.waitFor();
  await page.waitForFunction(() => {
    const select = document.querySelector('.a75-continuity-dialog select[aria-label="PA de origen"]');
    return select && !select.disabled;
  });
  assert.equal(await origin.inputValue(), '', 'Opening must not choose an origin implicitly');
  assert.equal(await entry.inputValue(), '', 'Opening must not choose an entry implicitly');
  assert.equal(await dialog.locator('input[type="date"],input[type="datetime-local"]').count(), 0);
  assert.equal(await dialog.getByRole('button', { name: 'Confirmar continuidad', exact: true }).isDisabled(), true);
  await origin.selectOption(pair.origin.id);
  await entry.selectOption(pair.entry.id);
  const response = await waitForRpc(page, PREVIEW,
    () => dialog.getByRole('button', { name: 'Previsualizar continuidad', exact: true }).click());
  assert.equal(response.error, null, JSON.stringify(response.error));
  assert.equal(response.data.confirmable, true, JSON.stringify(response.data.bloqueos));
  await dialog.getByRole('table', { name: 'Reparto de días imputables' }).waitFor();
  assert.notEqual(response.data.prevision.entrada.seguimiento_id, pair.destination.seguimiento_id);
  assert.equal(response.data.prevision.entrada.seguimiento_parada_id, pair.destination.seguimiento_id);
  assert.equal(response.data.prevision.entrada.registro_hotel_id, pair.destination.id);
  assert.match(await dialog.textContent(), new RegExp(displayDate(pair.dates.entry)));
  assert.equal(await dialog.getByRole('button', { name: 'Confirmar continuidad', exact: true }).isDisabled(), true);
  await dialog.getByLabel('Confirmo la entrada real y la continuidad del mismo sustituto', { exact: true }).check();
  assert.equal(await dialog.getByRole('button', { name: 'Confirmar continuidad', exact: true }).isEnabled(), true);
  return { dialog, preview: response.data };
}

async function committedFacts(db, pair) {
  return (await one(db, `SELECT jsonb_build_object(
    'links',(SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY c.id),'[]')
      FROM app_private.sustitucion_continuidades_alpha75 c
      WHERE c.origen_seguimiento_id=$1 OR c.destino_seguimiento_id=$2),
    'stops',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.seguimiento_id),'[]')
      FROM public.paradas_sustitucion_resumen s WHERE s.seguimiento_id=ANY($3::uuid[])),
    'hotel',(SELECT coalesce(jsonb_agg(to_jsonb(h) ORDER BY h.id),'[]')
      FROM public.hotel_por_dia h WHERE h.id=ANY($4::uuid[])),
    'billing',(SELECT coalesce(jsonb_agg(to_jsonb(b) ORDER BY b.periodo,b.seguimiento_id),'[]')
      FROM public.facturacion_dfm_periodos b WHERE b.seguimiento_id=ANY($3::uuid[])),
    'manual',(SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.seguimiento_id),'[]')
      FROM public.ajustes_sustitucion_parada a WHERE a.seguimiento_id=ANY($3::uuid[]))
  ) AS value`, [pair.origin.seguimiento_id, pair.destination.seguimiento_id,
    [pair.origin.seguimiento_id, pair.destination.seguimiento_id], [pair.origin.id, pair.destination.id]])).value;
}

async function assertBillingCard(card, days, rate) {
  const metric = card.locator('.a66-billing-cell').filter({ hasText: 'Días imputables totales' });
  await metric.waitFor();
  assert.equal(await metric.locator('strong').textContent(), String(days));
  if (rate != null) {
    const media = card.locator('.a66-billing-cell').filter({ hasText: 'Media diaria de sustitución' });
    // Existing cards display rounded whole km/day. Exact manual decimals are
    // asserted independently against the persisted adjustment rows above.
    const shown = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 0 }).format(rate);
    assert.equal(await media.locator('strong').textContent(), `${shown} km/día`);
  }
  assert.equal(await card.locator('.a66-substitution-body .notice.danger').count(), 0);
}

async function assertPanelOwner(page, pair, destination = true) {
  await page.locator('[data-module="resumen"]').click();
  await page.locator('.a52-updated').filter({ hasText: 'Actualizado' }).waitFor();
  const label = destination ? 'Ocupadas' : 'Libres';
  await page.locator('.a52-metric').filter({ has: page.getByText(label, { exact: true }) }).click();
  const row = page.locator('.a52-detail-item').filter({ hasText: pair.reserve });
  await row.waitFor();
  const text = await row.textContent();
  if (destination) {
    assert.ok(text.includes(pair.destination.numero_parada), text);
    assert.ok(!text.includes(pair.origin.numero_parada), text);
  } else assert.doesNotMatch(text, /Sustituye a/);
}

async function assertListados(page, pair, facts) {
  await page.locator('[data-alpha75-listados]').click();
  await page.getByPlaceholder('DFM, R, matrícula, parada, INC…').waitFor();
  await page.locator('.a7524-listados').getByText(/^\d+ registros? cargados?\.$/).waitFor();
  await page.getByPlaceholder('DFM, R, matrícula, parada, INC…').fill(pair.dfm);
  const period = await page.locator('.listados-filters label')
    .filter({ hasText: 'Periodo facturación' }).locator('select').inputValue();
  const expected = facts.billing.filter(row => row.periodo === period);
  const actual = await page.locator('.listados-table tbody tr').allTextContents();
  assert.equal(actual.length, expected.length);
  for (const expectedRow of expected) {
    const row = page.locator('.listados-table tbody tr').filter({ has: page.getByText(expectedRow.numero_parada, { exact: true }) });
    const cells = await row.locator('td').allTextContents();
    assert.equal(cells[1], displayDate(expectedRow.tramo_inicio));
    assert.equal(cells[2], displayDate(expectedRow.tramo_fin));
    assert.equal(cells[7], String(expectedRow.dias_facturables));
    assert.equal(cells[8], new Intl.NumberFormat('es-ES', { maximumFractionDigits: 0 }).format(expectedRow.km_dia));
  }
}

async function openHistoryToday(page, pair) {
  await page.locator('[data-module="historico"]').click();
  const input = page.getByLabel('Fecha de la pizarra', { exact: true });
  await input.waitFor();
  await page.waitForFunction(() => [...document.querySelectorAll('button')]
    .some(node => node.textContent === 'Buscar día' && !node.disabled));
  await input.fill(pair.dates.today);
  await page.getByRole('button', { name: 'Buscar día', exact: true }).click();
  await page.waitForFunction(() => [...document.querySelectorAll('button')]
    .some(node => node.textContent === 'Buscar día' && !node.disabled));
  return page.locator('[data-history-cards] .hotel-card')
    .filter({ has: page.getByText(`Actuación ${pair.origin.numero_parada}`, { exact: true }) });
}

async function recordActualWorkshopCompletion(db, pair) {
  // A separate, explicit synthetic fact. Continuity itself must leave this T
  // open; recovery becomes applicable only after finishing and collecting it.
  await db.query(`UPDATE public.etapas_hotel SET estado='realizada',
    fecha_fin_real=clock_timestamp()-interval '2 minutes',
    fecha_real=clock_timestamp()-interval '1 minute'
    WHERE id=$1`, [pair.entry.id]);
  return (await one(db, 'SELECT to_jsonb(e) AS value FROM public.etapas_hotel e WHERE id=$1', [pair.recovery.id])).value;
}

test('Continuidad explícita: navegador real → RPC → PostgreSQL17 y cuatro lecturas', { timeout: 240000 }, async t => {
  const fixture = await createContinuityFixture({ prefix: 'ui_continuity' });
  let server, browser;
  const denied = [], pageErrors = [];
  try {
    await fixture.admin.query(`UPDATE public.pizarras SET fecha=(clock_timestamp() AT TIME ZONE 'Europe/Madrid')::date WHERE id=$1`, [FIXTURE_BOARD]);
    await fixture.admin.query(`INSERT INTO public.usuarios(id,nombre,apellidos,correo,tipo_usuario,permisos,activo)
      VALUES($1,'Persona','Sintética','fixture@example.invalid','administrador_principal','{}',true)`, [FIXTURE_ACTOR]);
    const normal = await seedContinuityPair(fixture.admin, { tag: 'UIFLOW', originManualRate: 37.03, destinationManualRate: 41.07 });
    const zero = await seedContinuityPair(fixture.admin, { tag: 'UIZERO', originDaysAgo: 1, entryDaysAgo: 1 });
    const lost = await seedContinuityPair(fixture.admin, { tag: 'UILOST' });
    const stale = await seedContinuityPair(fixture.admin, { tag: 'UISTALE' });
    for (const pair of [normal, zero, lost, stale]) {
      await fixture.admin.query(`INSERT INTO public.vehiculos(dfm,matricula,activo) VALUES($1,$2,true) ON CONFLICT DO NOTHING`,
        [pair.dfm, `MAT${pair.tag}`]);
    }
    const protectedBefore = await snapshotProtectedFacts(fixture.admin);
    const independent = await fixture.connect('ui_readback');
    server = await startBrowserServer(fixture.admin, { continuity: true });
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
    await page.goto(server.origin);
    try { await page.waitForFunction(() => window.__UI_FIXTURE_READY__ === true); }
    catch (error) { throw new Error(`UI initialization: ${JSON.stringify({ pageErrors, failures: server.failures })}`, { cause: error }); }
    t.diagnostic(`PostgreSQL ${fixture.metadata.server.version}; browser ${browser.version()}; timezone Europe/Madrid`);

    await t.test('selección expresa y doble clic: un traspaso, días sin solape y lecturas Hotel/Panel/Listados/Histórico coherentes', async () => {
      const before = await recoveryInventory(independent, normal.dfm, normal.reserve);
      const factsBefore = await committedFacts(independent, normal);
      const { dialog, preview } = await openContinuity(page, normal);
      assert.equal(preview.prevision.tramo_origen.dias_imputables, 1);
      assert.equal(preview.prevision.tramo_destino.dias_imputables, 2);
      const countBefore = server.calls.filter(call => call.name === CONFIRM).length;
      server.controls.delayNextContinuityConfirmation = 300;
      await capture(page, 'continuity-normal-preview.png');
      const response = await waitForRpc(page, CONFIRM, () =>
        dialog.getByRole('button', { name: 'Confirmar continuidad', exact: true }).evaluate(button => { button.click(); button.click(); }));
      assert.equal(response.error, null, JSON.stringify(response.error));
      assert.equal(response.data.ok, true);
      await dialog.getByRole('status').filter({ hasText: 'Continuidad confirmada' }).waitFor();
      assert.equal(server.calls.filter(call => call.name === CONFIRM).length, countBefore + 1);
      await dialog.getByRole('button', { name: 'Cerrar', exact: true }).click();
      const after = await recoveryInventory(independent, normal.dfm, normal.reserve);
      const facts = await committedFacts(independent, normal);
      assert.equal(facts.links.length, 1);
      assert.equal(facts.links[0].dia_entrada, normal.dates.entry);
      assert.deepEqual(after.t, before.t, 'Continuity must not complete, create or recover any T');
      assert.deepEqual(after.activaciones, before.activaciones);
      assert.deepEqual(facts.manual, factsBefore.manual, 'Each PA keeps its own manual daily rate');
      assert.equal(after.reserva.estado, 'ocupada');
      for (const row of after.pa) {
        const previous = before.pa.find(item => item.id === row.id);
        assert.equal(row.fecha_parada, previous.fecha_parada);
        assert.equal(row.retirado_hotel_activo, previous.retirado_hotel_activo);
      }
      assert.equal(after.pa.find(row => row.id === normal.origin.id).vehiculo_reserva, normal.reserve);
      assert.equal(after.pa.find(row => row.id === normal.destination.id).vehiculo_reserva, normal.reserve);
      const origin = facts.stops.find(row => row.seguimiento_id === normal.origin.seguimiento_id);
      const destination = facts.stops.find(row => row.seguimiento_id === normal.destination.seguimiento_id);
      assert.equal(origin.fecha_inicio_parada, normal.dates.origin);
      assert.equal(origin.fecha_fin_parada, null, 'An imputation cut is not a physical recovery');
      assert.equal(origin.dias_imputables_total, 1);
      assert.equal(destination.dias_imputables_total, 2);
      assert.equal(origin.sustitucion_vigente, false);
      assert.equal(destination.sustitucion_vigente, true);
      assert.equal(origin.propietario_sustitucion_seguimiento_id, normal.destination.seguimiento_id);
      assert.equal(facts.billing.reduce((sum, row) => sum + Number(row.dias_facturables), 0), 3);
      await assertBillingCard(await openHotel(page, normal.origin.id), 1, 37.03);
      await assertBillingCard(await openHotel(page, normal.destination.id), 2, 41.07);
      await assertPanelOwner(page, normal);
      await assertListados(page, normal, facts);
      const history = await openHistoryToday(page, normal);
      await assertBillingCard(history, 1, 37.03);
      const callsBeforeHistory = server.calls.filter(call => call.name === CONFIRM).length;
      await history.getByRole('button', { name: 'Ver continuidad', exact: true }).click();
      const detail = page.getByRole('dialog', { name: 'Continuidad del mismo sustituto', exact: true });
      await detail.getByText('Continuidades confirmadas', { exact: true }).waitFor();
      assert.match(await detail.textContent(), /PA consultada/);
      assert.equal(await detail.getByRole('button', { name: 'Confirmar continuidad', exact: true }).isVisible(), false);
      assert.equal(server.calls.filter(call => call.name === CONFIRM).length, callsBeforeHistory);
      await detail.getByRole('button', { name: 'Cerrar', exact: true }).click();
    });

    await t.test('mismo día: origen con cero días, destino con todo el día y ninguna recuperación ficticia', async () => {
      const before = await recoveryInventory(independent, zero.dfm, zero.reserve);
      const { dialog, preview } = await openContinuity(page, zero);
      assert.equal(preview.prevision.tramo_origen.dias_imputables, 0);
      assert.match(await dialog.textContent(), /origen queda con 0 días imputables/);
      await capture(page, 'continuity-zero-preview.png');
      const response = await waitForRpc(page, CONFIRM,
        () => dialog.getByRole('button', { name: 'Confirmar continuidad', exact: true }).click());
      assert.equal(response.error, null, JSON.stringify(response.error));
      await dialog.getByRole('status').filter({ hasText: 'Continuidad confirmada' }).waitFor();
      await dialog.getByRole('button', { name: 'Cerrar', exact: true }).click();
      const after = await recoveryInventory(independent, zero.dfm, zero.reserve);
      const facts = await committedFacts(independent, zero);
      assert.deepEqual(after.t, before.t);
      assert.equal(after.reserva.estado, 'ocupada');
      const origin = facts.stops.find(row => row.seguimiento_id === zero.origin.seguimiento_id);
      assert.equal(origin.dias_imputables_total, 0);
      assert.equal(origin.fecha_fin_parada, null);
      assert.ok(origin.fecha_fin_imputacion < origin.fecha_inicio_imputacion);
      assert.equal(facts.billing.filter(row => row.seguimiento_id === zero.origin.seguimiento_id)
        .reduce((sum, row) => sum + Number(row.dias_facturables), 0), 0);
      assert.equal(facts.billing.reduce((sum, row) => sum + Number(row.dias_facturables), 0), 2);
      await assertBillingCard(await openHotel(page, zero.origin.id), 0);
      await assertPanelOwner(page, zero);
    });

    await t.test('respuesta perdida: reintento con la misma petición incluso después de una recuperación real posterior', async () => {
      const { dialog } = await openContinuity(page, lost);
      const countBefore = server.calls.filter(call => call.name === CONFIRM).length;
      server.controls.loseNextContinuityResponse = true;
      await dialog.getByRole('button', { name: 'Confirmar continuidad', exact: true }).click();
      const retry = dialog.getByRole('button', { name: 'Reintentar confirmación', exact: true });
      await retry.waitFor();
      assert.equal(await dialog.getByRole('button', { name: 'Cerrar', exact: true }).isDisabled(), true);
      assert.equal(await dialog.getByLabel('PA de origen', { exact: true }).isDisabled(), true);
      const committed = await committedFacts(independent, lost);
      assert.equal(committed.links.length, 1, 'The write committed before the HTTP body was lost');
      const first = server.calls.filter(call => call.name === CONFIRM).at(-1);
      const recovery = await recordActualWorkshopCompletion(fixture.admin, lost);
      const result = await one(fixture.admin, 'SELECT public.marcar_t_realizada_rapida($1,$2,$3) AS value',
        [recovery.id, recovery.version, 'ui_continuity_lost_later_recovery']);
      assert.equal(result.value.ok, true);
      assert.equal((await recoveryInventory(independent, lost.dfm, lost.reserve)).reserva.estado, 'libre');
      const replay = await waitForRpc(page, CONFIRM, () => retry.click());
      assert.equal(replay.error, null, JSON.stringify(replay.error));
      assert.equal(replay.data.reutilizada, true);
      assert.equal(replay.data.propietario_al_confirmar.seguimiento_id, lost.destination.seguimiento_id);
      assert.equal(replay.data.propietario_actual, null);
      assert.deepEqual(server.calls.filter(call => call.name === CONFIRM).at(-1).args, first.args);
      assert.equal(server.calls.filter(call => call.name === CONFIRM).length, countBefore + 2);
      await dialog.getByRole('status').filter({ hasText: 'Se ha comprobado la misma petición ya registrada' }).waitFor();
      await dialog.getByRole('button', { name: 'Cerrar', exact: true }).click();
      assert.equal((await committedFacts(independent, lost)).links.length, 1);
      await assertPanelOwner(page, lost, false);
    });

    await t.test('previsión obsoleta: SQL rechaza sin traspasar, conserva la selección y permite volver a previsualizar', async () => {
      const { dialog } = await openContinuity(page, stale);
      await fixture.admin.query(`UPDATE public.registros_hotel SET observaciones=observaciones || ' · edición concurrente sintética' WHERE id=$1`, [stale.origin.id]);
      const before = await recoveryInventory(independent, stale.dfm, stale.reserve);
      const response = await waitForRpc(page, CONFIRM,
        () => dialog.getByRole('button', { name: 'Confirmar continuidad', exact: true }).click());
      assert.ok(response.error, 'The authoritative version mismatch must reject');
      await dialog.getByRole('status').filter({ hasText: 'Vuelve a previsualizar' }).waitFor();
      assert.equal(await dialog.getByLabel('PA de origen', { exact: true }).inputValue(), stale.origin.id);
      assert.equal(await dialog.getByLabel('Entrada real en taller', { exact: true }).inputValue(), stale.entry.id);
      assert.equal(await dialog.getByLabel('Confirmo la entrada real y la continuidad del mismo sustituto', { exact: true }).isChecked(), false);
      assert.deepEqual(await recoveryInventory(independent, stale.dfm, stale.reserve), before);
      assert.equal((await committedFacts(independent, stale)).links.length, 0);
      const refreshed = await waitForRpc(page, PREVIEW,
        () => dialog.getByRole('button', { name: 'Previsualizar continuidad', exact: true }).click());
      assert.equal(refreshed.error, null);
      assert.equal(refreshed.data.confirmable, true);
      assert.equal(await dialog.getByRole('button', { name: 'Confirmar continuidad', exact: true }).isDisabled(), true);
      await dialog.getByRole('button', { name: 'Cerrar', exact: true }).click();
    });

    await t.test('recuperación explícita del destino: libera la reserva sin borrar el vínculo ni cerrar la 24H', async () => {
      await recordActualWorkshopCompletion(fixture.admin, normal);
      const before = await recoveryInventory(independent, normal.dfm, normal.reserve);
      const card = await openHotel(page, normal.destination.id);
      const toggle = card.locator('.a75-card-stages-toggle');
      if (await toggle.getAttribute('aria-expanded') === 'false') await toggle.click();
      const button = card.locator(`[data-stage-quick-id="${normal.recovery.id}"] .a67-quick-button`);
      await button.waitFor({ state: 'visible' });
      const callsBefore = server.calls.length;
      await button.click();
      assert.equal(server.calls.length, callsBefore, 'The first recovery press only arms the action');
      await page.waitForFunction(id => {
        const node = document.querySelector(`[data-stage-quick-id="${id}"] .a67-quick-button`);
        return node && !node.disabled;
      }, normal.recovery.id);
      const response = await waitForRpc(page, 'marcar_t_realizada_rapida', () => button.click());
      assert.equal(response.error, null, JSON.stringify(response.error));
      assert.equal(response.data.ok, true);
      const after = await recoveryInventory(independent, normal.dfm, normal.reserve);
      assert.equal(after.reserva.estado, 'libre');
      assert.deepEqual(after.activaciones, before.activaciones);
      assert.deepEqual(after.pa.find(row => row.id === normal.origin.id), before.pa.find(row => row.id === normal.origin.id));
      const facts = await committedFacts(independent, normal);
      assert.equal(facts.links.length, 1);
      assert.equal(facts.stops.find(row => row.seguimiento_id === normal.origin.seguimiento_id).fecha_fin_parada, null);
      for (const row of facts.stops) assert.equal(row.propietario_sustitucion_seguimiento_id, null);
      await assertPanelOwner(page, normal, false);
    });

    assert.deepEqual(await snapshotProtectedFacts(independent), protectedBefore);
    assert.deepEqual(denied, []);
    assert.deepEqual(pageErrors, []);
    assert.equal(server.failures.filter(item => item.path !== '/__test/rpc').length, 0, JSON.stringify(server.failures));
    for (const table of ['paradas_sustitucion_resumen', 'facturacion_dfm_periodos', 'hotel_por_dia', 'hotel_actual_detalle']) {
      assert.ok(server.readTables.includes(table), `Missing real ${table} read`);
    }
    t.diagnostic('Only shell, identity and Supabase transport are synthetic; the four continuity/financial reads use the candidate SQL views. Documents and MANTENIMENT delivery remain separate gates.');
  } finally {
    await browser?.close();
    await server?.close();
    await fixture.destroy();
  }
});
