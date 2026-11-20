/**
 * METROGES / SINCRO 11 / Precedencia por campo con pruebas de procedencia.
 * CANDIDATA PURA Y AISLADA. Ni siquiera prepara una orden ejecutable.
 * No toca MANTENIMENT/TANCAMENT, Supabase, Google, claves privadas ni archivos.
 * Las claves públicas llegan por configuración de confianza del receptor,
 * no desde el sobre recibido. Firmas Ed25519 de prueba NO acreditan por sí
 * solas que una persona concreta haya tecleado una celda.
 */
import { createPublicKey, verify as verificarFirma, createHash } from 'node:crypto';

export const SINCRO11_EVIDENCIA_VERSION = 'sincro11-evidencia-precedencia-20261116.1';
export const SINCRO11_DOMINIO = 'METROGES/SINCRO11/PRUEBA/1';
export const SINCRO11_CORTE = '2026-11-15T23:00:00.000Z';
const COLUMNAS = new Set([...('ABCDEFGHIJKLMNOPQRSUVWXYZ')]); // T se reserva exclusivamente a identidad
const KINDS = Object.freeze({ CAPTURA:'CAPTURA_MANUAL', VINCULO:'VINCULO_IDENTIDAD', ESTADO:'ESTADO_METROGES' });
const MAX_EVENTOS=10000, MAX_RESULTADOS=100;
const UUID_RE=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const HEX_RE=/^[0-9a-f]{64}$/i;
const FECHA_RE=/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;
const PROPIEDADES_EVENTO=[
  'dominio','kind','id_fila','campo','significado','revision','emitido_en','evento_id','objeto_id',
  'base_hash','nuevo_hash','operacion','clase','revision_fuente',
];

function exigir(p,m){ if(!p) throw new Error('SINCRO11 EVIDENCIA: '+m); }
function idFila(v){if(typeof v==='number')return Number.isSafeInteger(v)&&v>0?v:null;
 if(typeof v==='string'&&/^[1-9]\d{0,14}$/.test(v)){const n=Number(v);return Number.isSafeInteger(n)?n:null;}return null;}
function fecha(v){if(typeof v!=='string'||!FECHA_RE.test(v))return null;const n=Date.parse(v);return Number.isFinite(n)&&new Date(n).toISOString()===v?n:null;}
function clavesExactas(obj, keys){return !!obj&&Object.keys(obj).length===keys.length&&Object.keys(obj).every(k=>keys.includes(k));}
function canonical(obj){const keys=Object.keys(obj).sort();return '{'+keys.map(k=>JSON.stringify(k)+':'+JSON.stringify(obj[k])).join(',')+'}';}
function huella(s){return createHash('sha256').update(s,'utf8').digest('hex');}
function valorSeguro(v){return typeof v==='string' && v.length>=1&&v.length<=128&&!/[\u0000-\u001f]/.test(v);}
function validarRegistroClaves(reg){
 exigir(reg&&typeof reg==='object'&&!Array.isArray(reg),'registro de claves inválido');
 for(const tipo of ['captura','servidor']){
  const a=reg[tipo]; exigir(a&&typeof a==='object'&&typeof a.kid==='string'&&typeof a.pem==='string',`falta clave pública confiable para ${tipo}`);
  exigir(a.kid.length>0&&a.kid.length<=100,'kid inválido');
  try{const k=createPublicKey(a.pem);exigir(k.asymmetricKeyType==='ed25519','se requiere clave Ed25519');}catch(_){throw Error('SINCRO11 EVIDENCIA: clave pública Ed25519 inválida');}
 }
 exigir(reg.captura.kid!==reg.servidor.kid,'captura y servidor deben usar claves diferentes');
}
function validarPayload(body,now){
 exigir(body&&typeof body==='object'&&!Array.isArray(body)&&clavesExactas(body,PROPIEDADES_EVENTO),'payload incompleto o con campos extra');
 exigir(body.dominio===SINCRO11_DOMINIO,'dominio equivocado');
 exigir(Object.values(KINDS).includes(body.kind),'tipo de evidencia no reconocido');
 exigir(idFila(body.id_fila)!==null,'ID_FILA columna T inválida');
 exigir(typeof body.campo==='string'&&COLUMNAS.has(body.campo),'campo inválido o columna T no editable por esta ruta');
 exigir(valorSeguro(body.significado),'significado operativo no declarado');
 exigir(Number.isSafeInteger(body.revision)&&body.revision>0,'revisión inválida');
 exigir(UUID_RE.test(body.evento_id),'evento_id inválido');
 exigir(UUID_RE.test(body.objeto_id),'objeto_id inválido');
 const issued=fecha(body.emitido_en),cut=fecha(SINCRO11_CORTE);
 exigir(issued!==null&&issued>=cut&&issued<=now+120000,'evidencia anterior al corte, futura o sin hora válida');
 exigir(HEX_RE.test(body.base_hash)&&HEX_RE.test(body.nuevo_hash),'huellas base y nueva inválidas');
 exigir(['ASIGNAR','BORRAR','OBSERVAR'].includes(body.operacion),'operación inválida');
 exigir(valorSeguro(body.clase),'clase de fila ausente');
 exigir(Number.isSafeInteger(body.revision_fuente)&&body.revision_fuente>0,'revisión de fuente inválida');
 if(body.kind===KINDS.CAPTURA){
   exigir(body.operacion==='ASIGNAR'||body.operacion==='BORRAR','captura sin cambio explícito');
   exigir(body.base_hash!==body.nuevo_hash,'captura de valor sin diferencia');
   if(body.operacion==='BORRAR')exigir(body.nuevo_hash===hashCelda(''),
     'BORRAR exige huella de valor de celda vacía explícita');
 } else exigir(body.operacion==='OBSERVAR','vínculo/estado sin operación de observación');
}
function validarSobre(sobre,claves,ahora){
 exigir(sobre&&typeof sobre==='object'&&!Array.isArray(sobre)&&clavesExactas(sobre,['kid','payload','firma']),
   'sobre incompleto, sin firma o con campos extra');
 exigir(typeof sobre.kid==='string'&&typeof sobre.firma==='string'&&/^[A-Za-z0-9_-]{70,120}$/.test(sobre.firma),
   'firma ilegible');
 validarPayload(sobre.payload,ahora);
 const keySlot=sobre.payload.kind===KINDS.CAPTURA?'captura':'servidor';
 exigir(sobre.kid===claves[keySlot].kid,`firmante no autorizado para ${keySlot}`);
 let autenticada=false;
 try{autenticada=verificarFirma(null,Buffer.from(canonical(sobre.payload)),
   createPublicKey(claves[keySlot].pem),Buffer.from(sobre.firma,'base64url'));}catch(_){autenticada=false;}
 exigir(autenticada,'firma criptográfica inválida');
 return sobre.payload;
}
function claveCampo(p){return `${p.id_fila}|${p.campo}|${p.significado}`;}
function coherencia(a,b){return a.id_fila===b.id_fila&&a.campo===b.campo&&
  a.significado===b.significado&&a.objeto_id===b.objeto_id&&a.clase===b.clase;}
function hashCelda(valor){return huella(canonical({tipo:'VALOR_CANONICO',valor}));}
export function sincro11HashCampo(valor){
 // Herramienta para datos de prueba, NO un modo de registrar valores privados.
 exigir(valor!==undefined,'un campo omitido no significa borrado');
 exigir(valor===null||['string','number','boolean'].includes(typeof valor),'valor no canónico');
 return hashCelda(valor);
}
/**
 * Todas las entradas son instantáneas/atestaciones PSEUDO-fiables del laboratorio.
 * Aunque las firmas sean válidas, NO se permite ningún efecto ni se considera
 * acreditado un humano real hasta integrar un agente de captura auditado.
 *
 * Una propuesta automática solo se prepara como dirección informativa:
 * copiar el valor MANUAL acreditado a Metroges, exclusivamente para ese campo,
 * con condición de cotejo CAS del destino. Nunca se devuelve contenido privado.
 */
export function planificarPrecedenciaSincro11({
 capturas=[],vinculos=[],estados=[],celdasActuales=[],registroClaves,ahoraUtc,consumidos=[],identidadesExcluidas=[]
}={}){
 validarRegistroClaves(registroClaves);
 const now=fecha(ahoraUtc); exigir(now!==null,'hora de revisión inválida');
 for(const [k,arr] of Object.entries({capturas,vinculos,estados,celdasActuales,consumidos,identidadesExcluidas}))
   exigir(Array.isArray(arr)&&arr.length<=MAX_EVENTOS,`lote ${k} inválido o demasiado grande`);
 const seen=new Set();
 const val=(xs,kind)=>xs.map(s=>{
   const p=validarSobre(s,registroClaves,now);
   exigir(p.kind===kind,`evidencia de clase errónea, se esperaba ${kind}`);
   exigir(!seen.has(p.evento_id),'evento_id repetido en lote');seen.add(p.evento_id);
   return p;
 });
 const captures=val(capturas,KINDS.CAPTURA),links=val(vinculos,KINDS.VINCULO),remote=val(estados,KINDS.ESTADO);
 const consumed=new Set(consumidos);
 const excluded=new Set(identidadesExcluidas.map(v=>{const id=idFila(v);exigir(id!==null,'identidad excluida no válida');return id;}));
 for(const v of consumed)exigir(typeof v==='string'&&UUID_RE.test(v),'identidad consumida inválida');
 const linkMap=new Map(),remoteMap=new Map(),currentMap=new Map(),many=new Set(),captureCount=new Map();
 for(const x of captures){const k=claveCampo(x);captureCount.set(k,(captureCount.get(k)||0)+1);}
 for(const [arr,map] of [[links,linkMap],[remote,remoteMap]]){
  for(const x of arr){const key=claveCampo(x);if(map.has(key))many.add(key); else map.set(key,x);}
 }
 for(const cell of celdasActuales){
   exigir(cell&&typeof cell==='object'&&clavesExactas(cell,['id_fila','campo','significado','hash','revision_lectura']),
      'testigo de celda incompleto');
   exigir(idFila(cell.id_fila)!==null&&COLUMNAS.has(cell.campo)&&valorSeguro(cell.significado)&&HEX_RE.test(cell.hash)&&
      Number.isSafeInteger(cell.revision_lectura)&&cell.revision_lectura>0,'testigo de celda inválido');
   const key=claveCampo(cell);if(currentMap.has(key))many.add(key);else currentMap.set(key,cell);
 }
 const intentos=[];
 for(const m of captures){
   const key=claveCampo(m),l=linkMap.get(key),r=remoteMap.get(key),c=currentMap.get(key);
   let tipo,motivo;
   if(excluded.has(m.id_fila)){tipo='RETENER';motivo='IDENTIDAD_EXCLUIDA_POR_REGLA_DEL_OPERADOR';}
   else if(consumed.has(m.evento_id)){tipo='RETENER';motivo='EVENTO_YA_PROCESADO_NO_REINTENTAR';}
   else if(many.has(key)||captureCount.get(key)>1){tipo='RETENER';motivo='VARIAS_VERSIONES_DEL_MISMO_CAMPO';}
   else if(!l||!r){
     tipo='RETENER';
     const significadoDistinto=(!l&&links.some(x=>x.id_fila===m.id_fila&&x.campo===m.campo))||
       (!r&&remote.some(x=>x.id_fila===m.id_fila&&x.campo===m.campo));
     motivo=significadoDistinto?'SEMANTICA_CLASE_O_OBJETO_NO_COINCIDEN':'SIN_VINCULO_Y_ESTADO_DESTINO_ACREDITADOS';
   }
   else if(!coherencia(m,l)||!coherencia(m,r)){tipo='RETENER';motivo='SEMANTICA_CLASE_O_OBJETO_NO_COINCIDEN';}
   else if(!c){tipo='RETENER';motivo='SIN_LECTURA_ACTUAL_DEL_CAMPO_MANUAL';}
   else if(c.hash!==m.nuevo_hash){tipo='RETENER';motivo='CELDA_ACTUAL_Y_CAPTURA_MANUAL_DIFIEREN';}
   else if(c.revision_lectura<m.revision_fuente){tipo='RETENER';motivo='LECTURA_ANTERIOR_A_LA_CORRECCION';}
   else if(l.revision_fuente!==r.revision_fuente){tipo='RETENER';motivo='VERSION_DEL_VINCULO_DESACTUALIZADA';}
   else if(r.nuevo_hash===m.nuevo_hash){tipo='SIN_CAMBIO';motivo='METROGES_YA_COINCIDE_EN_ESE_CAMPO';}
   else {tipo='PREPARAR_COTEJO';motivo='RETORNO_MANUAL_POR_CAMPO_REQUIERE_CAS_Y_PERMISOS';}
   intentos.push({
    id_fila:idFila(m.id_fila),campo:m.campo,significado:m.significado,
    resultado:tipo,motivo,evento_id:m.evento_id,
    // Sólo metadatos para un futuro cotejo; la capa transaccional deberá
    // verificar otra vez identidad, autoría, permisos, revisión, celda y CAS.
    ... (tipo==='PREPARAR_COTEJO' ? {revision_destino_esperada:r.revision,
      huella_destino_esperada:r.nuevo_hash,huella_manual_a_contrastar:m.nuevo_hash} : {}),
   });
 }
 intentos.sort((a,b)=>a.id_fila-b.id_fila||a.campo.localeCompare(b.campo));
 const summary={};for(const i of intentos)summary[i.resultado]=(summary[i.resultado]||0)+1;
 return {
   version:SINCRO11_EVIDENCIA_VERSION,
   modalidad:'LABORATORIO_SIN_RECEPTOR',comparados:intentos.length,
   propuestas_de_cotejo:summary.PREPARAR_COTEJO||0,
   retenidos:summary.RETENER||0,ya_coinciden:summary.SIN_CAMBIO||0,
   detalles:intentos.slice(0,MAX_RESULTADOS),lista_parcial:intentos.length>MAX_RESULTADOS,
   capturas_firmadas_verificadas:captures.length,atestaciones_servidor_verificadas:links.length+remote.length,
   firma_de_captura_verificada:captures.length>0,firma_del_servidor_verificada:links.length+remote.length>0,
   humano_real_acreditado:false,identidad_t_acreditada_en_produccion:false,
   autoriza_sincronizar:false,autoriza_escribir_manteniment:false,autoriza_escribir_metroges:false,
   crea_T:false,crea_PA:false,expone_valores_privados:false,
   aviso:'La firma demuestra autenticidad de la clave de prueba, NO presencia humana ni permiso. Cada campo requiere cotejo y transacción CAS antes de cualquier retorno real; las correcciones independientes no se mezclan.'
 };
}
export const __sincro11CanonicoTestOnly = canonical;