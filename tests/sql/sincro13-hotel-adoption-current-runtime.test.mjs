import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {
  createWorkshopFixture,seedWorkshopScenario,markWorkshopMilestone,
  workshopInventory,currentStage,
} from './workshop-scenarios.mjs';
import {FIXTURE_ACTOR,one,snapshotProtectedFacts} from './local-postgres-harness.mjs';

// No production/staging connection. PostgreSQL17 native (Unix socket) or
// PGlite create a BRAND NEW synthetic database. Actual workshop candidate
// and read-only captured date functions are loaded before S13 adoption.
const SRC=new URL('../../',import.meta.url);
const paths=[
  'tests/sql/fixtures/sincro13-live-date-functions-20261119.sql',
  'tests/sql/fixtures/sincro13-hotel-native-contract.sql',
  'sql/sincro13_k_evidencias_base_20261119.sql',
  'sql/sincro13_aprobacion_operador_k_20261119.sql',
  'sql/sincro13_adopcion_hotel_k_candidato_20261119.sql',
];
let f,db,scenario,evidence,request,workSync,sheetId,result,afterInventory;
before(async()=>{
 f=await createWorkshopFixture();
 db=f.admin;
 for(const p of paths){
  const s=await readFile(new URL(p,SRC),'utf8');
  await db.query(s);
 }
});
after(async()=>{await f?.destroy();});
const trace=async()=>{
 return (await one(db,"SELECT md5(pg_get_functiondef('app_private.manteniment_fechas_desde_etapa()'::regprocedure)) AS value")).value;
};
test('native Hotel trigger is current Supabase-test source, not 2026-11-13 frozen',async()=>{
 assert.equal(await trace(),'2f6e56c1c1b7b5251ea1e32f03ce1c2b');
});

test('prepare one genuine workshop T in isolated fixture, not an old row',async()=>{
 scenario=await seedWorkshopScenario(db,{tag:'S13E2E'});
 const p=scenario;
 await db.query("INSERT INTO public.hotel_edicion_piloto(registro_hotel_id,activo,observaciones) "+
   "VALUES($1,true,'S13 TEST ONLY') ON CONFLICT (registro_hotel_id) DO UPDATE SET activo=true",[p.id]);
 await db.query('INSERT INTO public.vehiculos(id,dfm) VALUES ($1,$2)',[randomUUID(),p.dfm]);
 await markWorkshopMilestone(db,p,'entrada');
 await markWorkshopMilestone(db,p,'terminado');
 const beforePick=await workshopInventory(db,p.id);
 const e=beforePick.etapas.find(v=>v.id===p.entry.id);
 const w=beforePick.propagados.find(v=>v.trabajo_hotel_id===p.work);
 assert.ok(e.fecha_fin_real,'real native workshop milestone set J/finish');
 assert.ok(w.fecha_realizada);
 assert.equal(e.fecha_real,null);
 assert.equal(w.fecha_recogida,null);
 assert.notEqual(e.seguimiento_id,beforePick.ficha.seguimiento_id,
   'stage identity must differ from incident identity');
 workSync=randomUUID();evidence=randomUUID();request=randomUUID();
 await db.query('UPDATE app_private.manteniment_t_trabajos SET sync_id=$1 WHERE trabajo_hotel_id=$2',
   [workSync,p.work]);
 sheetId=(await one(db,'SELECT spreadsheet_id AS value FROM app_private.manteniment_sync_config WHERE id=1')).value;
 assert.ok(sheetId);
 const order=randomUUID(),revision=1,idfila=800001;
 const payload={trabajos_crear:[{
   trabajo_sync_id:workSync,trabajo_hotel_id:p.work,dfm:p.dfm,retener_propuesta:false
 }]};
 await db.query(
 'INSERT INTO app_private.manteniment_entregas_continuidad_alpha75 '+
 '(sync_id,revision,seguimiento_id,tipo,origen,entregado_en,payload) VALUES '+
 '($1,$2,$3,$4,$5,clock_timestamp(),$6::jsonb)',
 [order,revision,beforePick.ficha.seguimiento_id,'trabajos','entrega',JSON.stringify(payload)]);
 await db.query(
 'INSERT INTO app_private.sincro13_recibos_t '+
 '(spreadsheet_id,id_fila,trabajo_sync_id,orden_sync_id,orden_revision,estado,origen,asignado_en) '+
 'VALUES($1,$2,$3,$4,$5,$6,$7,clock_timestamp())',
 [sheetId,idfila,workSync,order,revision,'PENDIENTE_VERIFICACION_GOOGLE','ORDEN_AUTORIZADA']);
 const day=(await one(db,"SELECT (clock_timestamp() AT TIME ZONE 'Europe/Madrid')::date::text AS value")).value;
 const sha='d'.repeat(64);
 await db.query(
  'INSERT INTO app_private.sincro13_k_evidencias '+
  '(evidencia_id,solicitud_id,spreadsheet_id,id_fila,trabajo_sync_id,columna,'+
  'valor_base,valor_nuevo,evento_en,verificado_en,verificador,'+
  'actor_google_verificado,editor_google_acreditado,evidencia_sha256) '+
  "VALUES($1,$2,$3,$4,$5,'K',NULL,$6::date,clock_timestamp()-interval '5 seconds',"+
  "clock_timestamp(),'GOOGLE_INDEPENDIENTE',NULL,false,$7)",
  [evidence,request,sheetId,idfila,workSync,day,sha]);
 await db.query(
  'INSERT INTO app_private.sincro13_aprobaciones_k '+
  '(evidencia_id,solicitud_aprobacion_id,spreadsheet_id,id_fila,trabajo_sync_id,'+
  'evidencia_sha256,valor_base,valor_nuevo,aprobado_por,sesion_id,aprobado_en,caduca_en) '+
  "VALUES($1,$2,$3,$4,$5,$6,NULL,$7::date,$8,$9,clock_timestamp(),clock_timestamp()+interval '5 minutes')",
  [evidence,request,sheetId,idfila,workSync,sha,day,FIXTURE_ACTOR,'aaaaaaaa-0000-4000-8000-000000000001']);
 assert.equal((await currentStage(db,p.entry.id)).fecha_real,null);
});

test('realistic S13 adoption RPC updates ONLY pickup hour, triggers project K and preserve J',async()=>{
 const p=scenario;
 const beforeSnap=await snapshotProtectedFacts(db);
 const beforeWork=await workshopInventory(db,p.id);
 const oldEntry=beforeWork.etapas.find(v=>v.id===p.entry.id);
 const oldWork=beforeWork.propagados.find(v=>v.trabajo_hotel_id===p.work);
 const pickup=(await one(db,"SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC',"+
  "'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') AS value")).value;
 result=(await one(db,
  'SELECT public.sincro13_adoptar_hotel_k($1::uuid,$2::uuid,$3::uuid,$4::integer,$5,$6) AS value',
  [evidence,request,p.entry.id,oldEntry.version,pickup,'CONFIRMO_RECOGIDA_HORA_REAL'])).value;
 assert.equal(result.estado,'ADOPTADA_EN_HOTEL');
 assert.equal(result.escritura_operativa_realizada,true);
 assert.equal(result.editor_google_acreditado,false);
 assert.equal(result.autoriza_sincronizar,false);
 afterInventory=await workshopInventory(db,p.id);
 const current=afterInventory.etapas.find(v=>v.id===p.entry.id);
 const work=afterInventory.propagados.find(v=>v.trabajo_hotel_id===p.work);
 assert.ok(current.fecha_real);
 assert.equal(current.fecha_fin_real,oldEntry.fecha_fin_real);
 assert.equal(current.fecha_inicio_real,oldEntry.fecha_inicio_real);
 assert.equal(current.estado,oldEntry.estado);
 assert.equal(work.fecha_realizada,oldWork.fecha_realizada);
 assert.equal(work.fecha_recogida,result.dia_google);
 assert.equal(afterInventory.reserva.estado,'ocupada');
 assert.deepEqual(afterInventory.documentos,beforeWork.documentos);
 assert.deepEqual(afterInventory.trabajos,beforeWork.trabajos);
 assert.deepEqual(afterInventory.etapas.find(v=>v.id===p.recovery.id),
   beforeWork.etapas.find(v=>v.id===p.recovery.id));
 assert.deepEqual(await snapshotProtectedFacts(db),beforeSnap);
});

test('idempotent replay cannot change time or version or touch unrelated work',async()=>{
 const p=scenario;
 const before=await workshopInventory(db,p.id);
 const state=before.etapas.find(v=>v.id===p.entry.id);
 const receipt=(await one(db,'SELECT * FROM app_private.sincro13_adopciones_hotel_k WHERE evidencia_id=$1',
  [evidence]));
 const reply=(await one(db,
  'SELECT public.sincro13_adoptar_hotel_k($1,$2,$3,$4,$5,$6) AS value',
  [evidence,request,p.entry.id,receipt.etapa_version_antes,
   new Date(receipt.fecha_hora_recogida).toISOString(),'CONFIRMO_RECOGIDA_HORA_REAL'])).value;
 assert.equal(reply.estado,'ADOPTADA_EN_HOTEL');
 assert.equal((await currentStage(db,p.entry.id)).version,state.version);
 assert.deepEqual(await workshopInventory(db,p.id),before);
});
