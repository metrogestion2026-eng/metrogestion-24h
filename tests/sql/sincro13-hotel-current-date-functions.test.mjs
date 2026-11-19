import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {
  createWorkshopFixture,seedWorkshopScenario,markWorkshopMilestone,
  workshopInventory,currentStage,
} from './workshop-scenarios.mjs';
import {FIXTURE_ACTOR,one,snapshotProtectedFacts} from './local-postgres-harness.mjs';

// Two functions captured READ-ONLY from the connected Supabase TEST project.
// Run only inside a NEW synthetic PostgreSQL fixture. Never remote.
const RUNTIME=new URL('./fixtures/sincro13-live-date-functions-20261119.sql',import.meta.url);
const MD5_DATES='2f6e56c1c1b7b5251ea1e32f03ce1c2b';
const MD5_STAGE='56c386d5c8f2a186ba10bea5c82d9cf4';
let f,db,protectedAtStart;

before(async()=>{
 f=await createWorkshopFixture();
 db=f.admin;
 protectedAtStart=await snapshotProtectedFacts(db);
 const source=await readFile(RUNTIME,'utf8');
 assert.match(source,/CREATE OR REPLACE FUNCTION app_private\.manteniment_fechas_desde_etapa\(\)/i);
 assert.match(source,/CREATE OR REPLACE FUNCTION app_private\.manteniment_etapa_actual\(/i);
 await db.query(source);
 await db.query(await readFile(new URL('./fixtures/sincro13-hotel-audit-prerequisites.sql',import.meta.url),'utf8'));
 await db.query(await readFile(new URL('./fixtures/sincro13-live-four-trigger-functions-20261119.sql',import.meta.url),'utf8'));
 await db.query(await readFile(new URL('./fixtures/sincro13-live-ficha-trigger-functions-20261119.sql',import.meta.url),'utf8'));
 await db.query(await readFile(new URL('./fixtures/sincro13-ficha-trigger-prerequisites.sql',import.meta.url),'utf8'));
 assert.deepEqual(await snapshotProtectedFacts(db),protectedAtStart,
   'Loading live FUNCTION definitions must not touch frozen historical facts');
});
after(async()=>{await f?.destroy();});

test('captured function definitions match live Supabase test runtime',async()=>{
 const r=await one(db,
  "SELECT md5(pg_get_functiondef('app_private.manteniment_fechas_desde_etapa()'::regprocedure)) AS fecha_md5, "+
  "md5(pg_get_functiondef('app_private.manteniment_etapa_actual(uuid,uuid)'::regprocedure)) AS etapa_md5, "+
  "(SELECT count(*)::int FROM pg_trigger WHERE tgrelid='public.etapas_hotel'::regclass "+
  "AND NOT tgisinternal) AS triggers_de_hotel");
 assert.equal(r.fecha_md5,MD5_DATES);
 assert.equal(r.etapa_md5,MD5_STAGE);
 assert.ok(r.triggers_de_hotel>=10,'No es suficiente un único trigger sintético');
});

test('inventory checks 43 Hotel trigger names, function SHA and trigger definitions',async t=>{
 const manifest=JSON.parse(await readFile(
  new URL('./fixtures/sincro13-hotel-trigger-inventory-20261119.json',import.meta.url),'utf8'));
 assert.equal(manifest.counts.etapas,25);
 assert.equal(manifest.counts.registros,18);
 async function actualTable(table) {
  const rows=(await db.query(
   "SELECT t.tgname, "+
   "encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex') AS body_sha256, "+
   "encode(sha256(convert_to(pg_get_triggerdef(t.oid),'UTF8')),'hex') AS trigger_sha256 "+
   "FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid "+
   "WHERE NOT t.tgisinternal AND t.tgrelid=$1::regclass",
   ['public.'+table]
  )).rows;
  return new Map(rows.map(r=>[r.tgname,r]));
 }
 const stages=await actualTable('etapas_hotel');
 const records=await actualTable('registros_hotel');
 function compare(expected,actual) {
  return {
   missing:expected.filter(x=>!actual.has(x.trigger)).map(x=>x.trigger),
   body:expected.filter(x=>actual.has(x.trigger)
    && actual.get(x.trigger).body_sha256!==x.sha256).map(x=>x.trigger),
   timing:expected.filter(x=>actual.has(x.trigger)
    && actual.get(x.trigger).trigger_sha256!==x.trigger_sql_sha256).map(x=>x.trigger),
   extra:[...actual.keys()].filter(k=>!expected.some(e=>e.trigger===k))
  };
 }
 const e=compare(manifest.etapas,stages);
 const r=compare(manifest.fichas,records);
 const fullParity=[e,r].every(x=>!x.missing.length&&!x.body.length
   &&!x.timing.length&&!x.extra.length);
 t.diagnostic(JSON.stringify({
   tipo:'S13_PARIDAD_43_TRIGGERS_CODIGO_Y_ACTIVACION',
   etapas_reales:25,etapas_fixture:stages.size,
   fichas_reales:18,fichas_fixture:records.size,
   etapa_nombres_ausentes:e.missing,
   etapa_cuerpos_diferentes:e.body,
   etapa_definiciones_trigger_diferentes:e.timing,
   etapa_sobrantes:e.extra,
   ficha_nombres_ausentes:r.missing,
   ficha_cuerpos_diferentes:r.body,
   ficha_definiciones_trigger_diferentes:r.timing,
   ficha_sobrantes:r.extra,
   paridad_completa_verificada:fullParity,
   no_equivale_a_probar_todos_los_efectos:true
 }));
 assert.ok(stages.has('etapas_hotel_manteniment_fechas'));
 assert.equal(e.missing.length,0,'Ningún trigger de T debe faltar en el laboratorio');
 assert.equal(r.missing.length,0,'Ningún trigger de ficha debe faltar en el laboratorio');
});

test('T has its own seguimiento, while ficha and technical work share episode',async()=>{
 const oldProtected=await snapshotProtectedFacts(db);
 const p=await seedWorkshopScenario(db,{tag:'S13ID'});
 assert.deepEqual(await snapshotProtectedFacts(db),oldProtected,
   'Creating a synthetic identity scenario must not update protected rows');
 const sql="SELECT e.seguimiento_id AS t, r.seguimiento_id AS ficha, "+
 "w.seguimiento_id AS catalogo, e.registro_hotel_id AS registro, "+
 "w.trabajo_hotel_id AS trabajo, h.etapa_hotel_id AS etapa_trabajo "+
 "FROM app_private.manteniment_t_trabajos w "+
 "JOIN public.trabajos_etapa_hotel h ON h.id=w.trabajo_hotel_id "+
 "JOIN public.etapas_hotel e ON e.id=h.etapa_hotel_id "+
 "JOIN public.registros_hotel r ON r.id=e.registro_hotel_id "+
 "WHERE e.id=$1";
 const r=await one(db,sql,[p.entry.id]);
 assert.notEqual(r.t,r.ficha);
 assert.equal(r.ficha,r.catalogo);
 assert.equal(r.registro,p.id);
 assert.equal(r.trabajo,p.work);
 assert.equal(r.etapa_trabajo,p.entry.id);
 const other=await currentStage(db,p.recovery.id);
 assert.equal(other.registro_hotel_id,p.id);
 assert.notEqual(other.seguimiento_id,r.ficha);
});

test('current date trigger projects K from pickup, never overwrites J',async()=>{
 const previous=await snapshotProtectedFacts(db);
 const p=await seedWorkshopScenario(db,{tag:'S13K'});
 assert.deepEqual(await snapshotProtectedFacts(db),previous,
   'Synthetic workshop scenario setup must not change frozen facts');
 await markWorkshopMilestone(db,p,'entrada');
 assert.deepEqual(await snapshotProtectedFacts(db),previous,
   'Workshop entry cannot update other protected episodes');
 await markWorkshopMilestone(db,p,'terminado');
 assert.deepEqual(await snapshotProtectedFacts(db),previous,
   'Workshop finishing cannot update other protected episodes');
 const before=await workshopInventory(db,p.id);
 const entry=before.etapas.find(x=>x.id===p.entry.id);
 const recovery=before.etapas.find(x=>x.id===p.recovery.id);
 const prior=before.propagados.find(x=>x.trabajo_hotel_id===p.work);
 assert.ok(entry.fecha_fin_real);
 assert.equal(entry.fecha_real,null);
 assert.ok(prior.fecha_realizada);
 assert.equal(prior.fecha_recogida,null);
 const result=await db.query(
  'UPDATE public.etapas_hotel SET fecha_real=clock_timestamp(),modificado_por=$2 '+
  'WHERE id=$1 AND version=$3 RETURNING id,version,fecha_real,fecha_fin_real,estado',
  [p.entry.id,FIXTURE_ACTOR,entry.version]);
 assert.equal(result.rows.length,1,'La UPDATE debe devolver exactamente la T afectada');
 assert.deepEqual(await snapshotProtectedFacts(db),previous,
   'Changing one synthetic T pickup must not rewrite another episode');
 const after=await workshopInventory(db,p.id);
 const current=after.etapas.find(x=>x.id===p.entry.id);
 const projected=after.propagados.find(x=>x.trabajo_hotel_id===p.work);
 const day=(await one(db,
  "SELECT ($1::timestamptz AT TIME ZONE 'Europe/Madrid')::date::text AS value",
  [current.fecha_real])).value;
 assert.equal(projected.fecha_recogida,day);
 assert.equal(projected.fecha_realizada,prior.fecha_realizada);
 assert.equal(current.fecha_fin_real,entry.fecha_fin_real);
 assert.equal(current.fecha_inicio_real,entry.fecha_inicio_real);
 assert.equal(current.estado,entry.estado);
 assert.deepEqual(after.documentos,before.documentos);
 assert.deepEqual(after.trabajos,before.trabajos);
 assert.deepEqual(after.etapas.find(x=>x.id===p.recovery.id),recovery);
 assert.equal(after.reserva.estado,'ocupada');
});

test('the fixture was clean before any S13 read or stage mutation',async()=>{
 assert.deepEqual(await snapshotProtectedFacts(db),protectedAtStart,
   'The new test must not change protected rows outside its scenarios');
});
