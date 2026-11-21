import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../r1-alpha75/google-apps-script/sincronizar_manteniment.gs', import.meta.url), 'utf8');
const SPREADSHEET_ID = '1PQE5VsjTvDFvQZcqedyQKIs3RbSySHFK4JPQXBD0XyU';
const WORK = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const otherWork = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const date = () => new Date('2026-11-18T15:00:00.000Z');

function setup(overrides = {}) {
  const rows = [
    { id: null, dfm: '', clase: 'MANTENIMENT', note: '' },
    { id: 6000, dfm: '2612', clase: 'PARADA', note: '' },
    { id: 6971, dfm: overrides.dfm || '2637', clase: overrides.clase || 'AV',
      note: overrides.note ?? 'METROGESTION_T:' + WORK },
    { id: overrides.duplicateT ? 6971 : 6001, dfm: '2660', clase: 'ALTA', note: '' }
  ];
  const entries = [
    [6000,'ACTIVA',new Date('2026-11-01T12:00:00Z'),'','INSERT_ROW'],
    [6971,overrides.estado || 'ACTIVA',overrides.asignada || date(),'',
      overrides.origen || 'ORDEN_AUTORIZADA'],
    [6001,'ACTIVA',new Date('2026-11-01T12:00:00Z'),'','INSERT_ROW']
  ];
  const registry = {
    getLastRow: () => entries.length + 1,
    getRange: (r,c,n,cols) => {
      assert.deepEqual([r,c,n,cols],[2,1,entries.length,5]);
      return { getValues: () => entries };
    }
  };
  const book = {
    getId: () => SPREADSHEET_ID,
    getSheetByName: name => name === 'REGISTRO_FILAS' ? registry : null
  };
  const sheet = {
    getName: () => 'MANTENIMENT',
    getParent: () => book,
    getLastRow: () => rows.length,
    getRange: (r,c,n,cols) => {
      if (r === 2 && c === 20 && n === rows.length - 1 && cols === 1)
        return { getValues: () => rows.slice(1).map(v => [v.id]) };
      assert.equal(n,undefined);assert.equal(cols,undefined);
      const item=rows[r-1];
      assert.ok(item,'La fila inspeccionada debe existir');
      if (c===5) return {getNote:()=>item.note};
      if (c===8) return {getDisplayValue:()=>item.clase};
      if (c===1) return {getDisplayValue:()=>item.dfm};
      throw Error('Lectura inesperada: '+c);
    }
  };
  const context = {
    Date, Map, Set, Number, String, Object, Array,
    SpreadsheetApp: { openById: id => { assert.equal(id,SPREADSHEET_ID);return book; } }
  };
  vm.createContext(context);
  vm.runInContext(source + '\n;globalThis.__s13 = {' +
    'capturar: metroSincro13CapturarRecibosT_,' +
    'verificar: metroSincro13VerificarRecibosT_' +
    '};',context,{timeout:1000});
  const plan={
    confirmacion:{trabajos_creados: overrides.previstos ?? [{trabajo_sync_id:WORK,fila:3}]},
    memory:{rows: rows.map(v=>[
      {note:''},{note:''},{note:''},{note:''},{note:v.note}
    ])}
  };
  return {rows,entries,sheet,plan,api:context.__s13};
}

test('Recibo causal T de nueva fila creada por orden, nunca posición física',()=>{
  const x=setup();
  const res=x.api.capturar(x.sheet,x.plan,[3]);
  assert.equal(res.length,1);
  assert.equal(res[0].id_fila,6971);
  assert.equal(res[0].trabajo_sync_id,WORK);
  assert.equal(res[0].estado,'PENDIENTE_COTEJO_OBJETO');
  assert.ok(!Object.keys(res[0]).some(k=>/fila_fisica|row|dfm|pa/i.test(k)));
  assert.doesNotThrow(()=>x.api.verificar(x.sheet,res));
});

test('Cambiar la posición física NO cambia la identidad T',()=>{
  const x=setup(),receipt=x.api.capturar(x.sheet,x.plan,[3]);
  [x.rows[2],x.rows[3]]=[x.rows[3],x.rows[2]];
  assert.doesNotThrow(()=>x.api.verificar(x.sheet,receipt));
});

test('UUID en fila antigua NO crea vínculo positivo',()=>{
  const x=setup();
  assert.equal(x.api.capturar(x.sheet,x.plan,[]).length,0);
});

test('T duplicada en hoja bloquea todo recibo',()=>{
  const x=setup({duplicateT:true});
  assert.throws(()=>x.api.capturar(x.sheet,x.plan,[3]),/duplicada/i);
});

test('T BORRADA en registro bloquea recibo',()=>{
  const x=setup({estado:'BORRADA'});
  assert.throws(()=>x.api.capturar(x.sheet,x.plan,[3]),/no consta asignación/i);
});

test('INSERT_ROW no acredita alta de orden autorizada',()=>{
  const x=setup({origen:'INSERT_ROW'});
  assert.throws(()=>x.api.capturar(x.sheet,x.plan,[3]),/no consta asignación/i);
});

test('Registro previo al corte futuro no entra en SINCRO 13',()=>{
  const x=setup({asignada:new Date('2026-11-15T22:59:00Z')});
  assert.throws(()=>x.api.capturar(x.sheet,x.plan,[3]),/no consta asignación/i);
});

test('T de R1515 expresamente excluida',()=>{
  const x=setup({dfm:'R1515'});
  assert.throws(()=>x.api.capturar(x.sheet,x.plan,[3]),/excluida/i);
});

test('PARADA no se transforma en trabajo al compartir UUID',()=>{
  const x=setup({clase:'PARADA'});
  assert.throws(()=>x.api.capturar(x.sheet,x.plan,[3]),/trabajo/i);
});

test('Nota ajena a trabajo autorizado bloquea',()=>{
  const x=setup({note:'METROGESTION_T:'+otherWork});
  assert.throws(()=>x.api.capturar(x.sheet,x.plan,[3]),/no incluido/i);
});

test('Dos referencias de trabajo en una T nueva se retienen',()=>{
  const x=setup({note:'METROGESTION_T:'+WORK+'\nMETROGESTION_T:'+otherWork});
  assert.throws(()=>x.api.capturar(x.sheet,x.plan,[3]),/varias referencias/i);
});

test('Un UUID repetido en los trabajos previstos se rechaza',()=>{
  const x=setup({previstos:[{trabajo_sync_id:WORK},{trabajo_sync_id:WORK}]});
  assert.throws(()=>x.api.capturar(x.sheet,x.plan,[3]),/repetido/i);
});

test('Cambio de nota después del recibo bloquea ACK',()=>{
  const x=setup(),r=x.api.capturar(x.sheet,x.plan,[3]);
  x.rows[2].note='METROGESTION_T:'+otherWork;
  assert.throws(()=>x.api.verificar(x.sheet,r),/coincide/i);
});

test('Cambiar fecha original de emisión bloquea ACK',()=>{
  const x=setup(),r=x.api.capturar(x.sheet,x.plan,[3]);
  x.entries[1][2]=new Date('2026-11-18T15:05:00Z');
  assert.throws(()=>x.api.verificar(x.sheet,r),/fecha de asignación/i);
});

test('Recibo alterado o con nuevos campos bloquea ACK',()=>{
  const x=setup(),r=x.api.capturar(x.sheet,x.plan,[3]);
  assert.throws(()=>x.api.verificar(x.sheet,[{...r[0],fila_fisica:3}]),/alterado/i);
});

test('T faltante en hoja bloquea ACK sin reubicar por PA o DFM',()=>{
  const x=setup(),r=x.api.capturar(x.sheet,x.plan,[3]);
  x.rows[2].id=null;
  assert.throws(()=>x.api.verificar(x.sheet,r),/no consta asignación/i);
});
