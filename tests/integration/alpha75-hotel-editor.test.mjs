import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { FIXTURE_ACTOR, FIXTURE_BOARD, one, snapshotProtectedFacts } from '../sql/local-postgres-harness.mjs';
import { createEditorFixture, seedEditorContinuityPair } from '../sql/editor-scenarios.mjs';
import { startBrowserServer } from './browser-server.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const READ = 'obtener_ficha_hotel_edicion_alpha72';
const SAVE = 'guardar_ficha_hotel_edicion_alpha73';

async function capture(page, name) {
  const directory = process.env.METROGESTION_UI_SCREENSHOT_DIR;
  if (!directory) return;
  await mkdir(directory, { recursive: true });
  await page.getByRole('dialog', { name: 'Edición completa de Hotel', exact: true })
    .evaluate(node => { node.scrollTop = 0; });
  // A fixed overlay is a viewport surface: fullPage would shrink the editor
  // against the entire background Hotel list and provide misleading evidence.
  await page.screenshot({ path: path.join(directory, name), fullPage: false });
}

async function waitForRpc(page, name, action) {
  const [response] = await Promise.all([
    page.waitForResponse(value => value.url().endsWith('/__test/rpc')
      && value.request().postDataJSON().name === name),
    action(),
  ]);
  return response.json();
}

async function openHotel(page, id, { edit = true } = {}) {
  const heading = page.locator('#module-content > .module-heading');
  const previousHeading = await heading.count() ? await heading.elementHandle() : null;
  try {
    await page.locator('[data-module="hotel"]').click();
    // Permission lookup leaves the previous cards and ready marker visible.
    // After clear(), the new heading starts with a provisional read-mode label
    // before data and event handlers are ready. Require one completed NEW view
    // before inspecting its mode; neither an old card nor its marker suffices.
    await page.waitForFunction(previous => {
      const container = document.querySelector('#module-content');
      const current = container?.querySelector(':scope > .module-heading');
      return current && current !== previous && (!previous || !previous.isConnected)
        && container.dataset.alpha56HotelNative === '1';
    }, previousHeading);
    const card = page.locator(`.hotel-card[data-record-id="${id}"]`);
    await card.waitFor();
    if (edit) {
      const readMode = page.getByRole('button', { name: '🔒 Modo lectura', exact: true });
      if (await readMode.count()) await readMode.click();
      await card.getByRole('button', { name: 'Abrir edición completa', exact: true }).waitFor();
    }
    return card;
  } finally {
    await previousHeading?.dispose();
  }
}

async function editorFrom(page, card, id, { historical = false } = {}) {
  const opened = await waitForRpc(page, READ, () => historical
    ? card.getByRole('button', { name: 'Editar ficha histórica', exact: true }).click()
    : card.getByRole('button', { name: 'Abrir edición completa', exact: true }).click());
  assert.equal(opened.error, null, JSON.stringify(opened.error));
  assert.equal(opened.data.ficha.id, id);
  const dialog = page.getByRole('dialog', { name: 'Edición completa de Hotel', exact: true });
  await dialog.getByRole('button', { name: 'Guardar ficha completa', exact: true }).waitFor();
  assert.match(await dialog.locator('.hotel-editor-status').textContent(), /Ficha cargada/);
  assert.equal(await dialog.getByLabel('N.º de actuación', { exact: true }).inputValue(), opened.data.ficha.numero_parada);
  assert.equal(await dialog.getByLabel('Vehículo sustituido', { exact: true }).inputValue(), opened.data.ficha.vehiculo_sustituido);
  return { dialog, detail: opened.data };
}

async function openEditor(page, id) {
  return editorFrom(page, await openHotel(page, id), id);
}

async function addNote(dialog, text) {
  await dialog.getByRole('button', { name: '＋ Añadir anotación', exact: true }).click();
  await dialog.locator('.a72-manual-note-text').last().fill(text);
}

async function expandStages(dialog) {
  const toggle = dialog.locator('.editor-stages-section .a75-card-stages-toggle');
  if (await toggle.getAttribute('aria-expanded') === 'false') await toggle.click();
}

function entryCard(dialog, pair) {
  return dialog.locator('.editor-stage-card').filter({ hasText: pair.entry.nombre });
}

async function saveEditor(page, dialog, { doubleClick = false } = {}) {
  const button = dialog.getByRole('button', { name: 'Guardar ficha completa', exact: true });
  return waitForRpc(page, SAVE, () => doubleClick
    ? button.evaluate(node => { node.click(); node.click(); })
    : button.click());
}

async function dispatchDisabledClick(button) {
  // HTMLElement.click() suppresses events on a disabled button. Dispatching
  // directly exercises the JavaScript guard even when DOM disabling is bypassed.
  await button.evaluate(async node => {
    node.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
}

async function expectSaved(dialog, result) {
  assert.equal(result.error, null, JSON.stringify(result.error));
  assert.equal(result.data.ok, true);
  assert.equal(result.data.identidad_validada, true);
  assert.ok(result.data.detalle?.ficha?.id, 'The actual saved editor detail must be returned');
  await dialog.waitFor({ state: 'detached' });
}

async function notes(db, pair) {
  return (await one(db, `SELECT coalesce(jsonb_agg(to_jsonb(n) ORDER BY n.id),'[]') AS value
    FROM public.anotaciones_manuales_hotel n WHERE n.seguimiento_id=ANY($1::uuid[])`,
  [[pair.origin.seguimiento_id, pair.destination.seguimiento_id]])).value;
}

// Compare durable operational facts, not audit timestamps/version increments
// legitimately produced by the complete save chain. No timestamp is converted
// through Date: PostgreSQL JSON retains microseconds and the UTC offset.
async function protectedContinuityFacts(db, pair) {
  return (await one(db, `SELECT jsonb_build_object(
    'pa',(SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM (
      SELECT id,seguimiento_id,pizarra_id,numero_parada,vehiculo_sustituido,matricula_sustituido,
        vehiculo_reserva,matricula_reserva,tipo_sustituto,modalidad_operativa,tipo_movimiento,
        fecha_parada,fecha_entrada,fecha_retirado_hotel,estado,cancelado,retirado_hotel_activo
      FROM public.registros_hotel WHERE id=ANY($1::uuid[])) x),
    't',(SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM (
      SELECT id,seguimiento_id,registro_hotel_id,tipo_etapa,accion_sistema,posicion,estado,cancelado,
        fecha_prevista,fecha_inicio_real,fecha_fin_real,fecha_real
      FROM public.etapas_hotel WHERE registro_hotel_id=ANY($1::uuid[])) x),
    'links',(SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY c.id),'[]')
      FROM app_private.sustitucion_continuidades_alpha75 c WHERE c.origen_seguimiento_id=$2 OR c.destino_seguimiento_id=$3),
    'manual',(SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.seguimiento_id),'[]')
      FROM public.ajustes_sustitucion_parada a WHERE a.seguimiento_id=ANY($4::uuid[])),
    'owner',(SELECT jsonb_agg(jsonb_build_object('seguimiento_id',s.seguimiento_id,
      'propietario',s.propietario_sustitucion_seguimiento_id,'vigente',s.sustitucion_vigente,
      'inicio',s.fecha_inicio_imputacion,'fin',s.fecha_fin_imputacion,'dias',s.dias_imputables_total)
      ORDER BY s.seguimiento_id) FROM public.paradas_sustitucion_resumen s WHERE s.seguimiento_id=ANY($4::uuid[])),
    'reserve',(SELECT jsonb_build_object('codigo',r.vehiculo_codigo,'matricula',r.matricula,
      'estado',r.estado,'pendientes',r.pendientes) FROM public.reservas_hotel r WHERE r.vehiculo_codigo=$5),
    '24h',(SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.id),'[]') FROM public.activaciones_24h a
      WHERE a.registro_hotel_id=ANY($1::uuid[]))
  ) AS value`, [[pair.origin.id, pair.destination.id], pair.origin.seguimiento_id,
    pair.destination.seguimiento_id, [pair.origin.seguimiento_id, pair.destination.seguimiento_id], pair.reserve])).value;
}

async function atomicSnapshot(db, pair) {
  return (await one(db, `SELECT jsonb_build_object(
    'pa',(SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM public.registros_hotel r WHERE r.id=ANY($1::uuid[])),
    't',(SELECT jsonb_agg(to_jsonb(e) ORDER BY e.id) FROM public.etapas_hotel e WHERE e.registro_hotel_id=ANY($1::uuid[])),
    'works',(SELECT coalesce(jsonb_agg(to_jsonb(w) ORDER BY w.id),'[]') FROM public.trabajos_etapa_hotel w
      JOIN public.etapas_hotel e ON e.id=w.etapa_hotel_id WHERE e.registro_hotel_id=ANY($1::uuid[])),
    'notes',(SELECT coalesce(jsonb_agg(to_jsonb(n) ORDER BY n.id),'[]') FROM public.anotaciones_manuales_hotel n
      WHERE n.seguimiento_id=ANY($2::uuid[])),
    'sync',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.seguimiento_id),'[]')
      FROM app_private.manteniment_parada_sync s WHERE s.seguimiento_id=ANY($2::uuid[])),
    'links',(SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY c.id),'[]')
      FROM app_private.sustitucion_continuidades_alpha75 c
      WHERE c.origen_seguimiento_id=ANY($2::uuid[]) OR c.destino_seguimiento_id=ANY($2::uuid[]))
  ) AS value`, [[pair.origin.id, pair.destination.id], [pair.origin.seguimiento_id, pair.destination.seguimiento_id]])).value;
}

async function historyCard(page, pair, id) {
  const oldForm = page.getByLabel('Fecha de la pizarra', { exact: true });
  const oldInput = await oldForm.count() ? await oldForm.elementHandle() : null;
  await page.locator('[data-module="historico"]').click();
  if (oldInput) {
    try { await page.waitForFunction(node => !node.isConnected, oldInput); }
    finally { await oldInput.dispose(); }
  }
  const date = page.getByLabel('Fecha de la pizarra', { exact: true });
  await date.waitFor();
  await page.getByRole('button', { name: 'Buscar día', exact: true }).waitFor();
  await page.waitForFunction(() => [...document.querySelectorAll('button')]
    .some(button => button.textContent === 'Buscar día' && !button.disabled));
  await date.fill(pair.dates.today);
  await page.getByRole('button', { name: 'Buscar día', exact: true }).click();
  await page.waitForFunction(() => [...document.querySelectorAll('button')]
    .some(button => button.textContent === 'Buscar día' && !button.disabled));
  const number = id === pair.origin.id ? pair.origin.numero_parada : pair.destination.numero_parada;
  const card = page.locator('[data-history-cards] .hotel-card')
    .filter({ has: page.getByText(`Actuación ${number}`, { exact: true }) });
  await card.waitFor();
  return card;
}

test('Editor completo de Hotel → cadena SQL real, continuidad y fechas precisas', { timeout: 240000 }, async t => {
  const fixture = await createEditorFixture({ prefix: 'ui_editor' });
  let server, browser;
  const denied = [], pageErrors = [], confirmations = [];
  try {
    await fixture.admin.query(`UPDATE public.pizarras SET fecha=(clock_timestamp() AT TIME ZONE 'Europe/Madrid')::date WHERE id=$1`, [FIXTURE_BOARD]);
    await fixture.admin.query(`INSERT INTO public.usuarios(id,nombre,apellidos,correo,tipo_usuario,permisos,activo)
      VALUES($1,'Persona','Sintética','editor@example.invalid','administrador_principal','{}',true)
      ON CONFLICT(id) DO NOTHING`, [FIXTURE_ACTOR]);
    const normal = await seedEditorContinuityPair(fixture.admin, { tag: 'EDITORFLOW', precision: true, confirm: true,
      originManualRate: 37.03, destinationManualRate: 41.07 });
    const stale = await seedEditorContinuityPair(fixture.admin, { tag: 'EDITORSTALE', precision: true, confirm: true });
    const protectedDate = await seedEditorContinuityPair(fixture.admin, { tag: 'EDITORDATE', precision: true, confirm: true });
    const lost = await seedEditorContinuityPair(fixture.admin, { tag: 'EDITORLOST', precision: true, confirm: true });
    const sdkLost = await seedEditorContinuityPair(fixture.admin, { tag: 'EDITORSDK', precision: true, confirm: true });
    const protectedBefore = await snapshotProtectedFacts(fixture.admin);
    const independent = await fixture.connect('ui_editor_readback');
    server = await startBrowserServer(fixture.admin, { editor: true });
    browser = await chromium.launch({
      ...(process.env.METROGESTION_BROWSER_EXECUTABLE ? { executablePath: process.env.METROGESTION_BROWSER_EXECUTABLE } : {}),
      headless: true,
      proxy: { server: server.origin, bypass: '127.0.0.1,localhost' },
      args: ['--no-sandbox', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost'],
    });
    const context = await browser.newContext({ timezoneId: 'Europe/Madrid', locale: 'es-ES',
      viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
    await context.route('**/*', route => {
      if (new URL(route.request().url()).origin === server.origin) return route.continue();
      denied.push(route.request().url());
      return route.abort();
    });
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    page.on('pageerror', error => pageErrors.push(error.message));
    page.on('dialog', dialog => { confirmations.push({ type: dialog.type(), message: dialog.message() }); void dialog.accept(); });
    await page.goto(server.origin);
    try { await page.waitForFunction(() => window.__EDITOR_FIXTURE_READY__ === true); }
    catch (error) { throw new Error(`UI initialization: ${JSON.stringify({ pageErrors, failures: server.failures })}`, { cause: error }); }
    t.diagnostic(`PostgreSQL ${fixture.metadata.server.version}; browser ${browser.version()}; timezone Europe/Madrid`);
    t.afterEach(async () => {
      // A failed assertion must not leave a modal covering the next independent
      // case. Close through the actual editor action; never remove product DOM.
      const dialog = page.getByRole('dialog', { name: 'Edición completa de Hotel', exact: true });
      if (await dialog.count()) {
        const close = dialog.getByRole('button', { name: 'Cerrar sin guardar', exact: true });
        if (await close.count() && await close.isEnabled()) {
          await close.click();
          await dialog.waitFor({ state: 'detached' });
        }
      }
      await page.setViewportSize({ width: 1440, height: 1000 });
    });

    await t.test('origen cedido: añadir anotación con todas las T y doble clic conserva hechos, destino y sustituto', async () => {
      const before = await protectedContinuityFacts(independent, normal);
      assert.equal(before.manual.length, 2, 'Both PAs must have their own persisted manual daily rate');
      const { dialog, detail } = await openEditor(page, normal.origin.id);
      assert.match(detail.ficha.fecha_entrada, /21\.456789/);
      assert.ok(detail.etapas.every(stage => stage.id && stage.version), 'Full persisted stages, not an empty editor DTO');
      await addNote(dialog, 'Nota sintética del origen tras ceder el sustituto');
      await capture(page, 'editor-source-desktop.png');
      const count = server.calls.filter(call => call.name === SAVE).length;
      server.controls.delayNextEditorSave = 250;
      await expectSaved(dialog, await saveEditor(page, dialog, { doubleClick: true }));
      assert.equal(server.calls.filter(call => call.name === SAVE).length, count + 1);
      const call = server.calls.filter(value => value.name === SAVE).at(-1);
      assert.equal(call.args.p_registro_id, normal.origin.id);
      assert.deepEqual(call.args.p_etapas.map(stage => stage.id).sort(), detail.etapas.map(stage => stage.id).sort());
      assert.deepEqual(await protectedContinuityFacts(independent, normal), before);
      const persisted = (await notes(independent, normal)).filter(note => note.texto === 'Nota sintética del origen tras ceder el sustituto');
      assert.equal(persisted.length, 1);
      assert.equal(persisted[0].seguimiento_id, normal.origin.seguimiento_id);

      // Close the assistance through its actual public RPC (the assistance UI
      // already has its own journeys), then exercise the full historical editor.
      const activation = before['24h'][0];
      const closed = (await one(fixture.admin, 'SELECT public.guardar_activacion_24h($1,$2::jsonb,$3) AS value',
        [activation.id, JSON.stringify({ ...activation, estado: 'cerrada', estado_seguimiento: 'realizada',
          resultado: 'trasladado_taller', trasladado_taller: true, taller_traslado: 'Taller sintético de continuidad',
          estado_operativo_confirmado: false, fecha_fin_reparacion: normal.dates.entry, hora_fin_reparacion: '12:00' }),
        'editor_source_close_assistance'])).value;
      assert.equal(closed.estado, 'cerrada');
      const afterClosure = await protectedContinuityFacts(independent, normal);
      assert.deepEqual(afterClosure.pa.find(row => row.id === normal.destination.id), before.pa.find(row => row.id === normal.destination.id));
      assert.equal(afterClosure.reserve.estado, 'ocupada');
      const historic = await historyCard(page, normal, normal.origin.id);
      const reopened = await editorFrom(page, historic, normal.origin.id, { historical: true });
      await addNote(reopened.dialog, 'Nota del origen tras finalizar su asistencia');
      await expectSaved(reopened.dialog, await saveEditor(page, reopened.dialog));
      assert.deepEqual(await protectedContinuityFacts(independent, normal), afterClosure);
    });

    await t.test('destino: editar un trabajo existente y una nota conserva entrada con microsegundos y medias de ambas PA', async () => {
      const before = await protectedContinuityFacts(independent, normal);
      const { dialog, detail } = await openEditor(page, normal.destination.id);
      assert.match(detail.etapas.find(stage => stage.id === normal.entry.id).fecha_inicio_real, /37\.123456/);
      await addNote(dialog, 'Nota sintética del taller con continuidad vigente');
      await expandStages(dialog);
      const stage = entryCard(dialog, normal);
      const works = stage.locator('.editor-work-card');
      assert.equal(await works.count(), 1, 'A real existing work row is required');
      const workId = detail.etapas.find(value => value.id === normal.entry.id).trabajos[0].id;
      await works.getByLabel('Diagnóstico real', { exact: true }).fill('Diagnóstico sintético editado después de continuidad');
      await expectSaved(dialog, await saveEditor(page, dialog));
      assert.deepEqual(await protectedContinuityFacts(independent, normal), before);
      const work = await one(independent, `SELECT id,etapa_hotel_id,diagnostico_real FROM public.trabajos_etapa_hotel WHERE id=$1`, [workId]);
      assert.equal(work.etapa_hotel_id, normal.entry.id);
      assert.equal(work.diagnostico_real, 'Diagnóstico sintético editado después de continuidad');
      assert.equal((await notes(independent, normal)).filter(note => note.texto === 'Nota sintética del taller con continuidad vigente').length, 1);
    });

    await t.test('hitos guardados desde el editor permiten recuperar; editar después en Histórico conserva la hora real exacta', async () => {
      const before = await protectedContinuityFacts(independent, normal);
      const { dialog } = await openEditor(page, normal.destination.id);
      await expandStages(dialog);
      const stage = entryCard(dialog, normal);
      await stage.getByLabel('Acabado', { exact: true }).fill(`${normal.dates.entry}T12:10`);
      await stage.getByLabel('Recogido', { exact: true }).fill(`${normal.dates.entry}T12:20`);
      await expectSaved(dialog, await saveEditor(page, dialog));
      const afterHitos = await protectedContinuityFacts(independent, normal);
      assert.equal(afterHitos.t.find(value => value.id === normal.entry.id).fecha_inicio_real,
        before.t.find(value => value.id === normal.entry.id).fecha_inicio_real);
      assert.deepEqual(afterHitos.pa.find(value => value.id === normal.origin.id), before.pa.find(value => value.id === normal.origin.id));
      assert.deepEqual(afterHitos.manual, before.manual);
      const card = await openHotel(page, normal.destination.id, { edit: false });
      const toggle = card.locator('.a75-card-stages-toggle');
      if (await toggle.getAttribute('aria-expanded') === 'false') await toggle.click();
      const recovery = card.locator(`[data-stage-quick-id="${normal.recovery.id}"] .a67-quick-button`);
      await recovery.click();
      await page.waitForFunction(id => {
        const button = document.querySelector(`[data-stage-quick-id="${id}"] .a67-quick-button`);
        return button && !button.disabled;
      }, normal.recovery.id);
      const recovered = await waitForRpc(page, 'marcar_t_realizada_rapida', () => recovery.click());
      assert.equal(recovered.error, null, JSON.stringify(recovered.error));
      const recoveredFacts = await protectedContinuityFacts(independent, normal);
      assert.equal(recoveredFacts.reserve.estado, 'libre');
      assert.ok(recoveredFacts.owner.every(value => value.propietario === null));
      assert.deepEqual(recoveredFacts.pa.find(value => value.id === normal.origin.id), before.pa.find(value => value.id === normal.origin.id));
      const historical = await historyCard(page, normal, normal.destination.id);
      const opened = await editorFrom(page, historical, normal.destination.id, { historical: true });
      await addNote(opened.dialog, 'Nota histórica posterior a la recuperación real');
      await page.setViewportSize({ width: 390, height: 844 });
      await capture(page, 'editor-history-mobile.png');
      assert.equal(await opened.dialog.evaluate(node => node.scrollWidth <= node.clientWidth + 1), true,
        'The candidate editor must not overflow the narrow viewport horizontally');
      await expectSaved(opened.dialog, await saveEditor(page, opened.dialog));
      await page.setViewportSize({ width: 1440, height: 1000 });
      assert.deepEqual(await protectedContinuityFacts(independent, normal), recoveredFacts);
      assert.equal((await notes(independent, normal)).filter(note => note.texto === 'Nota histórica posterior a la recuperación real').length, 1);
    });

    await t.test('versión obsoleta: el editor conserva el borrador y el servidor no persiste ninguno de sus cambios', async () => {
      const { dialog } = await openEditor(page, stale.destination.id);
      await addNote(dialog, 'Este borrador obsoleto no debe guardarse');
      await independent.query(`UPDATE public.registros_hotel SET causa='Edición concurrente sintética' WHERE id=$1`, [stale.destination.id]);
      const before = await atomicSnapshot(independent, stale);
      const result = await saveEditor(page, dialog);
      assert.ok(result.error, 'The actual save chain must reject the stale version');
      assert.equal(result.error.code, 'P0001');
      assert.equal(result.error.message, 'La ficha ha cambiado desde que la abriste. Recárgala antes de guardar.');
      await dialog.locator('.hotel-editor-status.error').waitFor();
      assert.equal(await dialog.locator('.a72-manual-note-text').last().inputValue(), 'Este borrador obsoleto no debe guardarse');
      assert.deepEqual(await atomicSnapshot(independent, stale), before);
      await dialog.getByRole('button', { name: 'Cerrar sin guardar', exact: true }).click();
      await dialog.waitFor({ state: 'detached' });
    });

    await t.test('modificación explícita de la entrada protegida: rechazo atómico, sin añadir la nota ni alterar el vínculo', async () => {
      // Re-enter Hotel from its previous read-only instance. Permission lookup
      // leaves that instance visible; the next data read exposes the provisional
      // mode button before the new instance has attached its handlers.
      const editMode = page.getByRole('button', { name: '✏️ Lectura y edición', exact: true });
      if (await editMode.count()) await editMode.click();
      await page.getByRole('button', { name: '🔒 Modo lectura', exact: true }).waitFor();
      server.controls.delayNextHistoryAccess = 20;
      server.controls.delayNextHotelRead = 900;
      const { dialog } = await openEditor(page, protectedDate.destination.id);
      assert.equal(server.controls.delayNextHistoryAccess, 0, 'The delayed permission lookup must be consumed');
      assert.equal(server.controls.delayNextHotelRead, 0, 'The delayed Hotel data read must be consumed');
      await addNote(dialog, 'Esta nota acompaña un cambio de entrada rechazado');
      await expandStages(dialog);
      await entryCard(dialog, protectedDate).getByLabel('Fecha entrada', { exact: true }).fill(`${protectedDate.dates.entry}T11:01`);
      const before = await atomicSnapshot(independent, protectedDate);
      const result = await saveEditor(page, dialog);
      assert.ok(result.error, 'Changing the actual linked entry must reach and be rejected by the SQL guard');
      await dialog.locator('.hotel-editor-status.error').waitFor();
      assert.deepEqual(await atomicSnapshot(independent, protectedDate), before);
      assert.equal(await entryCard(dialog, protectedDate).getByLabel('Fecha entrada', { exact: true }).inputValue(), `${protectedDate.dates.entry}T11:01`);
      await dialog.getByRole('button', { name: 'Cerrar sin guardar', exact: true }).click();
      await dialog.waitFor({ state: 'detached' });
    });

    await t.test('respuesta perdida tras commit: no permite otra escritura; reabrir acredita una sola nota y hechos intactos', async () => {
      const before = await protectedContinuityFacts(independent, lost);
      const { dialog } = await openEditor(page, lost.destination.id);
      await addNote(dialog, 'Nota sintética confirmada en SQL con respuesta perdida');
      const count = server.calls.filter(call => call.name === SAVE).length;
      server.controls.loseNextEditorSaveResponse = true;
      await dialog.getByRole('button', { name: 'Guardar ficha completa', exact: true }).click();
      await dialog.locator('.hotel-editor-status.error').filter({ hasText: 'No se ha podido confirmar el resultado' }).waitFor();
      const uncertain = dialog.getByRole('button', { name: 'Resultado sin confirmar', exact: true });
      assert.equal(await uncertain.isDisabled(), true);
      const dialogsBeforeDispatch = confirmations.length;
      await dispatchDisabledClick(uncertain);
      assert.equal(confirmations.length, dialogsBeforeDispatch, 'The uncertainty guard must run before any new identity confirmation');
      assert.equal(server.calls.filter(call => call.name === SAVE).length, count + 1);
      assert.deepEqual(await protectedContinuityFacts(independent, lost), before);
      assert.equal((await notes(independent, lost)).filter(note => note.texto === 'Nota sintética confirmada en SQL con respuesta perdida').length, 1);
      await dialog.getByRole('button', { name: 'Cerrar sin guardar', exact: true }).click();
      await dialog.waitFor({ state: 'detached' });
      const reopened = await openEditor(page, lost.destination.id);
      assert.ok(reopened.detail.anotaciones_manuales.some(note => note.texto === 'Nota sintética confirmada en SQL con respuesta perdida'));
      assert.equal(server.calls.filter(call => call.name === SAVE).length, count + 1);
      await reopened.dialog.getByRole('button', { name: 'Cerrar sin guardar', exact: true }).click();
      await reopened.dialog.waitFor({ state: 'detached' });
    });

    await t.test('backend anterior sin contrato de fechas: se bloquea la edición completa antes de poder enviar una escritura', async () => {
      const before = await atomicSnapshot(independent, lost);
      const card = await openHotel(page, lost.destination.id);
      const count = server.calls.filter(call => call.name === SAVE).length;
      server.controls.omitEditorDateContract = true;
      try {
        const reply = await waitForRpc(page, READ,
          () => card.getByRole('button', { name: 'Abrir edición completa', exact: true }).click());
        assert.equal(reply.error, null);
        assert.ok(reply.data.ficha?.id, 'The actual detail remains otherwise valid');
        assert.equal(reply.data.contrato_fechas_editor, undefined);
        const dialog = page.getByRole('dialog', { name: 'Edición completa de Hotel', exact: true });
        await dialog.locator('.hotel-editor-status.error').waitFor();
        assert.match(await dialog.locator('.hotel-editor-status').textContent(), /fechas|actualiza|versi[oó]n|compatible/i);
        assert.equal(await dialog.getByRole('button', { name: 'Guardar ficha completa', exact: true }).count(), 0);
        assert.equal(await dialog.locator('form').count(), 0);
        assert.equal(server.calls.filter(call => call.name === SAVE).length, count);
        assert.deepEqual(await atomicSnapshot(independent, lost), before);
        await dialog.getByRole('button', { name: 'Cerrar', exact: true }).click();
        await dialog.waitFor({ state: 'detached' });
      } finally { server.controls.omitEditorDateContract = false; }
    });

    await t.test('error de red resuelto como valor por el SDK tras commit: resultado incierto bloqueado y una única nota al reabrir', async () => {
      const before = await protectedContinuityFacts(independent, sdkLost);
      const { dialog } = await openEditor(page, sdkLost.destination.id);
      const noteText = 'Nota sintética con fallo de red resuelto como valor SDK';
      await addNote(dialog, noteText);
      const count = server.calls.filter(call => call.name === SAVE).length;
      server.controls.editorSaveNetworkErrorAsValue = true;
      const reply = await saveEditor(page, dialog);
      assert.equal(reply.status, 0);
      assert.equal(reply.data, null);
      assert.equal(reply.error.code, '');
      await dialog.locator('.hotel-editor-status.error').waitFor();
      assert.match(await dialog.locator('.hotel-editor-status').textContent(), /No se ha podido confirmar el resultado/);
      const uncertain = dialog.getByRole('button', { name: 'Resultado sin confirmar', exact: true });
      assert.equal(await uncertain.isDisabled(), true);
      const dialogsBeforeDispatch = confirmations.length;
      await dispatchDisabledClick(uncertain);
      assert.equal(confirmations.length, dialogsBeforeDispatch);
      assert.equal(server.calls.filter(call => call.name === SAVE).length, count + 1);
      assert.deepEqual(await protectedContinuityFacts(independent, sdkLost), before);
      assert.equal((await notes(independent, sdkLost)).filter(note => note.texto === noteText).length, 1);
      await dialog.getByRole('button', { name: 'Cerrar sin guardar', exact: true }).click();
      await dialog.waitFor({ state: 'detached' });
      const reopened = await openEditor(page, sdkLost.destination.id);
      assert.equal(reopened.detail.anotaciones_manuales.filter(note => note.texto === noteText).length, 1);
      assert.equal(server.calls.filter(call => call.name === SAVE).length, count + 1);
      await reopened.dialog.getByRole('button', { name: 'Cerrar sin guardar', exact: true }).click();
      await reopened.dialog.waitFor({ state: 'detached' });
    });

    assert.deepEqual(await snapshotProtectedFacts(independent), protectedBefore);
    assert.deepEqual(denied, []);
    assert.deepEqual(pageErrors, []);
    assert.equal(server.failures.filter(item => item.path !== '/__test/rpc').length, 0, JSON.stringify(server.failures));
    assert.ok(server.readTables.includes('vehiculos_hotel_autocompletar'));
    assert.ok(confirmations.some(dialog => dialog.message.includes('Vas a guardar SOLO esta ficha:')));
    assert.equal(confirmations.filter(dialog => dialog.type === 'alert').length, 0, JSON.stringify(confirmations));
    t.diagnostic('Complete Hotel editor and SQL persistence chain are real. Auth, local transport, document storage and navigation remain isolated test doubles; candidate styles are real.');
  } finally {
    await browser?.close();
    await server?.close();
    await fixture.destroy();
  }
});
