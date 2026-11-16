import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import { auditarFuturoSoloLectura, CORTE_FUTURO_METROGES } from '../shared/sincro11-futuro-lector.mjs';

const fecha1='2026-11-16T05:30:25.398Z', fecha2='2026-11-16T08:00:00.000Z';
function fila(id, patch={}) {
 const values=Array(26).fill(''),formulas=Array(26).fill(''),notes=Array(26).fill('');
 values[0]='TEST-DFM';values[4]='PA-TEST-1';values[7]='AV';values[8]='14/09/2024';values[19]=id;
 for(const [column,value] of Object.entries(patch.values||{})) values[Number(column)-1]=value;
 for(const [column,value] of Object.entries(patch.formulas||{})) formulas[Number(column)-1]=value;
 for(const [column,value] of Object.entries(patch.notes||{})) notes[Number(column)-1]=value;
 return {values,formulas,notes};
}
const fotos=(before,after,time1=fecha1,time2=fecha2)=>[
 {capturada_en:time1,rows:before}, {capturada_en:time2,rows:after}
];
const testCall=(a,b,...dates)=>auditarFuturoSoloLectura(...fotos(a,b,...dates));

test('columna T manda; dos filas iguales en distinto orden no producen cambios',()=>{
 const rows=Array.from({length:23},(_,i)=>fila(i+1));
 const r=testCall(rows,[...rows].reverse());
 assert.equal(r.cambios_pendientes,0);assert.equal(r.altas_pendientes,0);assert.equal(r.ausencias_pendientes,0);
 assert.equal(r.filas_actuales,23);
});
test('fórmula histórica A1 desplazada y su valor recalculado NO son eventos',()=>{
 const old=fila(1601,{formulas:{12:'=K1623-J1623+1'},values:{12:4}});
 const moved=fila(1601,{formulas:{12:'=K1624-J1624+1'},values:{12:5}});
 const r=testCall([old],[moved]);assert.equal(r.cambios_pendientes,0);assert.equal(r.formulas_excluidas_de_cotejo,1);
});
test('corrección nueva de una fecha antigua sí es diferencia legítima',()=>{
 const r=testCall([fila(1601)],[fila(1601,{values:{9:'15/09/2024'}})]);
 assert.equal(r.cambios_pendientes,1);assert.deepEqual(r.cambios[0].columnas.map(x=>x.columna),['I']);
 assert.equal(r.autoriza_sincronizar,false);
});
test('una nota humana nueva en una fila con fórmula histórica sí se observa',()=>{
 const a=fila(1601,{formulas:{12:'=K1623-J1623+1'}});
 const b=fila(1601,{formulas:{12:'=K1624-J1624+1'},notes:{12:'ANOTACIÓN MANUAL NUEVA'}});
 const r=testCall([a],[b]);assert.equal(r.cambios_pendientes,1);
 assert.deepEqual(r.cambios[0].columnas,[{columna:'L',nombre:'VALOR / CONTROL',tipos:['NOTA']}]);
});
test('cambio de fórmula a literal en L queda retenido',()=>{
 const r=testCall([fila(1,{formulas:{12:'=K2-J2+1'}})],[fila(1,{values:{12:7}})]);
 assert.equal(r.cambios_pendientes,1);assert.deepEqual(r.cambios[0].columnas[0].tipos,['DATO']);
});
test('cambiar PA no cambia identidad y nunca crea otra parada',()=>{
 const r=testCall([fila(1)],[fila(1,{values:{5:'PA-TEST-2'}})]);
 assert.equal(r.cambios_pendientes,1);assert.equal(r.cambios[0].id_fila,1);
 assert.equal(r.permite_crear_PA,false);
});
test('la misma ID_FILA con DFM distinto nunca se trata de alta',()=>{
 const r=testCall([fila(1)],[fila(1,{values:{1:'TEST-DFM-2'}})]);
 assert.equal(r.altas_pendientes,0);assert.equal(r.cambios_pendientes,1);
 assert.deepEqual(r.cambios[0].columnas.map(x=>x.columna),['A']);
});
test('nueva identidad T queda retenida, sin crear automáticamente T',()=>{
 const r=testCall([fila(1)],[fila(1),fila(2)]);
 assert.equal(r.altas_pendientes,1);assert.deepEqual(r.altas.map(x=>x.id_fila),[2]);assert.equal(r.permite_crear_T,false);
});
test('ID desaparecida se retiene, no se declara BAJA',()=>{
 const r=testCall([fila(1),fila(2)],[fila(1)]);
 assert.equal(r.ausencias_pendientes,1);assert.equal(r.ausencias[0].tipo,'IDENTIDAD_AUSENTE_REQUIERE_REVISION');
});
test('T duplicada: fallar cerrando sin tomar la primera',()=>{
 assert.throws(()=>testCall([fila(1)],[fila(1),fila(1)]),/duplicado/);
});
test('T vacía, cero, negativa o decimal: fallar cerrando',()=>{
 for(const bad of ['',0,-1,1.5,'01','ID-1',null])assert.throws(()=>testCall([fila(1)],[fila(bad)]),/columna T/);
});
test('fecha operativa anterior a corte no altera la fecha de observación',()=>{
 const r=testCall([fila(1,{values:{9:new Date('2024-09-14T00:00:00Z')}})],[fila(1,{values:{9:new Date('2024-09-14T00:00:00Z')}})]);
 assert.equal(r.cambios_pendientes,0);assert.equal(r.fecha_base,fecha1);
});
test('no se puede observar sin fuente temporal posterior al corte',()=>{
 assert.throws(()=>testCall([fila(1)],[fila(1)],'2026-11-15T22:59:59.999Z',fecha2),/anterior al corte/);
});
test('no se acepta una hora ambigua, no UTC o inválida',()=>{
 for(const bad of ['2026-11-16','2026-11-16T10:00:00','2026-02-30T08:00:00.000Z'])assert.throws(()=>testCall([fila(1)],[fila(1)],bad,fecha2),/hora UTC|inválida/);
});
test('no se acepta observación anterior a foto base',()=>{
 assert.throws(()=>testCall([fila(1)],[fila(1)],fecha2,fecha1),/anterior a la base/);
});
test('diferencias de varias celdas se ordenan por columna pero no revelan valores',()=>{
 const r=testCall([fila(1)],[fila(1,{values:{4:'DIEGO',6:'AUTODIS',10:'30/10/2026'},notes:{7:'NOTA PRIVADA'}})]);
 assert.equal(r.cambios_pendientes,1);assert.deepEqual(r.cambios[0].columnas.map(x=>x.columna),['D','F','G','J']);
 assert.equal(JSON.stringify(r).includes('NOTA PRIVADA'),false);
});
test('cambia fecha de entrada J de una T antigua: se observa igual',()=>{
 const r=testCall([fila(1)],[fila(1,{values:{10:'17/11/2026'}})]);
 assert.deepEqual(r.cambios[0].columnas.map(x=>x.columna),['J']);
});
test('no inventa la hora exacta ni el autor del cambio',()=>{
 const r=testCall([fila(1)],[fila(1,{values:{8:'TRAMITE'}})]);
 assert.equal(r.cambios_con_autor_o_fecha_acreditados,0);assert.equal(r.autoriza_sincronizar,false);
});
test('alterar formulario de la propia columna T no crea otro ID válido',()=>{
 const r=testCall([fila(1)],[fila(2)]);
 assert.deepEqual(r.ausencias.map(x=>x.id_fila),[1]);assert.deepEqual(r.altas.map(x=>x.id_fila),[2]);
});
test('notas y literal de texto se comparan aun con fórmulas en otras columnas',()=>{
 const r=testCall([fila(1,{formulas:{12:'=K2-J2+1'}})],[fila(1,{formulas:{12:'=K3-J3+1'},values:{13:'FECHA NUEVA'},notes:{9:'Anotación'}})]);
 assert.equal(r.cambios_pendientes,1);assert.deepEqual(r.cambios[0].columnas.map(x=>x.columna),['I','M']);
});
test('proceso de 6742 identidades de prueba no pierde ni duplica cambios',()=>{
 const base=Array.from({length:6742},(_,i)=>fila(i+1));
 const after=[...base].reverse().map(row=>({...row,values:[...row.values],notes:[...row.notes],formulas:[...row.formulas]}));
 after.find(r=>r.values[19]===1601).values[8]='20/12/2024';
 const r=testCall(base,after);
 assert.equal(r.filas_actuales,6742);assert.equal(r.cambios_pendientes,1);
 assert.deepEqual(r.cambios.map(x=>x.id_fila),[1601]);
});
test('ancho de 25 o 27 columnas se rechaza sin mutación',()=>{
 for(const n of [25,27]){const bad=fila(1);bad.values=Array(n).fill('');assert.throws(()=>testCall([bad],[fila(1)]),/ancho/);}
});
test('fórmula sintácticamente modificada queda fuera de la fuente operativa',()=>{
 const r=testCall([fila(1,{formulas:{12:'=K2-J2+1'}})],[fila(1,{formulas:{12:'=SUM(K2;J2)'}})]);
 assert.equal(r.cambios_pendientes,0);
});
test('registro con fecha base y actual idéntica no permite escribir',()=>{
 const r=testCall([fila(1)],[fila(1)],fecha1,fecha1);
 assert.equal(r.escritura_en_hojas,false);assert.equal(r.escritura_en_backend,false);
});
test('instancia no depende de número de fila físico ni contiene motores de escritura',()=>{
 const src = readFileSync(new URL('../shared/sincro11-futuro-lector.mjs', import.meta.url),'utf8');
 for(const pattern of [/SpreadsheetApp/,/UrlFetchApp/,/setValues\(/,/update\(/,/createTrigger/,/fila_fisica/,/numero_fila/])assert.doesNotMatch(src,pattern);
 assert.equal(CORTE_FUTURO_METROGES,'2026-11-15T23:00:00.000Z');
});


test('edición nueva de TANCAMENT existente: fecha histórica no bloquea y su fórmula no manda',()=>{
 const before=fila(9001,{values:{8:'TANCAMENT 11',9:'14/09/2024',10:'18/09/2024',11:'21/09/2024'},formulas:{12:'=K1623-J1623+1'}});
 const after=fila(9001,{values:{8:'TANCAMENT 11',9:'14/09/2024',10:'19/09/2024',11:'21/09/2024'},formulas:{12:'=K1624-J1624+1'}});
 const result=testCall([before],[after]);
 assert.deepEqual(result.cambios.map(c=>c.id_fila),[9001]);
 assert.deepEqual(result.cambios[0].columnas.map(c=>c.columna),['J']);
 assert.equal(result.autoriza_sincronizar,false);
});

test('pasar de PR provisional a PA no crea automáticamente parada ni otra identidad',()=>{
 const x=fila(812,{values:{5:'PR-001'}});
 const y=fila(812,{values:{5:'PA-2600302'}});
 const d=testCall([x],[y]);
 assert.equal(d.cambios_pendientes,1);
 assert.equal(d.altas_pendientes,0);
 assert.equal(d.permite_crear_PA,false);
 assert.deepEqual(d.cambios[0].columnas.map(c=>c.columna),['E']);
});

test('una nota desaparecida cuenta como diferencia, sin ordenar borrarla',()=>{
 const d=testCall([fila(77,{notes:{16:'NOTA MANUAL'}})],[fila(77)]);
 assert.equal(d.cambios_pendientes,1);
 assert.deepEqual(d.cambios[0].columnas[0],{columna:'P',nombre:'KM / HORES',tipos:['NOTA']});
 assert.equal(d.escritura_en_hojas,false);
});