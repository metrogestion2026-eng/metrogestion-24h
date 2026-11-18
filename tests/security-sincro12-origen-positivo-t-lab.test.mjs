import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {generateKeyPairSync,sign,createPublicKey} from 'node:crypto';
import {
 auditarPuentePositivoS12 as verificar,
 S12_PUENTE_DOMINIO as DOMINIO,
 __s12PuenteCanonicalTest as canon
} from '../shared/sincro12-origen-positivo-t-lab.mjs';

const SHEET='1PQE5VsjTvDFvQZcqedyQKIs3RbSySHFK4JPQXBD0XyU';
const ID=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const NOW='2026-11-18T11:30:00.000Z';
const INT='2026-11-18T11:01:00.000Z',ACK='2026-11-18T11:02:00.000Z';
const READ='2026-11-18T11:03:00.000Z',DEST='2026-11-18T11:04:00.000Z';
function fixture(){
 const server=generateKeyPairSync('ed25519');
 const sheet=generateKeyPairSync('ed25519');
 const keys={
  servidor:{kid:'server-test-ed25519',pem:server.publicKey.export({type:'spki',format:'pem'})},
  hoja:{kid:'sheet-test-ed25519',pem:sheet.publicKey.export({type:'spki',format:'pem'})}
 };
 const privateKeys={servidor:server.privateKey,hoja:sheet.privateKey};
 const payload=(tipo,over={})=>{
  const request=over.req??1,row=over.row??90001,obj=over.obj??8,hotel=over.hotel??9;
  const nonce=over.nonce??30,hash='a'.repeat(64);
  const basics={dominio:DOMINIO,tipo,request_id:ID(request)};
  if(tipo==='INTENCION')return {
   ...basics,hoja_id:SHEET,clase:'TRABAJO',accion:'ASIGNAR_T_NUEVA',
   objeto_id:ID(obj),trabajo_hotel_id:ID(hotel),nonce:ID(nonce),
   hash_solicitud:hash,revision_destino:4,emitido_en:INT,
   origen:'SERVIDOR_FICTICIO_NO_AUTENTICA'
  };
  if(tipo==='ACUSE')return {
   ...basics,hoja_id:SHEET,id_fila:row,clase:'TRABAJO',
   hash_solicitud:hash,revision_hoja:3,asignado_en:ACK,
   estado:'ACTIVA',origen:'PUENTE_HOJA_FICTICIO'
  };
  if(tipo==='RELECTURA')return {
   ...basics,hoja_id:SHEET,id_fila:row,clase:'TRABAJO',
   hash_solicitud:hash,revision_hoja:3,leido_en:READ,
   estado:'ACTIVA',origen:'PUENTE_HOJA_FICTICIO'
  };
  return {
   ...basics,objeto_id:ID(obj),trabajo_hotel_id:ID(hotel),
   revision_destino:4,hash_solicitud:hash,existe:true,leido_en:DEST,
   origen:'SERVIDOR_FICTICIO_NO_AUTENTICA'
  };
 };
 const wrap=(p,role)=>{
  const owner=role||(p.tipo==='ACUSE'||p.tipo==='RELECTURA'?'hoja':'servidor');
  const priv=privateKeys[owner];
  return {payload:p,kid:keys[owner].kid,
   firma:sign(null,Buffer.from(canon(p)),priv).toString('base64url')};
 };
 const bundle=(over={})=>{
  const req=over.req??1,row=over.row??90001,obj=over.obj??8,
   hotel=over.hotel??9,nonce=over.nonce??30;
  return {
   intent:wrap(payload('INTENCION',{req,row,obj,hotel,nonce})),
   ack:wrap(payload('ACUSE',{req,row,obj,hotel,nonce})),
   reread:wrap(payload('RELECTURA',{req,row,obj,hotel,nonce})),
   destination:wrap(payload('DESTINO',{req,row,obj,hotel,nonce}))
  };
 };
 const submit=(bundles=[],opts={})=>verificar({
  observado_en:NOW,registroClaves:keys,
  intenciones:bundles.map(b=>b.intent),
  acuses:bundles.map(b=>b.ack),
  relecturas:bundles.map(b=>b.reread),
  destinos:bundles.map(b=>b.destination),
  ...opts
 });
 return {server,sheet,keys,privateKeys,payload,wrap,bundle,submit};
}
function reason(result){return result.detalle[0]?.motivo}
function locked(x){
 for(const key of ['autorizacion_real_servidor','acuse_real_google',
 'persona_que_edito_acreditada','vinculo_real_t_objeto_acreditado',
 'autoriza_crear_T','autoriza_crear_PA','autoriza_sincronizar',
 'escribe_google','escribe_supabase'])assert.equal(x[key],false,key);
}
test('cadena de cuatro firmas ficticias produce solo candidato sin escritura',()=>{
 const h=fixture(),r=h.submit([h.bundle()]);
 assert.equal(reason(r),'CADENA_FIRMADA_FICTICIA_CANDIDATA');
 assert.equal(r.candidatos_laboratorio,1);
 assert.equal(r.detalle[0].id_fila,90001);locked(r);
});
test('una firma de servidor no sustituye a la de la hoja',()=>{
 const h=fixture(),b=h.bundle();
 b.ack=h.wrap(b.ack.payload,'servidor');
 assert.throws(()=>h.submit([b]),/firma o estructura no verificable/);
});
test('un acuse cambiado sin volver a firmar se rechaza',()=>{
 const h=fixture(),b=h.bundle();
 b.ack.payload.id_fila=90002;
 assert.throws(()=>h.submit([b]),/firma o estructura no verificable/);
});
test('una relectura cambiada sin nueva firma no acredita el valor',()=>{
 const h=fixture(),b=h.bundle();b.reread.payload.revision_hoja=8;
 assert.throws(()=>h.submit([b]),/firma o estructura no verificable/);
});
test('registro de claves iguales se rechaza',()=>{
 const h=fixture();h.keys.hoja.pem=h.keys.servidor.pem;
 assert.throws(()=>h.submit([h.bundle()]),/emisores independientes no acreditados/);
});
test('mismo kid de servidor y hoja se rechaza',()=>{
 const h=fixture();h.keys.hoja.kid=h.keys.servidor.kid;
 assert.throws(()=>h.submit([h.bundle()]),/emisores independientes no acreditados/);
});
test('el acuse ausente no se inventa por UUID/DFM/PA',()=>{
 const h=fixture(),b=h.bundle(),r=h.submit([b],{acuses:[]});
 assert.equal(reason(r),'SIN_ACUSE_DE_T');locked(r);
});
test('sin relectura posterior del mismo T el acuse solo no basta',()=>{
 const h=fixture(),r=h.submit([h.bundle()],{relecturas:[]});
 assert.equal(reason(r),'SIN_RELECTURA_POSTERIOR_DE_T');locked(r);
});
test('sin relectura del destino actual no se acredita objeto',()=>{
 const h=fixture(),r=h.submit([h.bundle()],{destinos:[]});
 assert.equal(reason(r),'SIN_RELECTURA_DEL_DESTINO');locked(r);
});
test('un acuse para la T física T1624 no es ID_FILA canónico',()=>{
 const h=fixture(),b=h.bundle();
 b.ack=h.wrap({...b.ack.payload,id_fila:'T1624'});
 assert.equal(reason(h.submit([b])),'ACUSE_NO_ACREDITA_T_CANONICA');
});
test('T 6969 en estado BORRADA no puede ser alta ACTIVA',()=>{
 const h=fixture(),b=h.bundle({row:6969});
 b.ack=h.wrap({...b.ack.payload,estado:'BORRADA'});
 assert.equal(reason(h.submit([b])),'ACUSE_NO_ACREDITA_T_CANONICA');
});
test('no se toma contador ULTIMO_ID_EMITIDO como identidad del alta',()=>{
 const h=fixture(),b=h.bundle();b.ack=h.wrap({...b.ack.payload,id_fila:0});
 assert.equal(reason(h.submit([b])),'ACUSE_NO_ACREDITA_T_CANONICA');
});
test('los campos extra de PA, DFM o fila física quedan fuera del contrato firmado',()=>{
 for(const field of ['numero_fila','pa','dfm','matricula','nota_uuid']){
  const h=fixture(),b=h.bundle();
  b.ack=h.wrap({...b.ack.payload,[field]:'inferencia'});
  assert.throws(()=>h.submit([b]),/firma o estructura no verificable/);
 }
});
test('otro libro nunca se presenta como MANTENIMENT',()=>{
 const h=fixture(),b=h.bundle();b.intent=h.wrap({...b.intent.payload,hoja_id:'otro'});
 assert.equal(reason(h.submit([b])),'INTENCION_SIN_CONTRATO_VALIDO');
});
test('no se crea una T de PARADA con protocolo TRABAJO',()=>{
 const h=fixture(),b=h.bundle();b.ack=h.wrap({...b.ack.payload,clase:'PARADA'});
 assert.equal(reason(h.submit([b])),'ACUSE_NO_ACREDITA_T_CANONICA');
});
test('intención anterior al corte no se rejuvenece por relectura tardía',()=>{
 const h=fixture(),b=h.bundle();
 b.intent=h.wrap({...b.intent.payload,emitido_en:'2026-11-15T22:59:59.000Z'});
 assert.equal(reason(h.submit([b])),'INTENCION_NO_ES_EVENTO_FUTURO');
});
test('la marca de una petición de alta es un evento independiente de fechas I/J/K',()=>{
 const h=fixture(),r=h.submit([h.bundle()]);
 assert.equal(r.total,1);locked(r);
 assert.ok(!JSON.stringify(r).includes('fecha_realizada'));
});
test('solicitud reutilizada se retiene como consumida',()=>{
 const h=fixture(),b=h.bundle();
 assert.equal(reason(h.submit([b],{requests_consumidas:[b.intent.payload.request_id]})),
  'REQUEST_YA_CONSUMIDA');
});
test('T excluida por identidad (no DFM R1515) se retiene',()=>{
 const h=fixture(),r=h.submit([h.bundle()],{id_filas_excluidas:[90001]});
 assert.equal(reason(r),'T_EXCLUIDA_O_YA_VINCULADA');
});
test('dos intenciones con mismo request_id no ganan por orden',()=>{
 const h=fixture(),a=h.bundle(),b=h.bundle({row:90002,nonce:31});
 const r=h.submit([a,b]);assert.equal(r.candidatos_laboratorio,0);
 assert.equal(reason(r),'REQUEST_O_EVIDENCIA_DUPLICADA');
});
test('dos requests diferentes no pueden reclamar una misma T',()=>{
 const h=fixture(),a=h.bundle(),b=h.bundle({req:2,row:90001,nonce:31,obj:22,hotel:33});
 const r=h.submit([a,b]);
 assert.equal(r.motivos.MISMA_T_EN_VARIAS_SOLICITUDES,2);locked(r);
});
test('nonce compartido entre dos intenciones impide el alta',()=>{
 const h=fixture(),a=h.bundle(),b=h.bundle({req:2,row:90002,nonce:30,obj:22,hotel:33});
 const r=h.submit([a,b]);assert.equal(r.motivos.NONCE_REUTILIZADO_ENTRE_INTENCIONES,2);
});
test('dos T pueden referir a un mismo trabajo de Hotel sin fusionarse',()=>{
 const h=fixture(),a=h.bundle(),b=h.bundle({req:2,row:90002,nonce:31,obj:22,hotel:9});
 const r=h.submit([a,b]);assert.equal(r.candidatos_laboratorio,2);
 assert.deepEqual(r.detalle.map(x=>x.id_fila),[90001,90002]);locked(r);
});
test('acuse reemitido con diferente hash de solicitud no vincula el request',()=>{
 const h=fixture(),b=h.bundle();
 b.ack=h.wrap({...b.ack.payload,hash_solicitud:'b'.repeat(64)});
 assert.equal(reason(h.submit([b])),'ACUSE_NO_ACREDITA_T_CANONICA');
});
test('la relectura de otra T se retiene aunque ambas existan',()=>{
 const h=fixture(),b=h.bundle();
 b.reread=h.wrap({...b.reread.payload,id_fila:90002});
 assert.equal(reason(h.submit([b])),'RELECTURA_NO_COINCIDE_CON_ACUSE');
});
test('la revisión de hoja posterior no coincide aunque el hash sea igual',()=>{
 const h=fixture(),b=h.bundle();
 b.reread=h.wrap({...b.reread.payload,revision_hoja:4});
 assert.equal(reason(h.submit([b])),'RELECTURA_NO_COINCIDE_CON_ACUSE');
});
test('relectura hoja previa a asignación no acredita la nueva T',()=>{
 const h=fixture(),b=h.bundle();
 b.reread=h.wrap({...b.reread.payload,leido_en:'2026-11-18T11:00:00.000Z'});
 assert.equal(reason(h.submit([b])),'RELECTURA_T_FUERA_DE_SECUENCIA');
});
test('acuse previo a la intención no acredita el alta',()=>{
 const h=fixture(),b=h.bundle();
 b.ack=h.wrap({...b.ack.payload,asignado_en:'2026-11-18T11:00:00.000Z'});
 assert.equal(reason(h.submit([b])),'ACUSE_FUERA_DE_SECUENCIA');
});
test('un destino cambiado por otro trabajo no se equipara por DFM',()=>{
 const h=fixture(),b=h.bundle();
 b.destination=h.wrap({...b.destination.payload,trabajo_hotel_id:ID(55)});
 assert.equal(reason(h.submit([b])),'DESTINO_O_REVISION_NO_COINCIDEN');
});
test('una revisión de destino antigua no sirve para asignar T',()=>{
 const h=fixture(),b=h.bundle();
 b.destination=h.wrap({...b.destination.payload,revision_destino:5});
 assert.equal(reason(h.submit([b])),'DESTINO_O_REVISION_NO_COINCIDEN');
});
test('evidencia huérfana sin intención no crea nuevas T ni vínculos',()=>{
 const h=fixture(),b=h.bundle();
 const r=h.submit([],{acuses:[b.ack],relecturas:[b.reread],destinos:[b.destination]});
 assert.equal(r.total,0);assert.equal(r.evidencias_huerfanas,1);
 assert.equal(r.candidatos_laboratorio,0);locked(r);
});
test('no se admiten payloads anidados bajo un sobre firmado',()=>{
 const h=fixture(),b=h.bundle();
 b.intent=h.wrap({...b.intent.payload,accion:{tipo:'ASIGNAR_T_NUEVA'}});
 assert.throws(()=>h.submit([b]),/firma o estructura no verificable/);
});
test('un nonce de otro tipo se retiene sin lanzar un error interno',()=>{
 const h=fixture(),b=h.bundle();b.intent=h.wrap({...b.intent.payload,nonce:123});
 assert.equal(reason(h.submit([b])),'INTENCION_SIN_CONTRATO_VALIDO');
});
test('registro de firmas sin hoja válida no abre escritura',()=>{
 const h=fixture(),b=h.bundle();h.keys.hoja.pem='NO ES UNA CLAVE';
 assert.throws(()=>h.submit([b]),/emisores independientes no acreditados/);
});
test('la salida no publica UUID, hashes, claves privadas ni notas',()=>{
 const h=fixture(),b=h.bundle(),r=h.submit([b]),s=JSON.stringify(r);
 for(const token of [ID(1),ID(8),ID(9),'a'.repeat(64),'BEGIN PRIVATE KEY'])
  assert.ok(!s.includes(token));
 locked(r);
});
test('lote excesivo y exclusiones no numéricas fallan cerrados',()=>{
 const h=fixture(),b=h.bundle();
 assert.throws(()=>h.submit(Array(1001).fill(b)),/colección intenciones inválida/);
 assert.throws(()=>h.submit([b],{id_filas_excluidas:['R1515']}),/exclusión T inválida/);
});
test('código solo tiene cripto de laboratorio y carece de red/escritura',()=>{
 const text=readFileSync(new URL('../shared/sincro12-origen-positivo-t-lab.mjs',import.meta.url),'utf8');
 for(const pat of [/SpreadsheetApp\./,/UrlFetchApp\./,/createClient\(/,
  /\bfetch\(/,/\bINSERT INTO\b/,/\bUPDATE\b/,/\bDELETE FROM\b/,
  /\bservice_role\b/i,/Deno\.env/,/createTrigger\(/])
  assert.doesNotMatch(text,pat);
});
