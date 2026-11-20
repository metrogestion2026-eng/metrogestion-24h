/**
 * METROGES · SINCRO 12 · ADAPTADOR DE DIAGNÓSTICO CON PUERTOS SOLO LECTURA.
 * PR en borrador. NO es un servicio instalado ni acepta credenciales, JWT,
 * escribir celdas, ejecutar SQL arbitrario, crear vínculos o emitir recibos.
 *
 * Las fuentes reales se leen desde puertos proporcionados por un operador
 * autorizado, con lecturas A1 acotadas y un SELECT fijo ya revisado.
 * La pestaña oculta REGISTRO_FILAS es un registro de ASIGNACIÓN de T,
 * no de edición manual humana ni del objeto de Metroges.
 */
export const S12_READONLY_DIAGNOSTICO_VERSION='sincro12-readonly-fuentes-20261118.1';
export const S12_READONLY_LIBRO='1PQE5VsjTvDFvQZcqedyQKIs3RbSySHFK4JPQXBD0XyU';
export const S12_READONLY_CONSULTA='sincro12_diagnostico_capacidades_solo_lectura_20261118.sql';

const CABECERA_REG=['ID_FILA','ESTADO','FECHA_ASIGNACION','FECHA_ELIMINACION','OBSERVACION'];
const TABLES=['MANTENIMENT','REGISTRO_FILAS'];
const CAMPOS_SQL={
  contadores:[
    'filas_t_registradas','identidades_declaradas_acreditadas',
    'cambios_recibidos','recibos_de_entrega','trabajos_catalogados',
    'usuarios_con_permiso_s12'
  ],
  verificaciones:[
    'auth_sesiones_campos','usuarios_campos','dispositivos_campos',
    'vinculos_staging_campos','eventos_staging_campos',
    'fecha_recogida_disponible','outbox_identifica_t_y_campo'
  ],
  barreras:[
    'evento_manual_real_acreditado',
    'vinculo_t_objeto_real_acreditado_por_esta_consulta',
    'nonce_consumido_en_transaccion','autoriza_sincronizar'
  ]
};
const MAX_EMITIDOS=9007199254740991;
const unwrap=x=>x&&typeof x==='object'&&!Array.isArray(x)
 &&x.result&&typeof x.result==='object'?x.result:x;
const integer=x=>{
 if(typeof x==='number')return Number.isSafeInteger(x)&&x>=0?x:null;
 if(typeof x==='string'&&/^(?:0|[1-9]\d{0,15})$/.test(x)){
  const n=Number(x);return Number.isSafeInteger(n)&&n>=0?n:null;
 }
 return null;
};
const exactHeader=(v,keys)=>Array.isArray(v)&&v.length>=keys.length
 &&keys.every((k,i)=>v[i]===k);
const sheetFrom=(meta,name)=>{
 const sheets=meta?.sheets;
 if(!Array.isArray(sheets))return null;
 const matching=sheets.filter(s=>s?.properties?.title===name
   &&s.properties.sheetType==='GRID');
 return matching.length===1?matching[0]:null;
};
function output(motivos,info={}){
 return {
  version:S12_READONLY_DIAGNOSTICO_VERSION,
  modo:'LECTURA_DE_CAPACIDADES_NO_ES_REGISTRO_DE_EVENTOS',
  estado:motivos.some(m=>m.startsWith('FUENTE_')||m.startsWith('ESTRUCTURA_'))
    ?'DIAGNOSTICO_INCOMPLETO':'SINCRONIZACION_BLOQUEADA',
  motivos:[...new Set(motivos)].sort(),
  ...info,
  prueba_de_autor_de_edicion:false,
  acuse_de_T_objeto_real:false,
  revision_por_celda_real_acreditada:false,
  sesion_productiva_validada:false,
  evento_manual_nuevo_acreditado:false,
  autoriza_crear_T:false,autoriza_crear_PA:false,
  autoriza_sincronizar:false,
  escritura_google:false,escritura_supabase:false,
  autoriza_activar_scripts:false,
  nota:'REGISTRO_FILAS prueba control de asignación/baja de ID_FILA, no autoría manual ni enlace T-objeto. Las lecturas son fotografías no atómicas.'
 };
}
function validarFuentes({meta,headT,headersRegistro,contadorRegistro,server}){
 const problemas=[];
 const informacion={
  libro_reconocido:false,
  columna_t_es_id_fila:false,
  registro_identidades_detectado:false,
  registro_identidades_oculto:false,
  ultimo_id_emitido:null,
  conteos:{
   filas_t_registradas:null,identidades_declaradas_acreditadas:null,
   cambios_recibidos:null,recibos_de_entrega:null,
   trabajos_catalogados:null,usuarios_con_permiso_s12:null
  },
  columnas_servidor_verificadas:false,
  outbox_identifica_t_y_campo:null,
 };
 const m=unwrap(meta),ht=unwrap(headT),hr=unwrap(headersRegistro),
  control=unwrap(contadorRegistro),s=unwrap(server);
 if(m?.spreadsheetId!==S12_READONLY_LIBRO){
  problemas.push('FUENTE_LIBRO_INCORRECTO');return output(problemas,informacion);
 }
 informacion.libro_reconocido=true;
 const hoja=sheetFrom(m,'MANTENIMENT'),reg=sheetFrom(m,'REGISTRO_FILAS');
 if(!hoja||!reg||reg.properties?.hidden!==true){
  problemas.push('ESTRUCTURA_REGISTRO_HOJA_NO_CONFIABLE');
  return output(problemas,informacion);
 }
 informacion.registro_identidades_oculto=true;
 if(!Array.isArray(ht?.values)||ht.values[0]?.[0]!=='ID_FILA'){
  problemas.push('ESTRUCTURA_COLUMNA_T_SIN_ID_FILA');
 }else informacion.columna_t_es_id_fila=true;
 if(!Array.isArray(hr?.values)||!exactHeader(hr.values[0],CABECERA_REG)){
  problemas.push('ESTRUCTURA_REGISTRO_CABECERAS_INVALIDAS');
 }else informacion.registro_identidades_detectado=true;
 if(!Array.isArray(control?.values)||control.values[0]?.[0]!=='ULTIMO_ID_EMITIDO'){
  problemas.push('ESTRUCTURA_CONTADOR_T_NO_VERIFICADO');
 }else{
  const n=integer(control.values[0][1]);
  if(n===null||n<1||n>MAX_EMITIDOS){
   problemas.push('ESTRUCTURA_ULTIMO_ID_EMITIDO_INVALIDO');
  }else informacion.ultimo_id_emitido=n;
 }
 if(!s||typeof s!=='object'||Array.isArray(s)
    ||s.clasificacion!=='SOLO_CAPACIDADES_NO_ES_ACREDITACION'){
  problemas.push('FUENTE_CENSO_SERVIDOR_INVALIDA');
  return output(problemas,informacion);
 }
 for(const c of CAMPOS_SQL.contadores){
  const n=integer(s[c]);
  if(n===null)problemas.push('FUENTE_CONTADOR_NO_VALIDO');
  else informacion.conteos[c]=n;
 }
 for(const c of CAMPOS_SQL.verificaciones){
  if(typeof s[c]!=='boolean')problemas.push('FUENTE_ESQUEMA_SERVIDOR_INCOMPLETO');
 }
 for(const c of CAMPOS_SQL.barreras){
  if(s[c]!==false)problemas.push('FUENTE_NO_SE_DECLARA_SOLO_LECTURA');
 }
 if(problemas.length)return output(problemas,informacion);
 informacion.columnas_servidor_verificadas=
  CAMPOS_SQL.verificaciones.slice(0,6).every(c=>s[c]===true);
 informacion.outbox_identifica_t_y_campo=s.outbox_identifica_t_y_campo;
 if(!informacion.columnas_servidor_verificadas)
  problemas.push('ESTRUCTURA_SERVIDOR_CAPACIDADES_INCOMPLETAS');
 if(informacion.conteos.filas_t_registradas===0
    ||informacion.conteos.identidades_declaradas_acreditadas===0)
  problemas.push('SIN_VINCULOS_T_OBJETO_ACREDITADOS');
 if(informacion.conteos.cambios_recibidos===0)
  problemas.push('SIN_EVENTOS_T_REGISTRADOS');
 if(informacion.conteos.usuarios_con_permiso_s12===0)
  problemas.push('SIN_PERMISO_EXPLICITO_DE_LOTE');
 if(s.outbox_identifica_t_y_campo!==true)
  problemas.push('OUTBOX_SIN_CLAVE_T_Y_CAMPO');
 // Siempre faltan en este diagnóstico: el emisor humano y CAS productivo.
 problemas.push('ORIGEN_HUMANO_GOOGLE_NO_ACREDITADO');
 problemas.push('NONCE_Y_CAS_REAL_PENDIENTES');
 return output(problemas,informacion);
}
/**
 * Puertos autorizables, aún NO implementados:
 * hojas.leerMetadatos(spreadsheetId)
 * hojas.leerRango({spreadsheetId,hoja,rango})
 * servidor.leerConsultaFija(nombreFichero)
 *
 * Ejecuta solo cuatro lecturas exactas. Jamás pide ni lee el contenido de
 * TANCAMENT, notas, celdas privadas ni una lista de IDs en todo el libro.
 */
export async function diagnosticarFuentesSincro12({hojas,servidor}={}){
 if(!hojas||typeof hojas.leerMetadatos!=='function'
    ||typeof hojas.leerRango!=='function'
    ||!servidor||typeof servidor.leerConsultaFija!=='function')
  return output(['FUENTE_ADAPTADOR_SOLO_LECTURA_NO_CONFIGURADO']);
 try{
  const meta=await hojas.leerMetadatos(S12_READONLY_LIBRO);
  const m=unwrap(meta);
  if(m?.spreadsheetId!==S12_READONLY_LIBRO)
   return output(['FUENTE_LIBRO_INCORRECTO']);
  const a=sheetFrom(m,TABLES[0]),b=sheetFrom(m,TABLES[1]);
  if(!a||!b||b.properties.hidden!==true)
   return output(['ESTRUCTURA_REGISTRO_HOJA_NO_CONFIABLE']);
  const h1=await hojas.leerRango({
   spreadsheetId:S12_READONLY_LIBRO,hoja:'MANTENIMENT',rango:'T1:T1'});
  const h2=await hojas.leerRango({
   spreadsheetId:S12_READONLY_LIBRO,hoja:'REGISTRO_FILAS',rango:'A1:E1'});
  const h3=await hojas.leerRango({
   spreadsheetId:S12_READONLY_LIBRO,hoja:'REGISTRO_FILAS',rango:'G2:H2'});
  const s=await servidor.leerConsultaFija(S12_READONLY_CONSULTA);
  return validarFuentes({
   meta,headT:h1,headersRegistro:h2,contadorRegistro:h3,server:s
  });
 }catch(_){
  // No propagar datos operativos, excepciones ni rutas internas.
  return output(['FUENTE_FALLO_LECTURA_RESTRINGIDA']);
 }
}
