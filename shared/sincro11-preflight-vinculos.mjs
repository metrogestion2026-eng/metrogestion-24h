/**
 * METROGES SINCRO 11 · PREFLIGHT VÍNCULOS DE T A OBJETO.
 * Candidato de laboratorio. NO realiza lecturas remotas ni tiene escrituras.
 * La identidad de la fila es únicamente el valor de la columna T / ID_FILA.
 * Coincidencias UUID/H, registros de staging y fechas del servidor NO acreditan
 * autoría humana, edición futura ni conceden derechos de sincronización.
 */
export const PREFLIGHT_SINCRO11_VERSION='sincro11-preflight-vinculos-20261117.1';
export const CORTE_SINCRO11_UTC='2026-11-15T23:00:00.000Z';
export const SPREADSHEET_MANTENIMENT='1PQE5VsjTvDFvQZcqedyQKIs3RbSySHFK4JPQXBD0XyU';
const UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const NOTE_REGEX=/METROGESTION_T:\s*([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})/ig;
const SHA=/^[a-f0-9]{64}$/i;
const MAX_ROWS=25000, MAX_DETAILS=100;
const fail=m=>{throw new Error('SINCRO11 PREFLIGHT: '+m)};
function assert(c,m){if(!c)fail(m)}
function idFila(x){
 if(typeof x==='number')return Number.isSafeInteger(x)&&x>0?x:null;
 if(typeof x==='string'&&/^[1-9]\d{0,14}$/.test(x)){
   const n=Number(x);return Number.isSafeInteger(n)&&n>0?n:null;
 }
 return null;
}
function utc(x){
 assert(typeof x==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(x),'marca de observación UTC obligatoria');
 const ts=Date.parse(x);assert(Number.isFinite(ts)&&new Date(ts).toISOString()===x,'fecha UTC inválida');return ts;
}
function notaUuids(note){
 assert(typeof note==='string'&&note.length<100000,'nota de E inválida o excesiva');
 const items=[];NOTE_REGEX.lastIndex=0;let m;
 while((m=NOTE_REGEX.exec(note)))items.push(m[1].toLowerCase());
 return items;
}
function valH(x){assert(typeof x==='string'&&x.length<=200,'designación H inválida');return x.trim().toUpperCase();}
function validUuid(x){return typeof x==='string'&&UUID.test(x)}
/**
 * Formatos de ENTRADA (foto ya obtenida en solo lectura):
 *  filas: [{id_fila, tipo_h, nota_e}]
 *  trabajos: [{sync_id, tipo_trabajo, designacion}]
 *  vinculos: [{spreadsheet_id, id_fila, estado, clase, trabajo_sync_id,
 *              sync_id, revision, vector_sha256}]
 *  cambios: [{spreadsheet_id, id_fila, columna, revision, detectado_en}]
 * No acepta evento de hoja derivado de fechas I/J/K ni la falta de diferencias
 * como una autorización. No devuelve notas, UUID, fechas o contenido privado.
 */
export function preflightVinculosSincro11({
  spreadsheetId=SPREADSHEET_MANTENIMENT, observado_en,
  filas=[],trabajos=[],vinculos=[],cambios=[]
}={}){
 assert(spreadsheetId===SPREADSHEET_MANTENIMENT,'libro origen distinto de MANTENIMENT');
 const observation=utc(observado_en),cut=utc(CORTE_SINCRO11_UTC);
 assert(observation>=cut,'observación anterior al corte');
 for(const [name,list] of Object.entries({filas,trabajos,vinculos,cambios}))
   assert(Array.isArray(list)&&list.length<=MAX_ROWS,`lote ${name} inválido`);
 const sheet=new Map(), uuidRows=new Map(), workMap=new Map(),stage=new Map();
 let notedRows=0,occurrences=0;
 for(const row of filas){
   assert(row&&typeof row==='object'&&!Array.isArray(row),'fila T inválida');
   const id=idFila(row.id_fila);
   assert(id!==null,'falta ID_FILA válido en T; no se elige fila física');
   assert(!sheet.has(id),`ID_FILA T duplicada (${id})`);
   const h=valH(row.tipo_h??'');
   const u=notaUuids(row.nota_e??'');
   if(u.length)notedRows++;
   occurrences+=u.length;
   for(const uuid of u){
     if(!uuidRows.has(uuid))uuidRows.set(uuid,new Set());
     uuidRows.get(uuid).add(id);
   }
   sheet.set(id,{id,h,uuids:u});
 }
 for(const work of trabajos){
   assert(work&&validUuid(work.sync_id),'trabajo remoto sin UUID válido');
   const uuid=work.sync_id.toLowerCase();
   assert(!workMap.has(uuid),'UUID de trabajo duplicado en servidor');
   workMap.set(uuid,{designacion:valH(work.designacion??''),tipo_trabajo:valH(work.tipo_trabajo??'')});
 }
 for(const v of vinculos){
   assert(v&&v.spreadsheet_id===spreadsheetId,'identidad staging de libro incorrecto');
   const id=idFila(v.id_fila);assert(id!==null,'T inválida en staging');
   assert(!stage.has(id),'T duplicada en staging');
   assert(['PENDIENTE_CONCILIACION','ACREDITADA','RETENIDA'].includes(v.estado),'estado staging inválido');
   assert(Number.isSafeInteger(v.revision)&&v.revision>0,'revisión staging inválida');
   assert(typeof v.vector_sha256==='string'&&SHA.test(v.vector_sha256),'huella staging inválida');
   if(v.trabajo_sync_id!=null)assert(validUuid(v.trabajo_sync_id),'trabajo_sync_id inválido');
   if(v.sync_id!=null)assert(validUuid(v.sync_id),'sync_id inválido');
   assert(typeof v.clase==='string'&&v.clase.length<=100,'clase staging inválida');
   stage.set(id,v);
 }
 const cambiosPorId=new Map();
 for(const e of cambios){
   assert(e&&e.spreadsheet_id===spreadsheetId,'cambio staging de otro libro');
   const id=idFila(e.id_fila);assert(id!==null,'cambio sin T');
   assert(typeof e.columna==='string'&&/^(?:[A-Q]|NOTA_[AEG]|ORDEN_T)$/.test(e.columna),'columna de cambio sin semántica aceptada');
   assert(Number.isSafeInteger(e.revision)&&e.revision>0,'revisión de cambio inválida');
   const d=utc(e.detectado_en);assert(d>=cut&&d<=observation,'detección staging fuera del periodo de observación');
   cambiosPorId.set(id,(cambiosPorId.get(id)||0)+1);
 }
 const stats={
   filas_t:sheet.size,trabajos_servidor:workMap.size,vinculos_staging:stage.size,
   cambios_staging:cambios.length,nota_uuid_apariciones:occurrences,
   filas_con_uuid: notedRows,uuid_distintos:uuidRows.size,
   uuid_compartidos:0,filas_con_uuid_compartido:0,
   uuid_presentes_servidor:0,uuid_ausentes_servidor:0,
   uuid_h_unica:0,uuid_h_multiple:0,uuid_h_ninguna:0,
   filas_con_registro_acreditado:0,vinculos_candidatos_no_autorizados:0,
   filas_propuestas_para_verificacion:0,
 };
 const sharedIds=new Set();
 for(const [uuid,ids] of uuidRows){
   if(ids.size>1){stats.uuid_compartidos++;for(const id of ids)sharedIds.add(id);}
   const server=workMap.get(uuid);
   if(!server){stats.uuid_ausentes_servidor++;continue;}
   stats.uuid_presentes_servidor++;
   const hMatch=[...ids].filter(id=>{
      const h=sheet.get(id).h;
      return !!h&&(h===server.designacion||h===server.tipo_trabajo);
   });
   if(hMatch.length===1)stats.uuid_h_unica++;
   else if(hMatch.length>1)stats.uuid_h_multiple++;
   else stats.uuid_h_ninguna++;
 }
 stats.filas_con_uuid_compartido=sharedIds.size;
 const report=[],counts=Object.create(null);
 for(const row of sheet.values()){
   const v=stage.get(row.id);
   if(v?.estado==='ACREDITADA')stats.filas_con_registro_acreditado++;
   // Históricos o registros sin evidencia futura NO pasan a producción.
   if(!v&&!row.uuids.length)continue;
   let reason;
   if(!v)reason='SIN_VINCULO_STAGING_POR_T';
   else if(v.estado!=='ACREDITADA')reason='REGISTRO_STAGING_NO_ACREDITADO';
   else if(v.clase.trim().toUpperCase()!=='TRABAJO')reason='CLASE_DESTINO_SIN_MAPEO';
   else if(!v.trabajo_sync_id)reason='SIN_TRABAJO_UUID_EN_VINCULO';
   else if(!workMap.has(v.trabajo_sync_id.toLowerCase()))reason='VINCULO_AL_TRABAJO_INEXISTENTE';
   else if(row.uuids.length&&(!row.uuids.includes(v.trabajo_sync_id.toLowerCase())))reason='NOTA_UUID_DISCREPANTE_DEL_VINCULO';
   else if(row.uuids.length>1)reason='VARIAS_NOTAS_UUID_EN_MISMA_T';
   else if(sharedIds.has(row.id))reason='UUID_COMPARTIDO_REQUIERE_EVIDENCIA_EXTRA';
   else{
     const target=workMap.get(v.trabajo_sync_id.toLowerCase());
     if(!row.h||!(row.h===target.designacion||row.h===target.tipo_trabajo))reason='DESIGNACION_H_NO_COTEJADA';
     else if(!cambiosPorId.has(row.id))reason='SIN_CAMBIO_POST_CORTE_ACREDITADO';
     else{
       reason='VINCULO_TECNICO_SOLO_CANDIDATO';
       stats.vinculos_candidatos_no_autorizados++;
     }
   }
   counts[reason]=(counts[reason]||0)+1;
   stats.filas_propuestas_para_verificacion++;
   if(report.length<MAX_DETAILS)report.push({id_fila:row.id,resultado:'RETENER_SIN_ESCRIBIR',motivo:reason});
 }
 const ignoredStage=[...stage.keys()].filter(id=>!sheet.has(id)).length;
 const danglingChanges=[...cambiosPorId.keys()].filter(id=>!sheet.has(id)).length;
 return {
  version:PREFLIGHT_SINCRO11_VERSION,modo:'CENSO_CANDIDATO_SOLO_LECTURA',
  observado_en,stats,
  motivos:Object.fromEntries(Object.entries(counts).sort(([a],[b])=>a.localeCompare(b))),
  vinculos_staging_sin_t_visible:ignoredStage,cambios_staging_sin_t_visible:danglingChanges,
  detalle:report,detalle_parcial:stats.filas_propuestas_para_verificacion>MAX_DETAILS,
  notas_uuid_son_referencias_no_identidad:true,
  valores_privados_en_salida:false,autor_humano_acreditado:false,
  eventos_nuevos_autenticados:0,identidades_aptas_para_escritura:0,
  autoriza_sincronizar:false,permite_crear_T:false,permite_crear_PA:false,
  escritura_en_manteniment:false,escritura_en_tancament:false,escritura_en_backend:false,
  aviso:'La coincidencia de nota UUID/H y staging no demuestra identidad ni evento manual nuevo. La única identidad es el valor en T. Nunca aplicar ni enviar sin cotejo con fuente autenticada, CAS, clase y revisión.'
 };
}