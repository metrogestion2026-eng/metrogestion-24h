import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

const source = fs.readFileSync('r1-alpha75/google-apps-script/sincronizar_manteniment.gs', 'utf8');
const c = vm.createContext({ console, Date, Set, Map });
vm.runInContext(source, c);
c.metrogestionFechaCorteTrabajos_ = () => '2026-10-20';
const id = '11111111-1111-4111-8111-111111111111';
function row(code='GP') {
  const r = Array(17).fill('');
  Object.assign(r, {0:'DFM_TEST',1:'TEST_PLATE',4:'PA-9999999',5:'TEST_TALLER',
    6:'REPARACIÓN',7:code,8:'16/09/2026',9:'16/09/2026'});
  return r;
}
function read(r, {color='#d9ead3',note='',order='#ffff00'}={}) {
  return JSON.parse(JSON.stringify(c.metrogestionLeerTrabajos_([[],r], [[''],[note]],
    [[''],[color]], [[''],['#ffffff']], '2026-10-20', [[''],[order]])));
}
test('J sin K conserva GP, GC, AV y MCD con PA incluso en verde y con pedido en G', () => {
  for (const code of ['GP','GC','AV','MCD']) {
    const r=row(code); r[6]='TEST_ORDER';
    const works=read(r);
    assert.equal(works.length,1,code);
    assert.equal(works[0].taller,'TEST_TALLER');
    assert.equal(works[0].pedido,'TEST_ORDER');
    assert.equal(works[0].tipo_trabajo,'');
    assert.equal(works[0].fecha_realizada,'2026-09-16');
    assert.equal(works[0].fecha_recogida,'');
    assert.equal(c.metrogestionLeerPendientesListado_([[],r],[[],[]],
      [[],['#d9ead3']],[[],['#ffff00']]).length,1);
  }
});
test('el cierre manual en K deja de ser pendiente; un enlace existente comunica sus fechas', () => {
  const r=row(); r[10]='18/09/2026';
  assert.equal(read(r).length,0);
  assert.equal(c.metrogestionLeerPendientesListado_([[],r],[[],[]],[[],['#d9ead3']],[[],[]]).length,0);
  assert.equal(read(r,{note:`METROGESTION_T:${id}`})[0].fecha_recogida,'2026-09-18');
});
test('J histórica sin PA y trámites realizados no se reabren', () => {
  const r=row(); r[4]='';
  assert.equal(read(r,{color:'#ffffff'}).length,0);
  r[4]='GP-TEST'; assert.equal(read(r,{color:'#ffffff'}).length,0);
  for(const code of ['ITV','EXTINTOR','SG','RT']) assert.equal(read(row(code)).length,0);
  const admin=row(); admin[6]='GESTIÓN';
  assert.equal(read(admin,{order:'#ffffff'}).length,0);
});
test('la recogida escribe K una vez, mantiene J y respeta un K manual al reintentar', () => {
  const r=row(); const values=[Array(17).fill(''),r];
  const notes=['',`METROGESTION_T:${id}`]; const writes=[];
  const sheet={ getLastRow:()=>2, getRange(n,col,nRows=1,nCols=1) {
    const range={
      getDisplayValues:()=>values.slice(n-1,n-1+nRows).map(x=>x.slice(col-1,col-1+nCols)),
      getValues:()=>values.slice(n-1,n-1+nRows).map(x=>x.slice(col-1,col-1+nCols)),
      getNotes:()=>notes.slice(n-1,n-1+nRows).map(x=>[x]),
      getBackgrounds:()=>Array.from({length:nRows},()=>['#d9ead3']),
      getBackground:()=>'#d9ead3',
      getDisplayValue:()=>String(values[n-1][col-1]||''),
      setValue:v=>{writes.push({n,col,v});values[n-1][col-1]=v;return range;},
      setNumberFormat:()=>range,setBackground:()=>range,
    }; return range;
  }};
  const state={values,notesE:notes};
  const assignment={trabajo_sync_id:id,fila:999,clave_fila:c.metrogestionClaveFilaTrabajo_(r,false),
    fecha_entrada:'2026-09-16',fecha_salida:'2026-09-18'};
  c.metrogestionAplicarAsignacionesTrabajos_(sheet,[assignment],'PA-9999999',state,[]);
  assert.equal(writes.length,1); assert.equal(writes[0].col,11);
  assert.equal(r[9],'16/09/2026');
  c.metrogestionAplicarAsignacionesTrabajos_(sheet,[assignment],'PA-9999999',state,[]);
  assert.equal(writes.length,1);
  r[10]='19/09/2026';
  c.metrogestionAplicarAsignacionesTrabajos_(sheet,[assignment],'PA-9999999',state,[]);
  assert.equal(writes.length,1); assert.equal(r[10],'19/09/2026');
});
