/**
 * METROGES SINCRO13 — Google Sheets READ-ONLY verifier for T/K.
 * Pure transport/parser; cannot write to Google, Hotel, SQL or grant adoption.
 * Only the server may supply the independent Google OAuth read-only token.
 * A Google read is NOT proof of who made the edit.
 */
export const S13_GOOGLE_K_VERSION = 'sincro13-google-k-lectura-v1';
export const S13_GOOGLE_K_MAX_ROWS = 7500;
const CUT_DATE = '2026-11-16';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ID = /^[1-9][0-9]{0,15}$/;
const EXPECTED = ['MANTENIMENT','REGISTRO_FILAS'];
const COLS = [0,4,7,10,19];
const GOOGLE_FIELDS = 'spreadsheetId,properties(locale,timeZone),sheets(properties(title,gridProperties(rowCount,columnCount)),data(startRow,startColumn,rowData(values(formattedValue,userEnteredValue,effectiveValue,note))))';
const RANGES = [
  'MANTENIMENT!A2:A',
  'MANTENIMENT!E2:E',
  'MANTENIMENT!H2:H',
  'MANTENIMENT!K2:K',
  'MANTENIMENT!T2:T',
  'REGISTRO_FILAS!A2:E'
];

function reject(reason) {
  return {
    protocolo:S13_GOOGLE_K_VERSION,estado:'RETENER_SIN_ESCRIBIR',motivo:reason,
    autor_google_acreditado:false,actor_editor_acreditado:false,
    adopcion_autorizada:false,autoriza_sincronizar:false,
    escribe_google:false,escribe_supabase:false
  };
}
function idNumber(v) {
  if(typeof v==='number')return Number.isSafeInteger(v)&&v>0?v:null;
  if(typeof v==='string'&&ID.test(v)){
    const n=Number(v);
    return Number.isSafeInteger(n)&&n>0?n:null;
  }
  return null;
}
function value(cell) {
  return typeof cell?.formattedValue === 'string' ? cell.formattedValue.trim() : '';
}
function colData(sheet,column,rows) {
  const matches=(sheet.data||[]).filter(d=>d?.startRow===1 && d?.startColumn===column);
  if(matches.length!==1)return null;
  const seg=matches[0];
  if(!Array.isArray(seg.rowData)||seg.rowData.length < rows-1 || seg.rowData.length > rows-1)return null;
  return seg.rowData.map(r=>r?.values?.[0]??{});
}
function registryData(sheet,rows) {
  const matches=(sheet.data||[]).filter(d=>d?.startRow===1&&d?.startColumn===0);
  if(matches.length!==1)return null;
  const seg=matches[0];
  if(!Array.isArray(seg.rowData)||seg.rowData.length!==rows-1)return null;
  return seg.rowData.map(r=>{
    const cells=r?.values||[];
    return [cells[0]??{},cells[1]??{},cells[2]??{},cells[3]??{},cells[4]??{}];
  });
}
function dateEs(text,withTime=false) {
  const re=withTime ? /^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2})(?::\d{2})?$/
    : /^(\d{2})\/(\d{2})\/(\d{4})$/;
  const m=re.exec(text);
  if(!m)return null;
  const d=Number(m[1]),mon=Number(m[2]),year=Number(m[3]);
  const iso=m[3]+'-'+m[2]+'-'+m[1];
  const stamp=new Date(iso+'T00:00:00Z');
  if(!Number.isFinite(stamp.getTime())
     ||stamp.getUTCDate()!==d||stamp.getUTCMonth()+1!==mon||stamp.getUTCFullYear()!==year)return null;
  if(withTime && (Number(m[4])>23||Number(m[5])>59))return null;
  return iso;
}
function noteRefs(text) {
  if(typeof text!=='string')return [];
  return [...text.matchAll(/(?:^|\r?\n)METROGESTION_T:([0-9a-f-]{36})(?=\r?\n|$)/gi)]
    .map(m=>m[1].toLowerCase());
}
function ensureGrid(doc,spreadsheetId) {
  if(!doc || doc.spreadsheetId!==spreadsheetId) return {error:'ARCHIVO_INCORRECTO'};
  if(doc.properties?.locale!=='ca_ES'||doc.properties?.timeZone!=='Europe/Madrid')
    return {error:'CONFIGURACION_FECHAS_DISTINTA'};
  if(!Array.isArray(doc.sheets))return {error:'HOJAS_FALTANTES'};
  const sheets={};
  for(const key of EXPECTED){
    const match=doc.sheets.filter(s=>s?.properties?.title===key);
    if(match.length!==1)return {error:'HOJA_AMBIGUA_O_AUSENTE'};
    const s=match[0], props=s.properties.gridProperties;
    if(!props||!Number.isInteger(props.rowCount)||props.rowCount<2
      ||props.rowCount>S13_GOOGLE_K_MAX_ROWS||!Number.isInteger(props.columnCount)
      ||props.columnCount<(key==='MANTENIMENT'?20:5))
      return {error:'INVENTARIO_FUERA_DE_LIMITE'};
    sheets[key]=s;
  }
  return {sheets};
}
export function extraerGoogleK(doc,{spreadsheetId,id_fila,trabajo_sync_id}) {
  const id=idNumber(id_fila),work=String(trabajo_sync_id||'').toLowerCase();
  if(!id||!UUID.test(work)||!spreadsheetId||!/^[-_A-Za-z0-9]{20,150}$/.test(spreadsheetId))
    return reject('SOLICITUD_NO_VALIDA');
  const g=ensureGrid(doc,spreadsheetId);
  if(g.error)return reject(g.error);
  const main=g.sheets.MANTENIMENT,reg=g.sheets.REGISTRO_FILAS;
  const columns=Object.fromEntries(COLS.map(c=>[
    c,colData(main,c,main.properties.gridProperties.rowCount)
  ]));
  const registry=registryData(reg,reg.properties.gridProperties.rowCount);
  if(COLS.some(c=>!columns[c])||!registry)return reject('COLUMNAS_INCOMPLETAS');
  let match=null,countT=0,countWork=0;
  for(let i=0;i<columns[19].length;i++){
    const cell=columns[19][i],raw=value(cell);
    if(!raw)continue;
    if(cell.userEnteredValue?.formulaValue)return reject('T_ES_FORMULA');
    const candidate=idNumber(raw);
    if(!candidate)return reject('T_MALFORMADA');
    if(candidate===id){match=i;countT++;}
    countWork+=noteRefs(columns[4][i]?.note).filter(u=>u===work).length;
  }
  // Notes on rows without a T must not be allowed to bypass UUID collision.
  for(let i=0;i<columns[19].length;i++){
    if(value(columns[19][i]))continue;
    countWork+=noteRefs(columns[4][i]?.note).filter(u=>u===work).length;
  }
  if(countT!==1)return reject(countT>1?'T_DUPLICADA':'T_NO_EXISTE');
  if(countWork!==1)return reject('UUID_AJENO_O_DUPLICADO');
  let registryEntry=null,registryMatches=0;
  for(const r of registry){
    const raw=value(r[0]);if(!raw)continue;
    const n=idNumber(raw);
    if(!n)return reject('REGISTRO_T_MALFORMADO');
    if(n===id){registryMatches++;registryEntry=r;}
  }
  if(registryMatches!==1)return reject('T_REGISTRO_NO_UNICO_O_AUSENTE');
  if(value(registryEntry[1])!=='ACTIVA'||value(registryEntry[4])!=='ORDEN_AUTORIZADA')
    return reject('REGISTRO_T_NO_AUTORIZADO');
  const assigned=dateEs(value(registryEntry[2]),true);
  if(!assigned||assigned<CUT_DATE)return reject('T_ANTERIOR_AL_CORTE');
  const dfm=value(columns[0][match]).toUpperCase(),clase=value(columns[7][match]).toUpperCase();
  if(!dfm||dfm==='R1515')return reject('DFM_NO_PERMITIDO');
  if(!clase||['ALTA','BAJA','PARADA','ANULADA','ROAD','FIN','ARCHIVO'].includes(clase))
    return reject('NO_ES_T_TRABAJO');
  const refs=noteRefs(columns[4][match]?.note);
  if(refs.length!==1||refs[0]!==work)return reject('NOTA_E_TRABAJO_INCORRECTA');
  const cellK=columns[10][match];
  if(cellK.userEnteredValue?.formulaValue)return reject('K_ES_FORMULA');
  if(!Object.hasOwn(cellK.effectiveValue??{},'numberValue'))
    return reject('K_NO_ES_FECHA_NATIVA');
  const nuevo=dateEs(value(cellK));
  if(!nuevo)return reject('K_FECHA_INVALIDA');
  return {
    protocolo:S13_GOOGLE_K_VERSION,
    estado:'COTEJO_T_K_SIN_AUTORIA',
    id_fila:id,trabajo_sync_id:work,columna:'K',
    valor_nuevo:nuevo,
    autor_google_acreditado:false,actor_editor_acreditado:false,
    adopcion_autorizada:false,autoriza_sincronizar:false,
    escribe_google:false,escribe_supabase:false
  };
}
export function googleKUrl(spreadsheetId){
  if(typeof spreadsheetId!=='string'||!/^[-_A-Za-z0-9]{20,150}$/.test(spreadsheetId))
    throw Error('S13_SOLICITUD_NO_VALIDA');
  const q=new URLSearchParams({fields:GOOGLE_FIELDS});
  for(const r of RANGES)q.append('ranges',r);
  return 'https://sheets.googleapis.com/v4/spreadsheets/'+spreadsheetId+'?'+q.toString();
}
async function readGoogle(fetcher,url,accessToken) {
  const response=await fetcher(url,{
    method:'GET',redirect:'error',headers:{Authorization:'Bearer '+accessToken,Accept:'application/json'}
  });
  if(!response||response.status!==200||!String(response.headers?.get?.('content-type')||'').includes('application/json'))
    throw Error('S13_GOOGLE_HTTP_NO_VERIFICABLE');
  const raw=await response.text();
  if(raw.length>8_000_000||raw.length<2)throw Error('S13_GOOGLE_RESULTADO_INVALIDO');
  return JSON.parse(raw);
}
export async function cotejarGoogleKDosLecturas({
 fetcher,accessToken,spreadsheetId,id_fila,trabajo_sync_id
}) {
 const closed=reason=>reject(reason);
 if(typeof fetcher!=='function'||typeof accessToken!=='string'
   ||accessToken.length<12)return closed('SIN_CREDENCIAL_GOOGLE_INDEPENDIENTE');
 try {
   const url=googleKUrl(spreadsheetId);
   const a=extraerGoogleK(await readGoogle(fetcher,url,accessToken),
     {spreadsheetId,id_fila,trabajo_sync_id});
   if(a.estado!=='COTEJO_T_K_SIN_AUTORIA')return a;
   const b=extraerGoogleK(await readGoogle(fetcher,url,accessToken),
     {spreadsheetId,id_fila,trabajo_sync_id});
   if(b.estado!=='COTEJO_T_K_SIN_AUTORIA')return b;
   if(JSON.stringify(a)!==JSON.stringify(b))return closed('LECTURAS_GOOGLE_INESTABLES');
   return {
     ...a,lecturas_independientes:2,origen:'GOOGLE_SHEETS_API_SOLO_LECTURA',
     // Two reads improve consistency, not cross-system atomicity.
     prueba_atomicidad_google_supabase:false
   };
 }catch(_){
   return closed('GOOGLE_NO_VERIFICABLE');
 }
}
