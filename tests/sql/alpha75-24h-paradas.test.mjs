import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const setup = await readFile(new URL('./fixtures/setup.sql', import.meta.url), 'utf8');
const baseline = await readFile(new URL('../fixtures/alpha75-24h-paradas-baseline.sql', import.meta.url), 'utf8');
const triggers = await readFile(new URL('./fixtures/triggers.sql', import.meta.url), 'utf8');
const migration = await readFile(new URL('../../supabase/migrations/20261028174243_alpha75_24h_paradas_independientes.sql', import.meta.url), 'utf8');
const actor = '00000000-0000-4000-8000-000000000001';
const board = '00000000-0000-4000-8000-000000000010';
const history2556 = '00000000-0000-4000-8000-000000002556';
const history2637 = '00000000-0000-4000-8000-000000002637';
const oldActivation = '00000000-0000-4000-8000-000000102556';

async function row(db, sql, values = []) { return (await db.query(sql, values)).rows[0]; }
async function save(db, payload, request = 'test_assistance_001', id = null) {
  return (await row(db, 'SELECT public.guardar_activacion_24h($1,$2::jsonb,$3) AS value', [id, JSON.stringify(payload), request])).value;
}
const open = (dfm = 'TEST-2554') => ({
  dfm, averia: 'Avería sintética', resultado: 'seguimiento_abierto', estado_seguimiento: 'en_curso',
  fecha_activacion: '2026-10-20', hora_activacion: '10:00', ubicacion_referencia: 'Ubicación sintética',
});
const closeTransfer = (dfm = 'TEST-2554') => ({
  ...open(dfm), resultado: 'trasladado_taller', trasladado_taller: true,
  taller_traslado: 'Taller sintético', estado_seguimiento: 'realizada',
  estado_operativo_confirmado: false, fecha_fin_reparacion: '2026-10-20', hora_fin_reparacion: '11:00',
});
async function snapshot(db) {
  return (await row(db, `SELECT jsonb_build_object(
    'registros',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY id),'[]') FROM public.registros_hotel x),
    'activaciones',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY id),'[]') FROM public.activaciones_24h x),
    'etapas',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY id),'[]') FROM public.etapas_hotel x),
    'sync',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY seguimiento_id),'[]') FROM app_private.manteniment_parada_sync x),
    'reservas',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY vehiculo_codigo),'[]') FROM public.reservas_hotel x),
    'barreras',(SELECT jsonb_agg(to_jsonb(x)) FROM app_private.test_sync_config x)
  ) AS value`)).value;
}
async function seedHistory(db) {
  await db.exec(`
    INSERT INTO public.pizarras VALUES('00000000-0000-4000-8000-000000000011','archivada','2026-09-30');
    INSERT INTO public.registros_hotel(id,pizarra_id,seguimiento_id,numero_parada,vehiculo_sustituido,vehiculo_reserva,matricula_reserva,tipo_movimiento,estado,lugar,fecha_parada,modalidad_operativa,observaciones)
    VALUES('${history2556}','${board}','00000000-0000-4000-8000-000000202556','SINT-2556','2556','R2556','SYN2556','24H','en_taller','Taller manual 2556','2026-10-10','reserva_en_reparacion','Dato manual protegido'),
      ('${history2637}','00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000202637','SINT-2637','2637','R2637','SYN2637','TALLER','en_taller','Taller manual 2637','2026-09-19','','Identidad y medias manuales');
    INSERT INTO public.activaciones_24h(id,dfm,registro_hotel_id,seguimiento_hotel_id,fecha_activacion,hora_activacion,resultado,estado,creado_por)
    VALUES('${oldActivation}','2556','${history2556}','00000000-0000-4000-8000-000000202556','2026-10-10','10:00','trasladado_taller','abierta','${actor}');
    INSERT INTO public.etapas_hotel(registro_hotel_id,nombre,posicion,estado,tipo_etapa,lugar,fecha_inicio_real,fecha_fin_real,fecha_real)
    VALUES('${history2556}','24H · Avería',1,'realizada','24H','Lugar histórico','2026-10-10 10:00 Europe/Madrid','2026-10-10 11:00 Europe/Madrid','2026-10-10 11:00 Europe/Madrid'),
      ('${history2556}','Estancia taller manual',2,'en_curso','entrada_taller','Taller manual 2556','2026-10-11 09:00 Europe/Madrid',NULL,NULL),
      ('${history2637}','Taller histórico',1,'en_curso','entrada_taller','Taller manual 2637','2026-09-19 08:00 Europe/Madrid',NULL,NULL);
    INSERT INTO app_private.manteniment_parada_sync(seguimiento_id,fecha_programada_parada,fecha_corte,tancament,fecha_inicio_tramo,dias_parada_manual,km_facturables_manual,km_dia_manual,tancament_supervisado)
    VALUES('00000000-0000-4000-8000-000000202556','2026-10-10','2026-10-24','TANCAMENT 10','2026-10-10',15,555.55,37.03,true),
      ('00000000-0000-4000-8000-000000202637','2026-09-19','2026-09-30','TANCAMENT 9','2026-09-19',12,987.65,82.3042,true);
    INSERT INTO app_private.hotel_flujo_modelo VALUES('00000000-0000-4000-8000-000000202556','entrada_hitos_v1','${actor}');
  `);
}
async function boot({ install = true } = {}) {
  const db = new PGlite();
  await db.exec(setup);
  await db.exec(baseline);
  await seedHistory(db);
  await db.exec(triggers);
  const before = await snapshot(db);
  if (install) await db.exec(migration);
  return { db, before };
}
async function isolated(fn) {
  const { db, before } = await boot();
  try { await fn(db, before); } finally { await db.close(); }
}
async function workshop(db, dfm, extra = {}, request = 'test_workshop_001') {
  const ficha = { vehiculo_sustituido: dfm, estado: 'pendiente_taller', tipo_movimiento: 'TALLER', fecha_parada: '2026-10-21', ...extra };
  return (await row(db, 'SELECT app_private.crear_ficha_hotel($1::jsonb,$2) AS value', [JSON.stringify(ficha), request])).value;
}

// Each public RPC is one autocommit transaction, executing real deferred
// coherence constraints. No operational backend or imported operational rows.
test('migration is schema-only; synthetic2556/2637 facts, manual km/days and paused sync survive', async () => isolated(async (db, before) => {
  assert.deepEqual(await snapshot(db), before);
  assert.match((await row(db, 'SELECT version() AS value')).value, /PostgreSQL 17\./);
}));

test('new assistance events and subsequent workshop receive distinct PA and tracking identities', async () => isolated(async db => {
  const a = await save(db, open());
  const b = await save(db, open(), 'test_assistance_002');
  const w = await workshop(db, 'TEST-2554');
  const cards = (await db.query(`SELECT r.id,r.seguimiento_id,r.numero_parada,
    (SELECT count(*)::int FROM public.etapas_hotel e WHERE e.registro_hotel_id=r.id) AS stages
    FROM public.registros_hotel r WHERE vehiculo_sustituido='TEST-2554' ORDER BY numero_parada`)).rows;
  assert.equal(cards.length, 3);
  assert.equal(new Set(cards.map(x => x.id)).size, 3);
  assert.equal(new Set(cards.map(x => x.seguimiento_id)).size, 3);
  assert.equal(new Set(cards.map(x => x.numero_parada)).size, 3);
  assert.deepEqual(cards.map(x => x.stages), [1, 1, 0]);
  assert.notEqual(a.id, b.id);
  assert.ok(w.id);
}));

test('same create request and payload replay keeps id/PA and every existing fact; different payload fails', async () => isolated(async db => {
  const p = open();
  delete p.fecha_activacion;
  const a = await save(db, p, 'test_replay_001');
  // Simulate a previously created activation from another day without changing
  // the retry payload. Replays must not refresh its date from clock_timestamp.
  await db.exec(`UPDATE public.activaciones_24h SET fecha_activacion='2026-10-18' WHERE id='${a.id}'`);
  const before = await snapshot(db);
  const b = await save(db, p, 'test_replay_001');
  assert.equal(b.id, a.id);
  assert.equal(b.reutilizada, true);
  assert.deepEqual(await snapshot(db), before);
  await assert.rejects(save(db, { ...p, averia: 'Otro contenido' }, 'test_replay_001'), /otros datos/);
  assert.deepEqual(await snapshot(db), before);
  const stored = await row(db, 'SELECT payload_sha256 FROM app_private.activacion_24h_peticion_paradas002');
  assert.match(stored.payload_sha256, /^[a-f0-9]{64}$/);
}));

test('transfer closes assistance and its unique T without inventing repair, recovery, workshop T or retiro', async () => isolated(async db => {
  const a = await save(db, open());
  const result = await save(db, closeTransfer(), 'test_close_001', a.id);
  assert.equal(result.estado, 'cerrada');
  assert.equal(result.estado_seguimiento, 'realizada');
  assert.equal(result.resultado, 'trasladado_taller');
  assert.equal(result.estado_hotel, 'realizada');
  const actual = await row(db, `SELECT a.estado_operativo_confirmado,a.reparado_carretera,
    r.retirado_hotel_activo,r.fecha_retirado_hotel,r.vehiculo_reserva,
    (SELECT count(*)::int FROM public.etapas_hotel WHERE registro_hotel_id=r.id) AS stages,
    (SELECT count(*)::int FROM app_private.test_side_effects WHERE kind='liberar') AS releases
    FROM public.activaciones_24h a JOIN public.registros_hotel r ON r.id=a.registro_hotel_id WHERE a.id=$1`, [a.id]);
  assert.deepEqual(actual, { estado_operativo_confirmado: false, reparado_carretera: false, retirado_hotel_activo: false, fecha_retirado_hotel: null, vehiculo_reserva: '', stages: 1, releases: 0 });
}));

test('new substitution can be recorded and closed once; real reserve stays occupied and counters untouched', async () => isolated(async db => {
  const beforeCounters = (await db.query('SELECT * FROM app_private.manteniment_parada_sync ORDER BY seguimiento_id')).rows;
  const p = { ...closeTransfer('TEST-2527'), resultado: 'necesita_sustitucion', vehiculo_sustituto: 'R-TEST', matricula_sustituto: 'TEST123' };
  const a = await save(db, p, 'test_replacement_001');
  const actual = await row(db, `SELECT r.estado,r.vehiculo_reserva,r.retirado_hotel_activo,r.fecha_retirado_hotel,
    (SELECT estado FROM public.reservas_hotel WHERE vehiculo_codigo='R-TEST') AS reserva_estado,
    (SELECT count(*)::int FROM public.etapas_hotel WHERE registro_hotel_id=r.id) AS stages
    FROM public.activaciones_24h a JOIN public.registros_hotel r ON r.id=a.registro_hotel_id WHERE a.id=$1`, [a.id]);
  assert.deepEqual(actual, { estado: 'realizada', vehiculo_reserva: 'R-TEST', retirado_hotel_activo: false, fecha_retirado_hotel: null, reserva_estado: 'ocupada', stages: 1 });
  const afterCounters = (await db.query("SELECT * FROM app_private.manteniment_parada_sync WHERE seguimiento_id IN ('00000000-0000-4000-8000-000000202556','00000000-0000-4000-8000-000000202637') ORDER BY seguimiento_id")).rows;
  assert.deepEqual(afterCounters, beforeCounters);
  const w = await workshop(db, 'TEST-2527');
  assert.notEqual(w.id, a.id);
  await assert.rejects(workshop(db, 'TEST-2527', { vehiculo_reserva: 'R-TEST', matricula_reserva: 'TEST123' }, 'test_duplicate_001'), /continúa asignado/);
  assert.equal((await row(db, "SELECT count(*)::int AS n FROM public.registros_hotel WHERE vehiculo_reserva='R-TEST'")).n, 1);
}));

test('open substitution save avoids transient REC-001 conflict and does not create recovery T', async () => isolated(async db => {
  const p = { ...open('TEST-2675'), resultado: 'necesita_sustitucion', vehiculo_sustituto: 'R-TEST', matricula_sustituto: 'TEST123' };
  const a = await save(db, p, 'test_open_replacement');
  const actual = await row(db, `SELECT a.estado,r.vehiculo_reserva,(SELECT count(*)::int FROM public.etapas_hotel WHERE registro_hotel_id=r.id) AS stages
    FROM public.activaciones_24h a JOIN public.registros_hotel r ON r.id=a.registro_hotel_id WHERE a.id=$1`, [a.id]);
  assert.deepEqual(actual, { estado: 'abierta', vehiculo_reserva: 'R-TEST', stages: 1 });
}));

test('reactivation cannot create second assignment; unchanged legacy facts are not repaired automatically', async () => isolated(async db => {
  const dormant = await workshop(db, 'TEST-DORMANT', { vehiculo_reserva: 'R-TEST', matricula_reserva: 'TEST123' }, 'test_dormant_001');
  await db.query('UPDATE public.registros_hotel SET retirado_hotel_activo=true WHERE id=$1', [dormant.id]);
  await save(db, { ...closeTransfer(), resultado: 'necesita_sustitucion', vehiculo_sustituto: 'R-TEST', matricula_sustituto: 'TEST123' }, 'test_active_sub_001');
  await assert.rejects(db.query('UPDATE public.registros_hotel SET retirado_hotel_activo=false WHERE id=$1', [dormant.id]), /continúa asignado/);
  assert.equal((await row(db, 'SELECT retirado_hotel_activo FROM public.registros_hotel WHERE id=$1', [dormant.id])).retirado_hotel_activo, true);
}));

test('2556-like legacy workshop stays active with its exact place, other T, assignment and manual numbers', async () => isolated(async db => {
  const prior = await row(db, 'SELECT to_jsonb(r) AS value FROM public.registros_hotel r WHERE id=$1', [history2556]);
  const stages = (await db.query('SELECT to_jsonb(e) AS value FROM public.etapas_hotel e WHERE registro_hotel_id=$1 ORDER BY posicion', [history2556])).rows;
  const result = await save(db, { ...closeTransfer('2556'), fecha_activacion: '2026-10-10', fecha_fin_reparacion: '2026-10-10' }, 'test_legacy_close', oldActivation);
  assert.equal(result.estado_hotel, 'en_taller');
  assert.deepEqual((await row(db, 'SELECT to_jsonb(r) AS value FROM public.registros_hotel r WHERE id=$1', [history2556])).value, prior.value);
  assert.deepEqual((await db.query('SELECT to_jsonb(e) AS value FROM public.etapas_hotel e WHERE registro_hotel_id=$1 ORDER BY posicion', [history2556])).rows, stages);
  await assert.rejects(db.query("SELECT app_private.guardar_ficha_hotel_edicion($1,1,'{\"estado\":\"recuperado\"}'::jsonb,'[]'::jsonb,'test_guard_workshop')", [history2556]), /entrada de taller activa/);
  assert.deepEqual((await row(db, 'SELECT to_jsonb(r) AS value FROM public.registros_hotel r WHERE id=$1', [history2556])).value, prior.value);
}));

test('all closure paths reject missing, contradictory or reversed real dates atomically', async () => isolated(async db => {
  const a = await save(db, open());
  const before = await snapshot(db);
  for (const patch of [
    { hora_fin_reparacion: '' }, { fecha_fin_reparacion: '' }, { hora_activacion: '' },
    { fecha_activacion: '' }, { hora_fin_reparacion: '09:59' },
    { resultado: 'seguimiento_abierto' }, { taller_traslado: '' },
    { resultado: 'operativo_reparado', estado_operativo_confirmado: false },
  ]) {
    await assert.rejects(save(db, { ...closeTransfer(), ...patch }, 'test_invalid_close', a.id));
    assert.deepEqual(await snapshot(db), before);
  }
  await assert.rejects(db.query("UPDATE public.activaciones_24h SET estado='cerrada' WHERE id=$1", [a.id]), /resultado y fechas reales/);
  assert.deepEqual(await snapshot(db), before);
}));

test('overnight actual dates are honored and repeated close preserves the T facts', async () => isolated(async db => {
  const p = { ...open(), hora_activacion: '23:50' };
  const a = await save(db, p);
  const done = { ...closeTransfer(), hora_activacion: '23:50', fecha_fin_reparacion: '2026-10-21', hora_fin_reparacion: '00:10' };
  await save(db, done, 'test_overnight', a.id);
  const t = await row(db, `SELECT e.fecha_inicio_real::text AS inicio,e.fecha_fin_real::text AS fin
    FROM public.etapas_hotel e JOIN public.activaciones_24h a ON a.registro_hotel_id=e.registro_hotel_id WHERE a.id=$1`, [a.id]);
  assert.equal(t.inicio, '2026-10-20 21:50:00+00');
  assert.equal(t.fin, '2026-10-20 22:10:00+00');
  await save(db, done, 'test_overnight_repeat', a.id);
  assert.deepEqual(await row(db, `SELECT e.fecha_inicio_real::text AS inicio,e.fecha_fin_real::text AS fin
    FROM public.etapas_hotel e JOIN public.activaciones_24h a ON a.registro_hotel_id=e.registro_hotel_id WHERE a.id=$1`, [a.id]), t);
}));

test('reconciliations preserve explicit extra T and create neither recovery nor workshop stages', async () => isolated(async db => {
  const a = await save(db, open());
  const r = await row(db, 'SELECT registro_hotel_id AS id FROM public.activaciones_24h WHERE id=$1', [a.id]);
  // An explicit editor choice is allowed; it does not authorize a second auto T.
  await db.query("INSERT INTO public.etapas_hotel(registro_hotel_id,nombre,posicion,tipo_etapa,estado) VALUES($1,'Taller explícito',2,'entrada_taller','pendiente')", [r.id]);
  const before = await snapshot(db);
  await db.query('SELECT app_private.manteniment_reconciliar_asistencia_alpha74($1)', [r.id]);
  const reconciled = await row(db, "SELECT app_private.reconciliar_etapas_hotel($1,'test_reconcile_001') AS value", [r.id]);
  assert.equal(reconciled.value.impacto_operativo.recuperaciones_creadas, 0);
  assert.deepEqual(await snapshot(db), before);
}));

test('ambiguous T identity rejects completion and open projections preserve all stage facts', async () => isolated(async db => {
  const a = await save(db, open());
  const r = await row(db, 'SELECT registro_hotel_id AS id FROM public.activaciones_24h WHERE id=$1', [a.id]);
  await db.query("INSERT INTO public.etapas_hotel(registro_hotel_id,nombre,posicion,tipo_etapa,estado,observaciones) VALUES($1,'24H',2,'24H','pendiente','Manual protegido')", [r.id]);
  const stages = (await db.query('SELECT to_jsonb(e) AS value FROM public.etapas_hotel e WHERE registro_hotel_id=$1 ORDER BY posicion', [r.id])).rows;
  await save(db, { ...open(), fecha_activacion: '2026-10-19' }, 'test_ambiguous_open', a.id);
  assert.deepEqual((await db.query('SELECT to_jsonb(e) AS value FROM public.etapas_hotel e WHERE registro_hotel_id=$1 ORDER BY posicion', [r.id])).rows, stages);
  await assert.rejects(save(db, closeTransfer(), 'test_ambiguous_close', a.id), /única T/);
}));

test('explicit recovery remains available and cannot invent completion of an open assistance', async () => isolated(async db => {
  const a = await save(db, open());
  const r = await row(db, 'SELECT registro_hotel_id AS id FROM public.activaciones_24h WHERE id=$1', [a.id]);
  // Explicit/manual recovery scenario with recovery-required modality (legacy).
  await db.query("UPDATE public.registros_hotel SET modalidad_operativa='' WHERE id=$1", [r.id]);
  await db.query("INSERT INTO public.etapas_hotel(registro_hotel_id,nombre,posicion,tipo_etapa,estado,accion_sistema) VALUES($1,'Recuperar ruta y liberar reserva',2,'otro','realizada','recuperar_y_liberar')", [r.id]);
  const actual = await row(db, 'SELECT a.estado,r.estado AS estado_hotel FROM public.activaciones_24h a JOIN public.registros_hotel r ON r.id=a.registro_hotel_id WHERE a.id=$1', [a.id]);
  assert.deepEqual(actual, { estado: 'abierta', estado_hotel: 'recuperado' });
}));

test('permissions, private request storage and trigger-only guards remain restrictive', async () => isolated(async db => {
  const security = await row(db, `SELECT
    has_function_privilege('authenticated','app_private.guardar_activacion_24h(uuid,jsonb,text)','execute') AS may_save,
    has_function_privilege('anon','app_private.guardar_activacion_24h(uuid,jsonb,text)','execute') AS anon_save,
    has_function_privilege('authenticated','app_private.proteger_cierre_24h_paradas002()','execute') AS may_guard,
    has_table_privilege('authenticated','app_private.activacion_24h_peticion_paradas002','select') AS may_read_keys,
    (SELECT relrowsecurity FROM pg_class WHERE oid='app_private.activacion_24h_peticion_paradas002'::regclass) AS rls`);
  assert.deepEqual(security, { may_save: true, anon_save: false, may_guard: false, may_read_keys: false, rls: true });
  for (const [key, value] of [['test.device_allowed', 'false'], ['test.edit_allowed', 'false'], ['test.actor', '']]) {
    await db.query('SELECT set_config($1,$2,false)', [key, value]);
    await assert.rejects(save(db, open(), 'test_permission_denied'), /permiso/);
    await db.query('SELECT set_config($1,$2,false)', [key, key === 'test.actor' ? actor : 'true']);
  }
}));

test('unreviewed function drift fails before any candidate definition or schema change', async () => {
  const { db, before } = await boot({ install: false });
  try {
    await db.exec("CREATE OR REPLACE FUNCTION app_private.asistencia_24h_finalizada_sit001(p_registro_id uuid) RETURNS boolean LANGUAGE sql STABLE SET search_path TO 'pg_catalog','public','app_private' AS $$SELECT false$$");
    await assert.rejects(db.exec(migration), /deriva de función/);
    await db.exec('ROLLBACK');
    assert.deepEqual(await snapshot(db), before);
    assert.equal((await row(db, "SELECT to_regclass('app_private.activacion_24h_peticion_paradas002') AS value")).value, null);
  } finally { await db.close(); }
});

async function reserveWithPendingWork(db, dfm, request) {
  await db.query("INSERT INTO public.reservas_hotel(vehiculo_codigo,estado,pendientes) VALUES($1,'libre','AV24H + MCD')", [dfm]);
  const a = await save(db, open(dfm), request);
  const stage = await row(db, `SELECT e.id,r.id AS registro_id,res.id AS reserva_id FROM public.etapas_hotel e
    JOIN public.activaciones_24h a ON a.registro_hotel_id=e.registro_hotel_id
    JOIN public.registros_hotel r ON r.id=e.registro_hotel_id
    JOIN public.reservas_hotel res ON res.vehiculo_codigo=r.vehiculo_sustituido WHERE a.id=$1`, [a.id]);
  // Explicit synthetic work whose normalized type matches the pending item.
  await db.query("UPDATE public.trabajos_etapa_hotel SET tipo_trabajo='AV24H' WHERE etapa_hotel_id=$1", [stage.id]);
  const resolution = await row(db, `INSERT INTO public.reservas_pendientes_resueltos(reserva_id,pendiente_codigo,etapa_hotel_id)
    VALUES($1,'AV24H',$2) RETURNING id`, [stage.reserva_id, stage.id]);
  await db.query('INSERT INTO app_private.reservas_pendientes_reaperturas(resolucion_id,etapa_hotel_id) VALUES($1,$2)', [resolution.id, stage.id]);
  return a;
}

test('completed transfer/substitution preserve AV24H+MCD pending work and reopened reserve items', async () => isolated(async db => {
  for (const [i, result] of ['trasladado_taller', 'necesita_sustitucion'].entries()) {
    const dfm = `R-AFECTADO-${i}`;
    const a = await reserveWithPendingWork(db, dfm, `test_pending_${i}`);
    const p = { ...closeTransfer(dfm), resultado: result };
    if (result === 'necesita_sustitucion') Object.assign(p, { vehiculo_sustituto: 'R-TEST', matricula_sustituto: 'TEST123' });
    await save(db, p, `test_pending_close_${i}`, a.id);
    assert.equal((await row(db, 'SELECT pendientes FROM public.reservas_hotel WHERE vehiculo_codigo=$1', [dfm])).pendientes, 'AV24H + MCD');
  }
  assert.equal((await row(db, 'SELECT count(*)::int AS n FROM app_private.reservas_pendientes_reaperturas WHERE resuelto_nuevamente_en IS NOT NULL')).n, 0);
}));

test('confirmed repaired24H retains established pending-work resolution; generic maintenance rule is unchanged', async () => isolated(async db => {
  const a = await reserveWithPendingWork(db, 'R-REPARADO', 'test_pending_repaired');
  await save(db, { ...closeTransfer('R-REPARADO'), resultado: 'operativo_reparado', estado_operativo_confirmado: true }, 'test_repaired_close', a.id);
  assert.equal((await row(db, "SELECT pendientes FROM public.reservas_hotel WHERE vehiculo_codigo='R-REPARADO'")).pendientes, 'MCD');
  assert.equal((await row(db, 'SELECT count(*)::int AS n FROM app_private.reservas_pendientes_reaperturas WHERE resuelto_nuevamente_en IS NOT NULL')).n, 1);
}));

test('a new assistance cannot be linked to another PA and an existing event cannot be reassigned', async () => isolated(async db => {
  const a = await save(db, open());
  const r = await row(db, 'SELECT registro_hotel_id,seguimiento_hotel_id FROM public.activaciones_24h WHERE id=$1', [a.id]);
  await assert.rejects(db.query(`INSERT INTO public.activaciones_24h(dfm,registro_hotel_id,seguimiento_hotel_id)
    VALUES('TEST-2554',$1,$2)`, [r.registro_hotel_id, r.seguimiento_hotel_id]), /PA propia/);
  await assert.rejects(db.query('UPDATE public.activaciones_24h SET registro_hotel_id=$1,seguimiento_hotel_id=$2 WHERE id=$3', [history2556, '00000000-0000-4000-8000-000000202556', a.id]), /vínculo original/);
}));

test('closed assistance with explicit pending T leaves raw hotel state t_pendientes and preserves that T', async () => isolated(async db => {
  const a = await save(db, open());
  const r = await row(db, 'SELECT registro_hotel_id AS id FROM public.activaciones_24h WHERE id=$1', [a.id]);
  const manual = await row(db, "INSERT INTO public.etapas_hotel(registro_hotel_id,nombre,posicion,tipo_etapa,estado,observaciones) VALUES($1,'Trámite elegido',2,'tramite','pendiente','Texto manual') RETURNING id", [r.id]);
  await db.query("INSERT INTO public.etapas_hotel(registro_hotel_id,nombre,posicion,tipo_etapa,estado,fecha_inicio_real) VALUES($1,'Entrada anulada conservada',3,'entrada_taller','anulada','2026-10-20 10:30 Europe/Madrid')", [r.id]);
  const before = await row(db, 'SELECT to_jsonb(e) AS value FROM public.etapas_hotel e WHERE id=$1', [manual.id]);
  const result = await save(db, closeTransfer(), 'test_pending_other_t', a.id);
  assert.equal(result.estado, 'cerrada');
  assert.equal(result.estado_hotel, 't_pendientes');
  assert.deepEqual(await row(db, 'SELECT to_jsonb(e) AS value FROM public.etapas_hotel e WHERE id=$1', [manual.id]), before);
}));
