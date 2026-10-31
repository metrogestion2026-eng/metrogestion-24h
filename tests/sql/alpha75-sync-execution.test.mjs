import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createContinuityFixture } from './continuity-scenarios.mjs';
import { one, snapshotProtectedFacts } from './local-postgres-harness.mjs';
import {
  SYNTHETIC_SYNC_TOKEN, seedSyncTracking, receiveSync, acknowledgement, acknowledgeSync,
  seedSyncContinuityPair, confirmSyncContinuity, syncFlags,
} from './continuity-sync-scenarios.mjs';

const migration = await readFile(new URL('../../supabase/migrations/20261029184748_alpha75_autorizar_ejecucion_manteniment.sql', import.meta.url), 'utf8');
const capability = 'MG75-EJECUCION-ORDEN-001';
const spreadsheet = 'SYNTHETIC_SHEET_CONTINUITY_75';
const changedFunctions = ['public.recibir_snapshot_manteniment(text,jsonb)', 'app_private.manteniment_preflight_solo_lectura(text,jsonb)'];
let fixture, initialFlags, protectedBefore, initialInventory, previousProperties;

async function properties(client) {
  return (await client.query(`SELECT p.oid::text,to_jsonb(p)-'prosrc' AS value
    FROM pg_proc p WHERE p.oid=ANY($1::regprocedure[]) ORDER BY p.oid`, [changedFunctions])).rows;
}

async function inventory(client = fixture.admin) {
  return (await one(client, `SELECT jsonb_build_object(
    'config',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM app_private.manteniment_sync_config x),
    'queue',(SELECT jsonb_agg(to_jsonb(x) ORDER BY seguimiento_id) FROM app_private.manteniment_parada_outbox x),
    'master_queue',(SELECT jsonb_agg(to_jsonb(x) ORDER BY vehiculo_id) FROM app_private.manteniment_activo_outbox x),
    'deliveries',(SELECT jsonb_agg(to_jsonb(x) ORDER BY sync_id,revision) FROM app_private.manteniment_entregas_continuidad_alpha75 x),
    'sync',(SELECT jsonb_agg(to_jsonb(x) ORDER BY seguimiento_id) FROM app_private.manteniment_parada_sync x),
    'executions',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.manteniment_sync_ejecuciones x),
    'works',(SELECT jsonb_agg(to_jsonb(x) ORDER BY seguimiento_id,sync_id) FROM app_private.manteniment_t_trabajos x)
  ) AS value`)).value;
}

async function flags({ pause = false, protectedRead = false, safeWrite = true } = {}) {
  await fixture.admin.query(`UPDATE app_private.manteniment_sync_config SET
    pausa_importacion_identidad=$1,solo_lectura_manual_protegida=$2,escritura_segura_manual=$3 WHERE id=1`,
  [pause, protectedRead, safeWrite]);
}

function ref(command) {
  return { tipo: command.payload.solo_trabajos === true ? 'trabajos' : 'parada', sync_id: command.sync_id,
    revision: command.revision, payload_sha256: command.payload_sha256 };
}

function request(command, overrides = {}) {
  return { version_script: 'alpha75-2026.10.26.1', version_ejecucion: capability,
    escritura_segura_manual: true, spreadsheet_id: spreadsheet, request_id: randomUUID(),
    alcance: [ref(command)], orden: { ...ref(command), payload: command.payload }, ...overrides };
}

async function authorize(input, token = SYNTHETIC_SYNC_TOKEN) {
  const before = await inventory();
  await fixture.admin.query('BEGIN READ ONLY');
  try {
    assert.equal((await one(fixture.admin, 'SHOW transaction_read_only')).transaction_read_only, 'on');
    return (await one(fixture.admin, 'SELECT public.autorizar_ejecucion_manteniment($1,$2::jsonb) AS value',
      [token, JSON.stringify(input)])).value;
  } finally {
    await fixture.admin.query('ROLLBACK');
    assert.deepEqual(await inventory(), before, 'Authorization, including rejection, must not write flags, queues, delivery/ACK evidence, imports or timestamps');
  }
}

async function sendSnapshot(overrides = {}) {
  return receiveSync(fixture.admin, { version_ejecucion: capability, ...overrides });
}

async function delivered(tag, options) {
  const tracking = await seedSyncTracking(fixture.admin, tag, options);
  const result = await sendSnapshot();
  const command = result.comandos_manteniment.find(item => item.sync_id === tracking.syncId);
  assert.ok(command, `Missing synthetic delivered command ${tag}`);
  return { tracking, command };
}

function ackRequest(command, overrides = {}) {
  return { version_ejecucion: capability, spreadsheet_id: spreadsheet, request_id: randomUUID(),
    confirmacion: acknowledgement(command), ...overrides };
}

async function ack(input) {
  return (await one(fixture.admin, 'SELECT public.confirmar_ejecucion_manteniment($1,$2::jsonb) AS value',
    [SYNTHETIC_SYNC_TOKEN, JSON.stringify(input)])).value;
}

before(async () => {
  fixture = await createContinuityFixture({ prefix: 'sync_exec' });
  initialFlags = await syncFlags(fixture.admin);
  protectedBefore = await snapshotProtectedFacts(fixture.admin);
  initialInventory = await inventory();
  previousProperties = await properties(fixture.admin);
  await fixture.admin.query(migration);
});

after(async () => {
  if (!fixture) return;
  try {
    await fixture.admin.query('ROLLBACK');
    await flags({ pause: initialFlags.pausa_importacion_identidad,
      protectedRead: initialFlags.solo_lectura_manual_protegida, safeWrite: initialFlags.escritura_segura_manual });
    assert.deepEqual(await syncFlags(fixture.admin), initialFlags);
    assert.deepEqual(await snapshotProtectedFacts(fixture.admin), protectedBefore);
  } finally { await fixture.destroy(); }
});

test('EX01: installation preserves state and function privileges/properties; legacy preflight remains compatible without authorizing execution', async () => {
  assert.deepEqual(await inventory(), initialInventory);
  assert.deepEqual(await properties(fixture.admin), previousProperties);
  const result = (await one(fixture.admin, 'SELECT app_private.manteniment_preflight_solo_lectura($1,$2::jsonb) AS value',
    [SYNTHETIC_SYNC_TOKEN, JSON.stringify({ version_script: 'alpha75-2026.10.26.1',
      version_preflight: 'alpha75-preflight-2026.10.27.1', escritura_segura_manual: true, spreadsheet_id: spreadsheet })])).value;
  assert.equal(result.compatible, true);
  assert.equal(result.receptor_coincide, true);
  assert.equal(result.barreras_cerradas, true);
  assert.equal(result.sincronizacion_autorizada, false);
  for (const signature of ['public.autorizar_ejecucion_manteniment(text,jsonb)',
    'app_private.autorizar_ejecucion_manteniment(text,jsonb)', 'public.confirmar_ejecucion_manteniment(text,jsonb)',
    'app_private.confirmar_ejecucion_manteniment(text,jsonb)']) {
    const access = await one(fixture.admin, `SELECT has_function_privilege('anon',$1,'EXECUTE') AS anon,
      has_function_privilege('authenticated',$1,'EXECUTE') AS authenticated,
      has_function_privilege('service_role',$1,'EXECUTE') AS service`, [signature]);
    assert.deepEqual(access, { anon: false, authenticated: false, service: true });
  }
  const authorizeMetadata = await one(fixture.admin, `SELECT provolatile,prosecdef,proconfig
    FROM pg_proc WHERE oid='app_private.autorizar_ejecucion_manteniment(text,jsonb)'::regprocedure`);
  assert.deepEqual(authorizeMetadata, { provolatile: 's', prosecdef: true, proconfig: ['search_path=pg_catalog'] });
});

test('EX02: exact delivered revision is authorized in READ ONLY, with bound nonce/scope/identity and a 30-second attempt', async () => {
  await flags();
  const { command } = await delivered('POSITIVE');
  const input = request(command);
  const result = await authorize(input);
  assert.equal(result.autorizada, true);
  assert.equal(result.motivo, 'AUTORIZADA');
  assert.equal(result.solo_lectura, true);
  assert.equal(result.version_ejecucion, capability);
  assert.equal(result.request_id, input.request_id);
  assert.equal(result.spreadsheet_id, input.spreadsheet_id);
  assert.deepEqual(result.orden, ref(command));
  assert.deepEqual(result.alcance, input.alcance);
  assert.equal(Date.parse(result.expira_en) - Date.parse(result.autorizado_en), 30000);
  assert.match(result.autorizado_en, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
  assert.equal(result.payload, undefined);
  assert.equal((await authorize(request(command))).autorizada, true, 'A fresh check does not deliver a second copy or consume the queue');
  assert.equal((await sendSnapshot()).comandos_manteniment.some(item => item.sync_id === command.sync_id), false,
    'The existing once-per-revision PARADA delivery rule remains intact');
  const decimalTracking = await seedSyncTracking(fixture.admin, 'DECIMAL');
  await fixture.admin.query(`UPDATE app_private.manteniment_parada_outbox SET
    payload=jsonb_set(payload,'{km_facturables}','300.00'::jsonb) WHERE sync_id=$1`, [decimalTracking.syncId]);
  const decimal = (await sendSnapshot()).comandos_manteniment.find(item => item.sync_id === decimalTracking.syncId);
  assert.equal(decimal.payload.km_facturables, 300);
  const inputHash = (await one(fixture.admin, `SELECT encode(sha256(convert_to(($1::jsonb)::text,'UTF8')),'hex') AS value`,
    [JSON.stringify(decimal.payload)])).value;
  assert.notEqual(inputHash, decimal.payload_sha256, 'Numeric scale changes in JSON transport while the full JSONB value remains equal');
  assert.equal((await authorize(request(decimal))).autorizada, true);
  const changedDecimal = request(decimal);
  changedDecimal.orden.payload = { ...decimal.payload, km_facturables: 301 };
  assert.equal((await authorize(changedDecimal)).motivo, 'ORDEN_NO_COINCIDE');
});

test('EX03: closed/current or unknown barriers deny READ ONLY; nonce or old permission cannot bypass newly closed flags', async () => {
  await flags();
  const { command } = await delivered('FLAGS');
  const input = request(command);
  assert.equal((await authorize(input)).autorizada, true);
  for (const combination of [
    { pause: true, protectedRead: true, safeWrite: false },
    { pause: true }, { protectedRead: true }, { safeWrite: false },
    { pause: null }, { protectedRead: null }, { safeWrite: null },
  ]) {
    await flags(combination);
    const denied = await authorize(input);
    assert.equal(denied.autorizada, false);
    assert.equal(denied.motivo, 'BARRERAS_CERRADAS');
    assert.equal(denied.autorizado_en, denied.expira_en);
  }
  await flags();
});

test('EX04: explicit scope, canonical hash and complete payload are independent checks; no widening to another order/revision', async () => {
  await flags();
  const { command } = await delivered('SCOPE');
  const other = (await delivered('SCOPE-OTHER')).command;
  assert.equal((await authorize(request(command, { alcance: [ref(other)] }))).motivo, 'FUERA_DE_ALCANCE');
  const changedPayload = request(command);
  changedPayload.orden.payload = { ...command.payload, km_facturables: 999999 };
  assert.equal((await authorize(changedPayload)).motivo, 'ORDEN_NO_COINCIDE');
  const changedHash = request(command);
  assert.notEqual(other.payload_sha256, command.payload_sha256);
  changedHash.orden.payload_sha256 = other.payload_sha256;
  changedHash.alcance = [{ ...changedHash.orden }]; delete changedHash.alcance[0].payload;
  assert.equal((await authorize(changedHash)).motivo, 'ORDEN_NO_COINCIDE');
  const wrongType = request(command);
  wrongType.orden.tipo = 'trabajos'; wrongType.alcance[0].tipo = 'trabajos';
  assert.equal((await authorize(wrongType)).motivo, 'ORDEN_NO_COINCIDE');
  await fixture.admin.query(`UPDATE app_private.manteniment_parada_outbox SET
    payload=jsonb_set(payload,'{dias_parada}','10') WHERE sync_id=$1`, [command.sync_id]);
  assert.equal((await authorize(request(command))).motivo, 'ORDEN_NO_VIGENTE');
  const latest = (await sendSnapshot()).comandos_manteniment.find(item => item.sync_id === command.sync_id);
  assert.ok(latest.revision > command.revision);
  assert.equal((await authorize(request(latest, { alcance: [ref(command)] }))).motivo, 'FUERA_DE_ALCANCE');
});

test('EX05: undelivered/retained/already confirmed commands cannot receive execution authorization', async () => {
  await flags();
  const tracking = await seedSyncTracking(fixture.admin, 'UNDELIVERED');
  const command = await one(fixture.admin, `SELECT o.*,encode(sha256(convert_to(payload::text,'UTF8')),'hex') AS payload_sha256
    FROM app_private.manteniment_parada_outbox o WHERE sync_id=$1`, [tracking.syncId]);
  assert.equal((await authorize(request(command))).motivo, 'ENTREGA_NO_ACREDITADA');
  const deliveredCommand = (await sendSnapshot()).comandos_manteniment.find(item => item.sync_id === tracking.syncId);
  await fixture.admin.query("UPDATE app_private.manteniment_parada_outbox SET estado='retenida_manual' WHERE sync_id=$1", [tracking.syncId]);
  assert.equal((await authorize(request(deliveredCommand))).motivo, 'ORDEN_RETENIDA_O_CONFIRMADA');
  const another = (await delivered('CONFIRMED')).command;
  await ack(ackRequest(another));
  assert.equal((await authorize(request(another))).motivo, 'ORDEN_RETENIDA_O_CONFIRMADA');
});

test('EX06: malformed scope, invalid authentication and incompatible client/installation never authorize or mutate', async () => {
  await flags();
  const { command } = await delivered('INVALID');
  for (const input of [request(command, { alcance: [] }), request(command, { alcance: [ref(command), ref(command)] }),
    request(command, { alcance: Array.from({ length: 201 }, () => ref(command)) }),
    request(command, { request_id: 'invalid-nonce' }), { ...request(command), filas: [] }]) {
    await assert.rejects(authorize(input), error => error.code === '22023');
  }
  await assert.rejects(authorize(request(command), 'mg_' + 'b'.repeat(64)), error => error.code === '28000');
  for (const changes of [{ version_script: 'alpha75-old' }, { escritura_segura_manual: false },
    { spreadsheet_id: 'ANOTHER_SYNTHETIC_SHEET_75' }]) {
    assert.equal((await authorize(request(command, changes))).motivo, 'INSTALACION_NO_COMPATIBLE');
  }
  assert.equal((await authorize(request(command, { version_ejecucion: 'old-executor' }))).motivo, 'EJECUTOR_NO_COMPATIBLE');
  for (const replacement of [
    `CREATE OR REPLACE FUNCTION app_private.exigir_capacidad_ejecucion_manteniment(p_payload jsonb)
      RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$ SELECT p_payload $$`,
    `CREATE OR REPLACE FUNCTION app_private.normalizar_entregas_ejecucion_manteniment(p_resultado jsonb)
      RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$ SELECT p_resultado $$`,
  ]) {
    await fixture.admin.query('BEGIN');
    try {
      await fixture.admin.query(replacement);
      const drift = (await one(fixture.admin, 'SELECT public.autorizar_ejecucion_manteniment($1,$2::jsonb) AS value',
        [SYNTHETIC_SYNC_TOKEN, JSON.stringify(request(command))])).value;
      assert.equal(drift.motivo, 'INSTALACION_NO_COMPATIBLE', 'Capability and envelope normalization must both match their installed fingerprints');
    } finally { await fixture.admin.query('ROLLBACK'); }
  }
});

test('EX07: old Edge/client snapshots are rejected before importing or delivering; a complete capable snapshot is retained intact', async () => {
  await flags();
  const before = await inventory();
  await assert.rejects(receiveSync(fixture.admin), error => error.code === '55000' && /EJECUTOR_NO_COMPATIBLE/.test(error.message));
  assert.deepEqual(await inventory(), before);
  const payload = { version_ejecucion: capability, filas: [{ dfm: 'SYN-COMPLETE-1' }, { dfm: 'SYN-COMPLETE-2' }],
    trabajos: [], pendientes: [], paradas: [], cierres_facturacion: [] };
  const returned = (await one(fixture.admin, 'SELECT app_private.exigir_capacidad_ejecucion_manteniment($1::jsonb) AS value', [JSON.stringify(payload)])).value;
  assert.deepEqual(returned, payload, 'Capability negotiation never filters a snapshot by executable scope');
});

test('EX08: linked PARADA stays blocked and pure works retain their independent execution/ACK path', async () => {
  await flags();
  const pair = await seedSyncContinuityPair(fixture.admin, 'EXEC-LINK');
  await confirmSyncContinuity(fixture.admin, pair);
  const sourceCommand = await one(fixture.admin, `SELECT o.*,encode(sha256(convert_to(payload::text,'UTF8')),'hex') AS payload_sha256
    FROM app_private.manteniment_parada_outbox o WHERE seguimiento_id=$1`, [pair.source.seguimiento_id]);
  // Deliberately construct immutable delivery evidence after the link to assert
  // this defensive guard independently of dispatch (which already refuses it).
  await fixture.admin.query(`INSERT INTO app_private.manteniment_entregas_continuidad_alpha75
    (sync_id,revision,seguimiento_id,tipo,payload,entregado_en,ultima_entrega_en,entregas)
    SELECT sync_id,revision,seguimiento_id,'parada',payload,clock_timestamp(),clock_timestamp(),1
    FROM app_private.manteniment_parada_outbox WHERE sync_id=$1`, [sourceCommand.sync_id]);
  assert.equal((await authorize(request(sourceCommand))).motivo, 'CONTINUIDAD_RETENIDA');
  const tracking = pair.target.seguimiento_id;
  const sync = await one(fixture.admin, 'SELECT sync_id FROM app_private.manteniment_parada_sync WHERE seguimiento_id=$1', [tracking]);
  const payload = { sync_id: sync.sync_id, seguimiento_id: tracking, numero_parada: `PA-${pair.target.numero_parada}`,
    solo_trabajos: true, trabajos_asignados: [], trabajos_crear: [] };
  await fixture.admin.query(`INSERT INTO app_private.manteniment_parada_outbox(seguimiento_id,sync_id,payload)
    VALUES($1,$2,$3::jsonb)`, [tracking, sync.sync_id, JSON.stringify(payload)]);
  const workCommand = (await sendSnapshot()).comandos_manteniment.find(item => item.sync_id === sync.sync_id);
  assert.ok(workCommand);
  assert.equal((await authorize(request(workCommand))).autorizada, true);
  const physicalBefore = (await one(fixture.admin, 'SELECT to_jsonb(s) AS value FROM app_private.manteniment_parada_sync s WHERE seguimiento_id=$1', [tracking])).value;
  assert.equal((await ack(ackRequest(workCommand))).confirmada, true);
  assert.deepEqual((await one(fixture.admin, 'SELECT to_jsonb(s) AS value FROM app_private.manteniment_parada_sync s WHERE seguimiento_id=$1', [tracking])).value, physicalBefore);
});

test('EX09: strict ACK binds nonce/sheet/reference, replays exactly and confirms an older delivery without confirming a newer outbox', async () => {
  await flags();
  const { command } = await delivered('ACK-ADVANCE');
  await fixture.admin.query(`UPDATE app_private.manteniment_parada_outbox SET
    payload=jsonb_set(payload,'{dias_parada}','11') WHERE sync_id=$1`, [command.sync_id]);
  const newer = (await one(fixture.admin, 'SELECT to_jsonb(o) AS value FROM app_private.manteniment_parada_outbox o WHERE sync_id=$1', [command.sync_id])).value;
  assert.ok(newer.revision > command.revision);
  const input = ackRequest(command);
  const result = await ack(input);
  assert.deepEqual(result, { protocolo: 'manteniment-acuse-ejecucion-v1', version_ejecucion: capability,
    request_id: input.request_id, spreadsheet_id: spreadsheet, confirmada: true, orden: ref(command) });
  assert.deepEqual((await one(fixture.admin, 'SELECT to_jsonb(o) AS value FROM app_private.manteniment_parada_outbox o WHERE sync_id=$1', [command.sync_id])).value, newer);
  const afterFirst = await inventory();
  const second = { ...input, request_id: randomUUID() };
  assert.equal((await ack(second)).request_id, second.request_id);
  assert.deepEqual(await inventory(), afterFirst, 'An exact strict ACK replay does not advance queue, delivery or timestamps');
  assert.equal((await acknowledgeSync(fixture.admin, [input.confirmacion])).confirmados, 1, 'Legacy ACK remains compatible');
  assert.deepEqual(await inventory(), afterFirst);
});

test('EX10: wrong ACK hash/revision/type/sheet or a contradictory replay rolls back without consuming any queue', async () => {
  await flags();
  const { command } = await delivered('ACK-INVALID');
  for (const changes of [{ payload_sha256: 'f'.repeat(64) }, { revision: command.revision + 99 }, { tipo: 'trabajos' }]) {
    const before = await inventory();
    await assert.rejects(ack(ackRequest(command, { confirmacion: { ...acknowledgement(command), ...changes } })),
      error => error.code === '55000');
    assert.deepEqual(await inventory(), before);
  }
  const beforeSheet = await inventory();
  await assert.rejects(ack(ackRequest(command, { spreadsheet_id: 'OTHER_SYNTHETIC_SHEET_75' })), error => error.code === '22023');
  assert.deepEqual(await inventory(), beforeSheet);
  await ack(ackRequest(command));
  const confirmed = await inventory();
  await assert.rejects(ack(ackRequest(command, { confirmacion: acknowledgement(command, { fila: 43 }) })),
    error => error.code === '23514' && /CONTRADICTORIO/.test(error.message));
  assert.deepEqual(await inventory(), confirmed);
});

test('EX11: manual retirement and unsafe payloads remain ineligible even with a declared exact delivery', async () => {
  await flags();
  const { tracking, command } = await delivered('RETIRE');
  await fixture.admin.query(`INSERT INTO public.vehiculos(dfm,activo,baja_manual_bloquea_sync)
    VALUES($1,false,true)`, [tracking.payload.dfm]);
  assert.equal((await authorize(request(command))).motivo, 'BAJA_MANUAL_PROTEGIDA');
  const row = await seedSyncTracking(fixture.admin, 'UNSAFE', { enqueue: false });
  const payload = { ...row.payload, reversion_t: { limpiar_k_parada: true } };
  await fixture.admin.query(`INSERT INTO app_private.manteniment_parada_outbox(seguimiento_id,sync_id,payload)
    VALUES($1,$2,$3::jsonb)`, [row.tracking, row.syncId, JSON.stringify(payload)]);
  await fixture.admin.query(`INSERT INTO app_private.manteniment_entregas_continuidad_alpha75
    (sync_id,revision,seguimiento_id,tipo,payload,entregado_en,ultima_entrega_en,entregas)
    VALUES($1,1,$2,'parada',$3::jsonb,clock_timestamp(),clock_timestamp(),1)`, [row.syncId, row.tracking, JSON.stringify(payload)]);
  const unsafe = await one(fixture.admin, `SELECT o.*,encode(sha256(convert_to(payload::text,'UTF8')),'hex') AS payload_sha256
    FROM app_private.manteniment_parada_outbox o WHERE sync_id=$1`, [row.syncId]);
  assert.equal((await authorize(request(unsafe))).motivo, 'OPERACION_NO_PERMITIDA');
});

test('EX12: repeated/drifted installation aborts before replacing capability or changing runtime/state', async () => {
  const before = await inventory();
  const definition = (await one(fixture.admin, `SELECT pg_get_functiondef('public.recibir_snapshot_manteniment(text,jsonb)'::regprocedure) AS value`)).value;
  await assert.rejects(fixture.admin.query(migration), error => error.code === '55000' && /RUNTIME_DRIFT/.test(error.message));
  await fixture.admin.query('ROLLBACK');
  assert.deepEqual(await inventory(), before);
  assert.equal((await one(fixture.admin, `SELECT pg_get_functiondef('public.recibir_snapshot_manteniment(text,jsonb)'::regprocedure) AS value`)).value, definition);
});

test('EX13: closing barriers retains an unconfirmed ACK; exact committed replay is read without writes and contradictory replay remains rejected', async () => {
  await flags();
  const pending = (await delivered('ACK-PAUSED')).command;
  const committed = (await delivered('ACK-COMMITTED')).command;
  const committedInput = ackRequest(committed);
  await ack(committedInput);
  await flags({ pause: true, protectedRead: true, safeWrite: false });
  const before = await inventory();
  await assert.rejects(ack(ackRequest(pending)), error => error.code === '55000' && /PAUSADA_IDENTIDAD/.test(error.message));
  assert.deepEqual(await inventory(), before, 'A paused, unconfirmed ACK cannot consume evidence or return success');
  const replay = { ...committedInput, request_id: randomUUID() };
  const receipt = await ack(replay);
  assert.equal(receipt.confirmada, true);
  assert.equal(receipt.request_id, replay.request_id);
  assert.deepEqual(receipt.orden, ref(committed));
  assert.deepEqual(await inventory(), before, 'Reading a committed receipt leaves every queue, timestamp and flag unchanged');
  await assert.rejects(ack(ackRequest(committed, { confirmacion: acknowledgement(committed, { fila: 43 }) })),
    error => error.code === '23514' && /CONTRADICTORIO/.test(error.message));
  assert.deepEqual(await inventory(), before);
});
