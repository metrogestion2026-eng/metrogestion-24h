import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { createContinuityFixture } from './continuity-scenarios.mjs';
import { one, FIXTURE_ACTOR, FIXTURE_BOARD } from './local-postgres-harness.mjs';
import { SYNTHETIC_SYNC_TOKEN, seedSyncTracking, receiveSync, acknowledgement, seedSyncContinuityPair, confirmSyncContinuity } from './continuity-sync-scenarios.mjs';

// Default: native PostgreSQL17, restricted Unix socket and disposable database.
// Explicit METROGESTION_SQL_ENGINE=pglite: the SAME cases and literal SQL run
// in-process when native sockets are unavailable; not a concurrency substitute.
// No remote credentials, operational rows, Apps Script, Sheets or external HTTP.
const migrationUrl = new URL('../../supabase/migrations/20261107135502_alpha75_sincro_identidad_pa_tramos.sql', import.meta.url);
const migration = await readFile(migrationUrl, 'utf8');
const signatures = [
  'app_private.manteniment_importar_paradas(jsonb)',
  'app_private.manteniment_importar_cierres_facturacion(jsonb,timestamptz)',
  'app_private.manteniment_encolar_parada(uuid)',
  'app_private.finalizar_entrega_sync_continuidad_alpha75(jsonb)',
  'app_private.autorizar_ejecucion_manteniment(text,jsonb)',
];
const untouched = [
  'public.autorizar_ejecucion_manteniment(text,jsonb)',
  'app_private.confirmar_ejecucion_manteniment(text,jsonb)',
  'app_private.confirmar_entrega_sync_continuidad_alpha75(jsonb)',
  'app_private.manteniment_preflight_solo_lectura(text,jsonb)',
  'public.recibir_snapshot_manteniment(text,jsonb)',
  'app_private.manteniment_construir_payload_parada(uuid)',
];
let fixture, db, beforeState, afterState, oldMetadata, oldUntouched;

async function inventory({ includeSync = true } = {}) {
  return (await one(db, `SELECT jsonb_build_object(
    'hotel',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.registros_hotel x),
    'stages',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.etapas_hotel x),
    'activations',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.activaciones_24h x),
    'reserves',(SELECT jsonb_agg(to_jsonb(x) ORDER BY vehiculo_codigo) FROM public.reservas_hotel x),
    'sync',CASE WHEN $1 THEN (SELECT jsonb_agg(to_jsonb(x) ORDER BY seguimiento_id) FROM app_private.manteniment_parada_sync x) END,
    'queue',(SELECT jsonb_agg(to_jsonb(x) ORDER BY seguimiento_id) FROM app_private.manteniment_parada_outbox x),
    'deliveries',(SELECT jsonb_agg(to_jsonb(x) ORDER BY sync_id,revision) FROM app_private.manteniment_entregas_continuidad_alpha75 x),
    'flags',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM app_private.manteniment_sync_config x)
  ) AS value`, [includeSync])).value;
}
async function metadata() {
  return (await db.query(`SELECT p.oid::text,to_jsonb(p)-'prosrc' AS properties
    FROM pg_proc p WHERE oid=ANY($1::regprocedure[]) ORDER BY oid`, [signatures])).rows;
}
async function untouchedBodies() {
  return (await db.query(`SELECT oid::regprocedure::text AS signature,md5(pg_get_functiondef(oid)) AS md5
    FROM pg_proc WHERE oid=ANY($1::regprocedure[]) ORDER BY oid`, [untouched])).rows;
}
async function isolated(fn) {
  await db.query('BEGIN');
  try { await fn(); } finally { await db.query('ROLLBACK'); }
}
async function seed(tag, options = {}) {
  const s = await seedSyncTracking(db, tag);
  const dfm = options.dfm ?? `SYN-${tag}`;
  const plate = options.plate ?? `SYN${tag.replaceAll(/[^A-Z0-9]/g, '')}`;
  const reserve = `R-${tag}`;
  await db.query(`UPDATE public.registros_hotel SET vehiculo_sustituido=$2,matricula_sustituido=$3,
    vehiculo_reserva=$4,estado='en_taller',fecha_parada='2026-10-01' WHERE id=$1`, [s.id, dfm, plate, reserve]);
  await db.query(`UPDATE app_private.manteniment_parada_sync SET fecha_inicio_parada_origen='2026-10-01',
    fecha_inicio_tramo='2026-10-15',fecha_corte='2026-10-23',tancament='TANCAMENT 10',fila_manteniment=20
    WHERE seguimiento_id=$1`, [s.tracking]);
  const payload = { ...s.payload, dfm, matricula: plate, sustituto: reserve,
    fecha_parada: '2026-10-15', fecha_k: null, tancament: 'TANCAMENT 10' };
  await db.query('UPDATE app_private.manteniment_parada_outbox SET payload=$2::jsonb WHERE seguimiento_id=$1', [s.tracking, JSON.stringify(payload)]);
  return { ...s, dfm, plate, reserve, payload };
}
function item(s, changes = {}) {
  return { id_fila: 9001, fila: 39, sync_id: s.syncId, estado: 'PARADA', dfm: s.dfm,
    matricula: s.plate, numero_parada: `PA-${s.pa}`, sustituto: s.reserve,
    fecha_programada: '2026-10-01', fecha_parada: '2026-10-15', fecha_k: '2026-10-23',
    tancament: 'TANCAMENT 10', dias_parada: 9, km_facturables: 900, ...changes };
}
async function paradas(items) {
  return (await one(db, 'SELECT app_private.manteniment_importar_paradas($1::jsonb) AS value', [JSON.stringify(items)])).value;
}
async function cierres(items) {
  return (await one(db, 'SELECT app_private.manteniment_importar_cierres_facturacion($1::jsonb) AS value', [JSON.stringify(items)])).value;
}
async function closures() {
  return (await db.query('SELECT to_jsonb(f) AS value FROM public.facturacion_tancament_cierres f ORDER BY source_key')).rows.map(x => x.value);
}
async function reviews() {
  return (await db.query(`SELECT motivo,payload,alcance,retiene,resuelta_en,recepciones
    FROM app_private.manteniment_revision_identidad_alpha75 ORDER BY bloque,motivo,contexto,payload_sha256`)).rows;
}
async function queue(s) {
  return (await one(db, 'SELECT to_jsonb(o) AS value FROM app_private.manteniment_parada_outbox o WHERE seguimiento_id=$1', [s.tracking]))?.value;
}
async function deliver(items) {
  return (await one(db, 'SELECT app_private.finalizar_entrega_sync_continuidad_alpha75($1::jsonb) AS value',
    [JSON.stringify({ ok: true, comandos_manteniment: items.map(s => ({ tipo: 'parada', sync_id: s.syncId, revision: 1, payload: s.payload })) })])).value;
}
function request(command) {
  const ref = { tipo: 'parada', sync_id: command.sync_id, revision: command.revision, payload_sha256: command.payload_sha256 };
  return { version_script: 'alpha75-2026.10.26.1', version_ejecucion: 'MG75-EJECUCION-ORDEN-001',
    escritura_segura_manual: true, spreadsheet_id: 'SYNTHETIC_SHEET_CONTINUITY_75', request_id: randomUUID(),
    alcance: [ref], orden: { ...ref, payload: command.payload } };
}
async function authorize(command) {
  return (await one(db, 'SELECT public.autorizar_ejecucion_manteniment($1,$2::jsonb) AS value',
    [SYNTHETIC_SYNC_TOKEN, JSON.stringify(request(command))])).value;
}
async function enableSyntheticExecution() {
  await db.query(`UPDATE app_private.manteniment_sync_config SET
    pausa_importacion_identidad=false,solo_lectura_manual_protegida=false,escritura_segura_manual=true WHERE id=1`);
}

async function createFixture() {
  if (process.env.METROGESTION_SQL_ENGINE !== 'pglite') return createContinuityFixture({ prefix: 'id_pa_tramos' });
  const engine = new PGlite();
  const admin = { query: async (sql, values) => values?.length
    ? engine.query(sql, values) : (await engine.exec(sql)).at(-1) ?? { rows: [] } };
  try {
    // Same schema captures, historical migrations and labelled boundary doubles
    // loaded by createContinuityFixture. No substitute importer implementation.
    for (const relative of [
      './fixtures/setup.sql', '../fixtures/alpha75-24h-paradas-baseline.sql',
      './fixtures/concurrency-history.sql', './fixtures/triggers.sql',
      '../../supabase/migrations/20261028174243_alpha75_24h_paradas_independientes.sql',
      './fixtures/recovery-runtime.sql', '../integration/fixtures/hotel-views.sql',
      '../integration/fixtures/history-view.sql', './fixtures/continuity-runtime.sql',
      './fixtures/continuity-sync-runtime.sql',
      '../../supabase/migrations/20261029060636_alpha75_continuidad_sustitucion_entre_pa.sql',
      '../../supabase/migrations/20261029060925_alpha75_continuidad_barrera_manteniment.sql',
      '../../supabase/migrations/20261031115637_alpha75_panel_sustituciones_proyeccion_unica.sql',
    ]) await admin.query(await readFile(new URL(relative, import.meta.url), 'utf8'));
    return { admin, destroy: () => engine.close() };
  } catch (e) { await engine.close(); throw e; }
}

before(async () => {
  fixture = await createFixture();
  db = fixture.admin;
  for (const file of [
    '20261029184748_alpha75_autorizar_ejecucion_manteniment.sql',
    '20261101203000_alpha75_sincro7_resolver_tancament_calendario_real.sql',
  ]) await db.query(await readFile(new URL(`../../supabase/migrations/${file}`, import.meta.url), 'utf8'));
  await db.query(`INSERT INTO public.cierres_facturacion(periodo,fecha_inicio,fecha_cierre)
    VALUES('2026-10','2026-10-01','2026-10-31'),('2026-11','2026-11-01','2026-11-30'),
      ('2199-11','2199-11-01','2199-11-30') ON CONFLICT DO NOTHING`);
  // Establish the defect on the exact installed baseline, then discard the seed.
  await isolated(async () => {
    const s = await seed('REPRO');
    await db.query('UPDATE app_private.manteniment_parada_sync SET fecha_inicio_parada_origen=NULL WHERE seguimiento_id=$1', [s.tracking]);
    await paradas([item(s, { numero_parada: 'PA-OTHER-STOP', fecha_parada: '2026-11-02', fecha_k: null, tancament: 'TANCAMENT 11' })]);
    assert.equal((await one(db, 'SELECT fecha_parada::text FROM public.registros_hotel WHERE id=$1', [s.id])).fecha_parada, '2026-11-02',
      'Exact baseline reproduces a copied UUID overwriting the original stop with another PA segment J');
  });
  // Explicit output protection, with identity import pause false: installation
  // requires protected output, never a new pause or an automatic flag change.
  await db.query(`UPDATE app_private.manteniment_sync_config SET
    pausa_importacion_identidad=false,solo_lectura_manual_protegida=true,escritura_segura_manual=false WHERE id=1`);
  beforeState = await inventory();
  oldMetadata = await metadata();
  oldUntouched = await untouchedBodies();
  await db.query(migration);
  afterState = await inventory();
});
after(async () => { if (fixture) await fixture.destroy(); });

test('ID01 installation changes only intended bodies; OID/owner/ACL/contracts, state, barriers and ACK preserved', async () => {
  assert.deepEqual(afterState, beforeState);
  assert.deepEqual(await metadata(), oldMetadata);
  assert.deepEqual(await untouchedBodies(), oldUntouched);
  const functions = (await db.query(`SELECT p.oid::regprocedure::text AS signature,
    has_function_privilege('anon',p.oid,'EXECUTE') AS anon,
    has_function_privilege('authenticated',p.oid,'EXECUTE') AS authenticated,
    has_function_privilege('service_role',p.oid,'EXECUTE') AS service
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='app_private' AND p.proname=ANY($1::text[])`, [[
    'normalizar_pa_manteniment_alpha75','identidad_uuid_manteniment_alpha75',
    'analizar_identidad_manteniment_alpha75','item_retenido_identidad_manteniment_alpha75',
    'registrar_revision_manteniment_alpha75','retencion_identidad_manteniment_alpha75',
  ]])).rows;
  assert.equal(functions.length, 6);
  for (const f of functions) assert.deepEqual([f.anon,f.authenticated,f.service], [false,false,false], f.signature);
  const access = await one(db, `SELECT relrowsecurity,
    has_table_privilege('anon',oid,'SELECT') AS anon,
    has_table_privilege('authenticated',oid,'SELECT') AS authenticated,
    has_table_privilege('service_role',oid,'SELECT') AS service
    FROM pg_class WHERE oid='app_private.manteniment_revision_identidad_alpha75'::regclass`);
  assert.deepEqual(access, { relrowsecurity: true, anon: false, authenticated: false, service: false });
});

test('ID02 a contradicting member retains its entire UUID group and full snapshot; no operation depends on array order', async () => isolated(async () => {
  const s = await seed('MIXED');
  const rows = [item(s, { id_fila: 9002 }), item(s, { id_fila: 9003, numero_parada: 'PA-OTHER', fecha_k: null })];
  const before = await inventory();
  assert.equal(await paradas(rows), 0);
  assert.deepEqual(await inventory(), before);
  assert.equal(await paradas(rows.toReversed()), 0);
  assert.deepEqual(await inventory(), before);
  const r = await reviews();
  assert.ok(r.every(x => x.retiene && x.resuelta_en === null));
  assert.deepEqual(r[0].payload.map(x => x.id_fila).sort(), [9002,9003]);
  assert.ok(r[0].alcance.sync_ids.includes(s.syncId));
}));

test('ID03 wrong vehicle preserves canonical and received sources; incomplete identity retains the entire accounting block', async () => isolated(async () => {
  const a = await seed('WRONGA'), b = await seed('WRONGB');
  const snapshot = await inventory();
  const rows = [item(a, { dfm: b.dfm, matricula: b.plate }), item(b)];
  const result = await cierres(rows);
  assert.equal(result.retenidos_identidad, 2);
  assert.equal(result.actualizados, 0);
  assert.equal((await reviews())[0].alcance.vehiculos.length, 2);
  assert.deepEqual(await inventory(), snapshot);
  const c = await seed('INCOMPLETE');
  const whole = await cierres([item(c, { matricula: '' }), item(c, { id_fila: 9007, sync_id: '' })]);
  assert.equal(whole.actualizados, 0);
  assert.ok((await reviews()).some(x => x.alcance.retener_todo));
}));

test('ID04 two legitimate closed segments remain accounting history without selecting an operational winner', async () => isolated(async () => {
  const s = await seed('CLOSED');
  const rows = [item(s), item(s, { id_fila: 9002, fila: 40, fecha_parada: '2026-10-24', fecha_k: '2026-10-29', dias_parada: 6 })];
  const before = await inventory();
  assert.equal(await paradas(rows), 0);
  assert.equal((await cierres(rows)).actualizados, 2);
  assert.deepEqual(await inventory(), before);
  assert.equal((await closures()).filter(x => x.presente_en_manteniment).length, 2);
  assert.ok((await reviews()).some(x => x.motivo === 'SIN_TRAMO_ABIERTO'));
}));

test('ID05 one open concordant segment updates only its accounting context; original, recovery and replacement facts remain identical', async () => isolated(async () => {
  const s = await seed('OPEN');
  await db.query('UPDATE app_private.manteniment_parada_sync SET fecha_inicio_parada_origen=NULL WHERE seguimiento_id=$1', [s.tracking]);
  const before = await inventory({ includeSync: false });
  const rows = [item(s), item(s, { id_fila: 9002, fila: 499, fecha_parada: '2026-10-24', fecha_k: null, dias_parada: null, km_facturables: null })];
  assert.equal(await paradas(rows), 1);
  const sync = await one(db, `SELECT fecha_inicio_parada_origen,fecha_inicio_tramo::text,fecha_corte,fila_manteniment
    FROM app_private.manteniment_parada_sync WHERE seguimiento_id=$1`, [s.tracking]);
  assert.deepEqual(sync, { fecha_inicio_parada_origen: null, fecha_inicio_tramo: '2026-10-24', fecha_corte: null, fila_manteniment: 499 });
  assert.deepEqual(await inventory({ includeSync: false }), before);
  assert.equal(await paradas(rows.toReversed().map(x => ({ ...x, fila: x.fila + 20 }))), 1);
  assert.equal((await one(db, 'SELECT fecha_inicio_tramo::text FROM app_private.manteniment_parada_sync WHERE seguimiento_id=$1', [s.tracking])).fecha_inicio_tramo, '2026-10-24');
}));

test('ID06 several open segments, or an unproven replacement change, retain the group without an operational write', async () => isolated(async () => {
  const a = await seed('TWOOPEN'), b = await seed('REPLACE');
  const before = await inventory();
  assert.equal(await paradas([item(a, { fecha_k: null }), item(a, { id_fila: 9002, fecha_parada: '2026-10-24', fecha_k: null })]), 0);
  assert.equal(await paradas([item(b, { fecha_k: null, sustituto: 'R-UNPROVEN' })]), 0);
  assert.deepEqual(await inventory(), before);
  assert.deepEqual((await reviews()).map(x => x.motivo).sort(), ['SUSTITUTO_NO_ACREDITADO','VARIOS_TRAMOS_ABIERTOS']);
}));

test('ID07 deleting a note preserves legacy accounting with no inferred PA/operational facts; open K is retained as evidence before skip', async () => isolated(async () => {
  const s = await seed('NONOTE');
  const closed = item(s, { sync_id: '' });
  const open = item(s, { sync_id: '', id_fila: 9010, fecha_parada: '2199-11-02', fecha_programada: '2199-11-02', fecha_k: null, tancament: 'TANCAMENT 11', dias_parada: null, km_facturables: null });
  const before = await inventory();
  assert.equal((await cierres([closed,open])).actualizados, 1);
  const [f] = await closures();
  assert.match(f.source_key, /^MANTENIMENT\|/);
  assert.equal(f.sync_id, null);
  assert.equal(f.seguimiento_id, null);
  assert.deepEqual(await inventory(), before);
  const r = (await reviews()).find(x => x.motivo === 'CIERRES_SIN_UUID');
  assert.equal(r.retiene, false);
  assert.deepEqual(r.payload, [closed,open]);
}));

test('ID08 retained and clean vehicles in one period: no retained omissions, no new SYNC/MANTENIMENT double count, idempotent retry', async () => isolated(async () => {
  const held = await seed('HELD'), clean = await seed('CLEAN');
  await cierres([item(held),item(clean)]);
  const initial = await closures();
  const heldBefore = initial.find(x => x.sync_id === held.syncId);
  const rows = [item(held), item(held, { numero_parada: 'PA-WRONG', id_fila: 9002 }), item(clean, { sync_id: '' })];
  const result = await cierres(rows);
  assert.equal(result.retenidos_identidad, 2);
  assert.equal(result.actualizados, 1);
  const once = await closures();
  assert.deepEqual(once.find(x => x.sync_id === held.syncId), heldBefore);
  assert.equal(once.filter(x => x.dfm === clean.dfm && x.presente_en_manteniment).length, 1);
  assert.match(once.find(x => x.dfm === clean.dfm && x.presente_en_manteniment).source_key, /^MANTENIMENT\|/);
  await cierres(rows);
  assert.equal((await closures()).filter(x => x.dfm === clean.dfm && x.presente_en_manteniment).length, 1);
  await cierres([item(held, { sync_id: '' }), item(clean, { sync_id: '' })]);
  assert.deepEqual((await closures()).find(x => x.sync_id === held.syncId), heldBefore,
    'Removing the contradictory note does not clear durable retention or insert a replacement source');
  assert.equal((await closures()).filter(x => x.dfm === held.dfm).length, 1);
}));

test('ID09 retained canonical identity, source pair and prior outbox cannot be reopened by later enqueue or revision changes', async () => isolated(async () => {
  const s = await seed('QUEUE');
  await paradas([item(s, { numero_parada: 'PA-WRONG' })]);
  for (const state of ['pendiente','retenida_manual','confirmado']) {
    await db.query('UPDATE app_private.manteniment_parada_outbox SET estado=$2,revision=revision+1 WHERE seguimiento_id=$1', [s.tracking,state]);
    const before = await queue(s);
    await db.query('SELECT app_private.manteniment_encolar_parada($1)', [s.tracking]);
    assert.deepEqual(await queue(s), before);
  }
  await db.query('DELETE FROM app_private.manteniment_parada_outbox WHERE seguimiento_id=$1', [s.tracking]);
  await db.query('SELECT app_private.manteniment_encolar_parada($1)', [s.tracking]);
  assert.equal(await queue(s), undefined);
  assert.equal(await paradas([item(s, { fecha_k: null })]), 0);
  assert.ok((await reviews()).every(x => x.resuelta_en === null));
}));

test('ID10 delivery filters retained orders before ledger mutation, while a clean vehicle is still delivered', async () => isolated(async () => {
  const held = await seed('DELHELD'), clean = await seed('DELCLEAN');
  await paradas([item(held, { numero_parada: 'PA-WRONG' })]);
  const heldQueue = await queue(held);
  const result = await deliver([held,clean]);
  assert.deepEqual(result.comandos_manteniment.map(x => x.sync_id), [clean.syncId]);
  assert.equal((await one(db, 'SELECT count(*)::int AS n FROM app_private.manteniment_entregas_continuidad_alpha75 WHERE sync_id=$1', [held.syncId])).n, 0);
  assert.deepEqual(await queue(held), heldQueue);
}));

test('ID11 an already delivered order is denied after retention with the existing reason and no authorization writes', async () => isolated(async () => {
  await enableSyntheticExecution();
  const s = await seed('OLDDELIVERY');
  const [command] = (await deliver([s])).comandos_manteniment;
  assert.equal((await authorize(command)).autorizada, true);
  await paradas([item(s, { numero_parada: 'PA-WRONG' })]);
  const before = await inventory();
  const result = await authorize(command);
  assert.equal(result.autorizada, false);
  assert.equal(result.motivo, 'ORDEN_RETENIDA_O_CONFIRMADA');
  assert.equal(result.expira_en, result.autorizado_en);
  assert.deepEqual(await inventory(), before);
  assert.equal((await deliver([s])).comandos_manteniment.length, 0);
}));

test('ID12 ACK of effects already evidenced preserves the existing protocol; retention never fabricates or erases application evidence', async () => isolated(async () => {
  await enableSyntheticExecution();
  const s = await seed('ACK');
  const [command] = (await deliver([s])).comandos_manteniment;
  await paradas([item(s, { numero_parada: 'PA-WRONG' })]);
  const result = (await one(db, 'SELECT public.confirmar_ejecucion_manteniment($1,$2::jsonb) AS value', [SYNTHETIC_SYNC_TOKEN,
    JSON.stringify({ version_ejecucion: 'MG75-EJECUCION-ORDEN-001', spreadsheet_id: 'SYNTHETIC_SHEET_CONTINUITY_75',
      request_id: randomUUID(), confirmacion: acknowledgement(command) })])).value;
  assert.equal(result.confirmada, true);
  assert.equal((await queue(s)).estado, 'confirmado');
  assert.ok((await reviews()).every(x => x.resuelta_en === null));
}));


test('ID13 an historical closed PA stays retained while an independent open PA of the same vehicle can import and deliver', async () => isolated(async () => {
  const old = await seed('OLDPA');
  const current = await seed('NEWPA', { dfm: old.dfm, plate: old.plate });
  const closed = item(old), open = item(current, { id_fila: 9011, fecha_k: null });
  assert.equal(await paradas([closed,open]), 1);
  const review = (await reviews()).find(x => x.motivo === 'SIN_TRAMO_ABIERTO');
  assert.deepEqual(review.alcance.vehiculos, []);
  assert.deepEqual(review.alcance.sync_ids, [old.syncId]);
  assert.equal(await paradas([open,closed]), 1);
  const result = await deliver([old,current]);
  assert.deepEqual(result.comandos_manteniment.map(x => x.sync_id), [current.syncId]);
  assert.equal((await one(db, 'SELECT app_private.retencion_identidad_manteniment_alpha75($1) AS value', [old.tracking])).value, true);
}));

test('ID14 a new contradictory reception after explicit evidence-based resolution creates a new hold and preserves the prior resolution', async () => isolated(async () => {
  const s = await seed('REAPPEAR');
  const rows = [item(s, { numero_parada: 'PA-WRONG' })];
  await paradas(rows);
  // Synthetic owner-only reconciliation, deliberately outside the candidate API.
  await db.query(`UPDATE app_private.manteniment_revision_identidad_alpha75
    SET resuelta_en=clock_timestamp(),resolucion=jsonb_build_object(
      'motivo','Evidencia sintética de reconciliación explícita del ensayo', 'evidencia_sha256',repeat('a',64))`);
  assert.equal((await one(db, 'SELECT app_private.retencion_identidad_manteniment_alpha75($1) AS value', [s.tracking])).value, false);
  await paradas(rows);
  const result = await reviews();
  assert.equal(result.length, 2);
  assert.equal(result.filter(x => x.resuelta_en !== null).length, 1);
  assert.equal(result.filter(x => x.resuelta_en === null).length, 1);
  assert.equal((await one(db, 'SELECT app_private.retencion_identidad_manteniment_alpha75($1) AS value', [s.tracking])).value, true);
}));

test('ID15 an existing continuity source and its removed note cannot produce a new duplicate; another vehicle in the period still imports', async () => isolated(async () => {
  const pair = await seedSyncContinuityPair(db, 'BILLGUARD');
  await db.query('UPDATE public.registros_hotel SET matricula_sustituido=$2 WHERE seguimiento_id=ANY($1::uuid[])',
    [[pair.source.seguimiento_id,pair.target.seguimiento_id], 'SYNBILLGUARD']);
  await confirmSyncContinuity(db, pair);
  const source = await one(db, `SELECT s.sync_id,r.numero_parada,r.vehiculo_sustituido,r.vehiculo_reserva
    FROM app_private.manteniment_parada_sync s JOIN public.registros_hotel r USING(seguimiento_id)
    WHERE s.seguimiento_id=$1 LIMIT 1`, [pair.source.seguimiento_id]);
  const dfm = source.vehiculo_sustituido;
  const key = `SYNC|${source.sync_id}|2026-10|2026-10-15|${source.vehiculo_reserva}`;
  await db.query(`INSERT INTO public.facturacion_tancament_cierres
    (source_key,sync_id,seguimiento_id,dfm,matricula,numero_parada,sustituto,tancament,periodo,
      fecha_inicio_tramo,fecha_fin_tramo,dias_facturables,km_facturables,payload_hash)
    VALUES($1,$2,$3,$4,'SYNBILLGUARD',$5,$6,'TANCAMENT 10','2026-10','2026-10-15','2026-10-23',9,900,'synthetic')`,
    [key,source.sync_id,pair.source.seguimiento_id,dfm,source.numero_parada,source.vehiculo_reserva]);
  const before = (await closures()).find(x => x.source_key === key);
  const clean = await seed('CONTICLEAN');
  const missingNote = item(clean, { sync_id: '', dfm, matricula: 'SYNBILLGUARD', numero_parada: source.numero_parada, sustituto: source.vehiculo_reserva });
  const result = await cierres([missingNote,item(clean)]);
  assert.equal(result.retenidos_identidad, 1);
  assert.equal(result.actualizados, 1);
  const after = await closures();
  assert.deepEqual(after.find(x => x.source_key === key), before);
  assert.equal(after.filter(x => x.dfm === dfm && x.presente_en_manteniment).length, 1);
  assert.equal(after.filter(x => x.dfm === clean.dfm && x.presente_en_manteniment).length, 1);
}));


test('ID16 a full receiver call sees the new durable hold before global enqueue and delivery in the same transaction', async () => isolated(async () => {
  await enableSyntheticExecution();
  const held = await seed('SNAPHELD'), clean = await seed('SNAPCLEAN');
  const heldBefore = await queue(held);
  const rows = [item(held, { fecha_k: null }), item(held, { id_fila: 9002, numero_parada: 'PA-WRONG' })];
  const result = await receiveSync(db, { version_ejecucion: 'MG75-EJECUCION-ORDEN-001', paradas: rows });
  assert.equal(result.ok, true);
  assert.equal(result.comandos_manteniment.some(x => x.sync_id === held.syncId), false);
  assert.equal(result.comandos_manteniment.some(x => x.sync_id === clean.syncId), true);
  assert.deepEqual(await queue(held), heldBefore);
  assert.equal((await one(db, 'SELECT count(*)::int AS n FROM app_private.manteniment_entregas_continuidad_alpha75 WHERE sync_id=$1', [held.syncId])).n, 0);
}));

test('ID17 installation refuses a changed base and rolls back before altering state or permissions', async () => {
  const before = await inventory();
  const props = await metadata();
  await assert.rejects(() => db.query(migration), /MG_IDENTIDAD_BASE_INESPERADA/);
  await db.query('ROLLBACK');
  assert.deepEqual(await inventory(), before);
  assert.deepEqual(await metadata(), props);
});


test('ID18 a nonempty but unaccredited DFM/plate pair cannot delimit a contradiction and retains the whole block', async () => isolated(async () => {
  const held = await seed('BADPAIR'), clean = await seed('PAIRFREE');
  const before = await inventory();
  const result = await cierres([item(held, { matricula: 'UNKNOWNPLATE' }), item(clean)]);
  assert.equal(result.actualizados, 0);
  assert.equal(result.retenidos_identidad, 2);
  assert.equal((await reviews())[0].alcance.retener_todo, true);
  assert.deepEqual(await inventory(), before);
}));

test('ID19 installation refuses active output permission before any migration effect and never changes the flags itself', async () => {
  const protectedState = await inventory();
  await enableSyntheticExecution();
  try {
    const before = await inventory();
    const props = await metadata();
    await assert.rejects(() => db.query(migration), /MG_IDENTIDAD_BARRERAS_ABIERTAS/);
    await db.query('ROLLBACK');
    assert.deepEqual(await inventory(), before);
    assert.deepEqual(await metadata(), props);
  } finally {
    await db.query(`UPDATE app_private.manteniment_sync_config SET
      pausa_importacion_identidad=false,solo_lectura_manual_protegida=true,escritura_segura_manual=false WHERE id=1`);
  }
  assert.deepEqual(await inventory(), protectedState);
});
