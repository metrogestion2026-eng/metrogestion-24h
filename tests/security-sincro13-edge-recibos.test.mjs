import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {stripTypeScriptTypes} from 'node:module';

const edgeSource=await readFile(new URL('../supabase/functions/manteniment-sync-r1/index.ts',import.meta.url),'utf8');
const sharedSource=await readFile(new URL('../supabase/functions/_shared/http-security.ts',import.meta.url),'utf8');
const shared=await import('data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes(sharedSource)).toString('base64'));
const js=stripTypeScriptTypes(edgeSource.replace(/^import[^\n]*\n/gm,''));
const TOKEN='mg_'+'a'.repeat(64);
const SECRET='synthetic-service-key-s13';
const REQUEST='55555555-5555-4555-8555-555555555555';
const WORK='11111111-1111-4111-8111-111111111111';
const ORDER='44444444-4444-4444-8444-444444444444';
const SHEET='sincro13-hoja-sintetica-20261118';
const now=()=>new Date(Date.now()-60_000).toISOString();
function input(){
 return {version_ejecucion:'MG75-EJECUCION-ORDEN-001',spreadsheet_id:SHEET,
  request_id:REQUEST,
  orden:{tipo:'trabajos',sync_id:ORDER,revision:7,payload_sha256:'b'.repeat(64)},
  recibos:[{id_fila:7100,trabajo_sync_id:WORK,creado_en:now(),
   origen:'ORDEN_AUTORIZADA',estado:'PENDIENTE_COTEJO_OBJETO'}]};
}
function result(p=input()){
 return {protocolo:'sincro13-recibos-nuevos-v1',request_id:p.request_id,
  spreadsheet_id:p.spreadsheet_id,recibidos:p.recibos.length,
  estado:'PENDIENTE_VERIFICACION_GOOGLE',autoriza_sincronizar:false};
}
function harness({data,error=null,rpcThrows=false}={}){
 const calls=[];let handler;
 const Deno={serve:f=>{handler=f;},env:{get:k=>k==='SUPABASE_URL'?'https://synthetic.invalid':SECRET}};
 const createClient=(url,key,options)=>{
   assert.equal(url,'https://synthetic.invalid');assert.equal(key,SECRET);
   assert.deepEqual(options,{auth:{persistSession:false,autoRefreshToken:false}});
   return {async rpc(name,params){
     calls.push({name,params:structuredClone(params)});
     if(rpcThrows)throw Error('SECRET: '+TOKEN+SECRET);
     return {data:data??result(),error};
   }};
 };
 new Function('Deno','createClient','BodyError','readJsonObject','Request','Response',js)(
   Deno,createClient,shared.BodyError,shared.readJsonObject,Request,Response);
 assert.equal(typeof handler,'function');
 return {calls,handler};
}
async function call(h,body){
 const req=new Request('https://synthetic.invalid/functions/v1/manteniment-sync-r1',{
  method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
 const response=await h.handler(req);const text=await response.text();
 return {status:response.status,body:JSON.parse(text),text};
}
const body=(p=input())=>({action:'ack_t_nuevas',token:TOKEN,payload:p});
const noSecret=r=>{assert.equal(r.text.includes(TOKEN),false);assert.equal(r.text.includes(SECRET),false);};

test('acusa solo recibos T y nunca llama a sync/ack antiguos',async()=>{
 const p=input(),h=harness({data:result(p)}),r=await call(h,body(p));
 assert.equal(r.status,200);assert.equal(r.body.ok,true);
 assert.equal(r.body.recibos_t.estado,'PENDIENTE_VERIFICACION_GOOGLE');
 assert.equal(r.body.recibos_t.autoriza_sincronizar,false);
 assert.equal(h.calls.length,1);assert.equal(h.calls[0].name,'sincro13_registrar_recibo_t');
 assert.deepEqual(h.calls[0].params,{p_token:TOKEN,p_solicitud:p});noSecret(r);
});
for(const [name,mutate] of [
 ['id_fila inventado',p=>{p.recibos[0].id_fila='7100';}],
 ['columna T no segura',p=>{p.recibos[0].id_fila=0;}],
 ['UUID adicional',p=>{p.recibos[0].dfm='OTRO';}],
 ['fecha anterior al corte',p=>{p.recibos[0].creado_en='2026-11-01T12:00:00.000Z';}],
 ['origen no acreditado',p=>{p.recibos[0].origen='onEdit';}],
 ['recibo duplicado',p=>{p.recibos.push({...p.recibos[0]});}],
 ['orden extra',p=>{p.orden.fila=3;}],
 ['lote vacío',p=>{p.recibos=[];}],
 ['versión incorrecta',p=>{p.version_ejecucion='alpha76';}],
])test('rechaza '+name+' antes de RPC',async()=>{
 const p=input();mutate(p);const h=harness({data:result(p)}),r=await call(h,body(p));
 assert.equal(r.status,400);assert.equal(h.calls.length,0);noSecret(r);
});
test('rechaza campos adicionales en el sobre general',async()=>{
 const h=harness();const b=body();b.confirmaciones=[];
 const r=await call(h,b);assert.equal(r.status,400);assert.equal(h.calls.length,0);
});
test('respuesta que autoriza sincronizar es inválida',async()=>{
 const p=input();const h=harness({data:{...result(p),autoriza_sincronizar:true}});
 const r=await call(h,body(p));assert.equal(r.status,502);noSecret(r);
});
test('respuesta con otro request_id no puede aparentar acuse',async()=>{
 const p=input();const h=harness({data:{...result(p),request_id:'66666666-6666-4666-8666-666666666666'}});
 const r=await call(h,body(p));assert.equal(r.status,502);
});
test('errores internos nunca revelan clave ni confirman',async()=>{
 const p=input();for(const h of [
  harness({error:{code:'23505',message:TOKEN+SECRET}}),
  harness({rpcThrows:true})
 ]){
  const r=await call(h,body(p));assert.notEqual(r.status,200);noSecret(r);
 }
});
test('token inválido corta antes de crear cliente',async()=>{
 const h=harness();const b=body();b.token='bad';
 const r=await call(h,b);assert.equal(r.status,401);assert.equal(h.calls.length,0);
});
