import test from 'node:test';
import assert from 'node:assert/strict';
import {auditarLecturaGoogleT} from '../shared/sincro13-google-idfila-readback.mjs';

const U1='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const U3='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const mk=()=>({
  filas:[
    {id_fila:800002,clase:'PARADA',nota_e:'',dfm:'LAB-002'},
    {id_fila:800003,clase:'AV',nota_e:'METROGESTION_T:'+U3,dfm:'LAB-003'},
    {id_fila:800001,clase:'AV',nota_e:'METROGESTION_T:'+U1,dfm:'LAB-001'}
  ],
  registro:[
    {id_fila:800001,estado:'ACTIVA',origen:'ORDEN_AUTORIZADA'},
    {id_fila:800002,estado:'ACTIVA',origen:'INSERT_ROW'},
    {id_fila:800003,estado:'ACTIVA',origen:'ORDEN_AUTORIZADA'}
  ],
  propuestas:[{id_fila:800001,trabajo_sync_id:U1}]
});
test('lab Google real: T persiste al mover filas y coteja nota exacta',()=>{
  const x=mk(),r=auditarLecturaGoogleT(x);
  assert.equal(r.estado,'COTEJO_TECNICO_PENDIENTE_ACREDITACION');
  assert.equal(r.cotejos_tecnicos,1);
  assert.equal(r.autoriza_sincronizar,false);
  assert.equal(r.persona_que_edito_acreditada,false);
  x.filas.reverse();const y=auditarLecturaGoogleT(x);
  assert.deepEqual(y,r);
});
test('duplicidad de T en Google impide cualquier cotejo',()=>{
  const x=mk();x.filas[0].id_fila=800003;const r=auditarLecturaGoogleT(x);
  assert.equal(r.estado,'RETENER_SIN_ESCRIBIR');
  assert.equal(r.motivo,'T_DUPLICADA_EN_HOJA_O_REGISTRO');
  assert.equal(r.cotejos_tecnicos,0);
});
test('duplicidad de T en REGISTRO_FILAS impide cotejo',()=>{
  const x=mk();x.registro[2].id_fila=800001;const r=auditarLecturaGoogleT(x);
  assert.equal(r.motivo,'T_DUPLICADA_EN_HOJA_O_REGISTRO');
});
test('R1515 nunca se coteja favorablemente',()=>{
  const x=mk();x.filas[2].dfm='R1515';const r=auditarLecturaGoogleT(x);
  assert.equal(r.detalle[0].resultado,'UNIDAD_EXCLUIDA');
});
test('UUID compartido entre dos T no se convierte en vínculo',()=>{
  const x=mk();x.filas[1].nota_e='METROGESTION_T:'+U1;const r=auditarLecturaGoogleT(x);
  assert.equal(r.detalle[0].resultado,'UUID_COMPARTIDO_CON_OTRA_FILA');
});
test('una nota modificada bloquea el retorno',()=>{
  const x=mk();x.filas[2].nota_e='METROGESTION_T:'+U3;const r=auditarLecturaGoogleT(x);
  assert.equal(r.detalle[0].resultado,'NOTA_TRABAJO_NO_UNICA_O_DISTINTA');
});
test('registro INSERT_ROW no implica orden autorizada',()=>{
  const x=mk();x.registro[0].origen='INSERT_ROW';const r=auditarLecturaGoogleT(x);
  assert.equal(r.detalle[0].resultado,'REGISTRO_T_NO_ACREDITABLE');
});
test('registro BORRADA no se acepta',()=>{
  const x=mk();x.registro[0].estado='BORRADA';const r=auditarLecturaGoogleT(x);
  assert.equal(r.detalle[0].resultado,'REGISTRO_T_NO_ACREDITABLE');
});
test('no se deduce T a partir de posición física',()=>{
  const x=mk();x.filas[2].id_fila=800099;const r=auditarLecturaGoogleT(x);
  assert.equal(r.detalle[0].resultado,'T_NO_ENCONTRADA_O_SIN_REGISTRO');
});
test('PARADA no representa trabajo aunque comparta UUID',()=>{
  const x=mk();x.filas[2].clase='PARADA';const r=auditarLecturaGoogleT(x);
  assert.equal(r.detalle[0].resultado,'CLASE_NO_ES_TRABAJO');
});
test('propuestas con T repetida y UUID compartido son retenidas',()=>{
  const x=mk();x.propuestas.push({...x.propuestas[0]});const r=auditarLecturaGoogleT(x);
  assert.equal(r.conflictos,1);assert.equal(r.autoriza_sincronizar,false);
});
test('inventario inválido no devuelve datos operativos ni permisos',()=>{
  const x=mk();x.filas[0].id_fila='-5';const r=auditarLecturaGoogleT(x);
  assert.equal(r.motivo,'INVENTARIO_MALFORMADO');
  assert.equal(r.escribe_google,false);assert.equal(r.escribe_supabase,false);
});
test('sin propuestas se declara lectura pero no se crea permiso',()=>{
  const x=mk();x.propuestas=[];const r=auditarLecturaGoogleT(x);
  assert.equal(r.total,0);assert.equal(r.autoriza_sincronizar,false);
});
