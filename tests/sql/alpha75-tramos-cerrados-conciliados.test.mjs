import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { createContinuityFixture } from './continuity-scenarios.mjs';
import { one, snapshotProtectedFacts, FIXTURE_ACTOR, FIXTURE_BOARD } from './local-postgres-harness.mjs';
import { SYNTHETIC_SYNC_TOKEN, seedSyncTracking } from './continuity-sync-scenarios.mjs';

// Explicit in-process fallback runs the real SQL below, with the same schema
// captures and labelled boundary doubles as the native harness. PGlite does
// not prove native row-lock contention, multiple sessions or SSI behaviour.
const migration = await readFile(new URL('../../supabase/migrations/20261107180728_alpha75_tramos_cerrados_conciliados.sql', import.meta.url), 'utf8');
const signatures = [
  'app_private.manteniment_construir_payload_parada(uuid)',
  'app_private.retencion_identidad_manteniment_alpha75(uuid,uuid,jsonb)',
];
let fixture, db, beforeInstall, afterInstall, beforeMetadata;

async function createFixture() {
  if (process.env.METROGESTION_SQL_ENGINE !== 'pglite') return createContinuityFixture({ prefix: 'closed_tramos' });
  const engine = new PGlite();
  const admin = { query: async (sql, values) => values?.length
    ? engine.query(sql, values) : (await engine.exec(sql)).at(-1) ?? { rows: [] } };
  try {
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
async function metadata() {
  return (await db.query(`SELECT oid::text,to_jsonb(p)-'prosrc' AS properties FROM pg_proc p
    WHERE oid=ANY($1::regprocedure[]) ORDER BY oid`, [signatures])).rows;
}
async function inventory() {
  return (await one(db, `SELECT jsonb_build_object(
    'hotel',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.registros_hotel x),
    'stages',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.etapas_hotel x),
    'activations',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.activaciones_24h x),
    'reserves',(SELECT jsonb_agg(to_jsonb(x) ORDER BY vehiculo_codigo) FROM public.reservas_hotel x),
    'sync',(SELECT jsonb_agg(to_jsonb(x) ORDER BY seguimiento_id) FROM app_private.manteniment_parada_sync x),
    'queue',(SELECT jsonb_agg(to_jsonb(x) ORDER BY seguimiento_id) FROM app_private.manteniment_parada_outbox x),
    'deliveries',(SELECT jsonb_agg(to_jsonb(x) ORDER BY sync_id,revision) FROM app_private.manteniment_entregas_continuidad_alpha75 x),
    'origins',(SELECT jsonb_agg(to_jsonb(x) ORDER BY seguimiento_id) FROM app_private.manteniment_origenes_continuidad_alpha75 x),
    'reviews',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM app_private.manteniment_revision_identidad_alpha75 x),
    'accounting',(SELECT jsonb_agg(to_jsonb(x) ORDER BY source_key) FROM public.facturacion_tancament_cierres x),
    'works',(SELECT jsonb_agg(to_jsonb(x) ORDER BY seguimiento_id) FROM app_private.manteniment_t_trabajos x),
    'flags',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM app_private.manteniment_sync_config x)
  ) AS value`)).value;
}
async function isolated(fn, isolation = 'SERIALIZABLE') {
  await db.query(`BEGIN ISOLATION LEVEL ${isolation}`);
  try { await fn(); } finally { await db.query('ROLLBACK'); }
}
async function rejected(fn, pattern) {
  await db.query('SAVEPOINT expected_rejection');
  try { await assert.rejects(fn, error => { assert.match(error.message, pattern); return true; }); }
  finally { await db.query('ROLLBACK TO SAVEPOINT expected_rejection'); await db.query('RELEASE SAVEPOINT expected_rejection'); }
}
async function preview(request) {
  return (await one(db, 'SELECT app_private.previsualizar_tramo_cerrado_manteniment_alpha75($1::jsonb) AS value', [JSON.stringify(request)])).value;
}
async function apply(request, p) {
  return (await one(db, 'SELECT app_private.aplicar_tramo_cerrado_manteniment_alpha75($1::jsonb) AS value',
    [JSON.stringify({ ...request, huella_prevision: p.huella_prevision })])).value;
}
async function outbox(s) {
  return (await one(db, 'SELECT to_jsonb(x) AS value FROM app_private.manteniment_parada_outbox x WHERE seguimiento_id=$1', [s.tracking])).value;
}
async function sync(s) {
  return (await one(db, 'SELECT to_jsonb(x) AS value FROM app_private.manteniment_parada_sync x WHERE seguimiento_id=$1', [s.tracking])).value;
}
function row(s, overrides = {}) {
  return { id_fila: 6419, fila: 71, sync_id: s.syncId, estado: 'PARADA', dfm: s.dfm,
    matricula: s.plate, numero_parada: `PA-${s.pa}`, sustituto: s.reserve,
    fecha_programada: '2026-10-03', fecha_parada: '2026-10-03', fecha_k: '2026-10-30',
    dias_parada: 13, km_facturables: null, tancament: 'TANCAMENT 10', ...overrides };
}
async function seed(tag) {
  const s = await seedSyncTracking(db, tag);
  Object.assign(s, { dfm: `SYN-${tag}`, plate: `SYN${tag}`, reserve: `R-${tag}` });
  await db.query(`UPDATE public.registros_hotel SET matricula_sustituido=$2,
    vehiculo_reserva=$3,fecha_parada='2026-10-03',estado='recuperado',
    retirado_hotel_activo=true,cancelado=false WHERE id=$1`, [s.id, s.plate, s.reserve]);
  await db.query(`UPDATE app_private.manteniment_parada_sync SET fecha_programada_parada='2026-10-03',
    fecha_inicio_parada_origen='2026-10-03',fecha_inicio_tramo='2026-10-03',fecha_corte='2026-10-30',
    tancament='TANCAMENT 10',calculo_periodo_automatico=true,tancament_supervisado=false,
    dias_parada_manual=NULL,km_facturables_manual=NULL,fila_manteniment=71,
    ultimo_payload_confirmado='{"synthetic_historical_ack":true}' WHERE seguimiento_id=$1`, [s.tracking]);
  s.payload = { ...s.payload, dfm: s.dfm, matricula: s.plate, sustituto: s.reserve,
    fecha_parada: '2026-10-24', fecha_k: '2026-10-29', dias_parada: 6, km_facturables: 0,
    tancament: 'TANCAMENT 11', solo_trabajos: false,
    trabajos_crear: [{ sync_id: randomUUID(), tipo_trabajo: 'LAVADO', retener_propuesta: true }] };
  await db.query(`UPDATE app_private.manteniment_parada_outbox SET payload=$2::jsonb,revision=37,
    estado='retenida_manual',confirmado_en=NULL,ultimo_error='Synthetic old proposal' WHERE seguimiento_id=$1`,
    [s.tracking, JSON.stringify(s.payload)]);
  // A real SQL delivery ledger with synthetic old ACK and a later unapplied
  // delivery. Neither is a new factual ACK fabricated by the reconciler.
  await db.query(`INSERT INTO app_private.manteniment_entregas_continuidad_alpha75
    (sync_id,revision,seguimiento_id,tipo,payload,origen,entregado_en,confirmado_en,confirmacion)
    VALUES($1,36,$2,'parada','{"synthetic_historical_ack":true}','entrega','2026-10-30T10:00Z',
      '2026-10-30T10:01Z','{"fixture":true}'),
      ($1,37,$2,'parada',$3::jsonb,'entrega','2026-11-01T10:00Z',NULL,NULL)`,
    [s.syncId, s.tracking, JSON.stringify(s.payload)]);
  return s;
}
async function source(block, items, { context = '', reason, received = '2026-11-07T17:58:48Z' } = {}) {
  return await one(db, `INSERT INTO app_private.manteniment_revision_identidad_alpha75
    (bloque,motivo,contexto,payload,alcance,retiene,primera_recepcion_en,ultima_recepcion_en)
    VALUES($1,$2,$3,$4::jsonb,'{"retener_todo":true,"vehiculos":[],"sync_ids":[],"seguimientos":[]}',true,$5,$5)
    RETURNING id,payload_sha256`, [block, reason ?? (block === 'paradas' ? 'IDENTIDAD_UUID_PA_VEHICULO' : 'IDENTIDAD_O_CONTINUIDAD'), context, JSON.stringify(items), received]);
}
async function requestFor(s, items, { paradas = items.filter(x => x.sync_id), cierres = items } = {}) {
  const a = await source('paradas', paradas), b = await source('cierres_facturacion', cierres);
  const execution = randomUUID();
  await db.query(`INSERT INTO public.manteniment_sync_ejecuciones(id,estado,origen,detalle)
    VALUES($1,'correcta','google_apps_script','{"synthetic_reference_only":true}')`, [execution]);
  const times = await one(db, `SELECT to_char(clock_timestamp()-interval '36 seconds',
    'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS since,to_char(clock_timestamp(),
    'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS observed`);
  return { protocolo: 'MG75-TRAMOS-CERRADOS-001', request_id: `fixture:${randomUUID()}`,
    seguimiento_id: s.tracking, sync_id: s.syncId,
    fuentes: [a,b].map(x => ({ revision_id: Number(x.id), payload_sha256: x.payload_sha256 })),
    id_filas: items.map(x => x.id_fila), ultimo_id_fila: items.toSorted((x,y) => y.fecha_parada.localeCompare(x.fecha_parada))[0].id_fila,
    ejecucion_referencia: execution, evidencia_operador: { tipo: 'atestacion_sql_privada',
      cliente_sin_ejecucion_pendiente: true, cliente_inactivo: true, barreras_sostenidas: true,
      barreras_sostenidas_desde: times.since, observado_en: times.observed,
      alcance_fuente_completo_revisado: true, evidencia_sha256: 'a'.repeat(64),
      referencia: 'Synthetic operator attestation; not a cryptographic receipt association' },
    motivo: 'Synthetic explicit closed segment reconciliation for SQL boundary testing' };
}
async function assertOnlyContextAndHoldChanged(beforeState, s, accepted, receipt) {
  const afterState = await inventory();
  for (const key of Object.keys(beforeState).filter(x => !['sync','queue'].includes(x)))
    assert.deepEqual(afterState[key], beforeState[key], key);
  const expectedSync = structuredClone(beforeState.sync);
  const current = afterState.sync.find(x => x.seguimiento_id === s.tracking);
  expectedSync[expectedSync.findIndex(x => x.seguimiento_id === s.tracking)] = { ...accepted, actualizado_en: current.actualizado_en };
  assert.deepEqual(afterState.sync, expectedSync);
  const expectedQueue = structuredClone(beforeState.queue);
  const q = afterState.queue.find(x => x.seguimiento_id === s.tracking);
  expectedQueue[expectedQueue.findIndex(x => x.seguimiento_id === s.tracking)] = {
    ...beforeState.queue.find(x => x.seguimiento_id === s.tracking), actualizado_en: q.actualizado_en,
    ultimo_error: `Tramo cerrado conciliado; propuesta obsoleta no aplicada. Evidencia ${receipt.evidencia_sha256}` };
  assert.deepEqual(afterState.queue, expectedQueue);
}

before(async () => {
  fixture = await createFixture(); db = fixture.admin;
  for (const file of [
    '20261029184748_alpha75_autorizar_ejecucion_manteniment.sql',
    '20261101203000_alpha75_sincro7_resolver_tancament_calendario_real.sql',
  ]) await db.query(await readFile(new URL(`../../supabase/migrations/${file}`, import.meta.url), 'utf8'));
  await db.query(`UPDATE app_private.manteniment_sync_config SET pausa_importacion_identidad=false,
    solo_lectura_manual_protegida=true,escritura_segura_manual=false WHERE id=1`);
  await db.query(await readFile(new URL('../../supabase/migrations/20261107135502_alpha75_sincro_identidad_pa_tramos.sql', import.meta.url), 'utf8'));
  await db.query(`ALTER TABLE public.manteniment_sync_ejecuciones ADD COLUMN estado text,ADD COLUMN origen text;
    INSERT INTO public.cierres_facturacion(periodo,fecha_inicio,fecha_cierre)
    VALUES('2026-10','2026-10-01','2026-10-23'),('2026-11','2026-10-24','2026-11-20');`);
  // Literal current runtime trigger, absent from the shared protocol fixture.
  // The Hotel metadata trigger and unrelated work ingestion remain labelled
  // doubles in that fixture; no claim of browser/UI or whole-system coverage.
  await db.query(`CREATE OR REPLACE FUNCTION app_private.manteniment_parada_sync_trigger()
    RETURNS trigger LANGUAGE plpgsql SET search_path TO 'pg_catalog','public','app_private'
    AS $function$
    begin
      new.actualizado_en := clock_timestamp();
      if coalesce(current_setting('app.manteniment_importando_paradas', true), '') <> '1' then
        perform app_private.manteniment_encolar_parada(new.seguimiento_id);
      end if;
      return new;
    end;
    $function$;
    CREATE TRIGGER fixture_real_sync_enqueue AFTER INSERT OR UPDATE ON app_private.manteniment_parada_sync
    FOR EACH ROW EXECUTE FUNCTION app_private.manteniment_parada_sync_trigger();`);
  // Third protected sentinel complements the existing 2556 and 2637 fixtures.
  await db.query(`INSERT INTO public.registros_hotel(id,pizarra_id,seguimiento_id,numero_parada,
    vehiculo_sustituido,matricula_sustituido,estado,creado_por,modificado_por)
    VALUES('00000000-0000-4000-8000-000000002731',$1,'00000000-0000-4000-8000-000000202731',
      'SINT-2731','2731','SYN2731','en_taller',$2,$2)`, [FIXTURE_BOARD,FIXTURE_ACTOR]);
  beforeInstall = await inventory(); beforeMetadata = await metadata();
  await db.query(migration); afterInstall = await inventory();
});
after(async () => { if (fixture) await fixture.destroy(); });

test('TC01 installation preserves operational rows, ACK, barriers and function metadata; API stays private', async () => {
  assert.deepEqual(afterInstall, beforeInstall);
  assert.deepEqual(await metadata(), beforeMetadata);
  const access = await one(db, `SELECT relrowsecurity,
    has_table_privilege('anon',oid,'SELECT') AS anon,has_table_privilege('authenticated',oid,'SELECT') AS authenticated,
    has_table_privilege('service_role',oid,'SELECT') AS service FROM pg_class
    WHERE oid='app_private.manteniment_tramos_cerrados_conciliados_alpha75'::regclass`);
  assert.deepEqual(access, { relrowsecurity: true, anon: false, authenticated: false, service: false });
  const funcs = (await db.query(`SELECT oid::regprocedure::text AS name,
    has_function_privilege('anon',oid,'EXECUTE') AS anon,has_function_privilege('authenticated',oid,'EXECUTE') AS authenticated,
    has_function_privilege('service_role',oid,'EXECUTE') AS service,prosecdef FROM pg_proc
    WHERE pronamespace='app_private'::regnamespace AND proname LIKE '%tramo%cerrado%alpha75'`)).rows;
  assert.equal(funcs.length,7);
  for (const f of funcs) assert.deepEqual([f.anon,f.authenticated,f.service,f.prosecdef], [false,false,false,false], f.name);
});

test('TC02 R1488-style historical Q10 rollover is blocked after deliberate reconciliation; manual 13 days and blank P survive', async () => isolated(async () => {
  const s = await seed('ROLLOVER');
  const generated = (await one(db, 'SELECT app_private.manteniment_construir_payload_parada($1) AS value',[s.tracking])).value;
  assert.equal(generated.tancament,'TANCAMENT 11');
  assert.equal(generated.fecha_parada,'2026-10-24');
  const req = await requestFor(s,[row(s)]), p = await preview(req);
  const before = await inventory(), protectedFacts = await snapshotProtectedFacts(db);
  const receipt = await apply(req,p);
  assert.equal(receipt.aplicada_en_hoja,false); assert.equal(receipt.identidad_resuelta,false);
  await assertOnlyContextAndHoldChanged(before,s,p.prevision.contexto_aceptado,receipt);
  assert.deepEqual(await snapshotProtectedFacts(db),protectedFacts);
  const current = await sync(s);
  assert.equal(current.dias_parada_manual,13); assert.equal(current.km_facturables_manual,null);
  assert.equal(current.tancament,'TANCAMENT 10'); assert.equal(current.calculo_periodo_automatico,false);
  assert.equal(current.tancament_supervisado,false);
  assert.equal((await one(db,'SELECT app_private.manteniment_construir_payload_parada($1) AS value',[s.tracking])).value,null);
  const held = await outbox(s);
  await db.query('SELECT app_private.manteniment_encolar_parada($1)',[s.tracking]);
  assert.deepEqual(await outbox(s),held);
  const evidence = (await one(db,'SELECT evidencia FROM app_private.manteniment_tramos_cerrados_conciliados_alpha75 WHERE id=$1',[receipt.conciliacion_id])).evidencia;
  assert.deepEqual(evidence.prevision.fuentes,p.prevision.fuentes);
  assert.deepEqual(evidence.outbox_obsoleta,before.queue.find(x=>x.seguimiento_id===s.tracking));
  assert.match(evidence.prevision.ejecucion_referencia.asociacion,/no_union_criptografica/);
}));

test('TC03 complete stable IDs select the last actual segment, preserving original Hotel/J and literal noncalendar days/km', async () => isolated(async () => {
  const s = await seed('SEGMENTS');
  const rows = [row(s,{id_fila:1096,fecha_programada:'2026-10-08',fecha_parada:'2026-10-08',fecha_k:'2026-10-23',dias_parada:8,km_facturables:3600}),
    row(s,{id_fila:1097,fila:2,fecha_programada:'2026-10-08',fecha_parada:'2026-10-24',fecha_k:'2026-10-29',tancament:'TANCAMENT 11',dias_parada:8,km_facturables:3456})];
  const req=await requestFor(s,rows.toReversed()),p=await preview(req),before=await inventory();
  const receipt=await apply(req,p);
  await assertOnlyContextAndHoldChanged(before,s,p.prevision.contexto_aceptado,receipt);
  const current=await sync(s);
  assert.equal(current.fecha_inicio_tramo,'2026-10-24'); assert.equal(current.fecha_programada_parada,'2026-10-08');
  assert.equal(current.fecha_inicio_parada_origen,'2026-10-03'); assert.equal(current.dias_parada_manual,8);
  assert.equal(current.km_facturables_manual,3456);
  assert.deepEqual(p.prevision.id_filas,[1096,1097]);
  assert.equal(current.fila_manteniment,71,'Physical position is historical metadata, never stable T identity');
}));

test('TC04 actual J before programmed I is valid; numeric zero and source blank remain different', async () => isolated(async () => {
  const s=await seed('EARLY'), req=await requestFor(s,[row(s,{fecha_programada:'2026-10-09',km_facturables:0})]);
  const p=await preview(req); await apply(req,p);
  assert.equal((await sync(s)).fecha_programada_parada,'2026-10-09');
  assert.equal((await sync(s)).fecha_inicio_tramo,'2026-10-03');
  assert.equal((await sync(s)).km_facturables_manual,0);
}));

test('TC05 missing stable IDs, conflicting source rows and overlapping intervals fail without mutation', async () => isolated(async () => {
  const s=await seed('AMBIGUOUS'),rows=[row(s,{id_fila:10,fecha_k:'2026-10-23'}),row(s,{id_fila:20,fecha_parada:'2026-10-24'})];
  const req=await requestFor(s,rows),before=await inventory();
  await rejected(()=>preview({...req,id_filas:[20]}),/ALCANCE_INCOMPLETO/);
  await rejected(()=>preview({...req,id_filas:[10,10,20]}),/ALCANCE_INCOMPLETO/);
  await rejected(()=>preview({...req,ultimo_id_fila:10}),/ULTIMO_TRAMO/);
  assert.deepEqual(await inventory(),before);
  await db.query('SAVEPOINT alternate_source');
  await db.query(`UPDATE app_private.manteniment_revision_identidad_alpha75 SET payload=jsonb_set(payload,'{0,fecha_k}','"2026-10-24"') WHERE id=ANY($1::bigint[])`,[req.fuentes.map(x=>x.revision_id)]);
  const updated=(await db.query('SELECT id,payload_sha256 FROM app_private.manteniment_revision_identidad_alpha75 ORDER BY id')).rows;
  await rejected(()=>preview({...req,fuentes:updated.map(x=>({revision_id:Number(x.id),payload_sha256:x.payload_sha256}))}),/TRAMOS_SOLAPADOS/);
  await db.query('ROLLBACK TO SAVEPOINT alternate_source'); await db.query('RELEASE SAVEPOINT alternate_source');
}));

test('TC06 source block omissions cannot be hidden by a union; duplicate T and contradictory UUID fail closed', async () => isolated(async () => {
  const s=await seed('OMISSION');
  const req=await requestFor(s,[row(s)],{paradas:[]});
  await rejected(()=>preview(req),/FUENTES_VINCULADAS_INCOMPLETAS/);
  await db.query('DELETE FROM app_private.manteniment_revision_identidad_alpha75');
  const dup=await requestFor(s,[row(s),row(s)]);
  await rejected(()=>preview(dup),/ID_FILA_DUPLICADO/);
  await db.query('DELETE FROM app_private.manteniment_revision_identidad_alpha75');
  const wrong=await requestFor(s,[row(s,{numero_parada:'PA-OTHER'})]);
  await rejected(()=>preview(wrong),/FILA_IDENTIDAD_NO_ACREDITADA/);
  await db.query('DELETE FROM app_private.manteniment_revision_identidad_alpha75');
  const conflict=await requestFor(s,[row(s)],{cierres:[row(s,{dias_parada:99})]});
  await rejected(()=>preview(conflict),/FUENTES_DISCREPAN/);
}));

test('TC07 CAS binds context, queue and full source record; stale or superseded source leaves no receipt', async () => isolated(async () => {
  const s=await seed('CAS'),req=await requestFor(s,[row(s)]),p=await preview(req);
  const before=await inventory();
  await rejected(()=>apply(req,{...p,huella_prevision:'0'.repeat(64)}),/CAS_CAMBIADO/);
  assert.deepEqual(await inventory(),before);
  await db.query('SAVEPOINT context_change');
  await db.query(`UPDATE app_private.manteniment_parada_sync SET fecha_programada_parada='2026-11-02' WHERE seguimiento_id=$1`,[s.tracking]);
  await rejected(()=>apply(req,p),/CAS_CAMBIADO/);
  await db.query('ROLLBACK TO SAVEPOINT context_change'); await db.query('RELEASE SAVEPOINT context_change');
  await db.query('SAVEPOINT queue_change');
  await db.query(`UPDATE app_private.manteniment_parada_outbox SET ultimo_error='Synthetic changed queue evidence' WHERE seguimiento_id=$1`,[s.tracking]);
  await rejected(()=>apply(req,p),/CAS_CAMBIADO/);
  await db.query('ROLLBACK TO SAVEPOINT queue_change'); await db.query('RELEASE SAVEPOINT queue_change');
  await db.query('SAVEPOINT source_change');
  await db.query(`UPDATE app_private.manteniment_revision_identidad_alpha75 SET recepciones=recepciones+1 WHERE id=$1`,[req.fuentes[0].revision_id]);
  await rejected(()=>apply(req,p),/CAS_CAMBIADO/);
  await db.query('ROLLBACK TO SAVEPOINT source_change'); await db.query('RELEASE SAVEPOINT source_change');
  await source('cierres_facturacion',[row(s,{dias_parada:99})],{received:'2026-11-07T18:00:00Z'});
  await rejected(()=>preview(req),/FUENTE_SUPERADA/);
  assert.equal((await one(db,'SELECT count(*)::int AS n FROM app_private.manteniment_tramos_cerrados_conciliados_alpha75')).n,0);
}));

test('TC08 archived active or newer reopened Hotel is not a recovered episode; durable hold survives a later reopening', async () => isolated(async () => {
  const s=await seed('REOPEN'),req=await requestFor(s,[row(s)]);
  await db.query('SAVEPOINT active_copy');
  await db.query(`UPDATE public.registros_hotel SET estado='en_taller',retirado_hotel_activo=false WHERE id=$1`,[s.id]);
  await db.query(`UPDATE public.pizarras SET estado='archivada' WHERE id=$1`,[FIXTURE_BOARD]);
  await rejected(()=>preview(req),/HOTEL_NO_CERRADO/);
  await db.query('ROLLBACK TO SAVEPOINT active_copy'); await db.query('RELEASE SAVEPOINT active_copy');
  await db.query('SAVEPOINT newer_copy');
  const nextBoard=randomUUID();
  await db.query(`UPDATE public.pizarras SET estado='archivada' WHERE id=$1`,[FIXTURE_BOARD]);
  await db.query(`INSERT INTO public.pizarras(id,estado,fecha) VALUES($1,'en_curso','2026-11-08')`,[nextBoard]);
  await db.query(`INSERT INTO public.registros_hotel SELECT (jsonb_populate_record(NULL::public.registros_hotel,
    to_jsonb(r)||jsonb_build_object('id',$2::uuid,'pizarra_id',$3::uuid,'estado','en_taller',
      'retirado_hotel_activo',false))).* FROM public.registros_hotel r WHERE id=$1`,[s.id,randomUUID(),nextBoard]);
  await rejected(()=>preview(req),/HOTEL_NO_CERRADO/);
  await db.query('ROLLBACK TO SAVEPOINT newer_copy'); await db.query('RELEASE SAVEPOINT newer_copy');
  const p=await preview(req); await apply(req,p);
  await db.query(`UPDATE public.registros_hotel SET estado='en_taller',retirado_hotel_activo=false WHERE id=$1`,[s.id]);
  assert.equal((await one(db,'SELECT app_private.manteniment_construir_payload_parada($1) AS value',[s.tracking])).value,null);
  await rejected(()=>db.query(`UPDATE app_private.manteniment_parada_sync SET fecha_corte=NULL WHERE seguimiento_id=$1`,[s.tracking]),/CONTEXTO_CONCILIADO/);
  await rejected(()=>preview(req),/YA_CONCILIADO/);
}));

test('TC09 evidence is immutable and obsolete outbox cannot move both identities, be deleted, confirmed or repayloaded', async () => isolated(async () => {
  const s=await seed('IMMUTABLE'),req=await requestFor(s,[row(s)]),p=await preview(req); await apply(req,p);
  const before=await inventory();
  for (const sql of [
    `UPDATE app_private.manteniment_tramos_cerrados_conciliados_alpha75 SET request_id='attempted-rewrite'`,
    `DELETE FROM app_private.manteniment_tramos_cerrados_conciliados_alpha75`,
    `TRUNCATE app_private.manteniment_tramos_cerrados_conciliados_alpha75`,
  ]) await rejected(()=>db.query(sql),/EVIDENCIA_INMUTABLE/);
  for (const sql of [
    `DELETE FROM app_private.manteniment_parada_outbox WHERE seguimiento_id=$1`,
    `UPDATE app_private.manteniment_parada_outbox SET estado='confirmado' WHERE seguimiento_id=$1`,
    `UPDATE app_private.manteniment_parada_outbox SET payload='{}',revision=revision+1 WHERE seguimiento_id=$1`,
    `UPDATE app_private.manteniment_parada_outbox SET seguimiento_id=gen_random_uuid(),sync_id=gen_random_uuid(),estado='pendiente' WHERE seguimiento_id=$1`,
  ]) await rejected(()=>db.query(sql,[s.tracking]),/MG_CERRADO_OUTBOX_OBSOLETA|MG_SYNC_/);
  // Isolate the new OLD/NEW guard from the older continuity identity guard.
  // This temporary fixture DDL is rolled back and is never operational SQL.
  const prior=(await db.query(`SELECT tgname FROM pg_trigger WHERE tgrelid='app_private.manteniment_parada_outbox'::regclass
    AND tgfoid='app_private.proteger_outbox_continuidad_alpha75()'::regprocedure`)).rows;
  for (const {tgname} of prior) await db.query(`ALTER TABLE app_private.manteniment_parada_outbox DISABLE TRIGGER "${tgname.replaceAll('"','""')}"`);
  await rejected(()=>db.query(`UPDATE app_private.manteniment_parada_outbox SET seguimiento_id=gen_random_uuid(),
    sync_id=gen_random_uuid(),estado='pendiente' WHERE seguimiento_id=$1`,[s.tracking]),/MG_CERRADO_OUTBOX_OBSOLETA/);
  for (const {tgname} of prior) await db.query(`ALTER TABLE app_private.manteniment_parada_outbox ENABLE TRIGGER "${tgname.replaceAll('"','""')}"`);
  assert.deepEqual(await inventory(),before);
}));

test('TC10 independently resolving identity reviews cannot release old mixed PARADA, delivery or authorization', async () => isolated(async () => {
  const s=await seed('RELEASE'),req=await requestFor(s,[row(s)]),p=await preview(req); await apply(req,p);
  // Separate synthetic owner operation represents a later review, never a side
  // effect of the candidate application and never proposed remote SQL.
  await db.query(`UPDATE app_private.manteniment_revision_identidad_alpha75 SET resuelta_en=clock_timestamp(),
    resolucion=jsonb_build_object('motivo','Synthetic separately reviewed identity release','evidencia_sha256',repeat('b',64))`);
  await db.query(`UPDATE app_private.manteniment_sync_config SET solo_lectura_manual_protegida=false,
    escritura_segura_manual=true,pausa_importacion_identidad=false WHERE id=1`);
  const before=await inventory(),q=await outbox(s);
  assert.equal((await one(db,'SELECT app_private.retencion_identidad_manteniment_alpha75($1,$2) AS held',[s.tracking,s.syncId])).held,true);
  await db.query('SELECT app_private.manteniment_encolar_parada($1)',[s.tracking]);
  const delivered=(await one(db,'SELECT app_private.finalizar_entrega_sync_continuidad_alpha75($1::jsonb) AS value',
    [JSON.stringify({ok:true,comandos_manteniment:[{tipo:'parada',sync_id:s.syncId,revision:37,payload:q.payload}]})])).value;
  assert.deepEqual(delivered.comandos_manteniment,[]);
  const hash=(await one(db,'SELECT app_private.hash_payload_sync_continuidad_alpha75($1::jsonb) AS hash',[JSON.stringify(q.payload)])).hash;
  const ref={tipo:'parada',sync_id:s.syncId,revision:37,payload_sha256:hash};
  const auth=(await one(db,'SELECT public.autorizar_ejecucion_manteniment($1,$2::jsonb) AS value',[SYNTHETIC_SYNC_TOKEN,JSON.stringify({
    version_script:'alpha75-2026.10.26.1',version_ejecucion:'MG75-EJECUCION-ORDEN-001',escritura_segura_manual:true,
    spreadsheet_id:'SYNTHETIC_SHEET_CONTINUITY_75',request_id:randomUUID(),alcance:[ref],orden:{...ref,payload:q.payload}})])).value;
  assert.equal(auth.autorizada,false); assert.match(JSON.stringify(auth),/ORDEN_RETENIDA_O_CONFIRMADA/);
  assert.deepEqual(await inventory(),before);
  assert.equal((await outbox(s)).payload.solo_trabajos,false);
  assert.equal((await outbox(s)).payload.trabajos_crear.length,1);
}));

test('TC11 missing UUID can be credited only by a complete unique canonical PA/DFM/plate; ambiguous Hotel is rejected', async () => isolated(async () => {
  const s=await seed('NO_UUID'),req=await requestFor(s,[row(s,{sync_id:''})]);
  const p=await preview(req);
  assert.equal(p.prevision.tramos[0].sync_id,'');
  await db.query('SAVEPOINT ambiguous_identity');
  await db.query(`INSERT INTO public.registros_hotel(id,pizarra_id,seguimiento_id,numero_parada,vehiculo_sustituido,
    matricula_sustituido,creado_por,modificado_por) VALUES($1,$2,$3,$4,$5,$6,$7,$7)`,
    [randomUUID(),FIXTURE_BOARD,randomUUID(),s.pa,s.dfm,s.plate,FIXTURE_ACTOR]);
  await rejected(()=>preview(req),/PA_AMBIGUA_O_CONTINUIDAD/);
  await db.query('ROLLBACK TO SAVEPOINT ambiguous_identity'); await db.query('RELEASE SAVEPOINT ambiguous_identity');
  await apply(req,p);
  assert.equal((await sync(s)).fecha_inicio_tramo,'2026-10-03');
  assert.equal(p.prevision.solicitud.id_filas[0],6419);
}));

test('TC12 protected output, explicit inactive-client window and serializable CAS are required', async () => {
  await isolated(async()=>{
    const s=await seed('GUARDS'),req=await requestFor(s,[row(s)]),p=await preview(req);
    await rejected(()=>preview({...req,evidencia_operador:{...req.evidencia_operador,cliente_inactivo:false}}),/ATESTACION_REQUERIDA/);
    await rejected(()=>preview({...req,evidencia_operador:{...req.evidencia_operador,barreras_sostenidas_desde:req.evidencia_operador.observado_en}}),/VENTANA_ATESTADA_INSUFICIENTE/);
    await rejected(()=>preview({...req,evidencia_operador:{...req.evidencia_operador,observado_en:'2199-01-01T00:00:00Z'}}),/VENTANA_ATESTADA_INSUFICIENTE/);
    await db.query('SAVEPOINT invalid_reference');
    await db.query(`UPDATE public.manteniment_sync_ejecuciones SET estado='error' WHERE id=$1`,[req.ejecucion_referencia]);
    await rejected(()=>preview(req),/EJECUCION_REFERENCIA_INVALIDA/);
    await db.query('ROLLBACK TO SAVEPOINT invalid_reference'); await db.query('RELEASE SAVEPOINT invalid_reference');
    await db.query(`UPDATE app_private.manteniment_sync_config SET escritura_segura_manual=true WHERE id=1`);
    await rejected(()=>apply(req,p),/SALIDA_NO_PROTEGIDA/);
    assert.equal((await one(db,'SELECT count(*)::int AS n FROM app_private.manteniment_tramos_cerrados_conciliados_alpha75')).n,0);
  });
  await isolated(async()=>{
    const s=await seed('ISOLATION'),req=await requestFor(s,[row(s)]),p=await preview(req);
    await rejected(()=>apply(req,p),/REQUIERE_SERIALIZABLE/);
  },'READ COMMITTED');
});
