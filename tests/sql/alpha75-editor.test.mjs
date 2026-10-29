import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createEditorFixture, seedEditorContinuityPair, editorDetail, editorPayload, saveEditor, editorInventory } from './editor-scenarios.mjs';
import { one, snapshotProtectedFacts } from './local-postgres-harness.mjs';

const report={suite:'MG75-EDITOR-CONTINUIDAD-001',started_at:new Date().toISOString(),cases:[]};
let fixture;
before(async()=>{fixture=await createEditorFixture();report.environment=fixture.metadata;});
after(async()=>{
  let failure;
  try{if(fixture){assert.deepEqual(await snapshotProtectedFacts(fixture.admin),fixture.protectedBefore);report.protected_history_and_barriers_unchanged=true;}}
  catch(error){failure=error;report.suite_error={code:error.code,message:error.message};}
  finally{
    try{if(fixture){await fixture.destroy();report.temporary_database_dropped=true;}}catch(error){failure||=error;report.cleanup_error=error.message;}
    report.finished_at=new Date().toISOString();
    report.passed=!failure&&report.protected_history_and_barriers_unchanged===true&&report.temporary_database_dropped===true&&report.cases.length===6&&report.cases.every(c=>c.status==='passed');
    if(process.env.METROGESTION_EDITOR_REPORT){const file=path.resolve(process.env.METROGESTION_EDITOR_REPORT);assert.equal(path.extname(file),'.json');await mkdir(path.dirname(file),{recursive:true});await writeFile(file,`${JSON.stringify(report,null,2)}\n`);}
  }
  if(failure)throw failure;
});

function scenario(key,description,body){test(`${key}: ${description}`,{timeout:30000},async context=>{
  const result={key,description,status:'running'};report.cases.push(result);
  try{await body(fixture.admin,result);assert.deepEqual(await snapshotProtectedFacts(fixture.admin),fixture.protectedBefore);result.status='passed';context.diagnostic(JSON.stringify({key,checks:result.checks}));}
  catch(error){result.status='failed';result.error={code:error.code,message:error.message};throw error;}
  finally{await fixture.admin.query('ROLLBACK');}
});}

async function physical(db,pair){
  return (await one(db,`SELECT jsonb_build_object(
    'pa',(SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM (
      SELECT id,seguimiento_id,pizarra_id,numero_parada,vehiculo_sustituido,matricula_sustituido,
        vehiculo_reserva,matricula_reserva,tipo_sustituto,modalidad_operativa,tipo_movimiento,
        fecha_parada,fecha_entrada,fecha_limite_sustitucion,fecha_retirado_hotel,estado,cancelado,retirado_hotel_activo
      FROM public.registros_hotel WHERE vehiculo_sustituido=$1) x),
    't',(SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM (
      SELECT e.id,e.seguimiento_id,e.registro_hotel_id,e.tipo_etapa,e.accion_sistema,e.posicion,e.estado,e.cancelado,
        e.fecha_prevista,e.fecha_inicio_real,e.fecha_fin_real,e.fecha_real
      FROM public.etapas_hotel e JOIN public.registros_hotel r ON r.id=e.registro_hotel_id WHERE r.vehiculo_sustituido=$1) x),
    'links',(SELECT jsonb_agg(to_jsonb(c) ORDER BY c.id) FROM app_private.sustitucion_continuidades_alpha75 c WHERE afectado_dfm=$1),
    'reserva',(SELECT to_jsonb(r) FROM public.reservas_hotel r WHERE vehiculo_codigo=$2),
    'activation',(SELECT to_jsonb(a) FROM public.activaciones_24h a WHERE a.dfm=$1),
    'manuals',(SELECT jsonb_agg(to_jsonb(m) ORDER BY m.seguimiento_id) FROM public.ajustes_sustitucion_parada m WHERE seguimiento_id IN ($3,$4)),
    'summary',(SELECT jsonb_agg(jsonb_build_object('seguimiento_id',seguimiento_id,
      'inicio',fecha_inicio_imputacion,'fin',fecha_fin_imputacion,'dias',dias_imputables_total,
      'owner',propietario_sustitucion_seguimiento_id) ORDER BY seguimiento_id)
      FROM public.paradas_sustitucion_resumen WHERE unidad=$1)
  ) AS value`,[pair.dfm,pair.reserve,pair.origin.seguimiento_id,pair.destination.seguimiento_id])).value;
}

async function rejectUnchanged(db,pair,operation,pattern,code){
  const before=await editorInventory(db,pair);
  await assert.rejects(operation,error=>(!code||error.code===code)&&pattern.test(error.message), 'Expected a specific editor/domain rejection');
  assert.deepEqual(await editorInventory(db,pair),before,'The rejected full save changed committed rows');
}

scenario('ED01','full source save preserves exact physical facts and writes one real annotation',async(db,r)=>{
  const p=await seedEditorContinuityPair(db,{tag:'ED01',originManualRate:37.25,destinationManualRate:80.5});
  const before=await physical(db,p),payload=await editorPayload(db,p.origin.id);
  const detail=await editorDetail(db,p.origin.id);
  assert.equal(detail.contrato_fechas_editor,'MG75-EDITOR-FECHAS-001');
  assert.ok(payload.p_etapas.length>0&&payload.p_etapas.every(e=>e.id&&e.version));
  assert.match(payload.p_ficha.fecha_entrada,/21\.456789/);
  payload.p_ficha.anotaciones_manuales.push({texto:'Anotación completa en origen cedido',version:1});
  const saved=await saveEditor(db,payload,'editor_ED01_full_save');
  assert.equal(saved.ok,true);assert.equal(saved.identidad_validada,true);assert.equal(saved.anotaciones_guardadas,1);
  assert.deepEqual(await physical(db,p),before);
  const observer=await fixture.connect('editor_source_read');
  try{const notes=(await editorDetail(observer,p.origin.id)).anotaciones_manuales;assert.equal(notes.filter(n=>n.texto==='Anotación completa en origen cedido').length,1);}
  finally{await fixture.close(observer);}
  r.checks={all_existing_stages_sent:payload.p_etapas.length,annotation_committed:true,microseconds_preserved:true,manual_rates_preserved:true};
});

scenario('ED02','destination updates an existing work and stage description without duplicating either',async(db,r)=>{
  const p=await seedEditorContinuityPair(db,{tag:'ED02'}),before=await physical(db,p);
  const payload=await editorPayload(db,p.destination.id),stage=payload.p_etapas.find(e=>e.id===p.entry.id);
  assert.equal(stage.trabajos.length,1);assert.equal(stage.trabajos[0].id,p.work.id);
  stage.observaciones='Observaciones de T actualizadas desde editor';stage.trabajos[0].diagnostico_real='Diagnóstico editado tras continuidad';
  const saved=await saveEditor(db,payload,'editor_ED02_existing_work');
  assert.equal(saved.ok,true);assert.equal(saved.trabajos_guardados,1);
  const detail=await editorDetail(db,p.destination.id),afterStage=detail.etapas.find(e=>e.id===p.entry.id);
  assert.equal(afterStage.observaciones,stage.observaciones);assert.equal(afterStage.trabajos.length,1);
  assert.equal(afterStage.trabajos[0].id,p.work.id);assert.equal(afterStage.trabajos[0].diagnostico_real,stage.trabajos[0].diagnostico_real);
  assert.ok(afterStage.trabajos[0].version>p.work.version);assert.deepEqual(await physical(db,p),before);
  r.checks={existing_work_id:p.work.id,work_version:afterStage.trabajos[0].version,all_physical_facts_unchanged:true};
});

scenario('ED03','editor saves actual workshop milestones, real recovery then permits a historical note with exact timestamps',async(db,r)=>{
  const p=await seedEditorContinuityPair(db,{tag:'ED03'}),before=await physical(db,p);
  const payload=await editorPayload(db,p.destination.id),entry=payload.p_etapas.find(e=>e.id===p.entry.id);
  entry.estado='realizada';entry.estado_catalogo_codigo='realizada';
  entry.fecha_fin_real=`${p.dates.entry}T12:10:19.222333`;entry.fecha_real=`${p.dates.entry}T12:20:23.444555`;
  const saved=await saveEditor(db,payload,'editor_ED03_workshop_done');assert.equal(saved.ok,true);
  const recovery=await one(db,'SELECT version FROM public.etapas_hotel WHERE id=$1',[p.recovery.id]);
  const recovered=(await one(db,'SELECT public.marcar_t_realizada_rapida($1,$2,$3) AS value',[p.recovery.id,recovery.version,'editor_ED03_actual_recovery'])).value;
  assert.equal(recovered.ok,true);
  const recoveredFacts=await physical(db,p);
  assert.equal(recoveredFacts.reserva.estado,'libre');
  assert.deepEqual(recoveredFacts.pa.find(x=>x.id===p.origin.id),before.pa.find(x=>x.id===p.origin.id));
  const note=await editorPayload(db,p.destination.id);note.p_ficha.anotaciones_manuales.push({texto:'Nota posterior a la recuperación real',version:1});
  const noted=await saveEditor(db,note,'editor_ED03_historical_note');assert.equal(noted.ok,true);
  assert.deepEqual(await physical(db,p),recoveredFacts);
  assert.equal((await editorDetail(db,p.destination.id)).anotaciones_manuales.at(-1).texto,'Nota posterior a la recuperación real');
  r.checks={milestones_saved_through_editor:true,actual_recovery:true,historical_note_preserved_all_facts:true};
});

scenario('ED04','stale work rejects after earlier writes and rolls back the entire card transaction',async(db,r)=>{
  const p=await seedEditorContinuityPair(db,{tag:'ED04'}),payload=await editorPayload(db,p.destination.id);
  payload.p_ficha.observaciones='Esta nota no debe persistir';
  payload.p_etapas.find(e=>e.id===p.entry.id).observaciones='Esta T tampoco debe cambiar';
  await db.query("UPDATE public.trabajos_etapa_hotel SET diagnostico_real='Otra sesión sintética' WHERE id=$1",[p.work.id]);
  await rejectUnchanged(db,p,()=>saveEditor(db,payload,'editor_ED04_stale_work'),/El trabajo .* ha cambiado desde que abriste la ficha/,'P0001');
  r.checks={stale_existing_work_rejected:true,earlier_card_and_stage_writes_rolled_back:true};
});

scenario('ED05','protected cut and wrong card identity both reject with no partial save',async(db,r)=>{
  const p=await seedEditorContinuityPair(db,{tag:'ED05'}),payload=await editorPayload(db,p.destination.id);
  payload.p_ficha.observaciones='Nota que no debe sobrevivir al corte inválido';
  payload.p_etapas.find(e=>e.id===p.entry.id).fecha_inicio_real=`${p.dates.entry}T11:01`;
  await rejectUnchanged(db,p,()=>saveEditor(db,payload,'editor_ED05_changed_cut'),/CONTINUIDAD-001: la entrada real/,'23514');
  const wrong=await editorPayload(db,p.destination.id);wrong.p_identidad.registro_id=p.origin.id;
  await rejectUnchanged(db,p,()=>saveEditor(db,wrong,'editor_ED05_wrong_identity'),/identidad|otra ficha|coincide/i);
  r.checks={changed_cut_rejected:true,wrong_card_identity_rejected:true,both_atomic:true};
});

scenario('ED06','full save on archived source retains the same current PA and continuous substitution owner',async(db,r)=>{
  const p=await seedEditorContinuityPair(db,{tag:'ED06'});
  const board=(await one(db,"INSERT INTO public.pizarras(estado,fecha) VALUES('en_curso',(clock_timestamp() AT TIME ZONE 'Europe/Madrid')::date+1) RETURNING id")).id;
  const cloneIds=[];
  await db.query('BEGIN');
  try{
    await db.query("SELECT set_config('app.clonando_pizarra','1',true)");
    for(const id of [p.origin.id,p.destination.id]){
      const row=(await one(db,'SELECT to_jsonb(r) AS value FROM public.registros_hotel r WHERE id=$1',[id])).value;
      delete row.id;row.pizarra_id=board;
      const clone=(await one(db,`INSERT INTO public.registros_hotel SELECT (jsonb_populate_record(NULL::public.registros_hotel,$1::jsonb||jsonb_build_object('id',gen_random_uuid()))).* RETURNING id`,[JSON.stringify(row)])).id;
      cloneIds.push(clone);
      const stages=(await db.query("SELECT to_jsonb(e)-'id'-'posicion_activa' AS value FROM public.etapas_hotel e WHERE registro_hotel_id=$1",[id])).rows;
      for(const {value} of stages){value.registro_hotel_id=clone;const keys=Object.keys(value);await db.query(`INSERT INTO public.etapas_hotel(${keys.map(k=>`"${k}"`).join(',')}) VALUES(${keys.map((_,i)=>`$${i+1}`).join(',')})`,Object.values(value));}
    }
    await db.query("UPDATE public.pizarras SET estado='archivada' WHERE id=$1",[p.origin.pizarra_id]);
    await db.query('COMMIT');
  }catch(error){await db.query('ROLLBACK');throw error;}
  const before=await physical(db,p),payload=await editorPayload(db,p.origin.id);
  payload.p_ficha.anotaciones_manuales.push({texto:'Anotación en copia histórica del origen',version:1});
  const saved=await saveEditor(db,payload,'editor_ED06_archived_source');assert.equal(saved.ok,true);
  const after=await physical(db,p);
  assert.equal(after.pa.length,4);assert.equal(after.links.length,1);assert.equal(after.reserva.estado,'ocupada');
  assert.deepEqual(after,before);
  assert.equal((await editorDetail(db,p.origin.id)).anotaciones_manuales.at(-1).texto,'Anotación en copia histórica del origen');
  r.checks={archived_source_saved:true,physical_pa:4,logical_links:1,current_source_clone:cloneIds[0],current_destination_clone:cloneIds[1],no_extra_reactivation:true};
});
