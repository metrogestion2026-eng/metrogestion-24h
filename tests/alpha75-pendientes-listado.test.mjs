import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
import { matchesPendingScope } from '../r1-alpha75/src/pending-filters.js';
const script = fs.readFileSync('r1-alpha75/google-apps-script/sincronizar_manteniment.gs','utf8');
const c = vm.createContext({console, Date, Set, Map});
vm.runInContext(script,c);
function row(dfm, detail, date='20/09/2026') {
  const r=Array(17).fill('');
  Object.assign(r,{0:dfm,1:'TEST_PLATE',5:'TEST_TALLER',6:'MANTENIMIENTO',7:'MCD',8:date,16:detail});
  return r;
}
function read(rows,colors=[]) {
  return JSON.parse(JSON.stringify(c.metrogestionLeerPendientesListado_([[],...rows],[[]],
    [[],...rows.map((_,i)=>[colors[i]||'#ffffff'])],[[]])));
}
test('30 días incluye vencidas, hoy y día 30 en R y DFM; excluye día 31 y sin fecha',()=>{
  for(const dfm of ['R_TEST','DFM_TEST']) for(const [date,expected] of [
    ['2026-09-19',true],['2026-09-20',true],['2026-10-20',true],['2026-10-21',false],['',false]]) {
    assert.equal(matchesPendingScope({dfm,fecha_referencia:date},'next30','2026-09-20','2026-10-20'),expected);
  }
  assert.equal(matchesPendingScope({fecha_referencia:''},'undated','2026-09-20','2026-10-20'),true);
});
test('necesidades sin Hotel, lejanas y sin fecha se leen; Q mantiene distintos MCD',()=>{
  const rows=[row('DFM_TEST','M1','20/09/2027'),row('DFM_TEST','T1','20/09/2027'),row('R_TEST','A','')];
  const result=read(rows);
  assert.equal(result.length,3);
  assert.deepEqual(result.map(x=>x.detalle),['M1','T1','A']);
  assert.deepEqual(result.map(x=>x.numero_parada),['','','']);
  assert.equal(result[2].fecha_necesidad,'');
});
test('hechas, recogidas, auxiliares y coloreadas se excluyen del listado',()=>{
  const done=row('DFM_TEST','M1'); done[9]='19/09/2026';
  const collected=row('DFM_TEST','M2'); collected[10]='19/09/2026';
  const alta=row('DFM_TEST',''); alta[7]='ALTA';
  assert.deepEqual(read([done,collected,alta,row('DFM_TEST','M3')],['','','','#d9ead3']),[]);
});
test('recogida física pendiente conserva J y se cierra con K',()=>{
  const r=row('R_TEST',''); r[7]='REPUESTOS'; r[9]='19/09/2026';
  assert.equal(read([r]).length,1);
  r[10]='20/09/2026'; assert.equal(read([r]).length,0);
});
test('E histórica no oculta una necesidad blanca pendiente ni se convierte en parada',()=>{
  const r=row('DFM_TEST','M1'); r[4]='M-TEST';
  assert.equal(read([r]).length,1);
  assert.equal(read([r])[0].numero_parada,'');
});
