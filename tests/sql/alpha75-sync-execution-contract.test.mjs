import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createContinuityFixture } from './continuity-scenarios.mjs';
import { one, snapshotProtectedFacts } from './local-postgres-harness.mjs';
import { SYNTHETIC_SYNC_TOKEN, seedSyncTracking, syncFlags } from './continuity-sync-scenarios.mjs';
import { createExecutorHarness, HEADERS, PROTOCOL, paradaRow, workRow, scopeOf } from '../helpers/alpha75-sync-executor-harness.mjs';

const migration = await readFile(new URL('../../supabase/migrations/20261029184748_alpha75_autorizar_ejecucion_manteniment.sql', import.meta.url), 'utf8');
const bridgePath = fileURLToPath(new URL('./execution-edge-bridge.mjs', import.meta.url));
const plain = value => JSON.parse(JSON.stringify(value));
const journal = h => Object.entries(h.properties).filter(([key]) => key.startsWith('METROGESTION_ORDEN_V1:'))
  .map(([, value]) => JSON.parse(value));

async function setup(t, rows) {
  const fixture = await createContinuityFixture({ prefix: 'exec_contract' });
  t.after(async () => { await fixture.destroy(); });
  const initialFlags = await syncFlags(fixture.admin);
  const protectedBefore = await snapshotProtectedFacts(fixture.admin);
  await fixture.admin.query(migration);
  const requests = [];
  const h = createExecutorHarness({ rows, properties: { METROGESTION_SYNC_TOKEN: SYNTHETIC_SYNC_TOKEN },
    http(body) {
      const child = spawnSync(process.execPath, [bridgePath], { input: JSON.stringify({ database: fixture.dbName, body }),
        encoding: 'utf8', timeout: 25000, maxBuffer: 4_000_000 });
      assert.ifError(child.error);
      assert.equal(child.status, 0, child.stderr);
      const result = JSON.parse(child.stdout);
      requests.push({ action: body.action || 'sync', request: plain(body), response: JSON.parse(result.body), rpc_calls: result.rpc_calls });
      assert.equal(result.status, 200, `${body.action || 'sync'}: ${result.body}`);
      return result;
    } });
  // Local-only synthetic configuration. The value is the public client binding;
  // all fetches above are intercepted and can reach only the dedicated socket.
  await fixture.admin.query(`UPDATE app_private.manteniment_sync_config SET spreadsheet_id=$1,
    pausa_importacion_identidad=false,solo_lectura_manual_protegida=false,escritura_segura_manual=true WHERE id=1`, [h.config.spreadsheetId]);
  async function finish() {
    await fixture.admin.query(`UPDATE app_private.manteniment_sync_config SET spreadsheet_id=$1,
      pausa_importacion_identidad=$2,solo_lectura_manual_protegida=$3,escritura_segura_manual=$4 WHERE id=1`,
    [initialFlags.spreadsheet_id, initialFlags.pausa_importacion_identidad,
      initialFlags.solo_lectura_manual_protegida, initialFlags.escritura_segura_manual]);
    assert.deepEqual(await syncFlags(fixture.admin), initialFlags);
    assert.deepEqual(await snapshotProtectedFacts(fixture.admin), protectedBefore);
  }
  return { fixture, h, requests, finish };
}

async function seedOrder(client, tag, { dfm, plate, pa, pure = false, create = [], assigned = [] }) {
  const tracked = await seedSyncTracking(client, tag, { enqueue: false });
  await client.query(`UPDATE public.registros_hotel SET numero_parada=$2,vehiculo_sustituido=$3,
    matricula_sustituido=$4,fecha_parada='2026-10-01' WHERE id=$1`, [tracked.id, pa, dfm, plate]);
  const payload = pure
    ? { sync_id: tracked.syncId, seguimiento_id: tracked.tracking, numero_parada: `PA-${pa}`,
      solo_trabajos: true, trabajos_asignados: assigned, trabajos_crear: create }
    : { sync_id: tracked.syncId, seguimiento_id: tracked.tracking, numero_parada: `PA-${pa}`,
      dfm, matricula: plate, tipo: 'FURGON', upc: 'UPC-TEST', sustituto: 'TEST-SUST-01',
      estado: 'PARADA', marca: 'TEST', tancament: '', fecha_programada: '2026-10-01',
      fecha_parada: '2026-10-01', fecha_k: null, dias_parada: 1, km_facturables: 300,
      solo_trabajos: false, trabajos_asignados: [], trabajos_crear: [] };
  await client.query(`INSERT INTO app_private.manteniment_parada_outbox(seguimiento_id,sync_id,payload)
    VALUES($1,$2,CASE WHEN $4 THEN $3::jsonb ELSE jsonb_set($3::jsonb,'{km_facturables}','300.00'::jsonb) END)`,
  [tracked.tracking, tracked.syncId, JSON.stringify(payload), pure]);
  const stored = await one(client, `SELECT $2::text AS tipo,sync_id,revision,payload,
    app_private.hash_payload_sync_continuidad_alpha75(payload) AS payload_sha256
    FROM app_private.manteniment_parada_outbox WHERE sync_id=$1`, [tracked.syncId, pure ? 'trabajos' : 'parada']);
  return { tracked, stored };
}

function start(h, refs) {
  h.call('metrogestionGuardarAlcanceOrdenes_', refs);
  return h.call('metrogestionEjecutarSincronizacion_', 'manual');
}

function resumeUntilFinished(h, cycle, count) {
  let result = cycle;
  for (let step = 0; step < count && result.pendiente; step++) {
    result = h.call('metrogestionEjecutarSincronizacion_', 'manual', result.ciclo);
  }
  assert.equal(result.pendiente, false, 'All selected orders must receive a strict persisted ACK');
  return result;
}

async function delivery(client, order) {
  return one(client, `SELECT to_jsonb(e) AS value FROM app_private.manteniment_entregas_continuidad_alpha75 e
    WHERE sync_id=$1 AND revision=$2`, [order.sync_id, order.revision]).then(row => row.value);
}

function assertRealReceipts(requests, orders) {
  const authorizations = requests.filter(item => item.action === 'authorize');
  const acknowledgements = requests.filter(item => item.action === 'ack_execution');
  assert.equal(authorizations.length, orders.length);
  assert.equal(acknowledgements.length, orders.length);
  for (const order of orders) {
    const auth = authorizations.find(item => item.request.payload.orden.sync_id === order.sync_id);
    const ack = acknowledgements.find(item => item.request.payload.confirmacion.sync_id === order.sync_id);
    assert.ok(auth); assert.ok(ack);
    assert.deepEqual(auth.request.payload.orden.payload, order.payload, 'Local planning must send the original payload without a derived DFM');
    assert.deepEqual(scopeOf(auth.request.payload.orden), scopeOf(order));
    assert.equal(auth.response.autorizacion.autorizada, true);
    assert.equal(auth.response.autorizacion.request_id, auth.request.payload.request_id);
    assert.deepEqual(auth.response.autorizacion.orden, scopeOf(order));
    assert.match(auth.response.autorizacion.autorizado_en, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
    assert.equal(Date.parse(auth.response.autorizacion.expira_en) - Date.parse(auth.response.autorizacion.autorizado_en), 30000);
    assert.deepEqual(auth.rpc_calls, [{ name: 'autorizar_ejecucion_manteniment', read_only: true }]);
    assert.equal(ack.response.confirmacion.confirmada, true);
    assert.equal(ack.response.confirmacion.request_id, ack.request.payload.request_id);
    assert.deepEqual(ack.response.confirmacion.orden, scopeOf(order));
    assert.deepEqual(ack.rpc_calls, [{ name: 'confirmar_ejecucion_manteniment', read_only: false }]);
  }
}

test('CT01: real SQL delivery → Edge → distributed GS accepts pure create/assigned work envelopes without changing payload or hash', async t => {
  const { fixture, h, requests, finish } = await setup(t, [HEADERS, paradaRow({ 17: '' }),
    workRow({ 1: 'TEST-DFM-02', 2: 'TEST2345', 5: 'PA-910002' })]);
  try {
    // Shape-only catalog evidence: manteniment_trabajos_por_crear md5
    // 87cbb18160b9c88696ae38a98ce7d577; manteniment_trabajos_asignados md5
    // fd8ff7e95ec9d1554967011810370192. Work ingestion/builders remain fixture
    // doubles; delivery, authorization, strict ACK and the entire GS are real.
    const workId = randomUUID();
    const created = { trabajo_sync_id: workId, trabajo_hotel_id: randomUUID(), dfm: 'TEST-DFM-01',
      matricula: 'TEST1234', tipo: 'FURGON', upc: 'UPC-TEST', numero_parada: 'PA-910001',
      taller: 'TEST-TALLER', tipo_trabajo: 'MECANICA', designacion: 'TEST REVISION',
      fecha_necesidad: '2026-10-01', fecha_entrada: null, fecha_salida: null,
      marca: 'TEST', km_averia: null, expediente: '', motivo_entrada: '', diagnostico_real: '', detalle: '' };
    const assigned = { trabajo_sync_id: randomUUID(), fila: 3,
      clave_fila: 'TEST-DFM-02|TEST2345|TEST-TALLER|MECANICA|TEST REVISION|2026-10-01',
      fecha_entrada: '2026-10-02', fecha_salida: '2026-10-03' };
    const first = await seedOrder(fixture.admin, 'CONTRACT-CREATE', { dfm: 'TEST-DFM-01', plate: 'TEST1234',
      pa: '910001', pure: true, create: [created] });
    const second = await seedOrder(fixture.admin, 'CONTRACT-ASSIGN', { dfm: 'TEST-DFM-02', plate: 'TEST2345',
      pa: '910002', pure: true, assigned: [assigned] });
    await fixture.admin.query(`INSERT INTO app_private.manteniment_t_trabajos(seguimiento_id,sync_id,fuentes)
      VALUES($1,$2,'[]'::jsonb)`, [first.tracked.tracking, workId]);
    const orders = [first.stored, second.stored];
    const cycle = start(h, orders.map(scopeOf));
    assert.equal(requests.length, 1);
    const delivered = requests[0].response.resultado.comandos_manteniment;
    assert.equal(delivered.length, 2);
    for (const order of orders) {
      const received = delivered.find(item => item.sync_id === order.sync_id);
      assert.equal(received.tipo, 'trabajos');
      assert.deepEqual(received.payload, order.payload);
      assert.equal(received.payload_sha256, order.payload_sha256);
      assert.equal(Object.hasOwn(received.payload, 'dfm'), false);
      assert.equal(Object.keys(received.payload).length, 6);
      assert.equal((await delivery(fixture.admin, order)).tipo, 'trabajos');
    }
    assert.deepEqual(h.effects, [], 'Receiving and selecting never writes Sheet/Drive');
    resumeUntilFinished(h, cycle, 2);
    assert.equal(h.load().confirmados, 2);
    assertRealReceipts(requests, orders);
    const values = h.sheet.getRange(1, 1, h.sheet.getLastRow(), 17).getDisplayValues();
    const createdRow = values.findIndex(row => row[0] === created.dfm && row[7] === created.designacion) + 1;
    const assignedRow = values.findIndex(row => row[0] === 'TEST-DFM-02' && row[7] === 'TEST REVISION') + 1;
    assert.ok(createdRow > 1); assert.ok(assignedRow > 1);
    assert.equal(h.sheet.getRange(createdRow, 5).getNote().includes(workId), true);
    assert.equal(values[assignedRow - 1][9], '02/10/2026');
    assert.equal(values[assignedRow - 1][10], '03/10/2026');
    const sources = (await one(fixture.admin, 'SELECT fuentes FROM app_private.manteniment_t_trabajos WHERE sync_id=$1', [workId])).fuentes;
    assert.deepEqual(sources, [{ fila: createdRow,
      clave_fila: 'TEST-DFM-01|TEST1234|TEST-TALLER|MECANICA|TEST REVISION|2026-10-01' }]);
    for (const order of orders) {
      const saved = await delivery(fixture.admin, order);
      assert.ok(saved.confirmado_en);
      assert.deepEqual(saved.confirmacion, requests.find(item => item.action === 'ack_execution'
        && item.request.payload.confirmacion.sync_id === order.sync_id).request.payload.confirmacion);
    }
    assert.equal(journal(h).filter(item => item.estado === 'confirmado').length, 2);
    assert.equal(h.effects.some(item => item.kind === 'drive'), false);
  } finally { await finish(); }
});

test('CT02: two real once-only PARADA deliveries survive selection of one; later selection uses the durable inbox without sync or reapplying the first', async t => {
  const { fixture, h, requests, finish } = await setup(t, [HEADERS, paradaRow({ 17: '' }),
    paradaRow({ 1: 'TEST-DFM-02', 2: 'TEST2345', 5: 'PA-910002', 17: '' })]);
  try {
    const first = (await seedOrder(fixture.admin, 'CONTRACT-FIRST', { dfm: 'TEST-DFM-01', plate: 'TEST1234', pa: '910001' })).stored;
    const second = (await seedOrder(fixture.admin, 'CONTRACT-SECOND', { dfm: 'TEST-DFM-02', plate: 'TEST2345', pa: '910002' })).stored;
    const cycle = start(h, [scopeOf(first)]);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].action, 'sync');
    assert.equal(requests[0].request.payload.version_ejecucion, PROTOCOL);
    assert.equal(requests[0].response.resultado.comandos_manteniment.length, 2);
    assert.deepEqual(plain(h.load().comandos).map(scopeOf), [scopeOf(first)]);
    assert.equal(h.call('metrogestionLeerEntregasConservadas_').length, 2);
    const secondUnconfirmed = await delivery(fixture.admin, second);
    assert.equal(secondUnconfirmed.entregas, 1); assert.equal(secondUnconfirmed.confirmado_en, null);
    assert.deepEqual(h.effects, []);
    resumeUntilFinished(h, cycle, 1);
    const firstDelivery = await delivery(fixture.admin, first);
    const firstJournal = journal(h).find(item => item.referencia.sync_id === first.sync_id);
    const firstRow = plain(h.snapshot().sheet.rows[1]);
    assert.ok(firstDelivery.confirmado_en);
    assert.deepEqual(await delivery(fixture.admin, second), secondUnconfirmed,
      'Selecting the first cannot confirm or redispatch the unselected second delivery');
    h.restart(); h.clearEvents();
    const later = start(h, [scopeOf(second)]);
    assert.equal(h.httpCalls.length, 0, 'A fully conserved selected order must not require another snapshot/delivery');
    assert.deepEqual(plain(h.load().comandos).map(scopeOf), [scopeOf(second)]);
    resumeUntilFinished(h, later, 1);
    assert.deepEqual(h.httpCalls.map(item => item.method), ['authorize', 'ack_execution']);
    assert.equal(requests.filter(item => item.action === 'sync').length, 1);
    assertRealReceipts(requests, [first, second]);
    assert.deepEqual(await delivery(fixture.admin, first), firstDelivery);
    assert.deepEqual(journal(h).find(item => item.referencia.sync_id === first.sync_id), firstJournal);
    assert.deepEqual(plain(h.snapshot().sheet.rows[1]), firstRow, 'The first applied PARADA must not be reapplied');
    const secondConfirmed = await delivery(fixture.admin, second);
    assert.equal(secondConfirmed.entregas, 1); assert.ok(secondConfirmed.confirmado_en);
    assert.equal(secondConfirmed.payload_sha256, second.payload_sha256);
    assert.equal(h.call('metrogestionLeerEntregasConservadas_').length, 2);
    assert.equal(journal(h).filter(item => item.estado === 'confirmado').length, 2);
    assert.equal(h.sheet.getRange(2, 1).getNote().includes(first.sync_id), true);
    assert.equal(h.sheet.getRange(3, 1).getNote().includes(second.sync_id), true);
  } finally { await finish(); }
});
