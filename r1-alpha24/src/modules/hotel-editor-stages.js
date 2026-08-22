import { element } from '../../../r1-alpha17/src/dom.js';
import {
  STAGE_STATES, STAGE_TYPES, bindCheckbox, bindText, createCheckbox,
  createInput, createSelect, createTextarea, fieldLabel, makeNewStage, makeNewWork
} from '../../../r1-alpha17/src/modules/hotel-editor-utils.js';

function renumberStages(stages){stages.forEach((stage,index)=>{stage.posicion=index+1;});}
function exactByName(items,value){const key=String(value||'').trim().toLowerCase();return items.find(item=>String(item.nombre||'').trim().toLowerCase()===key)||null;}
function dataList(id,items,valueKey='nombre',labelFn=item=>item.nombre){const list=element('datalist',{id});items.forEach(item=>list.append(element('option',{value:item[valueKey]||'',label:labelFn(item)})));return list;}

function renderWorks(detail,stage,worksHost,markDirty){
  worksHost.replaceChildren();
  if(!stage.trabajos.length)worksHost.append(element('p',{className:'muted',text:'Sin trabajos detallados.'}));
  stage.trabajos.forEach((work,workIndex)=>{
    const card=element('article',{className:`editor-work-card${work.cancelado?' cancelled':''}`});
    const typeListId=`work-types-${crypto.randomUUID()}`;
    const workType=createInput({value:work.tipo_trabajo||''});
    workType.setAttribute('list',typeListId);
    workType.placeholder='Selecciona o escribe un tipo nuevo';
    bindText(workType,work,'tipo_trabajo',markDirty);
    card.append(dataList(typeListId,detail.catalogos.tipos_trabajo,'codigo',item=>`${item.codigo} · ${item.nombre}`));

    const category=createInput({value:work.categoria_tecnica||''});bindText(category,work,'categoria_tecnica',markDirty);
    const km=createInput({type:'number',min:0,step:1,value:work.km_averia??''});bindText(km,work,'km_averia',markDirty,value=>value===''?'':Number(value));
    const expediente=createInput({value:work.expediente||''});bindText(expediente,work,'expediente',markDirty);
    const reason=createTextarea(work.motivo_entrada||'');bindText(reason,work,'motivo_entrada',markDirty);
    const diagnosis=createTextarea(work.diagnostico_real||'');bindText(diagnosis,work,'diagnostico_real',markDirty);
    const description=createTextarea(work.descripcion||'');bindText(description,work,'descripcion',markDirty);
    const appraisal=createTextarea(work.peritaje_estado||'');bindText(appraisal,work,'peritaje_estado',markDirty);
    const observations=createTextarea(work.observaciones||'');bindText(observations,work,'observaciones',markDirty);
    const cancelled=createCheckbox(work.id?'Cancelar o restaurar trabajo, conservando el histórico':'Descartar trabajo nuevo',work.cancelado);
    const cancelReason=createTextarea(work.motivo_cancelacion||'');bindText(cancelReason,work,'motivo_cancelacion',markDirty);
    const cancelBox=element('div',{className:'editor-conditional'},[fieldLabel('Motivo obligatorio',cancelReason)]);
    const refresh=()=>{cancelBox.classList.toggle('hidden',!work.cancelado||!work.id);card.classList.toggle('cancelled',work.cancelado);};
    bindCheckbox(cancelled.input,work,'cancelado',markDirty,checked=>{if(!work.id&&checked){stage.trabajos.splice(workIndex,1);renderWorks(detail,stage,worksHost,markDirty);return;}refresh();});refresh();
    card.append(element('div',{className:'editor-work-header'},[element('strong',{text:`${workIndex+1}. ${work.tipo_trabajo||'Trabajo'}`}),element('span',{className:'badge',text:work.id?`Versión ${work.version}`:'Nuevo'})]),element('div',{className:'editor-grid'},[fieldLabel('Tipo',workType),fieldLabel('Categoría técnica',category),fieldLabel('Kilómetros',km),fieldLabel('Expediente',expediente)]),element('p',{className:'muted',text:'Tipo: puedes elegir uno existente o escribir uno nuevo; al guardar quedará incorporado al listado.'}),element('div',{className:'editor-grid editor-grid-two'},[fieldLabel('Motivo de entrada / primer diagnóstico',reason),fieldLabel('Diagnóstico real',diagnosis),fieldLabel('Descripción',description),fieldLabel('Peritaje / estado',appraisal),fieldLabel('Observaciones',observations)]),cancelled.label,cancelBox);
    worksHost.append(card);
  });
}

export function renderStagesSection(detail,markDirty){
  const section=element('section',{className:'editor-section editor-stages-section'},[element('div',{className:'editor-section-heading'},[element('div',{},[element('h3',{text:'4. T y trabajos asociados'}),element('p',{className:'muted',text:'Taller, Centro y Tipo de trabajo permiten seleccionar un valor existente o escribir uno nuevo.'})])])]);
  const stagesHost=element('div',{className:'editor-stages'});
  const addStageButton=element('button',{className:'button secondary',type:'button',text:'+ Añadir T'});

  const renderStages=()=>{
    stagesHost.replaceChildren();
    if(!detail.etapas.length)stagesHost.append(element('p',{className:'muted',text:'No hay T en esta ficha.'}));
    detail.etapas.forEach((stage,stageIndex)=>{
      stage.taller_nombre ||= detail.catalogos.talleres.find(item=>item.id===stage.taller_id)?.nombre||'';
      const selectedWorkshop=detail.catalogos.talleres.find(item=>item.id===stage.taller_id);
      stage.centro_nombre ||= selectedWorkshop?.centros?.find(item=>item.id===stage.centro_taller_id)?.nombre||'';
      const card=element('article',{className:`editor-stage-card${stage.cancelado?' cancelled':''}`});
      const up=element('button',{className:'button secondary compact',type:'button',text:'↑',title:'Subir T'}),down=element('button',{className:'button secondary compact',type:'button',text:'↓',title:'Bajar T'});
      up.disabled=stageIndex===0;down.disabled=stageIndex===detail.etapas.length-1;
      up.addEventListener('click',()=>{[detail.etapas[stageIndex-1],detail.etapas[stageIndex]]=[detail.etapas[stageIndex],detail.etapas[stageIndex-1]];renumberStages(detail.etapas);markDirty();renderStages();});
      down.addEventListener('click',()=>{[detail.etapas[stageIndex+1],detail.etapas[stageIndex]]=[detail.etapas[stageIndex],detail.etapas[stageIndex+1]];renumberStages(detail.etapas);markDirty();renderStages();});
      const header=element('div',{className:'editor-stage-header'},[element('div',{},[element('strong',{text:`${stage.posicion}T · ${stage.nombre||'Sin nombre'}`}),element('div',{className:'muted',text:stage.id?`Versión ${stage.version}`:'Nueva T sin guardar'})]),element('div',{className:'editor-row-actions'},[up,down])]);
      const name=createInput({value:stage.nombre||''});bindText(name,stage,'nombre',markDirty);
      const position=createInput({type:'number',min:1,max:99,step:1,value:stage.posicion});bindText(position,stage,'posicion',markDirty,Number);
      const stageState=createSelect(STAGE_STATES,stage.estado==='anulada'?'pendiente':stage.estado);bindText(stageState,stage,'estado',markDirty);
      const stageType=createSelect(STAGE_TYPES,stage.tipo_etapa||'otro');bindText(stageType,stage,'tipo_etapa',markDirty);

      const workshopListId=`workshops-${crypto.randomUUID()}`;
      const workshop=createInput({value:stage.taller_nombre||''});workshop.setAttribute('list',workshopListId);workshop.placeholder='Selecciona o escribe un taller nuevo';
      const workshopList=dataList(workshopListId,detail.catalogos.talleres);
      const centerListId=`centers-${crypto.randomUUID()}`;
      const center=createInput({value:stage.centro_nombre||''});center.setAttribute('list',centerListId);center.placeholder='Selecciona o escribe un centro nuevo';
      const centerList=element('datalist',{id:centerListId});
      const rebuildCenters=()=>{centerList.replaceChildren();const match=exactByName(detail.catalogos.talleres,workshop.value);(match?.centros||[]).forEach(item=>centerList.append(element('option',{value:item.nombre})));};
      const syncWorkshop=()=>{stage.taller_nombre=workshop.value.trim();const match=exactByName(detail.catalogos.talleres,workshop.value);stage.taller_id=match?.id||null;if(!match){stage.centro_taller_id=null;}rebuildCenters();markDirty();};
      const syncCenter=()=>{stage.centro_nombre=center.value.trim();const matchWorkshop=exactByName(detail.catalogos.talleres,workshop.value);const matchCenter=exactByName(matchWorkshop?.centros||[],center.value);stage.centro_taller_id=matchCenter?.id||null;markDirty();};
      workshop.addEventListener('input',syncWorkshop);workshop.addEventListener('change',syncWorkshop);center.addEventListener('input',syncCenter);center.addEventListener('change',syncCenter);rebuildCenters();

      const stagePlace=createInput({value:stage.lugar||''});bindText(stagePlace,stage,'lugar',markDirty);
      const planned=createInput({type:'datetime-local',value:stage.fecha_prevista||''});bindText(planned,stage,'fecha_prevista',markDirty);
      const started=createInput({type:'datetime-local',value:stage.fecha_inicio_real||''});bindText(started,stage,'fecha_inicio_real',markDirty);
      const finished=createInput({type:'datetime-local',value:stage.fecha_fin_real||''});bindText(finished,stage,'fecha_fin_real',markDirty);
      const realized=createInput({type:'datetime-local',value:stage.fecha_real||''});bindText(realized,stage,'fecha_real',markDirty);
      const grid=element('div',{className:'editor-grid'},[fieldLabel('Nombre de la T',name),fieldLabel('Posición',position),fieldLabel('Estado',stageState),fieldLabel('Tipo de T',stageType),fieldLabel('Taller',workshop),fieldLabel('Centro',center),fieldLabel('Lugar / referencia',stagePlace),fieldLabel('Fecha programada',planned),fieldLabel('Inicio real',started),fieldLabel('Fin real',finished),fieldLabel('Fecha realizada',realized)]);
      const obs=createTextarea(stage.observaciones||'');bindText(obs,stage,'observaciones',markDirty);
      const cancelled=createCheckbox(stage.id?'Anular o restaurar esta T, conservando su histórico':'Descartar esta T nueva',stage.cancelado);
      const cancelReason=createTextarea(stage.motivo_cancelacion||'');bindText(cancelReason,stage,'motivo_cancelacion',markDirty);
      const cancelBox=element('div',{className:'editor-conditional'},[fieldLabel('Motivo obligatorio de anulación',cancelReason)]);
      const refresh=()=>{cancelBox.classList.toggle('hidden',!stage.cancelado||!stage.id);stageState.disabled=stage.cancelado;card.classList.toggle('cancelled',stage.cancelado);};
      bindCheckbox(cancelled.input,stage,'cancelado',markDirty,checked=>{if(!stage.id&&checked){detail.etapas.splice(stageIndex,1);renumberStages(detail.etapas);renderStages();return;}if(!checked&&stage.estado==='anulada')stage.estado='pendiente';refresh();});refresh();
      const worksHost=element('div',{className:'editor-works'});renderWorks(detail,stage,worksHost,markDirty);
      const addWork=element('button',{className:'button secondary compact',type:'button',text:'+ Añadir trabajo'});addWork.addEventListener('click',()=>{stage.trabajos.push(makeNewWork(detail.catalogos.tipos_trabajo[0]?.codigo||'AV'));markDirty();renderWorks(detail,stage,worksHost,markDirty);});
      card.append(workshopList,centerList,header,grid,element('p',{className:'muted',text:'Taller y Centro: si el valor no existe, escríbelo. Se añadirá al catálogo al guardar la ficha.'}),fieldLabel('Observaciones de la T',obs),cancelled.label,cancelBox,element('div',{className:'editor-subheading'},[element('strong',{text:'Trabajos de esta T'})]),worksHost,addWork);
      stagesHost.append(card);
    });
  };
  addStageButton.addEventListener('click',()=>{detail.etapas.push(makeNewStage(detail.etapas));markDirty();renderStages();});
  renderStages();section.append(stagesHost,addStageButton);return section;
}