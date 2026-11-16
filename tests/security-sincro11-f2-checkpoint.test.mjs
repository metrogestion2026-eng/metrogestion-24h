import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import vm from 'node:vm';

const SOURCE = readFileSync(new URL('../r1-alpha75/google-apps-script/sincro11_futuro_checkpoint.gs', import.meta.url), 'utf8');
const SPREADSHEET = '1PQE5VsjTvDFvQZcqedyQKIs3RbSySHFK4JPQXBD0XyU';
const CHOICE = 'CONFIRMO_REFERENCIA_FUTURA_F2_NO_OPERATIVA';
const baseV1 = Object.freeze({
  version:'sincro11-base-readonly-20261115.1',
  spreadsheet_id: SPREADSHEET,
  hoja:'MANTENIMENT', cantidad:6742,
  checksum:'IzzV6Y5JsxDgmiSymIt9Q',recogido_en:'2026-11-16T05:30:25.398Z',
});
function row(id,opts={}) {
  const values=Array(26).fill(''),formulas=Array(26).fill(''),notes=Array(26).fill('');
  values[0]=opts.dfm ?? '2573';values[4]=opts.stop??'PA-2600001';values[7]=opts.kind??'AV';
  values[8]=opts.date??'14/09/2024';values[9]=opts.done??'18/09/2024';values[10]='21/09/2024';
  values[11]=opts.calculated??4;values[19]=id;
  if(opts.formula)formulas[11]=opts.formula;
  if(opts.note)notes[11]=opts.note;
  return {values,formulas,notes};
}
function fixture(n=2,options={}) {
  const rows=options.rows??Array.from({length:n},(_,i)=>row(i+1));
  const props=options.props ?? {'MG11_BASE_V1_MANIFEST':JSON.stringify(baseV1)};
  const writes=[],effects=[],reads={count:0},lock={held:false};
  let fakeIso=options.iso??'2026-11-16T08:20:00.000Z';
  const range = (start,column,height,width) => {
    assert.equal(start,2);assert.equal(column,1);assert.equal(height,rows.length);assert.equal(width,26);
    return {
      getValues:()=>{
        reads.count++;
        if(options.onRead)options.onRead(reads.count,rows);
        return rows.map(x=>x.values.slice());
      },
      getFormulas:()=>rows.map(x=>x.formulas.slice()),
      getNotes:()=>rows.map(x=>x.notes.slice()),
    };
  };
  const sheet = {
    getName:()=>options.sheetName??'MANTENIMENT',
    getMaxColumns:()=>options.columns??26,
    getLastRow:()=>rows.length+1,
    getRange:range,
  };
  const spreadsheet = {
    getId:()=>options.id??SPREADSHEET,
    getSheetByName:name=>name==='MANTENIMENT'?sheet:null,
  };
  const store = {
    getProperty:key=>props[key]??null,
    getProperties:()=>({...props}),
    setProperty:(key,val)=>{
      assert.equal(typeof val,'string');
      if(Buffer.byteLength(val,'utf8')>9000)throw Error('Google per-property limit exceeded');
      if(Object.entries({...props,[key]:val}).reduce((a,[k,v])=>a+Buffer.byteLength(k+v),0)>500000)
        throw Error('Google document properties limit exceeded');
      if(options.failAfter!==undefined && writes.length>=options.failAfter)throw Error('Simulated write outage');
      props[key]=val;writes.push({key,val});
    },
  };
  const runtime={
    Date:class FakeDate extends Date {
      constructor(...args) { super(...(args.length?args:[fakeIso])); }
      static now(){return new Date(fakeIso).getTime();}
    },
    Map,Set,Object,JSON,Array,Number,String,Boolean,Math,
    PropertiesService:{getDocumentProperties:()=>options.nullStore?null:store},
    SpreadsheetApp:{openById:id=>{effects.push(['openById',id]);return spreadsheet;}},
    LockService:{getDocumentLock:()=>options.nullLock?null:{tryLock:()=>{if(options.busy)return false;lock.held=true;return true;},releaseLock:()=>{lock.held=false;}}},
    Utilities:{
      DigestAlgorithm:{SHA_256:'sha256'},Charset:{UTF_8:'utf8'},
      computeDigest:(algo,data)=>Array.from(createHash(algo).update(data,'utf8').digest()),
      base64EncodeWebSafe:arr=>Buffer.from(arr).toString('base64url'),
      getUuid:()=>randomUUID(),
    },console:{log:(...args)=>effects.push(['console',args.length])},
  };
  const ctx=vm.createContext(runtime);
  vm.runInContext(SOURCE,ctx,{filename:'sincro11_futuro_checkpoint.gs'});
  const call=(name,...args)=>JSON.parse(JSON.stringify(ctx[name](...args)));
  return {rows,props,writes,effects,reads,call,store,setTime:value=>{fakeIso=value;},lock};
}

// Protection and basic continuity
test('script is additive and never installs triggers or calls network or sheet writers',()=>{
  assert.match(SOURCE,/function metroSincro11F2Previsualizar\(/);
  assert.match(SOURCE,/function metroSincro11F2Comparar\(/);
  assert.match(SOURCE,/function metroSincro11F2CrearReferencia_\(/);
  for(const rx of [/function onEdit\(/,/function onOpen\(/,/\bScriptApp\b/,/\bUrlFetchApp\b/,/\.setValues?\(/,/\.insertRow\w*\(/,/\.deleteRow\w*\(/,/\.clearContent\(/,/\.setNote\(/,/\.removeProperty\(/])
    assert.doesNotMatch(SOURCE,rx);
});
test('preview reads full sheet without writing cells or props',()=>{
  const x=fixture(3);const r=x.call('metroSincro11F2Previsualizar');
  assert.equal(r.filas,3);assert.equal(r.v1_existente,true);
  assert.equal(r.referencia_f2_existente,false);
  assert.equal(r.propiedades_modificadas,false);assert.deepEqual(x.writes,[]);
});
test('estado reports reference missing, V1 remains available',()=>{
  const x=fixture();const r=x.call('metroSincro11F2Estado');
  assert.equal(r.v1_preservada,true);assert.equal(r.referencia_f2_existente,false);
  assert.deepEqual(x.writes,[]);
});
test('without explicit approval a direct call cannot create reference',()=>{
  const x=fixture();for(const p of [undefined,'',true,'SELLARBASE','CONFIRMO'])assert.throws(()=>x.call('metroSincro11F2CrearReferencia_',p),/autorización explícita/);
  assert.deepEqual(x.writes,[]);
});
test('when separately authorized, F2 creates once and preserves every V1 key',()=>{
  const x=fixture(5);const old={...x.props};const r=x.call('metroSincro11F2CrearReferencia_',CHOICE);
  assert.equal(r.resultado,'REFERENCIA_F2_CREADA');assert.equal(r.filas_f2,5);
  assert.equal(r.autoriza_sincronizar,false);assert.equal(r.hojas_modificadas,false);
  for(const [k,v] of Object.entries(old))assert.equal(x.props[k],v);
  assert.equal(x.lock.held,false);
  const e=x.call('metroSincro11F2Estado');assert.equal(e.filas_f2,5);assert.equal(e.v1_preservada,true);
  assert.throws(()=>x.call('metroSincro11F2CrearReferencia_',CHOICE),/ya existe referencia F2/);
});
test('comparison without F2 baseline fails closed without writes',()=>{
  const x=fixture();assert.throws(()=>x.call('metroSincro11F2Comparar'),/falta la referencia futura/);
  assert.deepEqual(x.writes,[]);
});
test('unchanged rows report zero differences across time',()=>{
  const x=fixture(23);x.call('metroSincro11F2CrearReferencia_',CHOICE);
  const writes=x.writes.length; x.setTime('2026-11-17T17:00:00.000Z');
  const r=x.call('metroSincro11F2Comparar');
  assert.equal(r.filas_actuales,23);assert.equal(r.cambios_observados,0);
  assert.equal(r.altas_nuevas,0);assert.equal(r.identidades_ausentes,0);
  assert.equal(x.writes.length,writes);
});

test('reordering rows including formula A1 refs changes neither id nor content',()=>{
  const a=row(1601,{formula:'=K1623-J1623+1',calculated:4});
  const b=row(2600,{formula:'=K1625-J1625+1',calculated:7});
  const x=fixture(2,{rows:[a,b]});x.call('metroSincro11F2CrearReferencia_',CHOICE);
  x.rows.reverse();x.rows[1].formulas[11]='=K1624-J1624+1';x.rows[1].values[11]=5;
  const r=x.call('metroSincro11F2Comparar');
  assert.equal(r.cambios_observados,0);assert.equal(r.altas_nuevas,0);
});
test('edit to historic date J is observed by same ID_FILA',()=>{
  const x=fixture(2);x.call('metroSincro11F2CrearReferencia_',CHOICE);
  x.rows[0].values[9]='19/09/2024';
  const r=x.call('metroSincro11F2Comparar');
  assert.equal(r.cambios_observados,1);assert.equal(r.cambios[0].id_fila,1);
  assert.equal(r.origen_humano_acreditado,false);
});
test('a note on a formula cell counts as change while formula code does not',()=>{
  const x=fixture(1,{rows:[row(1601,{formula:'=K1623-J1623+1'})]});
  x.call('metroSincro11F2CrearReferencia_',CHOICE);
  x.rows[0].formulas[11]='=K1624-J1624+1';x.rows[0].values[11]=10;
  assert.equal(x.call('metroSincro11F2Comparar').cambios_observados,0);
  x.rows[0].notes[11]='NOTA NUEVA EN FORMULA';
  assert.equal(x.call('metroSincro11F2Comparar').cambios_observados,1);
});
test('PR provisional changed to definitive PA remains same identity, no new stop',()=>{
  const x=fixture(1,{rows:[row(42,{stop:'PR-005'})]});x.call('metroSincro11F2CrearReferencia_',CHOICE);
  x.rows[0].values[4]='PA-2600123';const r=x.call('metroSincro11F2Comparar');
  assert.equal(r.altas_nuevas,0);assert.deepEqual(r.cambios.map(i=>i.id_fila),[42]);
  assert.equal(r.permite_crear_PA,false);
});
test('TANCAMENT historic line updated now is observed, not executed as work',()=>{
  const x=fixture(1,{rows:[row(111,{kind:'TANCAMENT 11',done:'18/09/2024'})]});
  x.call('metroSincro11F2CrearReferencia_',CHOICE);
  x.rows[0].values[9]='20/09/2024';const r=x.call('metroSincro11F2Comparar');
  assert.equal(r.cambios_observados,1);assert.equal(r.permite_crear_T,false);
  assert.equal(r.escritura_en_hojas,false);
});
test('manually modified DFM with unchanged T is still same record',()=>{
  const x=fixture(1);x.call('metroSincro11F2CrearReferencia_',CHOICE);
  x.rows[0].values[0]='NUEVO_DFM';const r=x.call('metroSincro11F2Comparar');
  assert.equal(r.cambios_observados,1);assert.equal(r.altas_nuevas,0);
});
test('renumbering T is missing and new ID, never automatically linked',()=>{
  const x=fixture(1);x.call('metroSincro11F2CrearReferencia_',CHOICE);
  x.rows[0].values[19]=99;
  const r=x.call('metroSincro11F2Comparar');
  assert.equal(r.altas_nuevas,1);assert.equal(r.identidades_ausentes,1);
  assert.equal(r.autoriza_sincronizar,false);
});
test('new ID and missing ID counted separately',()=>{
  const x=fixture(2);x.call('metroSincro11F2CrearReferencia_',CHOICE);
  x.rows.pop();x.rows.push(row(3));const r=x.call('metroSincro11F2Comparar');
  assert.deepEqual(r.altas.map(a=>a.id_fila),[3]);assert.deepEqual(r.ausencias.map(a=>a.id_fila),[2]);
});

test('source duplicate ID blocks reference and comparison without resolving arbitrarily',()=>{
  const x=fixture(2,{rows:[row(1),row(1)]});
  assert.throws(()=>x.call('metroSincro11F2Previsualizar'),/duplicado/);
  assert.throws(()=>x.call('metroSincro11F2CrearReferencia_',CHOICE),/duplicado/);
  assert.equal(x.writes.length,0);
});
test('missing or invalid T blocks capture',()=>{
  for(const bad of ['',null,0,'AAA',-3]){
    const x=fixture(1,{rows:[row(bad)]});
    assert.throws(()=>x.call('metroSincro11F2CrearReferencia_',CHOICE),/columna T inválida/);
    assert.equal(x.writes.length,0);
  }
});
test('missing V1 manifest blocks F2 and preserves document properties',()=>{
  const x=fixture(1,{props:{OTHER:'TEST'}});
  assert.throws(()=>x.call('metroSincro11F2Previsualizar'),/no existe la base V1/);
  assert.throws(()=>x.call('metroSincro11F2CrearReferencia_',CHOICE),/no existe la base V1/);
  assert.equal(x.writes.length,0);
});
test('wrong spreadsheet or missing columns fail closed',()=>{
  for(const opts of [{id:'OTHER'},{sheetName:'INACTIVE'},{columns:25}]){
    const x=fixture(1,opts);
    assert.throws(()=>x.call('metroSincro11F2Previsualizar'),/no se acredita|pestaña/);
  }
});
test('missing document property store fails closed',()=>{
  const x=fixture(1,{nullStore:true});assert.throws(()=>x.call('metroSincro11F2Previsualizar'),/DocumentProperties/);
});
test('document lock contention blocks publication',()=>{
  const x=fixture(1,{busy:true});assert.throws(()=>x.call('metroSincro11F2CrearReferencia_',CHOICE),/ocupada/);assert.equal(x.writes.length,0);
});
test('change between two read passes prevents future reference',()=>{
  const x=fixture(2,{onRead:(n,rows)=>{if(n===2)rows[0].values[9]='20/09/2024';}});
  assert.throws(()=>x.call('metroSincro11F2CrearReferencia_',CHOICE),/cambios entre las fotografías/);
  assert.equal(x.writes.length,0);
});
test('partial commit is blocked, V1 remains and no automatic retry',()=>{
  const x=fixture(200,{failAfter:1});assert.throws(()=>x.call('metroSincro11F2CrearReferencia_',CHOICE),/Simulated write outage/);
  assert.equal(x.props.MG11_BASE_V1_MANIFEST,JSON.stringify(baseV1));
  assert.equal(x.props.MG11_F2_CHECKPOINT_MANIFEST,undefined);
  assert.equal(x.call('metroSincro11F2Estado').referencia_f2_parcial,true);
  assert.throws(()=>x.call('metroSincro11F2CrearReferencia_',CHOICE),/restos parciales/);
});
test('tampering a F2 chunk blocks comparison',()=>{
  const x=fixture(200);x.call('metroSincro11F2CrearReferencia_',CHOICE);
  const key=Object.keys(x.props).find(k=>k.startsWith('MG11_F2_CHECKPOINT_')&&k!=='MG11_F2_CHECKPOINT_MANIFEST');
  x.props[key]=x.props[key].replace('1|','11|');
  assert.throws(()=>x.call('metroSincro11F2Comparar'),/checksum incorrecto/);
});
test('changed V1 manifest checksum blocks F2 compare',()=>{
  const x=fixture();x.call('metroSincro11F2CrearReferencia_',CHOICE);
  x.props.MG11_BASE_V1_MANIFEST=JSON.stringify({...baseV1,checksum:'OTHER'});
  assert.throws(()=>x.call('metroSincro11F2Comparar'),/referencia V1 ha cambiado/);
});
test('large store quota fails before any property write',()=>{
  const props={MG11_BASE_V1_MANIFEST:JSON.stringify(baseV1), ...Object.fromEntries(Array.from({length:54},(_,i)=>['EXISTING_'+i,'a'.repeat(7900)]))};
  const x=fixture(100,{props});
  const p=x.call('metroSincro11F2Previsualizar');assert.equal(p.capacidad_estimada_suficiente,false);
  assert.throws(()=>x.call('metroSincro11F2CrearReferencia_',CHOICE),/capacidad/);
  assert.equal(x.writes.length,0);
});
test('6,742 IDs plus pre-existing V1 fit DocumentProperties and compare',()=>{
  const props={
    MG11_BASE_V1_MANIFEST:JSON.stringify(baseV1),
    ...Object.fromEntries(Array.from({length:24},(_,i)=>['MG11_BASE_V1_EXISTING_'+i,'X'.repeat(7700)])),
  };
  const x=fixture(6742,{props});
  const p=x.call('metroSincro11F2Previsualizar');
  assert.equal(p.filas,6742);assert.equal(p.capacidad_estimada_suficiente,true);
  const v1={...x.props};const ref=x.call('metroSincro11F2CrearReferencia_',CHOICE);
  assert.equal(ref.filas_f2,6742);
  const size=Object.entries(x.props).reduce((n,[k,v])=>n+Buffer.byteLength(k+v),0);
  assert.ok(size<430000,`store size ${size} > 430k`);
  assert.ok(Object.values(x.props).every(v=>Buffer.byteLength(v)<9000));
  for(const [k,v] of Object.entries(v1))assert.equal(x.props[k],v);
  const r=x.call('metroSincro11F2Comparar');assert.equal(r.cambios_observados,0);
});
test('more than 100 changes reports full count but shortened list',()=>{
  const x=fixture(150);x.call('metroSincro11F2CrearReferencia_',CHOICE);
  for(const r of x.rows)r.values[9]='25/09/2024';
  const out=x.call('metroSincro11F2Comparar');assert.equal(out.cambios_observados,150);
  assert.equal(out.cambios.length,100);assert.equal(out.lista_parcial,true);
});
test('F2 notes and formulas are observed but private note text is never reported',()=>{
  const x=fixture(1);x.call('metroSincro11F2CrearReferencia_',CHOICE);
  x.rows[0].notes[8]='NOTA PRIVADA';const out=x.call('metroSincro11F2Comparar');
  assert.equal(out.cambios_observados,1);assert.equal(JSON.stringify(out).includes('NOTA PRIVADA'),false);
});


test('single verification command is read-only, no sealing and complete logs',()=>{
 const x=fixture(4);
 const out=x.call('metroSincro11F2Verificar');
 assert.equal(out.estado.referencia_f2_existente,false);
 assert.equal(out.previa.filas,4);
 assert.match(out.comparacion.aviso,/Sin referencia F2/);
 assert.equal(x.writes.length,0);
 assert.ok(x.effects.some(e=>e[0]==='console'));
});

test('verification with an authorized F2 reference reports current differences only',()=>{
 const x=fixture(2);x.call('metroSincro11F2CrearReferencia_',CHOICE);
 const before=x.writes.length;x.rows[1].values[8]='16/11/2026';
 const out=x.call('metroSincro11F2Verificar');
 assert.equal(out.estado.referencia_f2_existente,true);
 assert.equal(out.comparacion.cambios_observados,1);
 assert.equal(x.writes.length,before);
});