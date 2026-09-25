import assert from 'node:assert/strict';
import test from 'node:test';
import { fixture, row } from './helpers/manteniment-sheet.mjs';

const sync='11111111-1111-4111-8111-111111111111';
const assignment=(id=sync,motivo='TEST-CAMPAIGN')=>({trabajo_sync_id:id,clave_fila:`EXT-TEST|TEST-PLATE|TEST-WORKSHOP|${motivo}|CV|2026-09-23`,fecha_entrada:'2026-09-23',fecha_salida:null,
 crear_necesidad:{dfm:'EXT-TEST',matricula:'TEST-PLATE',tipo:'TR',upc:'TEST',numero_parada:'PA-9999999',taller:'TEST-WORKSHOP',tipo_trabajo:motivo,designacion:'CV',fecha_necesidad:'2026-09-23',km:123,detalle:'TEST detail'}});
const refresh=f=>{f.state.values=f.sheet.data.map(r=>r.map(v=>v && typeof v.getFullYear==='function'?`${v.getFullYear()}-${String(v.getMonth()+1).padStart(2,'0')}-${String(v.getDate()).padStart(2,'0')}`:v));f.state.notesA=f.sheet.notes.map(r=>r[0]);f.state.notesE=f.sheet.notes.map(r=>r[4]);};
const apply=(f,a=[assignment()])=>f.context.metrogestionCrearNecesidadesHotel_(f.sheet,a,'PA-9999999',f.state);
for(const version of ['alpha75','alpha76']){
 test(`${version}: each job creates one need; retry preserves user documents and mileage`,()=>{
  const f=fixture(version,[row('EXT-TEST','ALTA'),row('OTHER','ALTA')]);f.sheet.data[1][17]='ARRAY-MONTH';f.sheet.data[1][18]='ARRAY-YEAR';
  const proofs=apply(f,[assignment(),assignment('22222222-2222-4222-8222-222222222222','TEST-B')]);
  assert.equal(proofs.length,2);assert.equal(f.sheet.inserted,2);assert.equal(f.sheet.data[2][7],'CV');assert.equal(f.sheet.data[3][7],'CV');assert.equal(f.sheet.data[1][17],'ARRAY-MONTH');assert.equal(f.sheet.data[1][18],'ARRAY-YEAR');assert.ok(f.sheet.copies.every(c=>c.columns===17));
  f.sheet.data[2][15]=456;f.sheet.data[2][16]='TEST-DOCUMENT';f.sheet.notes[2][7]='USER NOTE';refresh(f);
  apply(f);assert.equal(f.sheet.inserted,2);assert.equal(f.sheet.data[2][15],456);assert.equal(f.sheet.data[2][16],'TEST-DOCUMENT');assert.equal(f.sheet.notes[2][7],'USER NOTE');
 });
 test(`${version}: retry after interrupted row write resumes the marked blank row`,()=>{
  const f=fixture(version,[row('EXT-TEST','ALTA')]);const get=f.sheet.getRange;let fail=true;
  f.sheet.getRange=(r,c,nr,nc)=>{const range=get.call(f.sheet,r,c,nr,nc),set=range.setValues;range.setValues=function(v){if(fail&&r===3&&c===1&&nc===17&&v[0][7]==='CV'){fail=false;throw new Error('TEST interruption');}return set.call(this,v);};return range;};
  assert.throws(()=>apply(f),/TEST interruption/);refresh(f);assert.equal(apply(f)[0].fila,3);assert.equal(f.sheet.inserted,1);assert.equal(f.sheet.data[2][7],'CV');
 });
 test(`${version}: a conflicting linked row or ambiguous manual need is not overwritten`,()=>{
  const f=fixture(version,[row('EXT-TEST','ALTA')]);apply(f);f.sheet.data[2][0]='CHANGED';refresh(f);assert.throws(()=>apply(f),/cambió/);assert.equal(f.sheet.data[2][0],'CHANGED');
  const g=fixture(version,[row('EXT-TEST','ALTA')]);apply(g);g.sheet.notes[2][0]='';g.sheet.notes[2][4]='';refresh(g);assert.throws(()=>apply(g),/sin enlace/);assert.equal(g.sheet.inserted,1);
 });
 test(`${version}: invalid source key is rejected before inserting a row`,()=>{
  const f=fixture(version,[row('EXT-TEST','ALTA')]),a=assignment();a.clave_fila='INVALID';assert.throws(()=>apply(f,[a]),/identidad/);assert.equal(f.sheet.inserted,0);
 });
}
