import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,createPublicKey,generateKeyPairSync,verify as verifySignature,webcrypto} from 'node:crypto';
import {obtenerGoogleTokenSoloLectura,S13_GOOGLE_OAUTH_SCOPE}
 from '../supabase/functions/_shared/sincro13-google-oauth-readonly.mjs';
import {crearHandlerGoogleK}
 from '../supabase/functions/_shared/sincro13-google-k-edge.mjs';
import {S13_GOOGLE_K_VERSION}
 from '../supabase/functions/_shared/sincro13-google-k-readonly.mjs';

const GOOGLE_TOKEN='synthetic-google-readonly-token';
const SHEET='sincro13_hoja_ficticia_20261119';
const UUID='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SUB='88888888-8888-4888-8888-888888888888';
const JWT='Bearer '+'a'.repeat(80);
function env(input={}){
 const all={
  S13_GOOGLE_READER_ENABLED:'true',
  SUPABASE_URL:'https://example.supabase.co',
  SUPABASE_ANON_KEY:'synthetic-public-key',
  S13_GOOGLE_SPREADSHEET_ID:SHEET,
  S13_GOOGLE_SERVICE_ACCOUNT_JSON:'synthetic-server-secret',
  ...input};
 return {get:key=>all[key]};
}
function handler({enabled=true,validUser=true,permission=true,allowedReader=true,
  userThrows=false,readerThrows=false,settings={}}={}){
 const calls={users:0,rpcs:[],tokens:0,google:0};
 const createClient=(url,key,options)=>{
   assert.equal(url,'https://example.supabase.co');
   assert.equal(key,'synthetic-public-key');
   assert.equal(options.global.headers.Authorization,JWT);
   return {
     auth:{getUser:async()=>{calls.users++;if(userThrows)throw Error('secret dangerous');
       return validUser?{data:{user:{id:SUB}},error:null}:{data:{user:null},error:{message:'bad token'}};}},
     rpc:async name=>{calls.rpcs.push(name);return {data:permission,error:null};}
   };
 };
 const cotejar=async args=>{
   calls.google++;
   assert.equal(args.spreadsheetId,SHEET);
   assert.equal(args.accessToken,GOOGLE_TOKEN);
   assert.equal(args.id_fila,800001);
   assert.equal(args.trabajo_sync_id,UUID);
   if(readerThrows)throw Error('SECRET_PRIVATE_KEY_TEST');
   return allowedReader?
    {protocolo:S13_GOOGLE_K_VERSION,estado:'COTEJO_T_K_SIN_AUTORIA',
      origen:'GOOGLE_SHEETS_API_SOLO_LECTURA',id_fila:800001,
      trabajo_sync_id:UUID,columna:'K',valor_nuevo:'2026-11-19',
      lecturas_independientes:2,autoriza_sincronizar:false,
      actor_editor_acreditado:false}
    :{estado:'RETENER_SIN_ESCRIBIR',motivo:'T_DUPLICADA'};
 };
 const token=async()=>{calls.tokens++;return GOOGLE_TOKEN;};
 const fn=crearHandlerGoogleK({
  createClient,env:env({...settings,S13_GOOGLE_READER_ENABLED:enabled?'true':'false'}),
  fetcher:async()=>{throw Error('never call direct fetch in unit mock');},
  obtenerToken:token,cotejar
 });
 return {fn,calls};
}
async function call(h,{method='POST',body={id_fila:800001,trabajo_sync_id:UUID},
  headers={}}={}){
 const options={method,headers:{'content-type':'application/json',authorization:JWT,...headers}};
 if(method==='POST')options.body=typeof body==='string'?body:JSON.stringify(body);
 const res=await h.fn(new Request('https://synthetic.invalid/functions/v1/sincro13-google-lector',options));
 return {status:res.status,payload:await res.json()};
}
const zero=h=>{assert.equal(h.calls.google,0);assert.equal(h.calls.tokens,0);};
test('feature flag OFF impide leer incluso con usuario válido',async()=>{
 const h=handler({enabled:false}),r=await call(h);
 assert.equal(r.status,503);zero(h);assert.equal(h.calls.users,0);
});
test('sin JWT no se consulta Google ni Supabase',async()=>{
 const h=handler(),r=await call(h,{headers:{authorization:''}});
 assert.equal(r.status,401);zero(h);assert.equal(h.calls.users,0);
});
test('usuario inválido bloqueado antes de token de Google',async()=>{
 const h=handler({validUser:false}),r=await call(h);
 assert.equal(r.status,401);zero(h);
});
test('un usuario sin permisos no ve datos de Google',async()=>{
 const h=handler({permission:false}),r=await call(h);
 assert.equal(r.status,403);zero(h);
});
test('solicitudes con campos extra o T inválida se rechazan',async()=>{
 for(const payload of [
 {id_fila:800001,trabajo_sync_id:UUID,escribir:true},
 {id_fila:'800001',trabajo_sync_id:UUID},
 {id_fila:800001,trabajo_sync_id:'not-a-uuid'}
 ]){
  const h=handler(),r=await call(h,{body:payload});
  assert.equal(r.status,400);zero(h);
 }
});
test('K verificada por API devuelve solo fecha, sin escribir ni acreditar autor',async()=>{
 const h=handler(),r=await call(h);
 assert.equal(r.status,200);
 assert.deepEqual(h.calls.rpcs,['usuario_activo','dispositivo_autorizado','es_administrador_principal']);
 assert.equal(r.payload.lectura.valor_nuevo,'2026-11-19');
 assert.equal(r.payload.lectura.actor_editor_acreditado,false);
 assert.equal(r.payload.lectura.autoriza_sincronizar,false);
 assert.equal(r.payload.lectura.escritura_realizada,false);
 assert.equal(h.calls.google,1);
});
test('lectura sospechosa T duplicada da 409, no crea evidencia',async()=>{
 const h=handler({allowedReader:false}),r=await call(h);
 assert.equal(r.status,409);
 assert.equal(r.payload.motivo,'T_DUPLICADA');assert.equal(r.payload.autoriza_sincronizar,false);
});
test('fallo de Google nunca devuelve secretos ni datos privados',async()=>{
 const h=handler({readerThrows:true}),r=await call(h);
 assert.equal(r.status,502);
 assert.doesNotMatch(JSON.stringify(r.payload),/SECRET_PRIVATE_KEY_TEST|synthetic-server-secret|synthetic-google-readonly-token/);
});
test('entorno sin cuenta Google separada no llama a Google',async()=>{
 const h=handler({settings:{S13_GOOGLE_SERVICE_ACCOUNT_JSON:''}}),r=await call(h);
 assert.equal(r.status,503);zero(h);
});
test('método GET denegado antes de cualquier efecto',async()=>{
 const h=handler(),r=await call(h,{method:'GET'});
 assert.equal(r.status,405);zero(h);
});
test('token de usuario válido pero servidor Auth falla sin revelar datos',async()=>{
 const h=handler({userThrows:true}),r=await call(h);
 assert.equal(r.status,502);zero(h);
});

test('OAuth usa clave efímera del servidor y SOLO spreadsheets.readonly',async()=>{
 const pair=generateKeyPairSync('rsa',{modulusLength:2048});
 const acct=JSON.stringify({
  type:'service_account',client_email:'sincro13-lab@synthetic.iam.gserviceaccount.com',
  token_uri:'https://oauth2.googleapis.com/token',
  private_key:pair.privateKey.export({type:'pkcs8',format:'pem'})
 });
 let called=0,decoded;
 const fetcher=async(url,options)=>{
  called++;assert.equal(url,'https://oauth2.googleapis.com/token');
  assert.equal(options.method,'POST');
  const form=new URLSearchParams(options.body);
  assert.equal(form.get('grant_type'),'urn:ietf:params:oauth:grant-type:jwt-bearer');
  const jwt=form.get('assertion'),parts=jwt.split('.');
  assert.equal(parts.length,3);
  const parse=b64=>JSON.parse(Buffer.from(b64,'base64url').toString('utf8'));
  decoded={header:parse(parts[0]),payload:parse(parts[1])};
  assert.equal(decoded.header.alg,'RS256');
  assert.equal(decoded.payload.scope,S13_GOOGLE_OAUTH_SCOPE);
  assert.equal(decoded.payload.aud,url);
  assert.equal(decoded.payload.exp-decoded.payload.iat,900);
  assert.ok(verifySignature('RSA-SHA256',Buffer.from(parts[0]+'.'+parts[1]),
    pair.publicKey,Buffer.from(parts[2],'base64url')));
  return {status:200,json:async()=>({access_token:GOOGLE_TOKEN,
    token_type:'Bearer',expires_in:900})};
 };
 const r=await obtenerGoogleTokenSoloLectura({
  serviceAccountJson:acct,fetcher,cryptoImpl:webcrypto,nowMs:Date.UTC(2026,10,19,12)
 });
 assert.equal(r,GOOGLE_TOKEN);assert.equal(called,1);
 assert.ok(!decoded.payload.scope.includes('spreadsheets '));
});
test('OAuth rechaza emisor o endpoint distinto sin llamada de red',async()=>{
 let called=0;
 const fake=async()=>{called++;throw Error('network should not be used');};
 for(const sa of [
  {type:'service_account',client_email:'foreign@example.org',
    token_uri:'https://oauth2.googleapis.com/token',private_key:'invalid'},
  {type:'service_account',client_email:'test@g.iam.gserviceaccount.com',
    token_uri:'https://evil.example/token',private_key:'invalid'},
  {type:'user',client_email:'test@g.iam.gserviceaccount.com',
    token_uri:'https://oauth2.googleapis.com/token',private_key:'invalid'}
 ]) {
  await assert.rejects(()=>obtenerGoogleTokenSoloLectura({
    serviceAccountJson:JSON.stringify(sa),fetcher:fake,cryptoImpl:webcrypto
  }),/S13_CREDENCIAL_SERVIDOR_INVALIDA/);
 }
 assert.equal(called,0);
});
