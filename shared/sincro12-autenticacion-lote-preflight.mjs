/**
 * METROGES · SINCRO 12 · PREFLIGHT DE AUTENTICACIÓN DE UN LOTE.
 * CANDIDATA DE LABORATORIO. NO INSTALAR, NO EMITIR FIRMA, NO ESCRIBIR.
 * Las dependencias vienen de adaptadores de SERVIDOR; no existen aún aquí.
 *
 * Verificar una sesión/confirmación jamás prueba quién editó antes una celda.
 * Una huella de celda suministrada por el cliente tampoco es prueba de origen:
 * se requiere lectura fresca independiente, vínculo positivo y CAS posterior.
 */
import {createHash} from 'node:crypto';
export const S12_AUTH_PREFLIGHT_VERSION='sincro12-auth-lote-lab-20261118.1';
const SHEET='1PQE5VsjTvDFvQZcqedyQKIs3RbSySHFK4JPQXBD0XyU';
const CORTE=Date.parse('2026-11-15T23:00:00.000Z');
const U=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const H=/^[0-9a-f]{64}$/i;
const ISO=/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;
const JWT=/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const DEVICE=/^[A-Za-z0-9_-]{32,256}$/;
const MAX=100;
const RQ=['tipo','spreadsheet_id','lote_id','request_id','nonce','huella_alcance','presentado_en','celdas'];
const CELDA=['id_fila','columna','clase','revision_hoja','hash_vigente'];
function object(x){return x!==null&&typeof x==='object'&&!Array.isArray(x);}
function exact(x,keys){return object(x)&&Object.keys(x).length===keys.length&&
 Object.keys(x).every(k=>keys.includes(k));}
function uuid(x){return typeof x==='string'&&U.test(x);}
function digest(x){return createHash('sha256').update(x,'utf8').digest('hex');}
function instant(x){
 if(typeof x!=='string'||!ISO.test(x))return null;
 const n=Date.parse(x);return Number.isFinite(n)&&new Date(n).toISOString()===x?n:null;
}
function ident(x){
 if(Number.isSafeInteger(x)&&x>0)return x;
 if(typeof x==='string'&&/^[1-9]\d{0,14}$/.test(x)){
  const v=Number(x);return Number.isSafeInteger(v)&&v>0?v:null;
 }
 return null;
}
function normalizar(c){
 if(!exact(c,CELDA))return null;
 const id=ident(c.id_fila);
 if(id===null||c.columna!=='K'||c.clase!=='TRABAJO'
  ||!Number.isSafeInteger(c.revision_hoja)||c.revision_hoja<1
  ||typeof c.hash_vigente!=='string'||!H.test(c.hash_vigente))
  return null;
 return [id,'K','TRABAJO',c.revision_hoja,c.hash_vigente.toLowerCase()];
}
/** La única entrada que el cliente puede declarar es un deseo de confirmar.
 * Los valores actuales y la identificación T-objeto han de cotejarse después
 * desde fuentes INDEPENDIENTES autorizadas.
 */
export function huellaAlcanceS12(celdas){
 if(!Array.isArray(celdas)||celdas.length===0||celdas.length>MAX)return null;
 const norm=celdas.map(normalizar);
 if(norm.some(x=>x===null))return null;
 const keys=new Set(norm.map(v=>v[0]+'|'+v[1]));
 if(keys.size!==norm.length)return null;
 norm.sort((a,b)=>a[0]-b[0]||a[1].localeCompare(b[1]));
 return digest(JSON.stringify(['METROGES/SINCRO12/ADOPCION_POR_LOTE/LAB/1',norm]));
}
function resultado(motivo,items=0){
 return {
  version:S12_AUTH_PREFLIGHT_VERSION,
  modo:'PREFLIGHT_LABORATORIO_SIN_ADAPTADOR_PRODUCTIVO',
  resultado:motivo==='CONTRATO_COTEJADO_NO_AUTORIZADO'
    ?'CANDIDATO_SIN_AUTORIZACION':'RETENER_SIN_ESCRIBIR',
  motivo,elementos:items,
  autor_de_edicion_en_google_acreditado:false,
  sesion_productiva_acreditada_por_este_modulo:false,
  recibo_de_confirmacion_emitido:false,
  origen_hoja_real_acreditado:false,
  vinculos_T_objeto_reales_acreditados:false,
  autoriza_sincronizar:false,permite_crear_T:false,permite_crear_PA:false,
  escritura_manteniment:false,escritura_tancament:false,
  escritura_supabase:false,
 };
}
function authShape(auth){
 return object(auth)&&object(auth.auth)
  &&typeof auth.auth.getUser==='function'
  &&typeof auth.auth.getClaims==='function'
  &&object(auth.auth.mfa)
  &&typeof auth.auth.mfa.getAuthenticatorAssuranceLevel==='function';
}
function sourceShape(src){
 return object(src)&&[
  'leerUsuario','leerSesionAuth','buscarDispositivoPorHuella',
  'leerLotePreparado','nonceNoConsumido','leerVinculoT','leerCeldaHoja'
 ].every(k=>typeof src[k]==='function');
}
/**
 * API de lectura. No hay implementación de red, credenciales ni SQL:
 * el adaptador real debe ser desarrollado y revisado antes de su uso.
 *
 * La aprobación se limita al VALOR ACTUAL VISIBLE. No admite onEdit ni F2
 * como prueba de persona. No existe backend de escritura en este módulo.
 */
export async function preflightAutorizacionLoteS12({
 authorization,deviceToken,solicitud,auth,fuentes,observado_en
}={}){
 const now=instant(observado_en);
 if(now===null||now<=CORTE)return resultado('RELOJ_SERVIDOR_NO_ACREDITADO');
 if(!exact(solicitud,RQ)||solicitud.tipo!=='ADOPTAR_VALORES_ACTUALES'
  ||solicitud.spreadsheet_id!==SHEET
  ||!uuid(solicitud.lote_id)||!uuid(solicitud.request_id)
  ||!uuid(solicitud.nonce)||typeof solicitud.huella_alcance!=='string'
  ||!H.test(solicitud.huella_alcance)
  ||!Array.isArray(solicitud.celdas))return resultado('SOLICITUD_DE_LOTE_INVALIDA');
 const celdas=solicitud.celdas,hash=huellaAlcanceS12(celdas);
 if(hash===null||hash!==solicitud.huella_alcance.toLowerCase())
  return resultado('ALCANCE_T_CAMPOS_NO_COINCIDE');
 const presentado=instant(solicitud.presentado_en);
 if(presentado===null||presentado<=CORTE||presentado>now
  ||now-presentado>5*60*1000)
  return resultado('PRESENTACION_DEL_LOTE_CADUCADA',celdas.length);
 if(typeof authorization!=='string'||authorization.length>5000||
  !/^Bearer [^\s]+$/.test(authorization))return resultado('TOKEN_BEARER_AUSENTE',celdas.length);
 const jwt=authorization.slice(7);
 if(!JWT.test(jwt))return resultado('TOKEN_BEARER_INVALIDO',celdas.length);
 if(typeof deviceToken!=='string'||!DEVICE.test(deviceToken))
  return resultado('PRUEBA_DISPOSITIVO_AUSENTE',celdas.length);
 if(!authShape(auth)||!sourceShape(fuentes))
  return resultado('ADAPTADORES_CONFIABLES_NO_INSTALADOS',celdas.length);
 try{
  // No descodificar JWT sin verificar. getClaims verifica la firma; getUser
  // consulta Auth y permite cotejar que la cuenta sigue siendo válida.
  const claimsReply=await auth.auth.getClaims(jwt);
  const c=claimsReply?.data?.claims;
  if(claimsReply?.error||!object(c)||!uuid(c.sub)
   ||!uuid(c.session_id)||c.aal!=='aal2'||c.is_anonymous===true
   ||c.role!=='authenticated'
   ||!Number.isSafeInteger(c.iat)||!Number.isSafeInteger(c.exp)
   ||c.iat*1000>now||c.exp*1000<=now)
   return resultado('CLAIMS_VERIFICADOS_INSUFICIENTES',celdas.length);
  const userReply=await auth.auth.getUser(jwt);
  const user=userReply?.data?.user;
  if(userReply?.error||!object(user)||user.id!==c.sub)
   return resultado('CUENTA_AUTH_NO_COINCIDE',celdas.length);
  const mfaReply=await auth.auth.mfa.getAuthenticatorAssuranceLevel(jwt);
  if(mfaReply?.error||mfaReply?.data?.currentLevel!=='aal2')
   return resultado('MFA_REAL_NO_ACREDITADA_POR_ADAPTADOR',celdas.length);
  const perfil=await fuentes.leerUsuario(c.sub);
  if(!object(perfil)||perfil.id!==c.sub||perfil.activo!==true
   ||perfil.permisos?.sincro12_confirmar_lote!==true)
   return resultado('PERMISO_EXPLICITO_NO_EXISTE_O_CUENTA_INACTIVA',celdas.length);
  const credenciales=Date.parse(perfil.credenciales_actualizadas_en);
  if(!Number.isFinite(credenciales)||c.iat*1000<credenciales)
   return resultado('TOKEN_ANTERIOR_A_CREDENCIALES',celdas.length);
  const sesion=await fuentes.leerSesionAuth({userId:c.sub,sessionId:c.session_id});
  if(!object(sesion)||sesion.id!==c.session_id||sesion.user_id!==c.sub
   ||sesion.aal!=='aal2'||(sesion.not_after!==null
      &&sesion.not_after!==undefined&&
      (!Number.isFinite(Date.parse(sesion.not_after))||Date.parse(sesion.not_after)<=now)))
   return resultado('SESION_REVOCADA_O_NO_VIGENTE',celdas.length);
  const deviceHash=digest(deviceToken);
  const device=await fuentes.buscarDispositivoPorHuella({userId:c.sub,tokenHash:deviceHash});
  if(!object(device)||device.usuario_id!==c.sub||!uuid(device.id)
   ||device.estado!=='autorizado')
   return resultado('DISPOSITIVO_NO_AUTORIZADO',celdas.length);
  // El lote almacenado del SERVIDOR debe corresponder al que se mostró
  // previamente. Una propiedad "mostrado" enviada por cliente no se acepta.
  const saved=await fuentes.leerLotePreparado({loteId:solicitud.lote_id,userId:c.sub});
  if(!object(saved)||saved.lote_id!==solicitud.lote_id||
   saved.usuario_id!==c.sub||saved.session_id!==c.session_id||
   saved.huella_alcance!==hash||saved.request_id!==solicitud.request_id
   ||saved.nonce!==solicitud.nonce||saved.estado!=='PRESENTADO'
   ||saved.presentado_en!==solicitud.presentado_en)
   return resultado('LOTE_NO_PRESENTADO_POR_SERVIDOR',celdas.length);
  if(await fuentes.nonceNoConsumido({nonce:solicitud.nonce})!==true)
   return resultado('NONCE_USADO_O_NO_VERIFICABLE',celdas.length);
  // Todas las celdas siguen requiriendo lectura directa de la hoja y enlace
  // canónico POSITIVO por T, no por posición, PA, DFM ni UUID en notas.
  for(const c of celdas){
   const id=ident(c.id_fila);
   const vinc=await fuentes.leerVinculoT({spreadsheetId:SHEET,idFila:id,campo:'K'});
   if(!object(vinc)||vinc.spreadsheet_id!==SHEET||ident(vinc.id_fila)!==id
    ||vinc.estado!=='ACREDITADA'||vinc.clase!=='TRABAJO'
    ||vinc.origen_vinculo!=='ACUSE_T_CANONICO_VERIFICADO'
    ||!uuid(vinc.trabajo_sync_id))
    return resultado('VINCULO_T_OBJETO_NO_ACREDITADO',celdas.length);
   const read=await fuentes.leerCeldaHoja({spreadsheetId:SHEET,idFila:id,campo:'K'});
   if(!object(read)||read.spreadsheet_id!==SHEET||ident(read.id_fila)!==id
    ||read.columna!=='K'||read.revision!==c.revision_hoja
    ||typeof read.hash!=='string'||read.hash.toLowerCase()!==c.hash_vigente.toLowerCase())
    return resultado('RELECTURA_HOJA_NO_COINCIDE',celdas.length);
  }
  // IMPORTANTE: es un preflight de adaptadores. Ni firma, ni ACK, ni token
  // para el receptor. Faltan emisor autorizado, CAS y consumo atómico nonce.
  return resultado('CONTRATO_COTEJADO_NO_AUTORIZADO',celdas.length);
 }catch(_){
  // No reflejar errores SQL/Auth, tokens, detalles privados ni stacktraces.
  return resultado('SERVICIO_CONFIABLE_NO_VERIFICABLE',celdas.length);
 }
}
