/**
 * METROGES / SINCRO 12 · ensayo de alta positiva T → objeto.
 *
 * SOLO LABORATORIO. Los cuatro registros llegan ya obtenidos de un ensayo:
 * NO hay autenticación, consulta remota, firmas de producción ni escritura.
 *
 * Una solicitud de alta NO equivale a asignación de ID_FILA. Solo el acuse
 * de la hoja que contiene el valor CANÓNICO de T puede proponer ese vínculo.
 * La prueba jamás acredita persona, origen real o permiso de sincronizar.
 */
export const VERSION_ENLACE_S12='sincro12-enlace-positivo-lab-20261117.1';
const HOJA='1PQE5VsjTvDFvQZcqedyQKIs3RbSySHFK4JPQXBD0XyU';
const CORTE=Date.parse('2026-11-15T23:00:00.000Z');
const UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const SHA=/^[0-9a-f]{64}$/i;
const UTC=/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;
const MAX=10000, DETALLES=100;
function ok(x,msg){if(!x)throw Error('SINCRO12 ENLACE: '+msg)}
function entero(x){
 if(typeof x==='number')return Number.isSafeInteger(x)&&x>0?x:null;
 if(typeof x==='string'&&/^[1-9]\d{0,14}$/.test(x)){
  const n=Number(x);return Number.isSafeInteger(n)&&n>0?n:null;
 }
 return null;
}
function instante(x){
 if(typeof x!=='string'||!UTC.test(x))return null;
 const n=Date.parse(x);return Number.isFinite(n)&&new Date(n).toISOString()===x?n:null;
}
const validUUID=x=>typeof x==='string'&&UUID.test(x);
const validSha=x=>typeof x==='string'&&SHA.test(x);
function exact(o,claves){
 return o&&typeof o==='object'&&!Array.isArray(o)
 &&Object.keys(o).length===claves.length
 &&Object.keys(o).every(k=>claves.includes(k));
}
const LLAVES=Object.freeze({
 alta:['tipo','request_id','objeto_sync_id','trabajo_hotel_id','revision_destino',
       'hash_solicitud','creado_en'],
 acuse:['request_id','spreadsheet_id','id_fila','objeto_sync_id','tipo_fila',
        'revision_hoja','hash_solicitud','observado_en','origen'],
 hoja:['spreadsheet_id','id_fila','tipo_fila','revision_hoja','hash_solicitud',
       'leido_en','origen'],
 destino:['objeto_sync_id','trabajo_hotel_id','revision_destino','existe','leido_en','origen']
});
function valorar(v,ahora){
 const a=v.alta,b=v.acuse,c=v.hoja,d=v.destino;
 if(!a)return 'SIN_SOLICITUD_DE_ALTA';
 if(!exact(a,LLAVES.alta))return 'SOLICITUD_CONTRATO_INVALIDO';
 if(a.tipo!=='NUEVO_TRABAJO_MANTENIMENT'||!validUUID(a.request_id)
  ||!validUUID(a.objeto_sync_id)||!validUUID(a.trabajo_hotel_id)
  ||!Number.isSafeInteger(a.revision_destino)||a.revision_destino<1
  ||!validSha(a.hash_solicitud))return 'SOLICITUD_ORIGEN_INVALIDO';
 const t0=instante(a.creado_en);
 if(t0===null||t0<=CORTE||t0>ahora)return 'SOLICITUD_NO_ACREDITA_MOVIMIENTO_FUTURO';
 if(!b)return 'SIN_ACUSE_T_DE_HOJA';
 if(!exact(b,LLAVES.acuse))return 'ACUSE_T_CONTRATO_INVALIDO';
 const id=entero(b.id_fila),t1=instante(b.observado_en);
 if(b.spreadsheet_id!==HOJA||id===null||b.tipo_fila!=='TRABAJO'
  ||b.origen!=='ACK_HOJA_FICTICIO'||!Number.isSafeInteger(b.revision_hoja)
  ||b.revision_hoja<1)return 'ACUSE_T_SIN_IDENTIDAD_CANONICA';
 if(b.request_id!==a.request_id||b.objeto_sync_id!==a.objeto_sync_id
  ||b.hash_solicitud!==a.hash_solicitud)return 'ACUSE_T_NO_ES_LA_SOLICITUD';
 if(t1===null||t1<t0||t1>ahora)return 'ACUSE_T_FUERA_DE_SECUENCIA';
 if(!c)return 'SIN_RELECTURA_VIGENTE_DE_T';
 if(!exact(c,LLAVES.hoja))return 'RELECTURA_HOJA_CONTRATO_INVALIDO';
 if(c.spreadsheet_id!==HOJA||entero(c.id_fila)!==id||c.tipo_fila!=='TRABAJO'
  ||c.origen!=='RELECTURA_HOJA_FICTICIA'
  ||c.revision_hoja<b.revision_hoja||!Number.isSafeInteger(c.revision_hoja)
  ||c.hash_solicitud!==a.hash_solicitud)return 'RELECTURA_HOJA_NO_COINCIDE';
 const t2=instante(c.leido_en);
 if(t2===null||t2<t1||t2>ahora)return 'RELECTURA_HOJA_FUERA_DE_SECUENCIA';
 if(!d)return 'SIN_RELECTURA_ACTUAL_DEL_DESTINO';
 if(!exact(d,LLAVES.destino))return 'DESTINO_CONTRATO_INVALIDO';
 if(d.origen!=='RELECTURA_DESTINO_FICTICIA'||d.existe!==true
  ||d.objeto_sync_id!==a.objeto_sync_id||d.trabajo_hotel_id!==a.trabajo_hotel_id
  ||!Number.isSafeInteger(d.revision_destino)
  ||d.revision_destino<a.revision_destino)return 'DESTINO_NO_CORRESPONDE_AL_ALTA';
 const t3=instante(d.leido_en);
 if(t3===null||t3<t1||t3>ahora)return 'RELECTURA_DESTINO_FUERA_DE_SECUENCIA';
 return 'ENLACE_TECNICO_FICTICIO_SOLO_CANDIDATO';
}
/**
 * Cada alta cuenta como solicitud de crear una T nueva posterior al corte.
 * La corrección de una T ya existente necesita otra vía y prueba auténtica;
 * un snapshot y una fecha del hecho nunca la convierten en 'nueva'.
 *
 * Evidencias estructurales de laboratorio: NO aceptar su salida en un receptor.
 */
export function auditarAltasPositivasSincro12({
 observado_en,altas=[],identidades_ya_vinculadas=[]
}={}){
 const ahora=instante(observado_en);ok(ahora!==null&&ahora>CORTE,'observación inválida');
 ok(Array.isArray(altas)&&altas.length<=MAX,'lote de altas inválido');
 ok(Array.isArray(identidades_ya_vinculadas)
    &&identidades_ya_vinculadas.length<=MAX,'identidades previas inválidas');
 const previo=new Set();
 for(const x of identidades_ya_vinculadas){
  const id=entero(x);ok(id!==null,'identidad previa no es T');
  previo.add(id);
 }
 const eventos=new Map(),ts=new Map();
 for(const v of altas){
  ok(v&&typeof v==='object'&&!Array.isArray(v)
     &&Object.keys(v).every(k=>['alta','acuse','hoja','destino'].includes(k)),
     'sobre de alta desconocido');
  const req=v.alta?.request_id;
  if(typeof req==='string'&&validUUID(req))
   eventos.set(req,(eventos.get(req)||0)+1);
  const t=entero(v.acuse?.id_fila);
  if(t!==null)ts.set(t,(ts.get(t)||0)+1);
 }
 const motivos={},detalle=[];
 for(const v of altas){
  const id=entero(v.acuse?.id_fila),req=v.alta?.request_id;
  let motivo;
  if(validUUID(req)&&eventos.get(req)>1)motivo='SOLICITUD_DUPLICADA_O_REINTENTO_AMBIGUO';
  else if(id!==null&&ts.get(id)>1)motivo='T_ASIGNADA_A_VARIAS_SOLICITUDES';
  else if(id!==null&&previo.has(id))motivo='T_YA_VINCULADA_NO_REASIGNAR';
  else motivo=valorar(v,ahora);
  motivos[motivo]=(motivos[motivo]||0)+1;
  if(detalle.length<DETALLES)detalle.push({
   id_fila:id,estado:motivo==='ENLACE_TECNICO_FICTICIO_SOLO_CANDIDATO'
      ?'CANDIDATO_SIN_ACREDITACION':'RETENER_SIN_ESCRIBIR',motivo
  });
 }
 return {
  version:VERSION_ENLACE_S12,modo:'CONTRATO_LABORATORIO_SIN_CONEXIONES',
  total:altas.length,detalles:detalle,detalle_parcial:altas.length>DETALLES,
  motivos:Object.fromEntries(Object.entries(motivos).sort(([a],[b])=>a.localeCompare(b))),
  candidatos_de_laboratorio:motivos.ENLACE_TECNICO_FICTICIO_SOLO_CANDIDATO||0,
  humano_real_acreditado:false,
  emisor_hoja_real_autenticado:false,
  usuario_servidor_real_verificado:false,
  vinculos_reales_acreditados:0,
  autoriza_sincronizar:false,permite_crear_T:false,permite_crear_PA:false,
  escribe_manteniment:false,escribe_tancament:false,escribe_supabase:false,
  aviso:'Un acuse y una relectura de prueba NO acreditan identidades reales. Solo la T asignada y atestada por un emisor autorizado podrá ser candidata a un vínculo futuro.'
 };
}