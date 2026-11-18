/**
 * METROGES SINCRO12 · Corrección de una T EXISTENTE, con confirmación por lote.
 * CÓDIGO DE LABORATORIO SIN CONEXIONES NI ESCRITURAS.
 *
 * NO confundir: detectar una diferencia NO demuestra un evento manual nuevo;
 * una confirmación expresa de un valor NO demuestra quién editó la celda.
 * Ninguna entrada puede abrir permisos aunque todas las pruebas ficticias encajen.
 */
import {createHash} from 'node:crypto';

export const S12_EXISTENTE_VERSION='sincro12-correccion-t-existente-lab-20261118.1';
const LIBRO='1PQE5VsjTvDFvQZcqedyQKIs3RbSySHFK4JPQXBD0XyU';
const CORTE=Date.parse('2026-11-15T23:00:00.000Z');
const RE_UUID=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const RE_SHA=/^[a-f0-9]{64}$/i;
const RE_UTC=/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;
const RE_CAMPO=/^(?:[A-Q]|NOTA_[AEG]|ORDEN_T)$/;
const MAX=5000, LIMITE=100;
const MAPA_LAB=Object.freeze({TRABAJO:Object.freeze({
  K:Object.freeze({significado:'RECOGIDA_REAL_TALLER',
    tabla:'app_private.manteniment_t_trabajos',campo:'fecha_recogida'})
})});
const EVENTO_KEYS=['evento_id','spreadsheet_id','id_fila','columna','clase',
 'significado','revision_anterior','revision_nueva','hash_anterior','hash_nuevo',
 'capturado_en','origen'];
const VINCULO_KEYS=['evento_id','spreadsheet_id','id_fila','columna','clase',
 'significado','objeto_id','tabla_destino','campo_destino','revision_vinculo',
 'origen'];
const LECTURA_KEYS=['evento_id','spreadsheet_id','id_fila','columna',
 'revision_lectura','hash_vigente','leido_en','origen'];
const DESTINO_KEYS=['evento_id','objeto_id','tabla_destino','campo_destino',
 'revision_destino','hash_destino','leido_en','origen'];
const APROBACION_KEYS=['lote_id','spreadsheet_id','actor_id','sesion_id',
 'dispositivo_id','nonce','aal','permiso','accion','huella_lote',
 'confirmado_en','origen'];
function fallo(m){throw Error('SINCRO12 EXISTENTE: '+m);}
function validar(p,m){if(!p)fallo(m);}
function exact(o,keys){return !!o&&typeof o==='object'&&!Array.isArray(o)
 &&Object.keys(o).length===keys.length&&Object.keys(o).every(k=>keys.includes(k));}
function uuid(x){return typeof x==='string'&&RE_UUID.test(x);}
function sha(x){return typeof x==='string'&&RE_SHA.test(x);}
function ident(x) {
 if(typeof x==='number')return Number.isSafeInteger(x)&&x>0?x:null;
 if(typeof x==='string'&&/^[1-9]\d{0,14}$/.test(x)) {
  const n=Number(x);return Number.isSafeInteger(n)&&n>0?n:null;
 }
 return null;
}
function hora(x){if(typeof x!=='string'||!RE_UTC.test(x))return null;
 const n=Date.parse(x);return Number.isFinite(n)&&new Date(n).toISOString()===x?n:null;}
function canonical(o){
 if(Array.isArray(o))return '['+o.map(canonical).join(',')+']';
 if(o&&typeof o==='object')return '{'+Object.keys(o).sort()
  .map(k=>JSON.stringify(k)+':'+canonical(o[k])).join(',')+'}';
 return JSON.stringify(o);
}
function digest(o){return createHash('sha256').update(canonical(o)).digest('hex');}
/** Huella de prueba que liga la aprobación a TODAS las celdas y revisiones. */
export function huellaLoteS12(eventos){
 validar(Array.isArray(eventos)&&eventos.length<=MAX,'lote inválido');
 const ordenados=[...eventos].sort((a,b)=>{
  const ia=ident(a?.id_fila)??0,ib=ident(b?.id_fila)??0;
  return ia-ib||String(a?.columna??'').localeCompare(String(b?.columna??''))
   ||String(a?.evento_id??'').localeCompare(String(b?.evento_id??''));
 });
 return digest({dominio:'METROGES/S12/CORRECCION_EXISTENTE/LAB/1',eventos:ordenados});
}
function indexar(items,keys){
 const mapa=new Map();
 for(const x of items){
  const id=x?.evento_id;
  if(!uuid(id))continue;
  const k=id.toLowerCase();
  if(!mapa.has(k))mapa.set(k,[]);
  mapa.get(k).push(x);
 }
 return mapa;
}
function cotejar(e,v,l,d,a,now,excluidos,usados,loteCorrecto){
 const id=ident(e.id_fila);
 if(!exact(e,EVENTO_KEYS))return 'CAPTURA_CONTRATO_INVALIDO';
 if(e.spreadsheet_id!==LIBRO||id===null||!RE_CAMPO.test(e.columna??''))
  return 'IDENTIDAD_T_CAMPO_U_HOJA_INVALIDA';
 if(excluidos.has(id))return 'T_EXCLUIDA_POR_OPERADOR';
 if(usados.has(e.evento_id.toLowerCase()))return 'EVENTO_YA_CONSUMIDO';
 if(!Number.isSafeInteger(e.revision_anterior)||e.revision_anterior<1
  ||!Number.isSafeInteger(e.revision_nueva)
  ||e.revision_nueva!==e.revision_anterior+1
  ||!sha(e.hash_anterior)||!sha(e.hash_nuevo)
  ||e.hash_anterior===e.hash_nuevo)return 'REVISION_O_CAMBIO_NO_ACREDITADO';
 const ts=hora(e.capturado_en);
 if(ts===null||ts<=CORTE||ts>now)return 'NO_EVENTO_POSITIVO_POST_CORTE';
 if(e.origen!=='EDITOR_CONTROLADO_LAB'
  &&e.origen!=='ADOPCION_EXPRESA_ACTUAL_LAB')
   return 'ORIGEN_SOLO_OBSERVADO_NO_ES_EVENTO';
 if(!loteCorrecto)return 'APROBACION_DE_LOTE_AUSENTE_O_INCOMPLETA';
 if(a.accion!==(e.origen==='ADOPCION_EXPRESA_ACTUAL_LAB'
   ?'ADOPTAR_VALORES_ACTUALES':'CONFIRMAR_CAMBIOS_CONTROLADOS'))
    return 'ACCION_DE_CONFIRMACION_NO_COINCIDE_CON_ORIGEN';
 const tc=hora(a.confirmado_en);
 if(tc===null||tc<ts||tc>now)return 'CONFIRMACION_FUERA_DE_SECUENCIA';
 if(!l)return 'VINCULO_T_OBJETO_AUSENTE';
 if(!exact(l,VINCULO_KEYS)||l.origen!=='REGISTRO_CANONICO_FICTICIO'
  ||l.evento_id!==e.evento_id||l.spreadsheet_id!==LIBRO
  ||ident(l.id_fila)!==id||l.columna!==e.columna
  ||l.clase!==e.clase||l.significado!==e.significado
  ||!uuid(l.objeto_id)||!Number.isSafeInteger(l.revision_vinculo)
  ||l.revision_vinculo<1)return 'VINCULO_T_OBJETO_INCORRECTO';
 const sem=MAPA_LAB[e.clase]?.[e.columna];
 if(!sem||sem.significado!==e.significado
  ||sem.tabla!==l.tabla_destino||sem.campo!==l.campo_destino)
  return 'CLASE_Y_CAMPO_SIN_EQUIVALENCIA_VERIFICADA';
 if(!v)return 'SIN_RELECTURA_FRESCA_DE_CELDA';
 if(!exact(v,LECTURA_KEYS)||v.origen!=='RELECTURA_HOJA_FICTICIA'
  ||v.evento_id!==e.evento_id||v.spreadsheet_id!==LIBRO
  ||ident(v.id_fila)!==id||v.columna!==e.columna
  ||!Number.isSafeInteger(v.revision_lectura)
  ||v.revision_lectura<e.revision_nueva||v.hash_vigente!==e.hash_nuevo)
  return 'LECTURA_DE_HOJA_NO_COINCIDE';
 const tl=hora(v.leido_en);
 if(tl===null||tl<tc||tl>now)return 'RELECTURA_DE_HOJA_FUERA_DE_SECUENCIA';
 if(!d)return 'SIN_LECTURA_VIGENTE_DEL_DESTINO';
 if(!exact(d,DESTINO_KEYS)||d.origen!=='RELECTURA_DESTINO_FICTICIA'
  ||d.evento_id!==e.evento_id||d.objeto_id!==l.objeto_id
  ||d.tabla_destino!==l.tabla_destino||d.campo_destino!==l.campo_destino
  ||!Number.isSafeInteger(d.revision_destino)||d.revision_destino<1
  ||!sha(d.hash_destino))return 'DESTINO_NO_CORRESPONDE';
 const td=hora(d.leido_en);
 if(td===null||td<tc||td>now)return 'LECTURA_DESTINO_FUERA_DE_SECUENCIA';
 if(d.hash_destino===e.hash_nuevo)return 'DESTINO_YA_IGUAL_SIN_ESCRITURA';
 return e.origen==='ADOPCION_EXPRESA_ACTUAL_LAB'
   ?'ADOPCION_ACTUAL_SOLO_LAB_SIN_AUTORIA_ORIGINAL'
   :'CAMBIO_CONTROLADO_SOLO_LAB';
}
/**
 * Todas las entradas se fabrican en pruebas: NO valida una sesión real.
 * Diferencias detectadas vía onEdit/F2 no constituyen evento nuevo.
 * La adopción explícita declara un NUEVO acto de conformidad, no fecha
 * ni autoría de edición en la hoja. Ambos quedan solo como candidatos LAB.
 */
export function auditarCorreccionesExistentesS12({
 observado_en,eventos=[],aprobacion=null,vinculos=[],lecturas=[],destinos=[],
 eventos_consumidos=[],identidades_excluidas=[]
}={}){
 const now=hora(observado_en);validar(now!==null&&now>CORTE,'instante de consulta inválido');
 for(const [nombre,arr] of Object.entries({eventos,vinculos,lecturas,destinos,
  eventos_consumidos,identidades_excluidas}))
  validar(Array.isArray(arr)&&arr.length<=MAX,'lote '+nombre+' inválido');
 const excluidos=new Set(),usados=new Set();
 for(const t of identidades_excluidas){
  const id=ident(t);validar(id!==null,'exclusión requiere ID_FILA T');excluidos.add(id);
 }
 for(const e of eventos_consumidos){
  validar(uuid(e),'evento consumido inválido');usados.add(e.toLowerCase());
 }
 const ap=exact(aprobacion,APROBACION_KEYS)&&
  aprobacion.spreadsheet_id===LIBRO&&
  ['CONFIRMAR_CAMBIOS_CONTROLADOS','ADOPTAR_VALORES_ACTUALES'].includes(aprobacion.accion)&&
  aprobacion.origen==='SERVIDOR_LAB_NO_AUTENTICA'&&
  aprobacion.aal==='aal2'&&
  aprobacion.permiso==='CONFIRMAR_CORRECCION_EXISTENTE'&&
  ['lote_id','actor_id','sesion_id','dispositivo_id','nonce'].every(k=>uuid(aprobacion[k]))&&
  sha(aprobacion.huella_lote)&&
  aprobacion.huella_lote===huellaLoteS12(eventos)&&
  hora(aprobacion.confirmado_en)!==null&&
  hora(aprobacion.confirmado_en)>CORTE&&
  hora(aprobacion.confirmado_en)<=now;
 const links=indexar(vinculos),reads=indexar(lecturas),targets=indexar(destinos);
 const eventIds=new Map(),pares=new Map();
 for(const e of eventos) {
  if(uuid(e?.evento_id)){const k=e.evento_id.toLowerCase();
   eventIds.set(k,(eventIds.get(k)||0)+1);}
  const id=ident(e?.id_fila);
  if(id!==null&&typeof e?.columna==='string'){
   const k=id+'|'+e.columna;pares.set(k,(pares.get(k)||0)+1);
  }
 }
 const resultado=[],motivos={};
 for(const e of eventos){
  const id=ident(e?.id_fila),col=typeof e?.columna==='string'?e.columna:null;
  const eid=uuid(e?.evento_id)?e.evento_id.toLowerCase():null;
  let motivo;
  if(eid===null)motivo='ID_EVENTO_INVALIDO';
  else if(eventIds.get(eid)!==1||pares.get(id+'|'+col)!==1)
   motivo='EVENTO_O_T_CAMPO_DUPLICADO';
  else if([links.get(eid),reads.get(eid),targets.get(eid)].some(arr=>arr&&arr.length!==1))
   motivo='EVIDENCIA_EVENTO_DUPLICADA';
  else motivo=cotejar(e,reads.get(eid)?.[0],links.get(eid)?.[0],
   targets.get(eid)?.[0],aprobacion,now,excluidos,usados,ap);
  motivos[motivo]=(motivos[motivo]||0)+1;
  if(resultado.length<LIMITE)resultado.push({
   id_fila:id,columna:col,estado:motivo==='CAMBIO_CONTROLADO_SOLO_LAB'
    ||motivo==='ADOPCION_ACTUAL_SOLO_LAB_SIN_AUTORIA_ORIGINAL'
    ?'CANDIDATO_LAB_SIN_AUTORIZAR':'RETENER_SIN_ESCRIBIR',motivo
  });
 }
 return {
  version:S12_EXISTENTE_VERSION,modo:'ENSAYO_SIN_CONEXIONES',
  total:eventos.length,detalles:resultado,detalles_parciales:eventos.length>LIMITE,
  motivos:Object.fromEntries(Object.entries(motivos).sort(([a],[b])=>a.localeCompare(b))),
  candidatos_de_laboratorio:(motivos.CAMBIO_CONTROLADO_SOLO_LAB||0)+
    (motivos.ADOPCION_ACTUAL_SOLO_LAB_SIN_AUTORIA_ORIGINAL||0),
  usuario_real_autenticado:false,autor_edicion_hoja_acreditado:false,
  vinculos_reales_acreditados:0,eventos_reales_acreditados:0,
  autorizacion_real_de_retorno:false,autoriza_sincronizar:false,
  permiso_crear_T:false,permiso_crear_PA:false,
  escribe_manteniment:false,escribe_tancament:false,escribe_supabase:false,
  aviso:'Una diferencia de hoja, onEdit o F2 nunca es por sí misma evento manual acreditado. Aprobar un valor solo demuestra, tras validación real futura, una decisión nueva; no la autoría original de la celda.'
 };
}
