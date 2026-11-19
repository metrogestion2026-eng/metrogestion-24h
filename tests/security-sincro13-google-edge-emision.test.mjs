import test from 'node:test';
import assert from 'node:assert/strict';
import {crearHandlerGoogleK} from '../supabase/functions/_shared/sincro13-google-k-edge.mjs';
const UUID='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const NONCE='11111111-1111-4111-8111-111111111111';
const PROOF='99999999-9999-4999-8999-999999999999';
const SHEET='sincro13_hoja_ficticia_20261119';
const jwt='Bearer '+'a'.repeat(80);
function setup({on=true,noSecret=false,sqlFails=false,sqlWrong=false,googleWrong=false}={}){
 const calls={auth:0,google:0,sql:[]};
 const vars={
  S13_GOOGLE_READER_ENABLED:'true',
  S13_GOOGLE_EVIDENCE_ENABLED:on?'true':'false',
  S13_GOOGLE_SPREADSHEET_ID:SHEET,
  S13_GOOGLE_SERVICE_ACCOUNT_JSON:'synthetic-service-account',
  S13_GOOGLE_VERIFIER_SECRET:noSecret?'':'s13g_'+'1'.repeat(64),
  SUPABASE_URL:'https://synthetic.supabase.co',
  SUPABASE_ANON_KEY:'synthetic-public-key',
  SUPABASE_SERVICE_ROLE_KEY:'synthetic-service-role-key'
 };
 const createClient=(url,key,options)=>{
  assert.equal(url,'https://synthetic.supabase.co');
  if(key==='synthetic-public-key')return {
   auth:{getUser:async()=>{calls.auth++;return {data:{user:{id:'88888888-8888-4888-8888-888888888888'}},error:null};}},
   rpc:async()=>({data:true,error:null})
  };
  assert.equal(key,'synthetic-service-role-key');
  assert.equal(options.auth.persistSession,false);
  return {rpc:async(name,args)=>{
   calls.sql.push({name,args});
   if(sqlFails)return {data:null,error:{code:'S13_NO_AUTORIZADA'}};
   return {data:{protocolo:'sincro13-evidencia-k-v1',
     estado:'PENDIENTE_ADOPCION',evidencia_id:PROOF,
     solicitud_id:args.p_lectura.solicitud_id,
     id_fila:sqlWrong?800002:args.p_lectura.id_fila,
     trabajo_sync_id:args.p_lectura.trabajo_sync_id,
     valor_base:null,valor_nuevo:args.p_lectura.valor_nuevo,
     evidencia_sha256:'c'.repeat(64),
     autoriza_sincronizar:false},error:null};
  }};
 };
 const fn=crearHandlerGoogleK({
  createClient,env:{get:n=>vars[n]},
  fetcher:async()=>{throw Error('no fetch in this isolated mock');},
  obtenerToken:async()=> 'synthetic-google-token',
  cotejar:async()=>{
   calls.google++;
   return {protocolo:'sincro13-google-k-lectura-v1',
     estado:'COTEJO_T_K_SIN_AUTORIA',
     origen:'GOOGLE_SHEETS_API_SOLO_LECTURA',
     id_fila:googleWrong?800002:800001,
     trabajo_sync_id:UUID,columna:'K',valor_nuevo:'2026-11-19',
     lecturas_independientes:2,actor_editor_acreditado:false,
     autoriza_sincronizar:false};
  }
 });
 async function request(body){
  const r=await fn(new Request('https://synthetic.invalid/functions/v1/sincro13-google-lector',{
   method:'POST',headers:{'content-type':'application/json','authorization':jwt},
   body:JSON.stringify(body)
  }));
  return {status:r.status,result:await r.json()};
 }
 return {calls,request};
}
const body=()=>({id_fila:800001,trabajo_sync_id:UUID,solicitud_id:NONCE});
test('emisión desactivada: no acepta solicitud con nonce y no llama SQL',async()=>{
 const h=setup({on:false}),r=await h.request(body());
 assert.equal(r.status,400);assert.equal(h.calls.sql.length,0);
});
test('emisión activada: sin nonce no lee Google ni toca SQL',async()=>{
 const h=setup(),r=await h.request({id_fila:800001,trabajo_sync_id:UUID});
 assert.equal(r.status,400);assert.equal(h.calls.google,0);assert.equal(h.calls.sql.length,0);
});
test('no se admite K proporcionada por cliente',async()=>{
 const h=setup(),r=await h.request({...body(),valor_nuevo:'2026-12-25'});
 assert.equal(r.status,400);assert.equal(h.calls.google,0);assert.equal(h.calls.sql.length,0);
});
test('dos lecturas de Google → SOLO evidencia pendiente en SQL',async()=>{
 const h=setup(),r=await h.request(body());
 assert.equal(r.status,200);
 assert.equal(r.result.lectura.valor_nuevo,'2026-11-19');
 assert.equal(r.result.evidencia.estado,'PENDIENTE_ADOPCION');
 assert.equal(r.result.evidencia.escritura_realizada,false);
 assert.equal(r.result.evidencia.autoriza_sincronizar,false);
 assert.equal(h.calls.google,1);assert.equal(h.calls.sql.length,1);
 const rpc=h.calls.sql[0];
 assert.equal(rpc.name,'sincro13_recibir_lectura_google_k');
 assert.equal(rpc.args.p_clave,'s13g_'+'1'.repeat(64));
 assert.equal(rpc.args.p_lectura.id_fila,800001);
 assert.equal(rpc.args.p_lectura.valor_nuevo,'2026-11-19');
 assert.equal(rpc.args.p_lectura.lecturas_independientes,2);
 assert.equal(rpc.args.p_lectura.editor_google_acreditado,false);
 assert.equal(rpc.args.p_lectura.escritura_realizada,false);
 assert.equal(rpc.args.p_lectura.solicitud_id,NONCE);
 assert.match(rpc.args.p_lectura.observado_en,/^\d{4}-\d{2}-\d{2}T/);
 assert.doesNotMatch(JSON.stringify(r.result),/s13g_|synthetic-service-role/);
});
test('secreto verificador ausente: lector no registra evidencia',async()=>{
 const h=setup({noSecret:true}),r=await h.request(body());
 assert.equal(r.status,503);assert.equal(h.calls.sql.length,0);
});
test('RPC falla: nunca se declara una evidencia recibida',async()=>{
 const h=setup({sqlFails:true}),r=await h.request(body());
 assert.equal(r.status,502);assert.equal(r.result.motivo,'EVIDENCIA_NO_REGISTRADA');
});
test('RPC devuelve T contradictoria: bloquear evidencia',async()=>{
 const h=setup({sqlWrong:true}),r=await h.request(body());
 assert.equal(r.status,502);assert.equal(r.result.motivo,'EVIDENCIA_NO_VERIFICABLE');
});
test('Google devuelve otra T: no llega a RPC',async()=>{
 const h=setup({googleWrong:true}),r=await h.request(body());
 assert.equal(r.status,409);assert.equal(h.calls.sql.length,0);
});
