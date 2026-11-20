import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {
  createWorkshopFixture,seedWorkshopScenario,markWorkshopMilestone,
  workshopInventory,
} from './workshop-scenarios.mjs';
import {FIXTURE_ACTOR,one,snapshotProtectedFacts} from './local-postgres-harness.mjs';
import {cotejarGoogleKDosLecturas} from '../../supabase/functions/_shared/sincro13-google-k-readonly.mjs';

/**
 * CROSS-SYSTEM LAB (strictly synthetic):
 * Google GridData -> two independent GET reads -> SQL Google receipt ->
 * authenticated adoption -> REAL-CAPTURED Hotel triggers -> K technical.
 *
 * No Google credentials, no operational book, no network, no Supabase project.
 */
const ROOT=new URL('../../',import.meta.url);
const REQUIRED_NATIVE=Boolean(process.env.METROGESTION_LOCAL_PG_DSN);
const files=[
  'tests/sql/fixtures/sincro13-live-date-functions-20261119.sql',
  'tests/sql/fixtures/sincro13-hotel-audit-prerequisites.sql',
  'tests/sql/fixtures/sincro13-live-four-trigger-functions-20261119.sql',
  'tests/sql/fixtures/sincro13-live-ficha-trigger-functions-20261119.sql',
  'tests/sql/fixtures/sincro13-ficha-trigger-prerequisites.sql',
  'tests/sql/fixtures/sincro13-hotel-native-contract.sql',
  'sql/sincro13_k_evidencias_base_20261119.sql',
  'sql/sincro13_google_lectura_receptor_20261119.sql',
  'sql/sincro13_aprobacion_operador_k_20261119.sql',
  'sql/sincro13_adopcion_hotel_k_candidato_20261119.sql',
];
const SECRET='s13g_'+'0'.repeat(64);
const BOOK='SINCRO13_LAB_20NOV_2026_SHEET';
const ID_FILA=800001;
const toCell=x=>({formattedValue:String(x)});
let f,db,scenario,workSync,order,request,sheet,proof,day,snapshot,technicalBefore;
let reads=0;
before(async()=>{
 if(!REQUIRED_NATIVE)return;
 f=await createWorkshopFixture({native:true});
 db=f.admin;
 await db.query('CREATE SCHEMA IF NOT EXISTS extensions');
 await db.query('CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions');
 for(const path of files)await db.query(await readFile(new URL(path,ROOT),'utf8'));
});
after(async()=>{await f?.destroy()});
const labTest=(name,fn)=>test(name,{skip:!REQUIRED_NATIVE},fn);
function gridDocument(workId,dfm,dayIso,broken=false){
 const [y,m,d]=dayIso.split('-');
 const dateFmt=[d,m,y].join('/');
 const serial=Math.round((Date.UTC(+y,+m-1,+d)-Date.UTC(1899,11,30))/86400000);
 const cell=(v)=>({values:[v]});
 const segment=(c,values)=>({startRow:1,startColumn:c,rowData:values.map(cell)});
 return {
  spreadsheetId:BOOK,
  properties:{locale:'ca_ES',timeZone:'Europe/Madrid'},
  sheets:[
   {properties:{title:'MANTENIMENT',gridProperties:{rowCount:2,columnCount:26}},data:[
    segment(0,[toCell(dfm)]),
    segment(4,[{note:'METROGESTION_T:'+workId.toLowerCase()}]),
    segment(7,[toCell('AV')]),
    segment(10,[{formattedValue:dateFmt,effectiveValue:{numberValue:serial},
      userEnteredValue:{numberValue:serial}}]),
    segment(19,[{formattedValue:String(broken?ID_FILA+1:ID_FILA),
      userEnteredValue:{numberValue:broken?ID_FILA+1:ID_FILA}}])
   ]},
   {properties:{title:'REGISTRO_FILAS',gridProperties:{rowCount:2,columnCount:8}},data:[
    {startRow:1,startColumn:0,rowData:[{values:[
      toCell(ID_FILA),toCell('ACTIVA'),toCell(dateFmt+' 00:01'),
      {},toCell('ORDEN_AUTORIZADA')
    ]}]}
   ]}
  ]
 };
}
async function google2Read(docA,docB=docA) {
 const data=[docA,docB];
 let i=0;
 const fetcher=async(url,options)=>{
  assert.equal(options.method,'GET');
  assert.equal(options.redirect,'error');
  assert.match(url,/^https:\/\/sheets\.googleapis\.com\/v4\/spreadsheets\//);
  const val=data[Math.min(i++,data.length-1)];
  reads++;
  return {status:200,headers:{get:k=>k==='content-type'?'application/json':null},
    text:async()=>JSON.stringify(val)};
 };
 return cotejarGoogleKDosLecturas({fetcher,accessToken:'synthetic-readonly-oauth-token',
  spreadsheetId:BOOK,id_fila:ID_FILA,trabajo_sync_id:workSync});
}
labTest('setup workshop T in NEW native PG17 fixture and exact T receipt (no historical rows)',async()=>{
 scenario=await seedWorkshopScenario(db,{tag:'S13_GOOGLE_HOTEL_CHAIN'});
 await db.query("INSERT INTO public.hotel_edicion_piloto(registro_hotel_id,activo,observaciones) "+
   "VALUES($1,true,'S13 SYNTHETIC E2E') ON CONFLICT(registro_hotel_id) DO UPDATE SET activo=true",
   [scenario.id]);
 await db.query('INSERT INTO public.vehiculos(id,dfm) VALUES($1,$2)',[randomUUID(),scenario.dfm]);
 await markWorkshopMilestone(db,scenario,'entrada');
 await markWorkshopMilestone(db,scenario,'terminado');
 const s=await workshopInventory(db,scenario.id);
 snapshot=await snapshotProtectedFacts(db);
 assert.equal(s.etapas.find(e=>e.id===scenario.entry.id).fecha_real,null);
 technicalBefore=s.propagados.find(w=>w.trabajo_hotel_id===scenario.work);
 assert.equal(technicalBefore.fecha_recogida,null);
 assert.ok(technicalBefore.fecha_realizada);
 workSync=randomUUID();
 order=randomUUID();request=randomUUID();
 day=(await one(db,"SELECT (clock_timestamp() AT TIME ZONE 'Europe/Madrid')::date::text AS value")).value;
 await db.query("UPDATE app_private.manteniment_sync_config SET spreadsheet_id=$1 WHERE id=1",[BOOK]);
 await db.query('UPDATE app_private.manteniment_t_trabajos SET sync_id=$1 WHERE trabajo_hotel_id=$2',
    [workSync,scenario.work]);
 await db.query('INSERT INTO app_private.manteniment_entregas_continuidad_alpha75 '+
   '(sync_id,revision,seguimiento_id,tipo,origen,entregado_en,payload) '+
   "VALUES($1,1,$2,'trabajos','entrega',clock_timestamp(),$3::jsonb)",
   [order,s.ficha.seguimiento_id,JSON.stringify({trabajos_crear:[{
      trabajo_sync_id:workSync,trabajo_hotel_id:scenario.work,
      dfm:scenario.dfm,retener_propuesta:false
   }]})]);
 await db.query('INSERT INTO app_private.sincro13_recibos_t('+
   'spreadsheet_id,id_fila,trabajo_sync_id,orden_sync_id,orden_revision,estado,origen,asignado_en)'+
   "VALUES($1,$2,$3,$4,1,'PENDIENTE_VERIFICACION_GOOGLE','ORDEN_AUTORIZADA',clock_timestamp())",
   [BOOK,ID_FILA,workSync,order]);
 // Test database ONLY, never run against connected Supabase:
 await db.query('UPDATE app_private.sincro13_verificador_config SET habilitado=true,'+
   " secreto_sha256=encode(extensions.digest($1,'sha256'),'hex') WHERE id=1",[SECRET]);
 sheet=gridDocument(workSync,scenario.dfm,day);
 assert.equal((await one(db,
    'SELECT count(*)::int AS value FROM app_private.sincro13_k_evidencias')).value,0);
});

labTest('two distinct Google readbacks find current K by T and reject stale duplicate before SQL',async()=>{
 const ok=await google2Read(sheet);
 assert.equal(ok.estado,'COTEJO_T_K_SIN_AUTORIA');
 assert.equal(ok.valor_nuevo,day);
 assert.equal(ok.id_fila,ID_FILA);
 assert.equal(ok.trabajo_sync_id,workSync.toLowerCase());
 assert.equal(ok.actor_editor_acreditado,false);
 assert.equal(ok.autoriza_sincronizar,false);
 assert.equal(ok.lecturas_independientes,2);
 const changed=structuredClone(sheet);
 changed.sheets[0].data[4].rowData[0].values[0].formattedValue=String(ID_FILA+1);
 changed.sheets[0].data[4].rowData[0].values[0].userEnteredValue.numberValue=ID_FILA+1;
 const blocked=await google2Read(sheet,changed);
 assert.equal(blocked.estado,'RETENER_SIN_ESCRIBIR');
 assert.equal(blocked.motivo,'T_NO_EXISTE');
 assert.equal((await one(db,
    'SELECT count(*)::int AS value FROM app_private.sincro13_k_evidencias')).value,0);
});

labTest('server independently records K observation, not an invented editor or base date',async()=>{
 const observed=await google2Read(sheet);
 const payload={
  protocolo:observed.protocolo,solicitud_id:request,
  spreadsheet_id:BOOK,id_fila:observed.id_fila,
  trabajo_sync_id:observed.trabajo_sync_id,columna:'K',
  valor_nuevo:observed.valor_nuevo,observado_en:new Date().toISOString(),
  lecturas_independientes:2,editor_google_acreditado:false,
  escritura_realizada:false
 };
 proof=(await one(db,
   'SELECT public.sincro13_recibir_lectura_google_k($1,$2::jsonb) AS value',
   [SECRET,JSON.stringify(payload)])).value;
 assert.equal(proof.estado,'PENDIENTE_ADOPCION');
 assert.equal(proof.valor_base,null);
 assert.equal(proof.valor_nuevo,day);
 assert.equal(proof.id_fila,ID_FILA);
 assert.match(proof.evidencia_sha256,/^[0-9a-f]{64}$/);
 assert.equal(proof.editor_google_acreditado,false);
 assert.equal((await one(db,
    'SELECT actor_google_verificado AS value FROM app_private.sincro13_k_evidencias WHERE evidencia_id=$1',
    [proof.evidencia_id])).value,null);
 assert.deepEqual(await snapshotProtectedFacts(db),snapshot);
 const before=await workshopInventory(db,scenario.id);
 assert.equal(before.etapas.find(e=>e.id===scenario.entry.id).fecha_real,null);
 assert.equal(before.propagados.find(w=>w.trabajo_hotel_id===scenario.work).fecha_recogida,null);
});

labTest('without administrator adoption, changing Hotel is denied without effects',async()=>{
 const inventory=await workshopInventory(db,scenario.id);
 const e=inventory.etapas.find(e=>e.id===scenario.entry.id);
 const pickup=new Date().toISOString();
 await assert.rejects(()=>db.query(
  'SELECT public.sincro13_adoptar_hotel_k($1,$2,$3,$4,$5,$6)',
  [proof.evidencia_id,request,scenario.entry.id,e.version,pickup,'CONFIRMO_RECOGIDA_HORA_REAL']),
  /S13_HOTEL_K_SIN_ADOPCION_EXPLICITA/);
 assert.deepEqual(await workshopInventory(db,scenario.id),inventory);
});

labTest('authenticated administrator adopts exact evidence, preserving unknown Google editor',async()=>{
 const contrast={
  id_fila:ID_FILA,trabajo_sync_id:workSync.toLowerCase(),columna:'K',
  valor_base:null,valor_nuevo:day,evidencia_sha256:proof.evidencia_sha256
 };
 const approved=(await one(db,
   'SELECT public.sincro13_aprobar_correccion_k($1::uuid,$2::uuid,$3::jsonb,$4) AS value',
   [proof.evidencia_id,request,JSON.stringify(contrast),
     'ADOPTO_CORRECCION_K_VERIFICADA'])).value;
 assert.equal(approved.estado,'APROBADA');
 assert.equal(approved.adopcion_expresa,true);
 assert.equal(approved.edicion_original_atribuida,false);
 assert.equal(approved.aprobada_por,FIXTURE_ACTOR);
 assert.equal((await one(db,
   'SELECT count(*)::int AS value FROM app_private.sincro13_adopciones_hotel_k')).value,0);
});

labTest('full Google → evidence → adoption → Hotel triggers → K, never overwrite J',async()=>{
 const before=await workshopInventory(db,scenario.id);
 const entry=before.etapas.find(e=>e.id===scenario.entry.id);
 const realHour=(await one(db,"SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC',"+
  "'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') AS value")).value;
 const resp=(await one(db,
   'SELECT public.sincro13_adoptar_hotel_k($1,$2,$3,$4,$5,$6) AS value',
   [proof.evidencia_id,request,scenario.entry.id,entry.version,realHour,
    'CONFIRMO_RECOGIDA_HORA_REAL'])).value;
 assert.equal(resp.estado,'ADOPTADA_EN_HOTEL');
 assert.equal(resp.editor_google_acreditado,false);
 assert.equal(resp.autoriza_sincronizar,false);
 assert.equal(resp.dia_google,day);
 const after=await workshopInventory(db,scenario.id);
 const actual=after.etapas.find(e=>e.id===scenario.entry.id);
 assert.ok(actual.fecha_real);
 assert.equal(actual.estado,'realizada');
 assert.equal(actual.fecha_inicio_real,entry.fecha_inicio_real);
 assert.equal(actual.fecha_fin_real,entry.fecha_fin_real);
 assert.equal(after.ficha.estado,'recogido_pendiente_ruta');
 assert.equal(after.reserva.estado,'ocupada');
 assert.equal(after.propagados.find(w=>w.trabajo_hotel_id===scenario.work).fecha_recogida,day);
 assert.equal(after.propagados.find(w=>w.trabajo_hotel_id===scenario.work).fecha_realizada,
   technicalBefore.fecha_realizada,'J is not overwritten');
 assert.deepEqual(after.documentos,before.documentos);
 assert.deepEqual(after.trabajos,before.trabajos);
 assert.deepEqual(after.etapas.find(e=>e.id===scenario.recovery.id),
   before.etapas.find(e=>e.id===scenario.recovery.id));
 assert.deepEqual(await snapshotProtectedFacts(db),snapshot);
 const events=await one(db,
   'SELECT count(*)::int AS value FROM app_private.sincro13_adopciones_hotel_k WHERE evidencia_id=$1',
   [proof.evidencia_id]);
 assert.equal(events.value,1);
});

labTest('same request replay returns receipt without a second Hotel edit',async()=>{
 const before=await workshopInventory(db,scenario.id);
 const receipt=await one(db,
  'SELECT * FROM app_private.sincro13_adopciones_hotel_k WHERE evidencia_id=$1',
  [proof.evidencia_id]);
 const res=(await one(db,
  'SELECT public.sincro13_adoptar_hotel_k($1,$2,$3,$4,$5,$6) AS value',
  [proof.evidencia_id,request,scenario.entry.id,receipt.etapa_version_antes,
   new Date(receipt.fecha_hora_recogida).toISOString(),'CONFIRMO_RECOGIDA_HORA_REAL'])).value;
 assert.equal(res.estado,'ADOPTADA_EN_HOTEL');
 assert.deepEqual(await workshopInventory(db,scenario.id),before);
 assert.equal((await one(db,'SELECT count(*)::int AS value FROM app_private.sincro13_k_evidencias')).value,1);
 assert.ok(reads>=6,'readback and instability tests must actually execute');
});
