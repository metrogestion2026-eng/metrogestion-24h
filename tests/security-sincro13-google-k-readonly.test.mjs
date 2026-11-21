import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extraerGoogleK,googleKUrl,cotejarGoogleKDosLecturas
} from '../supabase/functions/_shared/sincro13-google-k-readonly.mjs';

const SHEET='sincro13_hoja_ficticia_20261119';
const WORK='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const target={spreadsheetId:SHEET,id_fila:800001,trabajo_sync_id:WORK};
const v=x=>x===null||x===undefined?{}:{formattedValue:String(x)};
const serialK=(date='19/11/2026')=>({formattedValue:date,
 effectiveValue:{numberValue:46345},userEnteredValue:{numberValue:46345}});
const data=(col,values)=>({startRow:1,startColumn:col,rowData:values.map(c=>({values:[c]}))});
function fixture(){
  const a=[
    data(0,[v('LAB-002'),v('LAB-003'),v('LAB-001')]),
    data(4,[{}, {note:'METROGESTION_T:'+OTHER},
      {note:'Nota de ensayo\nMETROGESTION_T:'+WORK}]),
    data(7,[v('PARADA'),v('AV'),v('AV')]),
    data(10,[{},serialK('18/11/2026'),serialK('19/11/2026')]),
    data(19,[v(800002),v(800003),v(800001)])
  ];
  const r={startRow:1,startColumn:0,rowData:[
    {values:[v(800001),v('ACTIVA'),v('18/11/2026 18:00'),{},v('ORDEN_AUTORIZADA')]},
    {values:[v(800002),v('ACTIVA'),v('18/11/2026 18:01'),{},v('INSERT_ROW')]},
    {values:[v(800003),v('ACTIVA'),v('18/11/2026 18:02'),{},v('ORDEN_AUTORIZADA')]}
  ]};
  return {spreadsheetId:SHEET,properties:{locale:'ca_ES',timeZone:'Europe/Madrid'},sheets:[
    {properties:{title:'MANTENIMENT',gridProperties:{rowCount:4,columnCount:26}},data:a},
    {properties:{title:'REGISTRO_FILAS',gridProperties:{rowCount:4,columnCount:8}},data:[r]}
  ]};
}
const read=(doc,targetArgs=target)=>extraerGoogleK(doc,targetArgs);
const expectBlocked=(doc,code)=>{
  const r=read(doc);assert.equal(r.estado,'RETENER_SIN_ESCRIBIR');
  assert.equal(r.motivo,code);assert.equal(r.autoriza_sincronizar,false);
  assert.equal(r.escribe_google,false);assert.equal(r.escribe_supabase,false);
};
function mockFetch(responses, {status=200}={}){
 let calls=[];
 const fn=async (url,options)=>{
   calls.push({url,options});
   const next=responses[Math.min(calls.length-1,responses.length-1)];
   return {status,headers:{get:k=>k==='content-type'?'application/json':null},
     text:async()=>JSON.stringify(next)};
 };
 return {fn,calls};
}
test('hoja catalana: nueva T y K nativa por valor, no por ubicación física',()=>{
 const r=read(fixture());
 assert.equal(r.estado,'COTEJO_T_K_SIN_AUTORIA');
 assert.equal(r.valor_nuevo,'2026-11-19');
 assert.equal(r.id_fila,800001);
 assert.equal(r.actor_editor_acreditado,false);
 assert.equal(r.autoriza_sincronizar,false);
});
test('permutación de filas no cambia el enlace T/K',()=>{
 const f=fixture();
 for(const segment of f.sheets[0].data){
   [segment.rowData[0],segment.rowData[2]]=[segment.rowData[2],segment.rowData[0]];
 }
 assert.equal(read(f).valor_nuevo,'2026-11-19');
});
test('URL limita alcance a cinco columnas y registro, siempre lectura',()=>{
 const u=new URL(googleKUrl(SHEET));
 assert.equal(u.protocol,'https:');assert.equal(u.host,'sheets.googleapis.com');
 assert.deepEqual(u.searchParams.getAll('ranges'),[
 'MANTENIMENT!A2:A','MANTENIMENT!E2:E','MANTENIMENT!H2:H',
 'MANTENIMENT!K2:K','MANTENIMENT!T2:T','REGISTRO_FILAS!A2:E'
 ]);
 assert.match(u.searchParams.get('fields'),/note/);
});
test('T duplicada (aunque coincida trabajo) bloquea la lectura',()=>{
 const f=fixture();f.sheets[0].data[4].rowData[0].values[0]=v(800001);
 expectBlocked(f,'T_DUPLICADA');
});
test('T físicamente eliminada queda retenida',()=>{
 const f=fixture();f.sheets[0].data[4].rowData[2].values[0]=v(800004);
 expectBlocked(f,'T_NO_EXISTE');
});
test('T es fórmula y no identidad manual auténtica',()=>{
 const f=fixture();f.sheets[0].data[4].rowData[2].values[0].userEnteredValue={formulaValue:'=123'};
 expectBlocked(f,'T_ES_FORMULA');
});
test('registro duplicado retiene nueva T',()=>{
 const f=fixture();f.sheets[1].data[0].rowData[1].values[0]=v(800001);
 expectBlocked(f,'T_REGISTRO_NO_UNICO_O_AUSENTE');
});
test('registro origen INSERT_ROW no acredita orden autorizada',()=>{
 const f=fixture();f.sheets[1].data[0].rowData[0].values[4]=v('INSERT_ROW');
 expectBlocked(f,'REGISTRO_T_NO_AUTORIZADO');
});
test('registro de T borrada bloquea',()=>{
 const f=fixture();f.sheets[1].data[0].rowData[0].values[1]=v('BORRADA');
 expectBlocked(f,'REGISTRO_T_NO_AUTORIZADO');
});
test('registro T previo al corte de 16 de noviembre',()=>{
 const f=fixture();f.sheets[1].data[0].rowData[0].values[2]=v('15/11/2026 23:00');
 expectBlocked(f,'T_ANTERIOR_AL_CORTE');
});
test('nota E cambiada retiene y no copia la UUID vecina',()=>{
 const f=fixture();f.sheets[0].data[1].rowData[2].values[0].note='METROGESTION_T:'+OTHER;
 expectBlocked(f,'UUID_AJENO_O_DUPLICADO');
});
test('UUID de trabajo repetida en nota de otra fila retiene',()=>{
 const f=fixture();f.sheets[0].data[1].rowData[0].values[0].note='METROGESTION_T:'+WORK;
 expectBlocked(f,'UUID_AJENO_O_DUPLICADO');
});
test('R1515 excluida a pesar de todo lo demás',()=>{
 const f=fixture();f.sheets[0].data[0].rowData[2].values[0]=v('R1515');
 expectBlocked(f,'DFM_NO_PERMITIDO');
});
test('PARADA no es trabajo K',()=>{
 const f=fixture();f.sheets[0].data[2].rowData[2].values[0]=v('PARADA');
 expectBlocked(f,'NO_ES_T_TRABAJO');
});
test('K con fórmula no acredita fecha manual',()=>{
 const f=fixture();f.sheets[0].data[3].rowData[2].values[0].userEnteredValue={formulaValue:'=TODAY()'};
 expectBlocked(f,'K_ES_FORMULA');
});
test('K de texto no es fecha nativa de Google',()=>{
 const f=fixture();f.sheets[0].data[3].rowData[2].values[0]={formattedValue:'19/11/2026',effectiveValue:{stringValue:'19/11/2026'}};
 expectBlocked(f,'K_NO_ES_FECHA_NATIVA');
});
test('K con fecha 31 de febrero bloquea',()=>{
 const f=fixture();f.sheets[0].data[3].rowData[2].values[0]=serialK('31/02/2026');
 expectBlocked(f,'K_FECHA_INVALIDA');
});
test('locale o huso distintos no alteran interpretación',()=>{
 const f=fixture();f.properties.locale='es_ES';
 expectBlocked(f,'CONFIGURACION_FECHAS_DISTINTA');
});
test('otra spreadsheet_id no se admite',()=>{
 const f=fixture();f.spreadsheetId='otra_hoja_000000000000000000';
 expectBlocked(f,'ARCHIVO_INCORRECTO');
});
test('datos parciales u omisión de columnas no crean coincidencia',()=>{
 const f=fixture();f.sheets[0].data.splice(4,1);
 expectBlocked(f,'COLUMNAS_INCOMPLETAS');
});
test('más de 7500 filas bloquea por límite de revisión',()=>{
 const f=fixture();f.sheets[0].properties.gridProperties.rowCount=7501;
 expectBlocked(f,'INVENTARIO_FUERA_DE_LIMITE');
});
test('doble lectura HTTP real: mismo T y K, no acredita autoría',async()=>{
 const f=fixture(),h=mockFetch([f,f]);
 const r=await cotejarGoogleKDosLecturas({fetcher:h.fn,accessToken:'synthetic-google-oauth-token',
   ...target});
 assert.equal(r.estado,'COTEJO_T_K_SIN_AUTORIA');
 assert.equal(r.lecturas_independientes,2);
 assert.equal(r.prueba_atomicidad_google_supabase,false);
 assert.equal(h.calls.length,2);
 assert.ok(h.calls.every(x=>x.options.method==='GET'&&x.options.redirect==='error'));
 assert.equal(r.actor_editor_acreditado,false);
});
test('valor K cambiado entre primera y segunda lectura queda retenido',async()=>{
 const a=fixture(),b=fixture();
 b.sheets[0].data[3].rowData[2].values[0]=serialK('20/11/2026');
 const h=mockFetch([a,b]);
 const r=await cotejarGoogleKDosLecturas({fetcher:h.fn,accessToken:'synthetic-google-oauth-token',...target});
 assert.equal(r.motivo,'LECTURAS_GOOGLE_INESTABLES');
});
test('segundo intento con T duplicada nunca acredita',async()=>{
 const a=fixture(),b=fixture();
 b.sheets[0].data[4].rowData[0].values[0]=v(800001);
 const r=await cotejarGoogleKDosLecturas({fetcher:mockFetch([a,b]).fn,
 accessToken:'synthetic-google-oauth-token',...target});
 assert.equal(r.motivo,'T_DUPLICADA');
});
test('Google HTTP no autorizado retiene y no devuelve token',async()=>{
 const h=mockFetch([fixture()],{status:401});
 const r=await cotejarGoogleKDosLecturas({fetcher:h.fn,accessToken:'synthetic-google-oauth-token',...target});
 assert.equal(r.motivo,'GOOGLE_NO_VERIFICABLE');
 assert.doesNotMatch(JSON.stringify(r),/synthetic-google-oauth-token/);
});
test('sin credencial independiente la comprobación no se inicia',async()=>{
 const h=mockFetch([fixture()]);
 const r=await cotejarGoogleKDosLecturas({fetcher:h.fn,accessToken:'',...target});
 assert.equal(r.motivo,'SIN_CREDENCIAL_GOOGLE_INDEPENDIENTE');
 assert.equal(h.calls.length,0);
});
