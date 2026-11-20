/**
 * METROGES / SINCRO11 / admisión POSITIVA de eventos futuros - LABORATORIO.
 * SIN conexiones, credenciales, datos operativos ni capacidad de escribir.
 * Identidad: solo ID_FILA de columna T. El onEdit, una nota o un hash no prueban autoría.
 * Las firmas son de EMISORES DE PRUEBA. En producción se requeriría un servicio
 * independiente de autenticación, un capturador duradero y vínculos positivos.
 */
import {createPublicKey, createHash, verify} from 'node:crypto';

export const SINCRO11_ADMISION_VERSION = 'sincro11-admision-eventos-futuros-lab-20261117.1';
export const SINCRO11_ADMISION_DOMINIO = 'METROGES/SINCRO11/ADMISION/LAB/1';
const CORTE = '2026-11-15T23:00:00.000Z';
const SHEET_ID = '1PQE5VsjTvDFvQZcqedyQKIs3RbSySHFK4JPQXBD0XyU';
const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const HASH = /^[a-f0-9]{64}$/i;
const CAMPO = /^(?:[A-S]|[U-Z]|NOTA_[AEG]|ORDEN_T)$/;
const FECHA = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;
const MAX = 10000, MAX_DETALLE = 100;
const CLAVES = Object.freeze({
 CAPTURA: ['dominio','tipo','evento_id','spreadsheet_id','id_fila','campo','revision_anterior','revision_nueva','hash_anterior','hash_nuevo','operacion','observado_en','origen'],
 CONFIRMACION: ['dominio','tipo','evento_id','huella_captura','actor_id','sesion_id','dispositivo_id','aal','permiso','accion','confirmado_en','nonce'],
 VINCULO: ['dominio','tipo','evento_id','spreadsheet_id','id_fila','campo','objeto_id','clase_fila','significado','revision_vinculo','revision_destino','hash_destino','origen_vinculo','atestiguado_en'],
 LECTURA: ['dominio','tipo','evento_id','spreadsheet_id','id_fila','campo','revision_lectura','hash_vigente','leido_en'],
});
// Sólo equivalencias previamente examinadas en el laboratorio. NO es mapeo de producción.
const MAPA_LAB = Object.freeze({ TRABAJO: Object.freeze({J:'fecha_realizada', K:'fecha_recogida'}) });
const fail = message => {throw new Error('SINCRO11 ADMISION: '+message);};
const ensure = (ok,message) => {if(!ok)fail(message);};
const validUUID = value => typeof value === 'string' && UUID.test(value);
const validHash = value => typeof value === 'string' && HASH.test(value);
const validInt = value => Number.isSafeInteger(value) && value>0;
function idFila(value){
 if(validInt(value))return value;
 if(typeof value==='string'&&/^[1-9]\d{0,14}$/.test(value)){
  const n=Number(value);return validInt(n)?n:null;
 }
 return null;
}
function timestamp(v, campo){
 ensure(typeof v==='string'&&FECHA.test(v),`${campo}: UTC exacto obligatorio`);
 const n=Date.parse(v);ensure(Number.isFinite(n)&&new Date(n).toISOString()===v,`${campo}: UTC inválido`);return n;
}
function canon(obj){
 return '{'+Object.keys(obj).sort().map(k=>JSON.stringify(k)+':'+JSON.stringify(obj[k])).join(',')+'}';
}
function huella(obj){return createHash('sha256').update(canon(obj),'utf8').digest('hex');}
function hashCeldaCanonica(valor){return huella({tipo:'VALOR_CANONICO',valor});}
function trustKeys(registro){
 ensure(registro&&typeof registro==='object'&&!Array.isArray(registro),'no se entregó registro de claves externas');
 const resultado={};
 for(const nombre of ['captura','servidor']){
  const item=registro[nombre];ensure(item&&typeof item.kid==='string'&&item.kid.length>0&&item.kid.length<120&&typeof item.pem==='string',`clave ${nombre} ausente`);
  let key;try{key=createPublicKey(item.pem);}catch(_){fail(`clave ${nombre} inválida`);}
  ensure(key.asymmetricKeyType==='ed25519',`clave ${nombre} no Ed25519`);
  resultado[nombre]={...item,key};
 }
 ensure(resultado.captura.kid!==resultado.servidor.kid,'captura y servidor no pueden compartir identidad de clave');
 return resultado;
}
function signed(envelope,tipo,trust){
 ensure(envelope&&typeof envelope==='object'&&!Array.isArray(envelope)&&Object.keys(envelope).sort().join('|')==='firma|kid|payload','sobre sin firma o con campos inesperados');
 const p=envelope.payload;ensure(p&&typeof p==='object'&&!Array.isArray(p),'payload inválido');
 const keys=CLAVES[tipo];ensure(Object.keys(p).length===keys.length&&Object.keys(p).every(k=>keys.includes(k)),'campos de payload ausentes o adicionales');
 ensure(p.dominio===SINCRO11_ADMISION_DOMINIO&&p.tipo===tipo,`dominio o tipo inválidos: ${tipo}`);
 const signer=tipo==='CAPTURA'||tipo==='LECTURA'?trust.captura:trust.servidor;
 ensure(envelope.kid===signer.kid,'emisor no está en registro confiable');
 ensure(typeof envelope.firma==='string'&&/^[A-Za-z0-9_-]{70,120}$/.test(envelope.firma),'firma codificada inválida');
 let ok=false;try{ok=verify(null,Buffer.from(canon(p),'utf8'),signer.key,Buffer.from(envelope.firma,'base64url'));}catch(_){ok=false;}
 ensure(ok,'firma criptográfica inválida');
 return p;
}
function unique(events,tipo,trust){
 const map=new Map();
 for(const envelope of events){
  const p=signed(envelope,tipo,trust);
  ensure(validUUID(p.evento_id),'identificador de evento inválido');
  const id=p.evento_id.toLowerCase();
  if(!map.has(id))map.set(id,[]);
  map.get(id).push(p);
 }
 return map;
}
function matched(a,b){return a.spreadsheet_id===b.spreadsheet_id&&idFila(a.id_fila)===idFila(b.id_fila)&&a.campo===b.campo;}
function classify(p,c,l,v,now,excluded,consumed,nonceCounts){
 const id=idFila(p.id_fila),cut=timestamp(CORTE,'corte');
 // Ningún identificador se deduce de UUID, DFM, PA o posición física.
 if(p.spreadsheet_id!==SHEET_ID)return 'ORIGEN_HOJA_NO_ACREDITADO';
 if(id===null||typeof p.campo!=='string'||!CAMPO.test(p.campo))return 'IDENTIDAD_T_O_CAMPO_INVALIDO';
 if(excluded.has(id))return 'T_EXCLUIDA_POR_OPERADOR';
 if(consumed.has(p.evento_id.toLowerCase()))return 'EVENTO_YA_CONSUMIDO';
 if(!validInt(p.revision_anterior)||!validInt(p.revision_nueva)||p.revision_nueva!==p.revision_anterior+1)return 'REVISIONES_DE_CAPTURA_NO_CONSECUTIVAS';
 if(!validHash(p.hash_anterior)||!validHash(p.hash_nuevo)||p.hash_anterior===p.hash_nuevo)return 'SIN_DIFERENCIA_ACREDITABLE';
 if(!['ASIGNAR','BORRAR'].includes(p.operacion))return 'OPERACION_NO_EXPLICITA';
 if(p.operacion==='BORRAR'&&p.hash_nuevo!==hashCeldaCanonica(''))return 'BORRADO_SIN_HUELLA_VACIA';
 if(p.origen!=='OBSERVACION_DE_HOJA')return 'ORIGEN_AUTOMATICO_O_NO_ACREDITADO';
 const observado=timestamp(p.observado_en,'observado_en');
 if(observado<cut||observado>now)return 'NO_SE_DEMUESTRA_EVENTO_POSTERIOR_CORTE';
 if(!c)return 'SIN_CONFIRMACION_INDEPENDIENTE';
 if(c.huella_captura!==huella(p)||!validUUID(c.actor_id)||!validUUID(c.sesion_id)||!validUUID(c.dispositivo_id))return 'CONFIRMACION_NO_VINCULADA_AL_CAMBIO';
 if(c.aal!=='aal2'||c.permiso!=='MANTENIMENT_CONFIRMAR_CORRECCION'||c.accion!=='CONFIRMACION_EXPLICITA')return 'CONFIRMACION_SIN_SEGURIDAD_SUFICIENTE';
 if(!validUUID(c.nonce)||nonceCounts.get(c.nonce.toLowerCase())!==1)return 'NONCE_AUSENTE_O_DUPLICADO';
 const confirmado=timestamp(c.confirmado_en,'confirmado_en');
 if(confirmado<observado||confirmado>now)return 'CONFIRMACION_FUERA_DE_PERIODO';
 if(!l)return 'SIN_VINCULO_CANONICO_T_OBJETO';
 if(!matched(p,l)||!validUUID(l.objeto_id)||l.origen_vinculo!=='REGISTRO_T_CANONICO'||!validInt(l.revision_vinculo)||!validInt(l.revision_destino)||!validHash(l.hash_destino))return 'VINCULO_T_OBJETO_NO_ACREDITADO';
 if(typeof l.clase_fila!=='string'||typeof l.significado!=='string'||MAPA_LAB[l.clase_fila]?.[p.campo]!==l.significado)return 'CAMPO_Y_CLASE_SIN_MAPEO';
 const vinculado=timestamp(l.atestiguado_en,'atestiguado_en');
 if(vinculado<cut||vinculado>now)return 'VINCULO_SIN_HORA_VALIDA';
 if(!v)return 'SIN_LECTURA_VIGENTE_DE_CELDA';
 if(!matched(p,v)||!validInt(v.revision_lectura)||v.revision_lectura<p.revision_nueva||!validHash(v.hash_vigente)||v.hash_vigente!==p.hash_nuevo)return 'LECTURA_NO_COINCIDE_CON_CAMBIO';
 const leido=timestamp(v.leido_en,'leido_en');
 if(leido<confirmado||leido>now)return 'LECTURA_NO_POSTERIOR_A_CONFIRMACION';
 if(l.hash_destino===p.hash_nuevo)return 'DESTINO_YA_COINCIDE';
 return 'COTEJO_SOLO_LABORATORIO';
}
/**
 * Verifica cuatro sobrecitos criptográficos de laboratorio:
 * captura, confirmación autenticada por un servidor de PRUEBA, vínculo canónico
 * y nueva lectura. Aunque todo encaje, NO otorga permisos ni prueba una persona.
 */
export function auditarAdmisionFuturaSincro11({
 observadoEn, registroClaves,
 capturas=[], confirmaciones=[], vinculos=[], lecturas=[],
 consumidos=[], identidadesExcluidas=[]
}={}){
 const now=timestamp(observadoEn,'observadoEn'),cut=timestamp(CORTE,'corte');
 ensure(now>=cut,'observación antes del corte');
 for(const [name,arr] of Object.entries({capturas,confirmaciones,vinculos,lecturas,consumidos,identidadesExcluidas}))
  ensure(Array.isArray(arr)&&arr.length<=MAX,`lote ${name} inválido`);
 const trust=trustKeys(registroClaves);
 const events=unique(capturas,'CAPTURA',trust);
 const confirmations=unique(confirmaciones,'CONFIRMACION',trust);
 const links=unique(vinculos,'VINCULO',trust);
 const fresh=unique(lecturas,'LECTURA',trust);
 const consumed=new Set(),excluded=new Set();
 for(const e of consumidos){ensure(validUUID(e),'evento consumido inválido');consumed.add(e.toLowerCase());}
 for(const t of identidadesExcluidas){const id=idFila(t);ensure(id!==null,'T excluida inválida');excluded.add(id);}
 const nonces=new Map();for(const entry of confirmations.values())for(const c of entry)if(validUUID(c.nonce))nonces.set(c.nonce.toLowerCase(),(nonces.get(c.nonce.toLowerCase())||0)+1);
 const results=[];
 for(const [eventId,group] of events){
  const p=group[0];let motivo;
  const c=confirmations.get(eventId)||[],l=links.get(eventId)||[],v=fresh.get(eventId)||[];
  if(group.length!==1||c.length>1||l.length>1||v.length>1)motivo='EVIDENCIA_DUPLICADA_O_AMBIGUA';
  else motivo=classify(p,c[0]||null,l[0]||null,v[0]||null,now,excluded,consumed,nonces);
  results.push({id_fila:idFila(p.id_fila),campo:typeof p.campo==='string'?p.campo:'INVALIDO',evento_id:eventId,
    resultado:motivo==='COTEJO_SOLO_LABORATORIO'?'CANDIDATO_DE_COTEJO_NO_AUTORIZADO':'RETENER_SIN_ESCRIBIR',motivo});
 }
 results.sort((a,b)=>(a.id_fila??0)-(b.id_fila??0)||a.campo.localeCompare(b.campo));
 const counts={};for(const r of results)counts[r.motivo]=(counts[r.motivo]||0)+1;
 return {
  version:SINCRO11_ADMISION_VERSION,modo:'LABORATORIO_SIN_CONEXION',total:results.length,
  candidatos_laboratorio:counts.COTEJO_SOLO_LABORATORIO||0,
  retenidos:results.length-(counts.COTEJO_SOLO_LABORATORIO||0),
  detalles:results.slice(0,MAX_DETALLE),lista_parcial:results.length>MAX_DETALLE,
  motivos:Object.fromEntries(Object.entries(counts).sort((a,b)=>a[0].localeCompare(b[0]))),
  humano_real_acreditado:false, sesion_real_verificada:false, vinculos_reales_acreditados:false,
  permite_crear_T:false,permite_crear_PA:false,autoriza_sincronizar:false,
  escritura_en_manteniment:false,escritura_en_tancament:false,escritura_en_backend:false,
  expone_valores_privados:false,
  aviso:'Una firma y una simulación de sesión no acreditan a una persona real; sin emisor autorizado de producción, un registro T-objeto positivo y CAS vigente, retener siempre.'
 };
}
export const __admisionTestCanon = canon;