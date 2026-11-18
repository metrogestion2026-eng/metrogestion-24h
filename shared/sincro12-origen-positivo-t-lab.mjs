/**
 * METROGES · SINCRO 12 · INTENCIÓN + ACUSE T + RELECTURA + DESTINO.
 *
 * Laboratorio sin red, credenciales productivas, creación de T, hojas ni SQL.
 * Las claves y emisores suministrados son de PRUEBA, no autentican una
 * persona ni prueban que Google Sheets ejecutara un cambio material.
 * Un acuse firmado SOLO significa que su supuesto emisor lo firmó;
 * sin puente autorizado, no es prueba operativa ni permiso de sincronizar.
 *
 * La única identidad de línea es T / ID_FILA, jamás posición, PA ni DFM.
 */
import {createPublicKey,verify} from 'node:crypto';

export const S12_PUENTE_VERSION='sincro12-origen-positivo-t-lab-20261118.1';
export const S12_PUENTE_DOMINIO='METROGES/SINCRO12/PUENTE_T/LAB/1';
const SHEET='1PQE5VsjTvDFvQZcqedyQKIs3RbSySHFK4JPQXBD0XyU';
const CORTE=Date.parse('2026-11-15T23:00:00.000Z');
const RE_UUID=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const RE_HASH=/^[a-f0-9]{64}$/i;
const RE_DATE=/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;
const RE_SIGN=/^[A-Za-z0-9_-]{70,120}$/;
const MAX=1000,DETAIL=100;
const SHAPES=Object.freeze({
 INTENCION:['dominio','tipo','request_id','hoja_id','clase','accion','objeto_id',
  'trabajo_hotel_id','nonce','hash_solicitud','revision_destino','emitido_en','origen'],
 ACUSE:['dominio','tipo','request_id','hoja_id','id_fila','clase','hash_solicitud',
  'revision_hoja','asignado_en','estado','origen'],
 RELECTURA:['dominio','tipo','request_id','hoja_id','id_fila','clase','hash_solicitud',
  'revision_hoja','leido_en','estado','origen'],
 DESTINO:['dominio','tipo','request_id','objeto_id','trabajo_hotel_id',
  'revision_destino','hash_solicitud','existe','leido_en','origen']
});
const uuid=x=>typeof x==='string'&&RE_UUID.test(x);
const sha=x=>typeof x==='string'&&RE_HASH.test(x);
const id=x=>{
 if(Number.isSafeInteger(x)&&x>0)return x;
 if(typeof x==='string'&&/^[1-9]\d{0,14}$/.test(x)){
  const n=Number(x);return Number.isSafeInteger(n)&&n>0?n:null;
 }
 return null;
};
const timestamp=x=>{
 if(typeof x!=='string'||!RE_DATE.test(x))return null;
 const n=Date.parse(x);return Number.isFinite(n)&&new Date(n).toISOString()===x?n:null;
};
const exact=(x,keys)=>!!x&&typeof x==='object'&&!Array.isArray(x)
 &&Object.keys(x).length===keys.length
 &&Object.keys(x).every(k=>keys.includes(k));
/** Payloads de primer nivel: solo primitivos, sin arrays u objetos externos. */
function canon(x){
 return '{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+JSON.stringify(x[k])).join(',')+'}';
}
function keyring(reg){
 if(!exact(reg,['servidor','hoja']))return null;
 const keys={};
 try{
  for(const tipo of ['servidor','hoja']){
   const k=reg[tipo];
   if(!exact(k,['kid','pem'])||typeof k.kid!=='string'
    ||k.kid.length<4||k.kid.length>100||typeof k.pem!=='string')return null;
   const pub=createPublicKey(k.pem);
   if(pub.asymmetricKeyType!=='ed25519')return null;
   keys[tipo]={kid:k.kid,key:pub};
  }
 }catch(_){return null;}
 if(keys.servidor.kid===keys.hoja.kid
  ||keys.servidor.key.export({type:'spki',format:'der'}).equals(
     keys.hoja.key.export({type:'spki',format:'der'})))return null;
 return keys;
}
function signed(envelope,tipo,keys){
 if(!exact(envelope,['payload','kid','firma']))return null;
 const p=envelope.payload,owner=tipo==='ACUSE'||tipo==='RELECTURA'?'hoja':'servidor';
 if(!exact(p,SHAPES[tipo])||p.dominio!==S12_PUENTE_DOMINIO
   ||p.tipo!==tipo||envelope.kid!==keys[owner].kid
   ||typeof envelope.firma!=='string'||!RE_SIGN.test(envelope.firma))return null;
 // El sobre no es una firma de sesión; es verificación criptográfica ficticia.
 let ok=false;
 try{ok=verify(null,Buffer.from(canon(p)),keys[owner].key,
   Buffer.from(envelope.firma,'base64url'));}catch(_){ok=false;}
 return ok?p:null;
}
function agrupar(arr,kind,keys){
 const out=new Map();
 for(const env of arr){
  const payload=signed(env,kind,keys);
  const request=payload?.request_id?.toLowerCase();
  if(!request||!uuid(request))return null;
  const group=out.get(request)||[];
  group.push(payload);out.set(request,group);
 }
 return out;
}
function reason(p,a,r,d,now,consumed,exclusiones){
 if(!p)return 'INTENCION_INEXISTENTE';
 if(p.hoja_id!==SHEET||p.clase!=='TRABAJO'||p.accion!=='ASIGNAR_T_NUEVA'
   ||p.origen!=='SERVIDOR_FICTICIO_NO_AUTENTICA'
   ||!uuid(p.request_id)||!uuid(p.objeto_id)||!uuid(p.trabajo_hotel_id)
   ||!uuid(p.nonce)||!sha(p.hash_solicitud)
   ||!Number.isSafeInteger(p.revision_destino)||p.revision_destino<1)
  return 'INTENCION_SIN_CONTRATO_VALIDO';
 const t0=timestamp(p.emitido_en);
 if(t0===null||t0<=CORTE||t0>now)return 'INTENCION_NO_ES_EVENTO_FUTURO';
 if(consumed.has(p.request_id.toLowerCase()))return 'REQUEST_YA_CONSUMIDA';
 if(!a)return 'SIN_ACUSE_DE_T';
 const fid=id(a.id_fila);
 if(a.hoja_id!==SHEET||fid===null||a.clase!=='TRABAJO'
  ||a.origen!=='PUENTE_HOJA_FICTICIO'||a.estado!=='ACTIVA'
  ||a.request_id!==p.request_id||a.hash_solicitud!==p.hash_solicitud
  ||!Number.isSafeInteger(a.revision_hoja)||a.revision_hoja<1)
  return 'ACUSE_NO_ACREDITA_T_CANONICA';
 if(exclusiones.has(fid))return 'T_EXCLUIDA_O_YA_VINCULADA';
 const t1=timestamp(a.asignado_en);
 if(t1===null||t1<t0||t1>now)return 'ACUSE_FUERA_DE_SECUENCIA';
 if(!r)return 'SIN_RELECTURA_POSTERIOR_DE_T';
 if(r.hoja_id!==SHEET||id(r.id_fila)!==fid||r.clase!=='TRABAJO'
  ||r.request_id!==p.request_id||r.hash_solicitud!==p.hash_solicitud
  ||r.estado!=='ACTIVA'||r.origen!=='PUENTE_HOJA_FICTICIO'
  ||r.revision_hoja!==a.revision_hoja)
  return 'RELECTURA_NO_COINCIDE_CON_ACUSE';
 const t2=timestamp(r.leido_en);
 if(t2===null||t2<t1||t2>now)return 'RELECTURA_T_FUERA_DE_SECUENCIA';
 if(!d)return 'SIN_RELECTURA_DEL_DESTINO';
 if(d.request_id!==p.request_id||d.objeto_id!==p.objeto_id
  ||d.trabajo_hotel_id!==p.trabajo_hotel_id||d.hash_solicitud!==p.hash_solicitud
  ||d.existe!==true||d.origen!=='SERVIDOR_FICTICIO_NO_AUTENTICA'
  ||d.revision_destino!==p.revision_destino)
  return 'DESTINO_O_REVISION_NO_COINCIDEN';
 const t3=timestamp(d.leido_en);
 if(t3===null||t3<t1||t3>now)return 'RELECTURA_DESTINO_FUERA_DE_SECUENCIA';
 return 'CADENA_FIRMADA_FICTICIA_CANDIDATA';
}
/**
 * Las colecciones contienen SOLO sobres firmados por claves de pruebas
 * independientes, cuya disponibilidad no equivale a un puente instalado.
 * Ausencia y duplicidad se retienen; no se rescatan por PA, DFM o notas.
 */
export function auditarPuentePositivoS12({
 observado_en,registroClaves,intenciones=[],acuses=[],relecturas=[],destinos=[],
 requests_consumidas=[],id_filas_excluidas=[]
}={}){
 const now=timestamp(observado_en);
 if(now===null||now<=CORTE)throw Error('S12 PUENTE LAB: observación UTC inválida');
 for(const [k,v] of Object.entries({intenciones,acuses,relecturas,destinos,
  requests_consumidas,id_filas_excluidas}))
  if(!Array.isArray(v)||v.length>MAX)throw Error('S12 PUENTE LAB: colección '+k+' inválida');
 const keys=keyring(registroClaves);
 if(!keys)throw Error('S12 PUENTE LAB: emisores independientes no acreditados');
 const intents=agrupar(intenciones,'INTENCION',keys);
 const acks=agrupar(acuses,'ACUSE',keys);
 const reread=agrupar(relecturas,'RELECTURA',keys);
 const dest=agrupar(destinos,'DESTINO',keys);
 if([intents,acks,reread,dest].some(x=>x===null))
  throw Error('S12 PUENTE LAB: firma o estructura no verificable');
 const consumed=new Set(),excluidos=new Set();
 for(const k of requests_consumidas){
  if(!uuid(k))throw Error('S12 PUENTE LAB: request consumida inválida');
  consumed.add(k.toLowerCase());
 }
 for(const k of id_filas_excluidas){
  const n=id(k);if(n===null)throw Error('S12 PUENTE LAB: exclusión T inválida');
  excluidos.add(n);
 }
 const nos=new Map(),filas=new Map();
 for(const [req,groups] of intents){
  for(const p of groups){
   const n=p.nonce.toLowerCase();
   nos.set(n,(nos.get(n)||0)+1);
  }
 }
 for(const groups of acks.values())for(const a of groups){
  const n=id(a.id_fila);
  if(n!==null)filas.set(n,(filas.get(n)||0)+1);
 }
 const motivos={},detalles=[];
 for(const [request,groups] of intents){
  const ia=groups[0],as=acks.get(request)||[],
        rs=reread.get(request)||[],ds=dest.get(request)||[];
  let motivo;
  if(groups.length!==1||as.length>1||rs.length>1||ds.length>1)
   motivo='REQUEST_O_EVIDENCIA_DUPLICADA';
  else if(nos.get(ia.nonce.toLowerCase())!==1)
   motivo='NONCE_REUTILIZADO_ENTRE_INTENCIONES';
  else if(as.length&&filas.get(id(as[0].id_fila))!==1)
   motivo='MISMA_T_EN_VARIAS_SOLICITUDES';
  else motivo=reason(ia,as[0],rs[0],ds[0],now,consumed,excluidos);
  motivos[motivo]=(motivos[motivo]||0)+1;
  if(detalles.length<DETAIL)detalles.push({
   id_fila:as.length===1?id(as[0].id_fila):null,
   resultado:motivo==='CADENA_FIRMADA_FICTICIA_CANDIDATA'
     ?'CANDIDATO_FICTICIO_SIN_AUTORIZAR':'RETENER_SIN_ESCRIBIR',
   motivo
  });
 }
 // Pruebas huérfanas nunca se convierten en altas a partir de un UUID/T.
 const huerfanas=[...new Set([...acks.keys(),...reread.keys(),...dest.keys()])]
  .filter(k=>!intents.has(k)).length;
 return {
  version:S12_PUENTE_VERSION,modo:'PUENTE_CRIPTOGRAFICO_SOLO_LABORATORIO',
  total:intenciones.length,
  candidatos_laboratorio:motivos.CADENA_FIRMADA_FICTICIA_CANDIDATA||0,
  detalle:detalles,detalle_parcial:intenciones.length>DETAIL,
  motivos:Object.fromEntries(Object.entries(motivos).sort()),
  evidencias_huerfanas:huerfanas,
  autorizacion_real_servidor:false,acuse_real_google:false,
  persona_que_edito_acreditada:false,vinculo_real_t_objeto_acreditado:false,
  autoriza_crear_T:false,autoriza_crear_PA:false,
  autoriza_sincronizar:false,escribe_google:false,escribe_supabase:false,
  aviso:'Firmas de prueba no acreditan sesión, autoría ni actuación real en hoja. No instalar ni enviar.'
 };
}
/** SOLO para ensayos; los tests generan claves efímeras propias. */
export const __s12PuenteCanonicalTest=canon;
