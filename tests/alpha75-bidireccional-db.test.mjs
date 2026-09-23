import fs from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
const require = createRequire(new URL('./sql-runtime/package.json', import.meta.url));
const { PGlite } = require('@electric-sql/pglite');
const baseline=fs.readFileSync(new URL('./fixtures/manteniment-bidireccional-baseline.sql',import.meta.url),'utf8');
const migration=fs.readFileSync(new URL('../supabase/migrations/20260923142949_alpha75_trabajos_necesidades_bidireccionales.sql',import.meta.url),'utf8');
const id=n=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
async function fixture(){
 const db=new PGlite(); try { await db.exec(baseline);await db.exec(migration); } catch(e) { await db.close(); throw new Error(`${e.message} at ${e.position}: ${e.query?.slice(Number(e.position)-100,Number(e.position)+150)}`); }
 await db.exec(`select set_config('test.uid','${id(1)}',false);select set_config('app.audit_origin','metrogestion-r1-editor',false);
 insert into public.pizarras(id,fecha,estado) values('${id(2)}',current_date,'en_curso');
 insert into public.registros_hotel(id,pizarra_id,seguimiento_id,vehiculo_sustituido,matricula_sustituido,numero_parada,modalidad_operativa,creado_por,modificado_por,marca) values('${id(3)}','${id(2)}','${id(4)}','TEST-UNIT','TEST-PLATE','TEST-STOP','reserva_en_reparacion','${id(1)}','${id(1)}','TEST');
 insert into public.catalogo_modalidades_operativas_hotel values('reserva_en_reparacion','reserva_en_reparacion',true);
 insert into public.talleres(id,nombre,activo) values('${id(5)}','TEST-WORKSHOP',true);
 insert into public.catalogo_tipos_trabajo(codigo,nombre,activo) values('CV','CV',true),('MCD','MCD',true),('OTA','OTA',true);
 insert into public.etapas_hotel(id,registro_hotel_id,seguimiento_id,grupo_documental_id,nombre,lugar,posicion,estado,tipo_etapa,taller_id,fecha_real) values('${id(6)}','${id(3)}','${id(7)}','${id(8)}','Entrada TEST-WORKSHOP','TEST-WORKSHOP',1,'realizada','entrada_taller','${id(5)}',current_timestamp);
 insert into public.etapas_hotel(id,registro_hotel_id,seguimiento_id,grupo_documental_id,nombre,posicion,estado,tipo_etapa,etapa_origen_id) values('${id(9)}','${id(3)}','${id(10)}','${id(11)}','Recogida TEST-WORKSHOP',2,'pendiente','recogida_taller','${id(6)}');
 insert into app_private.manteniment_parada_sync(seguimiento_id,sync_id) values('${id(4)}','${id(12)}');
 insert into app_private.manteniment_sync_config(id,token_activo,token_hash) values(1,true,md5('TEST-TOKEN'));`);
 return db;
}
const job=(n,type='CV',motivo='TEST-CAMPAIGN')=>`insert into public.trabajos_etapa_hotel(id,etapa_hotel_id,tipo_trabajo,motivo_entrada,categoria_tecnica,creado_por) values('${id(n)}','${id(6)}','${type}','${motivo}','CAMPAÑA','${id(1)}')`;
async function count(db,table){return +(await db.query(`select count(*) n from ${table}`)).rows[0].n;}
async function importWorks(db,works){return (await db.query('select app_private.manteniment_importar_trabajos_alpha74_base($1::jsonb) result',[JSON.stringify(works)])).rows[0].result;}
const need=(g,h='CV',fila=2)=>({fila,clave_fila:`TEST-UNIT|TEST-PLATE|TEST-WORKSHOP|${g}|${h}|2026-09-23`,dfm:'TEST-UNIT',matricula:'TEST-PLATE',numero_parada:'TEST-STOP',taller:'TEST-WORKSHOP',tipo_trabajo:g,designacion:h,fecha_necesidad:'2026-09-23',fecha_realizada:'',fecha_recogida:'',pendiente_fondo_blanco:true,prioridad_fondo_amarillo:true});

test('manual CV creates a need and preserves the existing visit, retry imports the same job',async()=>{
 const db=await fixture();try{
 await db.exec(job(20));assert.equal(await count(db,'app_private.manteniment_t_trabajos'),1);assert.equal(await count(db,'public.etapas_hotel'),2);
 const w=(await db.query('select * from app_private.manteniment_t_trabajos')).rows[0];assert.equal(w.trabajo_hotel_id,id(20));assert.equal(w.grupo_etapa_id,id(8));
 const assignments=(await db.query(`select app_private.manteniment_trabajos_asignados('${id(4)}') a`)).rows[0].a;
 assert.equal(assignments[0].crear_necesidad.designacion,'CV');assert.ok(assignments[0].fecha_entrada);assert.equal(assignments[0].fecha_salida,null);
 const row={...need('TEST-CAMPAIGN'),trabajo_sync_id:w.sync_id,clave_fila:assignments[0].clave_fila,fecha_necesidad:assignments[0].crear_necesidad.fecha_necesidad,fecha_realizada:assignments[0].fecha_entrada};
 for(let i=0;i<2;i++){const r=await importWorks(db,[row]);assert.equal(r.t_creadas,0);assert.equal(r.trabajos_creados,0);}
 }finally{await db.close();}
});
test('two manual CV jobs create two stable needs within one T',async()=>{
 const db=await fixture();try{await db.exec(job(20)+';'+job(21,'CV','TEST-CAMPAIGN-B'));assert.equal(await count(db,'app_private.manteniment_t_trabajos'),2);assert.equal(await count(db,'public.etapas_hotel'),2);}finally{await db.close();}
});
test('daily clones and imports do not export duplicate needs',async()=>{
 const db=await fixture();try{for(const flag of ['app.clonando_pizarra','app.reconciliando_etapas','app.manteniment_importando_paradas']){await db.query('select set_config($1,$2,false)',[flag,'1']);await db.exec(job(30+['app.clonando_pizarra','app.reconciliando_etapas','app.manteniment_importando_paradas'].indexOf(flag)));await db.query('select set_config($1,$2,false)',[flag,'0']);}assert.equal(await count(db,'app_private.manteniment_t_trabajos'),0);}finally{await db.close();}
});
test('an older script cannot acknowledge an unwritten need',async()=>{
 const db=await fixture();try{await db.exec(job(20));const o=(await db.query('select * from app_private.manteniment_parada_outbox')).rows[0];
 await assert.rejects(db.query('select app_private.manteniment_confirmar_comandos($1,$2::jsonb)',['TEST-TOKEN',JSON.stringify([{sync_id:o.sync_id,revision:o.revision,estado:'aplicado'}])]),/Actualiza el script/);
 assert.equal((await db.query('select estado from app_private.manteniment_parada_outbox')).rows[0].estado,'pendiente');
 const a=o.payload.trabajos_asignados[0];await db.query('select app_private.manteniment_confirmar_comandos($1,$2::jsonb)',['TEST-TOKEN',JSON.stringify([{sync_id:o.sync_id,revision:o.revision,estado:'aplicado',necesidades_hotel:[{trabajo_sync_id:a.trabajo_sync_id,clave_fila:a.clave_fila,fila:2}]}])]);
 assert.equal((await db.query('select fuentes from app_private.manteniment_t_trabajos')).rows[0].fuentes[0].crear_desde_hotel,undefined);
 }finally{await db.close();}
});
test('two sheet needs with same F/H but different campaign stay distinct in the open visit',async()=>{
 const db=await fixture();try{await db.exec("select set_config('app.audit_origin','manteniment-alpha74-predictivo',false)");const rows=[need('TEST-A'),need('TEST-B','CV',3)];const first=await importWorks(db,rows);assert.equal(first.t_creadas,0);assert.equal(first.trabajos_creados,2);const second=await importWorks(db,rows);assert.equal(second.t_creadas,0);assert.equal(second.trabajos_creados,0);assert.equal(await count(db,'public.etapas_hotel'),2);}finally{await db.close();}
});
test('OTA stays remote alongside an open workshop visit',async()=>{
 const db=await fixture();try{
 await db.exec(job(20));
 const first=await importWorks(db,[need('TEST-REMOTE','OTA')]);assert.equal(first.trabajos_creados,1);
 const remote=(await db.query("select e.tipo_etapa,v.modalidad,v.grupo_recogida_id from app_private.manteniment_t_trabajos w join app_private.manteniment_t_visitas v on v.id=w.visita_id join public.trabajos_etapa_hotel t on t.id=w.trabajo_hotel_id join public.etapas_hotel e on e.id=t.etapa_hotel_id where w.designacion='OTA'")).rows[0];
 assert.equal(remote.tipo_etapa,'otro');assert.equal(remote.modalidad,'gestion');assert.equal(remote.grupo_recogida_id,null);assert.equal(await count(db,'public.etapas_hotel'),3);
 const retry=await importWorks(db,[need('TEST-REMOTE','OTA')]);assert.equal(retry.t_creadas,0);assert.equal(retry.trabajos_creados,0);
 }finally{await db.close();}
});
test('another workshop is not merged; ambiguous matching entries abort atomically',async()=>{
 const db=await fixture();try{
 const other={...need('TEST-OTHER','MCD'),taller:'TEST-OTHER-WORKSHOP',clave_fila:'TEST-UNIT|TEST-PLATE|TEST-OTHER-WORKSHOP|TEST-OTHER|MCD|2026-09-23'};
 const first=await importWorks(db,[other]);assert.equal(first.trabajos_creados,1);assert.equal(first.t_creadas,2);
 await db.exec(`insert into public.etapas_hotel(id,registro_hotel_id,nombre,lugar,posicion,tipo_etapa,estado) values('${id(50)}','${id(3)}','TEST duplicate','TEST-WORKSHOP',20,'entrada_taller','pendiente')`);
 await assert.rejects(importWorks(db,[need('TEST-AMBIGUOUS')]),/varias entradas compatibles/);
 assert.equal(await count(db,'public.trabajos_etapa_hotel'),1);
 }finally{await db.close();}
});
