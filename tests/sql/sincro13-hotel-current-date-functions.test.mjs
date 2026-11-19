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
 assert.equal(result.rowCount,1);
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
