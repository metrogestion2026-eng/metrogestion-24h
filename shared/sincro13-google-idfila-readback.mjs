/**
 * SINCRO 13 · Independent Google T inventory review.
 * Pure verifier: a current read of Sheets and REGISTRO_FILAS is not proof of
 * human authorship, nor a permission to write. It cannot update any system.
 * The only identity of the physical line is the VALUE of column T / ID_FILA.
 */
export const S13_GOOGLE_AUDITOR_VERSION='sincro13-google-readback-v1';
const RE_UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX=7500;
const num=v=>{
  if(typeof v==='number')return Number.isSafeInteger(v)&&v>0?v:null;
  if(typeof v==='string'&&/^[1-9][0-9]{0,14}$/.test(v)){
    const n=Number(v);return Number.isSafeInteger(n)&&n>0?n:null;
  }
  return null;
};
function notes(note){
  const t=String(note??'');
  return [...t.matchAll(/(?:^|\r?\n)METROGESTION_T:([0-9a-f-]{36})(?=\r?\n|$)/gi)]
    .map(m=>m[1].toLowerCase());
}
function shape(v,keys){
  return v&&typeof v==='object'&&!Array.isArray(v)
    &&Object.keys(v).length===keys.length
    &&Object.keys(v).every(k=>keys.includes(k));
}
/**
 * filas: [{id_fila, clase, nota_e, dfm}] from Google, each physical row
 * registro: [{id_fila, estado, origen}] from REGISTRO_FILAS
 * propuestas: [{id_fila, trabajo_sync_id}] from durable LOCAL receipt
 *
 * Neither fila order nor row number, PA, DFM, J/K, date, nor UUID alone
 * can establish a canonically authorized T->object relationship.
 */
export function auditarLecturaGoogleT({filas,registro,propuestas}){
  const closed=(motivo)=>({
    version:S13_GOOGLE_AUDITOR_VERSION,
    estado:'RETENER_SIN_ESCRIBIR',motivo,
    total:0,cotejos_tecnicos:0,conflictos:0,detalle:[],
    identidad_google_real_acreditada:false,
    persona_que_edito_acreditada:false,
    vinculo_t_objeto_real_acreditado:false,
    autoriza_sincronizar:false,
    escribe_google:false,escribe_supabase:false
  });
  if(!Array.isArray(filas)||!Array.isArray(registro)||!Array.isArray(propuestas)
    ||filas.length>MAX||registro.length>MAX||propuestas.length>8)
    return closed('INVENTARIO_NO_ACOTADO');
  const seenT=new Map(),seenRegistry=new Map(),seenWork=new Map();
  let malformed=false,duplicates=false;
  filas.forEach(f=>{
    if(!shape(f,['id_fila','clase','nota_e','dfm'])){
      malformed=true;return;
    }
    const id=num(f.id_fila);
    if(!id||typeof f.clase!=='string'||typeof f.nota_e!=='string'||typeof f.dfm!=='string'){
      malformed=true;return;
    }
    if(seenT.has(id))duplicates=true;
    seenT.set(id,f);
    for(const u of notes(f.nota_e)){
      seenWork.set(u,(seenWork.get(u)||0)+1);
    }
  });
  registro.forEach(r=>{
    if(!shape(r,['id_fila','estado','origen'])){
      malformed=true;return;
    }
    const id=num(r.id_fila);
    if(!id||typeof r.estado!=='string'||typeof r.origen!=='string'){
      malformed=true;return;
    }
    if(seenRegistry.has(id))duplicates=true;
    seenRegistry.set(id,r);
  });
  if(malformed)return closed('INVENTARIO_MALFORMADO');
  if(duplicates)return closed('T_DUPLICADA_EN_HOJA_O_REGISTRO');
  const proposalsT=new Set(),proposalsW=new Set(),detalle=[];
  let faults=0;
  for(const p of propuestas){
    const id=num(p?.id_fila),uuid=String(p?.trabajo_sync_id||'').toLowerCase();
    let reason='COTEJO_TECNICO_SIN_AUTORIA';
    if(!shape(p,['id_fila','trabajo_sync_id'])||!id||!RE_UUID.test(uuid))
      reason='RECIBO_NO_VALIDO';
    else if(proposalsT.has(id)||proposalsW.has(uuid))
      reason='PROPUESTA_DUPLICADA';
    else {
      const row=seenT.get(id),reg=seenRegistry.get(id);
      if(!row||!reg)reason='T_NO_ENCONTRADA_O_SIN_REGISTRO';
      else if(reg.estado!=='ACTIVA'||reg.origen!=='ORDEN_AUTORIZADA')
        reason='REGISTRO_T_NO_ACREDITABLE';
      else if(row.dfm.trim().toUpperCase()==='R1515')
        reason='UNIDAD_EXCLUIDA';
      else if(['ALTA','BAJA','PARADA','ANULADA','ROAD','FIN','ARCHIVO'].includes(row.clase.trim().toUpperCase()))
        reason='CLASE_NO_ES_TRABAJO';
      else if(notes(row.nota_e).length!==1 || notes(row.nota_e)[0]!==uuid)
        reason='NOTA_TRABAJO_NO_UNICA_O_DISTINTA';
      else if(seenWork.get(uuid)!==1)
        reason='UUID_COMPARTIDO_CON_OTRA_FILA';
    }
    if(id)proposalsT.add(id);
    if(RE_UUID.test(uuid))proposalsW.add(uuid);
    if(reason!=='COTEJO_TECNICO_SIN_AUTORIA')faults++;
    detalle.push({id_fila:id,resultado:reason});
  }
  return {
    version:S13_GOOGLE_AUDITOR_VERSION,
    estado:faults?'RETENER_SIN_ESCRIBIR':'COTEJO_TECNICO_PENDIENTE_ACREDITACION',
    motivo:faults?'CONFLICTOS_O_DATOS_INSUFICIENTES':'LECTURA_COINCIDE_SIN_AUTORIA_O_PERMISO',
    total:propuestas.length,
    cotejos_tecnicos:propuestas.length-faults,
    conflictos:faults,detalle,
    identidad_google_real_acreditada:false,
    persona_que_edito_acreditada:false,
    vinculo_t_objeto_real_acreditado:false,
    autoriza_sincronizar:false,
    escribe_google:false,escribe_supabase:false
  };
}
