import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createHash, randomUUID } from 'node:crypto';

const file = new URL('../r1-alpha75/google-apps-script/sincro11_snapshot.gs', import.meta.url);
const SOURCE = readFileSync(file, 'utf8');
const id='1PQE5VsjTvDFvQZcqedyQKIs3RbSySHFK4JPQXBD0XyU';
const asRow=(i, props={})=>{
 const arr=Array(26).fill('');arr[0]=props.dfm||String(2400+i);arr[4]=props.pa||'PA-2600001';arr[7]=props.designacion||'PARADA';arr[8]=props.date||'11/10/2026';arr[9]=props.done||'';arr[19]=props.id===undefined?i:props.id;
 return {values:arr,formulas:Array(26).fill(''),notes:Array(26).fill('')};
};
function createHarness(rowCount=2, opts={}) {
 const rows = opts.rows || Array.from({length:rowCount},(_,i)=>asRow(i+1));
 const props={...(opts.props??{})};let writes=[], opened=[],reads=0,locked=false;
 let onRead=opts.onRead || null;
 const sheet={
   getName:()=>opts.sheetName??'MANTENIMENT',
   getMaxColumns:()=>opts.cols??26,
   getLastRow:()=>rows.length+1,
   getRange:(first,col,height,width)=>{
     assert.equal(first,2);assert.equal(col,1);assert.equal(height,rows.length);assert.equal(width,26);
     return {
       getValues:()=>{reads++;if(onRead)onRead(reads,rows);return rows.map(r=>r.values.slice());},
       getFormulas:()=>rows.map(r=>r.formulas.slice()),
       getNotes:()=>rows.map(r=>r.notes.slice()),
     };
   }
 };
 const ss={getId:()=>opts.actualId??id,getSheetByName:name=>name==='MANTENIMENT'?sheet:null};
 const store={
    getProperty:name=>props[name]===undefined?null:props[name],
    getProperties:()=>({...props}),
    setProperty:(name,value)=>{
      if(typeof value!=='string')throw Error('Google Properties values must be strings');
      const size=Buffer.byteLength(value,'utf8');
      if(size>9000)throw Error('Property 9 KB limit');
      const total=Object.entries({...props,[name]:value}).reduce((n,[k,v])=>n+Buffer.byteLength(k+v,'utf8'),0);
      if(total>500000)throw Error('DocumentProperties total 500 KB limit');
      if(opts.failWritesAfter!==undefined&&writes.length>=opts.failWritesAfter)throw Error('Simulated quota or write loss');
      props[name]=value;writes.push({type:'props',name,size});
    },
  };
 const env={
    Date, Map, Set,
    SpreadsheetApp:{openById:x=>{opened.push(x);return ss;}},
    PropertiesService:{getDocumentProperties:()=>opts.nullStore?null:store},
    LockService:{getDocumentLock:()=>opts.noLock?null:{tryLock:()=>{if(opts.failLock)return false;locked=true;return true;},releaseLock:()=>{locked=false;}}},
    Utilities:{
       DigestAlgorithm:{SHA_256:'sha256'},Charset:{UTF_8:'utf8'},
       computeDigest:(alg,content)=>Array.from(createHash(alg).update(content,'utf8').digest()),
       base64EncodeWebSafe:bytes=>Buffer.from(bytes).toString('base64url'),
       getUuid:()=>randomUUID(),
    },
    console,
  };
 const context=vm.createContext(env);
 vm.runInContext(SOURCE,context,{filename:'sincro11_snapshot.gs'});
 return {call:(name,...args)=>context[name](...args),rows,props,writes,opened,readCount:()=>reads,lockStatus:()=>locked,store};
}

const cleanResult=r=>JSON.parse(JSON.stringify(r));

test('syntax integrates as a pure Apps Script additional file',()=>{
 assert.match(SOURCE,/function metroSincro11SellarBase\(/);
 assert.doesNotMatch(SOURCE,/function\s+onEdit\(/);
 for(const verb of ['setValue','setValues','setNote','setNotes','insertRow','deleteRow','createTrigger','UrlFetchApp','openByUrl'])
   assert.doesNotMatch(SOURCE,new RegExp(`\\.${verb}\\s*\\(`),`No live-sheet/API effect: ${verb}`);
});

test('preflight returns counts and does not write any property or cell',()=>{
 const h=createHarness(3);
 const r=cleanResult(h.call('metroSincro11PrevisualizarBase'));
 assert.equal(r.filas_identificadas,3);assert.equal(r.puede_sellar,true);
 assert.equal(r.hojas_modificadas,0);assert.equal(r.sincronizacion_autorizada,false);
 assert.equal(h.writes.length,0);assert.equal(h.opened[0],id);
});

test('seal once and compare unchanged: no sheet writes or duplicate positives',()=>{
 const h=createHarness(20);
 const base=cleanResult(h.call('metroSincro11SellarBase'));
 assert.equal(base.resultado,'BASE_SELLADA');assert.equal(base.filas,20);
 const next=cleanResult(h.call('metroSincro11Comparar'));
 assert.equal(next.modificaciones_o_altas,0);assert.equal(next.identidades_desaparecidas,0);
 assert.equal(next.autoriza_sincronizar,false);
 assert.equal(h.writes.some(w=>w.type!=='props'),false);
 assert.equal(h.lockStatus(),false);
 assert.throws(()=>h.call('metroSincro11SellarBase'),/Ya existe una base/);
});

test('historical dates changed after base are detected, without new PA or T',()=>{
 const h=createHarness(2);
 h.call('metroSincro11SellarBase');
 h.rows[0].values[8]='16/10/2026';
 const result=cleanResult(h.call('metroSincro11Comparar'));
 assert.equal(result.modificaciones_o_altas,1);
 assert.equal(result.cambios[0].id_fila,1);
 assert.equal(result.cambios[0].tipo,'CAMBIO_DESDE_BASE');
 assert.deepEqual(result.cambios[0].fecha_operativa_original_o_actual,['STRING','16/10/2026']);
 assert.equal(result.autoriza_sincronizar,false);
});

test('a formula change is detected even when displayed value is constant',()=>{
 const h=createHarness(2);h.rows[0].formulas[11]='=2+2';h.call('metroSincro11SellarBase');h.rows[0].formulas[11]='=2*2';
 const d=cleanResult(h.call('metroSincro11Comparar'));assert.equal(d.modificaciones_o_altas,1);
});

test('a note change is detected, including comments in existing historical rows',()=>{
 const h=createHarness(2);h.rows[0].notes[8]='Comentario manual 01';h.call('metroSincro11SellarBase');h.rows[0].notes[8]='Comentario manual 02';
 const d=cleanResult(h.call('metroSincro11Comparar'));assert.equal(d.modificaciones_o_altas,1);
});

test('reordering physical rows does not change permanent ID_FILA identities',()=>{
 const h=createHarness(7);h.call('metroSincro11SellarBase');h.rows.reverse();
 assert.equal(cleanResult(h.call('metroSincro11Comparar')).modificaciones_o_altas,0);
});

test('new rows and removed rows flagged, never interpreted as copying historical cases',()=>{
 const h=createHarness(3);h.call('metroSincro11SellarBase');h.rows.pop();h.rows.push(asRow(99));
 const d=cleanResult(h.call('metroSincro11Comparar'));
 assert.deepEqual(d.cambios.map(x=>x.id_fila),[99]);assert.deepEqual(d.ausencias.map(x=>x.id_fila),[3]);
});

test('duplicate ID_FILA prevents baseline creation and further comparisons',()=>{
 const h=createHarness(3,{rows:[asRow(1),asRow(1),asRow(3)]});
 const prev=cleanResult(h.call('metroSincro11PrevisualizarBase'));
 assert.equal(prev.puede_sellar,false);assert.equal(prev.identidades_duplicadas.length,1);
 assert.throws(()=>h.call('metroSincro11SellarBase'),/ID_FILA no válido/);
 assert.equal(h.writes.length,0);
});

test('missing ID_FILA, even in an old record, blocks unsafe baseline',()=>{
 const h=createHarness(2);h.rows[0].values[19]='';
 assert.deepEqual(cleanResult(h.call('metroSincro11PrevisualizarBase')).filas_sin_id,[2]);
 assert.throws(()=>h.call('metroSincro11SellarBase'),/ID_FILA no válido/);
});

test('attempt to edit identity T after baseline becomes missing+new and not auto-corrected',()=>{
 const h=createHarness(2);h.call('metroSincro11SellarBase');h.rows[0].values[19]=1000000;
 const d=cleanResult(h.call('metroSincro11Comparar'));
 assert.deepEqual(d.ausencias.map(x=>x.id_fila),[1]);assert.deepEqual(d.cambios.map(x=>x.id_fila),[1000000]);
});

test('wrong source spreadsheet or missing sheet fails without modifying any property',()=>{
 const h=createHarness(2,{actualId:'FALSO'});assert.throws(()=>h.call('metroSincro11PrevisualizarBase'),/Archivo origen no acreditado/);
 assert.equal(h.writes.length,0);
});

test('document properties unavailable means preview fails closed',()=>{
 const h=createHarness(2,{nullStore:true});assert.throws(()=>h.call('metroSincro11PrevisualizarBase'),/DocumentProperties/);assert.equal(h.writes.length,0);
});

test('base tamper checksum stops compare without modifying sheet',()=>{
 const h=createHarness(40);h.call('metroSincro11SellarBase');
 const part=Object.keys(h.props).find(x=>x.includes('MG11_BASE_V1_')&&x!=='MG11_BASE_V1_MANIFEST');
 h.props[part]=h.props[part].replace('1|','7|');
 assert.throws(()=>h.call('metroSincro11Comparar'),/Base corrupta|Identidad duplicada/);
});

test('quota failure leaves uncommitted base, blocks repeated seal',()=>{
 const h=createHarness(100,{failWritesAfter:1});assert.throws(()=>h.call('metroSincro11SellarBase'),/Simulated quota/);
 assert.equal(h.props.MG11_BASE_V1_MANIFEST,undefined);
 assert.equal(cleanResult(h.call('metroSincro11PrevisualizarBase')).puede_sellar,false);
 assert.equal(cleanResult(h.call('metroSincro11Estado')).base_parcial_a_revisar,true);
 assert.throws(()=>h.call('metroSincro11SellarBase'),/restos de un sellado/);
});

test('source mutates between two snapshots: seal aborts with no writes',()=>{
 const h=createHarness(4,{onRead:(count,rows)=>{if(count===2)rows[1].values[9]='COPIADO EN MEDIO';}});
 assert.throws(()=>h.call('metroSincro11SellarBase'),/cambió durante la captura/);
 assert.equal(h.writes.length,0);
});

test('document lock busy prevents new base',()=>{
 const h=createHarness(2,{failLock:true});assert.throws(()=>h.call('metroSincro11SellarBase'),/Otro proceso/);assert.equal(h.writes.length,0);
});

test('exact size limit 9KB enforced with thousands of actual-style rows',()=>{
 const h=createHarness(6742);
 const result=cleanResult(h.call('metroSincro11SellarBase'));
 assert.equal(result.filas,6742);
 assert.ok(result.paquetes > 30);
 const values=Object.entries(h.props);
 const size=values.reduce((n,[k,v])=>n+Buffer.byteLength(k+v),0);
 assert.ok(size<300000,`baseline should stay small (${size})`);
 assert.ok(values.every(([k,v])=>Buffer.byteLength(v)<9000),'each prop must respect 9KB');
 assert.equal(cleanResult(h.call('metroSincro11Comparar')).modificaciones_o_altas,0);
});

test('hundreds of changes keep complete counts, but small preview is explicitly partial',()=>{
 const h=createHarness(115);h.call('metroSincro11SellarBase');
 for(const r of h.rows)r.values[11]='CAMBIO';
 const d=cleanResult(h.call('metroSincro11Comparar'));
 assert.equal(d.modificaciones_o_altas,115);assert.equal(d.cambios.length,100);assert.equal(d.lista_parcial,true);
});

test('retained past snapshot is never silently overwritten by repeated seal',()=>{
 const h=createHarness(4);const old=cleanResult(h.call('metroSincro11SellarBase'));
 h.rows[0].values[0]='UNIDAD MANUAL';assert.throws(()=>h.call('metroSincro11SellarBase'),/Ya existe una base/);
 const state=cleanResult(h.call('metroSincro11Estado'));
 assert.equal(state.fecha_base,old.fecha_base);
 assert.equal(cleanResult(h.call('metroSincro11Comparar')).modificaciones_o_altas,1);
});