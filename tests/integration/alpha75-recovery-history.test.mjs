import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { FIXTURE_ACTOR, one, snapshotProtectedFacts } from '../sql/local-postgres-harness.mjs';
import { createContinuityFixture } from '../sql/continuity-scenarios.mjs';
import { seedRecoveryScenario, recoveryInventory } from '../sql/recovery-scenarios.mjs';
import { startBrowserServer } from './browser-server.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const BOARD_DATE = '2026-10-28';

async function capture(page, name) {
  const directory = process.env.METROGESTION_UI_SCREENSHOT_DIR;
  if (!directory) return;
  await mkdir(directory, { recursive: true });
  await page.screenshot({ path: path.join(directory, name), fullPage: true });
}

async function seedUi(db) {
  await db.query(`INSERT INTO public.usuarios(id,nombre,apellidos,correo,tipo_usuario,permisos,activo)
    VALUES($1,'Persona','Sintética','fixture@example.invalid','administrador_principal','{}',true)`, [FIXTURE_ACTOR]);
  await db.query(`INSERT INTO public.catalogo_tipos_trabajo(codigo,nombre)
    VALUES('TRAMITE-SYN','Trámite sintético de integración')`);
  const recovered = await seedRecoveryScenario(db, { tag: 'UIREC' });
  const stale = await seedRecoveryScenario(db, { tag: 'UISTALE', pendingReserve: 'Incidencia sintética pendiente' });
  for (const scenario of [recovered, stale]) {
    await db.query(`INSERT INTO public.vehiculos(dfm,matricula,activo) VALUES($1,$2,true)`,
      [scenario.dfm, `MAT${scenario.tag}`]);
  }
  const note = 'NOTA-HIST-UI · Texto manual íntegro: 37,03 km/día; no sustituir por una media calculada.';
  await db.query(`INSERT INTO public.anotaciones_manuales_hotel
    (seguimiento_id,registro_origen_id,texto,fecha_evento,autor_nombre)
    SELECT seguimiento_id,id,$2,'2026-10-21 14:45 Europe/Madrid','Persona sintética'
    FROM public.registros_hotel WHERE id=$1`, [recovered.targetId, note]);
  await db.query(`INSERT INTO public.trabajos_etapa_hotel
    (etapa_hotel_id,tipo_trabajo,motivo_entrada,descripcion,observaciones)
    VALUES($1,'TRAMITE-SYN','Motivo sintético','TRABAJO-HIST-UI · descripción preservada','No modifica la T')`,
    [recovered.other.id]);
  // Exercise the real history keyset traversal, including its second page.
  // These inert rows belong to an archived board and are never rendered as
  // current Hotel cards. They are data fixtures, not a simulated search result.
  await db.query(`INSERT INTO public.registros_hotel
    (pizarra_id,vehiculo_sustituido,estado,orden,observaciones)
    SELECT '00000000-0000-4000-8000-000000000011',
      'TEST-HISTORY-FILLER-' || n,'pendiente_taller',n,'Relleno sintético de paginación'
    FROM generate_series(1,201) AS s(n)`);
  const view = await one(db, `SELECT c.reloptions,
    md5(pg_get_viewdef(c.oid,true)) AS digest FROM pg_class c
    WHERE c.oid='public.hotel_por_dia'::regclass`);
  assert.deepEqual(view.reloptions, ['security_invoker=true']);
  // createContinuityFixture verifies the captured view before applying the
  // candidate. Its added ownership columns must remain on this final view.
  const columns = (await db.query(`SELECT attname FROM pg_attribute
    WHERE attrelid='public.hotel_por_dia'::regclass AND attnum>0 AND NOT attisdropped`)).rows.map(row => row.attname);
  assert.ok(columns.includes('sustitucion_vigente'));
  assert.ok(columns.includes('propietario_sustitucion_seguimiento_id'));
  return { recovered, stale, note };
}

async function openHotel(page, id) {
  await page.locator('[data-module="hotel"]').click();
  const card = page.locator(`.hotel-card[data-record-id="${id}"]`);
  await card.waitFor();
  await page.waitForFunction(() => document.querySelector('#module-content')?.dataset.alpha56HotelNative === '1');
  assert.equal(await page.locator('#module-content > .notice.danger').count(), 0);
  if (await card.locator('.a75-card-stages-toggle').getAttribute('aria-expanded') === 'false') {
    await card.locator('.a75-card-stages-toggle').click();
  }
  return card;
}

async function armRecovery(page, card, stageId, server) {
  const button = card.locator(`[data-stage-quick-id="${stageId}"] .a67-quick-button`);
  await button.waitFor({ state: 'visible' });
  assert.match(await button.textContent(), /Marcar recuperación realizada/);
  const before = server.calls.length;
  await button.click();
  assert.equal(await button.isDisabled(), true, 'First press must not confirm immediately');
  assert.equal(server.calls.length, before, 'Arming must not send a write');
  assert.match(await card.locator(`[data-stage-quick-id="${stageId}"] .a67-quick-status`).textContent(),
    /pondrá la ficha como recuperada y liberará el sustituto/);
  await page.waitForFunction(id => {
    const button = document.querySelector(`[data-stage-quick-id="${id}"] .a67-quick-button`);
    return button && !button.disabled;
  }, stageId);
  return { button, before };
}

async function confirmRecovery(page, button) {
  const [response] = await Promise.all([
    page.waitForResponse(value => value.url().endsWith('/__test/rpc')
      && value.request().postDataJSON().name === 'marcar_t_realizada_rapida'),
    button.click(),
  ]);
  return response.json();
}

function historicalCard(page, number) {
  return page.locator('[data-history-cards] .hotel-card')
    .filter({ has: page.getByText(`Actuación ${number}`, { exact: true }) });
}

async function waitHistory(page, dateInput = null) {
  await page.waitForFunction(expectedInput => {
    const currentInput = document.querySelector('input[aria-label="Fecha de la pizarra"]');
    const button = [...document.querySelectorAll('button')].find(node => node.textContent === 'Buscar día');
    return (!expectedInput || (expectedInput.isConnected && currentInput === expectedInput))
      && button && !button.disabled;
  }, dateInput);
  const errors = (await page.locator('[data-history-results] > .notice.danger').allTextContents())
    .filter(text => !text.includes('PIZARRA ANTERIOR'));
  assert.deepEqual(errors, []);
}

async function openHistoryDay(page, date) {
  const input = page.getByLabel('Fecha de la pizarra', { exact: true });
  const previousInput = await input.count() ? await input.elementHandle() : null;
  let currentInput;
  try {
    await page.locator('[data-module="historico"]').click();
    // Permission lookup precedes renderHistoryNative's clear(container). An
    // enabled button can still belong to the previous search during that await.
    await page.waitForFunction(previous => {
      const current = document.querySelector('input[aria-label="Fecha de la pizarra"]');
      return current && current !== previous && (!previous || !previous.isConnected);
    }, previousInput);
    currentInput = await input.elementHandle();
    await waitHistory(page, currentInput);
    await input.fill(date);
    await page.getByRole('button', { name: 'Buscar día', exact: true }).click();
    await waitHistory(page, currentInput);
    assert.equal(await currentInput.evaluate(node => node.value), date,
      'The requested date must remain on the newly loaded History form');
  } finally {
    await previousInput?.dispose();
    await currentInput?.dispose();
  }
}

async function searchHistory(page, term, from = '', to = '') {
  await page.getByLabel('Buscar en todo el histórico', { exact: true }).fill(term);
  await page.getByLabel('Desde', { exact: true }).fill(from);
  await page.getByLabel('Hasta', { exact: true }).fill(to);
  await page.getByRole('button', { name: 'Buscar en todo el Histórico', exact: true }).click();
  await waitHistory(page);
}

async function notesSnapshot(db) {
  return (await one(db, `SELECT coalesce(jsonb_agg(to_jsonb(n) ORDER BY n.id),'[]') AS value
    FROM public.anotaciones_manuales_hotel n`)).value;
}

test('Recuperación explícita e Histórico reales → PostgreSQL17 aislado', { timeout: 180000 }, async t => {
  const fixture = await createContinuityFixture({ prefix: 'ui_history' });
  let server, browser;
  const denied = [], pageErrors = [];
  try {
    const { recovered, stale, note } = await seedUi(fixture.admin);
    const protectedBefore = await snapshotProtectedFacts(fixture.admin);
    const notesBefore = await notesSnapshot(fixture.admin);
    server = await startBrowserServer(fixture.admin, { recoveryHistory: true });
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

    await t.test('dos pulsaciones recuperan sólo el taller y liberan su reserva; 24H abierta y trámite siguen íntegros', async () => {
      const card = await openHotel(page, recovered.targetId);
      const before = await recoveryInventory(fixture.admin, recovered.dfm, recovered.reserve);
      assert.equal(before.reserva.estado, 'ocupada');
      const lowerTime = await one(fixture.admin, 'SELECT clock_timestamp() AS value');
      const { button, before: callCount } = await armRecovery(page, card, recovered.recovery.id, server);
      await capture(page, '05-recovery-confirm.png');
      const result = await confirmRecovery(page, button);
      assert.equal(result.error, null, result.error?.message);
      assert.equal(result.data.ok, true);
      assert.equal(result.data.registro_estado, 'recuperado');
      assert.equal(server.calls.length, callCount + 1);
      assert.deepEqual(Object.keys(server.calls.at(-1).args).sort(), ['p_etapa_id', 'p_request_id', 'p_version']);
      assert.equal(server.calls.at(-1).args.p_etapa_id, recovered.recovery.id);
      assert.match(await card.locator('.a67-quick-success').textContent(), /ruta recuperada y sustituto liberado/);
      const after = await recoveryInventory(fixture.admin, recovered.dfm, recovered.reserve);
      const upperTime = await one(fixture.admin, 'SELECT clock_timestamp() AS value');
      const finished = after.t.find(row => row.id === recovered.recovery.id);
      assert.equal(finished.estado, 'realizada');
      assert.equal(finished.datos_pendientes, true);
      assert.equal(finished.marcado_rapido_por, FIXTURE_ACTOR);
      assert.equal(finished.fecha_real, finished.fecha_fin_real);
      assert.ok(new Date(finished.fecha_real) >= lowerTime.value && new Date(finished.fecha_real) <= upperTime.value,
        'The recorded time must be the actual server time, not a guessed browser value');
      assert.deepEqual(after.activaciones, before.activaciones);
      assert.deepEqual(after.t.filter(row => row.id !== recovered.recovery.id), before.t.filter(row => row.id !== recovered.recovery.id));
      assert.deepEqual(after.trabajos, before.trabajos);
      assert.deepEqual(after.peticiones, before.peticiones);
      assert.deepEqual(after.sync, before.sync);
      assert.equal(after.t.find(row => row.id === recovered.other.id).estado, 'pendiente');
      const target = after.pa.find(row => row.id === recovered.targetId);
      assert.equal(target.estado, 'recuperado');
      assert.equal(target.retirado_hotel_activo, true);
      assert.equal(target.vehiculo_reserva, recovered.reserve, 'Historical substitute identity remains on the recovered card');
      assert.equal(after.reserva.estado, 'libre');
      assert.deepEqual(after.pa.filter(row => row.id !== recovered.targetId), before.pa.filter(row => row.id !== recovered.targetId));
      await page.waitForFunction(id => !document.querySelector(`.hotel-card[data-record-id="${id}"]`), recovered.targetId);
      const assistanceCard = page.locator(`.hotel-card[data-record-id="${recovered.activation.registro_hotel_id}"]`);
      await assistanceCard.waitFor();
      assert.equal(await assistanceCard.getAttribute('data-state'), before.pa.find(row => row.id === recovered.activation.registro_hotel_id).estado);

      await page.locator('[data-module="resumen"]').click();
      await page.locator('.a52-updated').filter({ hasText: 'Actualizado' }).waitFor();
      const counts = await one(fixture.admin, `SELECT
        (SELECT count(*)::int FROM public.hotel_actual_detalle) AS cards,
        (SELECT count(*)::int FROM public.activaciones_24h WHERE estado NOT IN ('cerrada','anulada')) AS open24h,
        (SELECT count(*)::int FROM public.reservas_hotel WHERE activo AND estado='libre') AS free,
        (SELECT count(*)::int FROM public.reservas_hotel WHERE activo AND estado='ocupada') AS occupied`);
      for (const [label, value] of [['Fichas activas', counts.cards], ['24H abiertas', counts.open24h], ['Libres', counts.free], ['Ocupadas', counts.occupied]]) {
        const metric = page.locator('.a52-metric').filter({ has: page.getByText(label, { exact: true }) });
        assert.equal(await metric.locator('strong').textContent(), String(value), label);
      }
      await page.locator('.a52-metric').filter({ has: page.getByText('Libres', { exact: true }) }).click();
      assert.match(await page.locator('.a52-detail').textContent(), new RegExp(recovered.reserve));
      assert.doesNotMatch(await page.locator('.a52-detail').textContent(), new RegExp(stale.reserve));
    });

    await t.test('una versión obsoleta rechazada por PostgreSQL conserva la T, la reserva y el control visible', async () => {
      const card = await openHotel(page, stale.targetId);
      await card.locator(`[data-stage-quick-id="${stale.recovery.id}"] .a67-quick-button`).waitFor({ state: 'visible' });
      await fixture.admin.query(`UPDATE public.etapas_hotel SET observaciones=observaciones || ' · ajuste concurrente sintético'
        WHERE id=$1`, [stale.recovery.id]);
      const before = await recoveryInventory(fixture.admin, stale.dfm, stale.reserve);
      assert.ok(before.t.find(row => row.id === stale.recovery.id).version > stale.recovery.version);
      const { button, before: callCount } = await armRecovery(page, card, stale.recovery.id, server);
      const result = await confirmRecovery(page, button);
      assert.equal(result.data, null);
      assert.match(result.error.message, /ha cambiado desde que se cargó/);
      const status = card.locator(`[data-stage-quick-id="${stale.recovery.id}"] .a67-quick-status.danger`);
      await status.waitFor({ state: 'visible' });
      assert.match(await status.textContent(), /Recarga la Pizarra/);
      assert.equal(await card.locator('.a67-quick-success').count(), 0);
      assert.match(await button.textContent(), /Marcar recuperación realizada/);
      assert.equal(await button.isDisabled(), false);
      assert.equal(server.calls.length, callCount + 1);
      assert.deepEqual(await recoveryInventory(fixture.admin, stale.dfm, stale.reserve), before);
      assert.equal(before.reserva.estado, 'ocupada');
    });

    const historyBefore = await recoveryInventory(fixture.admin, recovered.dfm, recovered.reserve);
    const historyWritesBefore = server.calls.length;
    await t.test('Histórico por día conserva PA recuperada, asistencia abierta, T pendiente y nota manual', async () => {
      await openHistoryDay(page, BOARD_DATE);
      const target = historyBefore.pa.find(row => row.id === recovered.targetId);
      const assistance = historyBefore.pa.find(row => row.id === recovered.activation.registro_hotel_id);
      const card = historicalCard(page, target.numero_parada);
      assert.equal(await card.count(), 1);
      assert.equal(await card.getAttribute('data-state'), 'recuperado');
      assert.match(await card.textContent(), /Retirado del Hotel activo/);
      assert.match(await card.textContent(), new RegExp(recovered.reserve));
      assert.ok((await card.textContent()).includes(note));
      assert.equal(await historicalCard(page, assistance.numero_parada).count(), 1);
      assert.notEqual(target.numero_parada, assistance.numero_parada);
      await card.locator('.a75-card-stages-toggle').click();
      const recovery = card.locator(`[data-stage-id="${recovered.recovery.id}"]`);
      const other = card.locator(`[data-stage-id="${recovered.other.id}"]`);
      await recovery.locator('.a67-pending-panel').waitFor({ state: 'visible' });
      assert.match(await recovery.textContent(), /Datos pendientes de completar/);
      assert.match(await other.locator('.a53-history-stage-head .badge').textContent(), /Pendiente/);
      assert.equal(await card.locator('.a67-quick-button').count(), 0, 'History must not offer quick completion of pending stages');
      await other.locator('.a56-history-stage-open').click();
      const detail = page.locator('.a56-stage-detail-modal');
      await detail.locator('.a56-stage-detail-content').waitFor();
      assert.equal(await detail.locator('.a56-stage-warning').count(), 0);
      assert.match(await detail.textContent(), /TRABAJO-HIST-UI · descripción preservada/);
      assert.match(await detail.textContent(), /La recuperación no realiza este trámite/);
      assert.match(await detail.textContent(), /29\/10\/26,? 9:15/);
      await detail.getByRole('button', { name: 'Cerrar', exact: true }).click();
      await capture(page, '06-history-recovered.png');
      assert.equal(server.calls.length, historyWritesBefore, 'Opening history and stage detail must not write');
    });

    await t.test('búsqueda global real pagina, conserva las dos PA y filtra por fechas, trabajo y anotación', async () => {
      const queryStart = server.queries.length;
      await searchHistory(page, recovered.dfm);
      assert.equal(await page.locator('[data-history-cards] .hotel-card').count(), 2);
      assert.ok(server.queries.slice(queryStart).some(query => query.table === 'registros_hotel'
        && query.filters.some(filter => filter.operator === 'gt' && filter.column === 'id')),
      'History must read a real second page through its keyset query');
      const target = historyBefore.pa.find(row => row.id === recovered.targetId);
      await searchHistory(page, `PA-${target.numero_parada}`, BOARD_DATE, BOARD_DATE);
      assert.equal(await historicalCard(page, target.numero_parada).count(), 1);
      assert.equal(await page.locator('[data-history-cards] .hotel-card').count(), 1);
      await searchHistory(page, recovered.dfm, '2026-09-01', '2026-09-30');
      assert.equal(await page.locator('[data-history-cards] .hotel-card').count(), 0);
      const beforeInvalid = server.queries.length;
      await searchHistory(page, recovered.dfm, '2026-10-29', '2026-10-28');
      assert.match(await page.locator('[data-history-results]').textContent(), /Desde no puede ser posterior/);
      assert.equal(server.queries.length, beforeInvalid, 'Invalid periods must stop before querying');
      for (const term of ['TRABAJO-HIST-UI', 'NOTA-HIST-UI']) {
        await searchHistory(page, term);
        assert.equal(await page.locator('[data-history-cards] .hotel-card').count(), 1);
        assert.equal(await historicalCard(page, target.numero_parada).count(), 1);
      }
      assert.equal(server.calls.length, historyWritesBefore);
    });

    await t.test('históricos mixtos 2556/2637 se leen sin arrastrar recuperación ni alterar sus datos manuales', async () => {
      await searchHistory(page, '2556');
      const mixed = page.locator('[data-history-cards] .hotel-card');
      assert.equal(await mixed.count(), 1);
      assert.equal(await mixed.getAttribute('data-state'), 'en_taller');
      await mixed.locator('.a75-card-stages-toggle').click();
      assert.equal(await mixed.locator('[data-stage-id]').count(), 2);
      assert.match(await mixed.textContent(), /Dato manual protegido/);
      assert.match(await mixed.textContent(), /Estancia taller manual/);
      assert.equal(await mixed.locator('.a67-quick-button').count(), 0);
      const previousDateInput = await page.getByLabel('Fecha de la pizarra', { exact: true }).elementHandle();
      // openHistory awaits permissions while the previous form is still
      // connected and enabled. Force that order instead of relying on CI load.
      server.controls.delayNextHistoryAccess = 1000;
      await openHistoryDay(page, '2026-09-30');
      assert.equal(server.controls.delayNextHistoryAccess, 0, 'The delayed permission query must have been exercised');
      assert.equal(await previousDateInput.evaluate(node => node.isConnected), false,
        'History navigation must finish on a new form, not the still-enabled previous form');
      await previousDateInput.dispose();
      const historical = historicalCard(page, 'SINT-2637');
      assert.equal(await historical.count(), 1);
      assert.match(await historical.textContent(), /Identidad y medias manuales/);
      await searchHistory(page, '2637', '2026-09-30', '2026-09-30');
      assert.equal(await page.locator('[data-history-cards] .hotel-card').count(), 1);
      assert.equal(server.calls.length, historyWritesBefore);
      assert.deepEqual(await snapshotProtectedFacts(fixture.admin), protectedBefore);
    });

    assert.deepEqual(await recoveryInventory(fixture.admin, recovered.dfm, recovered.reserve), historyBefore);
    assert.deepEqual(await notesSnapshot(fixture.admin), notesBefore);
    assert.deepEqual(denied, []);
    assert.deepEqual(pageErrors, []);
    assert.equal(server.failures.length, 1, JSON.stringify(server.failures));
    assert.match(server.failures[0].message, /ha cambiado desde que se cargó/);
    assert.ok(server.doubledRpcs.includes('listar_ordenes_manteniment_pendientes_alpha74'));
    for (const table of ['hotel_actual_detalle', 'hotel_por_dia', 'registros_hotel', 'etapas_hotel',
      'trabajos_etapa_hotel', 'anotaciones_manuales_hotel', 'catalogo_tipos_trabajo']) {
      assert.ok(server.readTables.includes(table), `Missing real read: ${table}`);
    }
  } finally {
    await browser?.close();
    await server?.close();
    await fixture.destroy();
  }
});
