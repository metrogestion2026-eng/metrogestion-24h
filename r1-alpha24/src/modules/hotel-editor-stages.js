import { element } from '../../../r1-alpha17/src/dom.js';
import {
  STAGE_STATES, STAGE_TYPES, bindCheckbox, bindText, createCheckbox,
  createInput, createSelect, createTextarea, fieldLabel, makeNewStage, makeNewWork
} from '../../../r1-alpha17/src/modules/hotel-editor-utils.js';

function renumberStages(stages){stages.forEach((stage,index)=>{stage.posicion=index+1;});}
function exactByName(items,value){const key=String(value||'').trim().toLowerCase();return items.find(item=>String(item.nombre||'').trim().toLowerCase()===key)||null;}
function normalizeSearch(value){return String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase();}
function workTypeVisibleValue(item){if(!item)return'';return /^USR_/i.test(String(item.codigo||''))&&item.nombre?item.nombre:(item.codigo||item.nombre||'');}
function findWorkType(items,value){
  const key=normalizeSearch(value);
  return items.find(item=>normalizeSearch(item.codigo)===key||normalizeSearch(item.nombre)===key)||null;
}

function ensureAutocompleteStyles(){
  if(document.querySelector('#hotel-catalog-autocomplete-style'))return;
  const style=document.createElement('style');
  style.id='hotel-catalog-autocomplete-style';
  style.textContent=`
    .hotel-autocomplete-menu{position:fixed;z-index:11040;max-height:260px;overflow:auto;background:#fff;border:1px solid #b9cbd8;border-radius:12px;box-shadow:0 14px 34px rgba(15,23,42,.18);padding:5px;display:none}
    .hotel-autocomplete-menu.open{display:block}
    .hotel-autocomplete-option{display:block;width:100%;border:0;background:transparent;text-align:left;padding:9px 10px;border-radius:8px;cursor:pointer;color:#0f172a;font:inherit}
    .hotel-autocomplete-option:hover,.hotel-autocomplete-option.active{background:#eaf4fb}
    .hotel-autocomplete-option strong{display:block;font-weight:700}
    .hotel-autocomplete-option small{display:block;color:#64748b;margin-top:2px}
    .hotel-autocomplete-empty{padding:9px 10px;color:#64748b;font-size:.9rem}
  `;
  document.head.append(style);
}

function attachAutocomplete(input,{items=()=>[],value=item=>item?.nombre||'',label=item=>item?.nombre||'',meta=()=>'',onSelect=()=>{},limit=12}={}){
  ensureAutocompleteStyles();
  input.removeAttribute('list');
  input.setAttribute('autocomplete','off');
  input.setAttribute('role','combobox');
  input.setAttribute('aria-autocomplete','list');
  input.setAttribute('aria-expanded','false');

  const menu=element('div',{className:'hotel-autocomplete-menu',role:'listbox'});
  document.body.append(menu);
  let current=[];
  let activeIndex=-1;

  const close=()=>{
    menu.classList.remove('open');
    input.setAttribute('aria-expanded','false');
    activeIndex=-1;
  };
  const place=()=>{
    const rect=input.getBoundingClientRect();
    menu.style.left=`${Math.max(8,rect.left)}px`;
    menu.style.top=`${Math.min(window.innerHeight-80,rect.bottom+4)}px`;
    menu.style.width=`${Math.max(rect.width,260)}px`;
    menu.style.maxWidth=`${Math.max(240,window.innerWidth-Math.max(16,rect.left+16))}px`;
  };
  const activate=index=>{
    activeIndex=index;
    [...menu.querySelectorAll('.hotel-autocomplete-option')].forEach((node,i)=>node.classList.toggle('active',i===index));
  };
  const choose=item=>{
    input.value=value(item);
    onSelect(item);
    input.dispatchEvent(new Event('input',{bubbles:true}));
    input.dispatchEvent(new Event('change',{bubbles:true}));
    close();
  };
  const render=()=>{
    const query=normalizeSearch(input.value);
    const source=(items()||[]).filter(item=>{
      if(!query)return true;
      return normalizeSearch(value(item)).includes(query)||normalizeSearch(label(item)).includes(query)||normalizeSearch(meta(item)).includes(query);
    }).slice(0,limit);
    current=source;
    menu.replaceChildren();
    if(!source.length){
      if(input.value.trim())menu.append(element('div',{className:'hotel-autocomplete-empty',text:`“${input.value.trim()}” es nuevo. Se guardará en el listado.`}));
      else menu.append(element('div',{className:'hotel-autocomplete-empty',text:'Escribe para buscar.'}));
    }else{
      source.forEach((item,index)=>{
        const button=element('button',{className:'hotel-autocomplete-option',type:'button',role:'option'});
        button.append(element('strong',{text:label(item)||value(item)}));
        const secondary=meta(item);
        if(secondary&&normalizeSearch(secondary)!==normalizeSearch(label(item)))button.append(element('small',{text:secondary}));
        button.addEventListener('mousedown',event=>event.preventDefault());
        button.addEventListener('click',()=>choose(item));
        button.addEventListener('mousemove',()=>activate(index));
        menu.append(button);
      });
    }
    place();
    menu.classList.add('open');
    input.setAttribute('aria-expanded','true');
    activate(-1);
  };

  input.addEventListener('focus',render);
  input.addEventListener('input',render);
  input.addEventListener('keydown',event=>{
    if(event.key==='ArrowDown'){
      event.preventDefault();
      if(!menu.classList.contains('open'))render();
      if(current.length)activate(Math.min(activeIndex+1,current.length-1));
    }else if(event.key==='ArrowUp'){
      event.preventDefault();
      if(current.length)activate(Math.max(activeIndex-1,0));
    }else if(event.key==='Enter'&&activeIndex>=0&&current[activeIndex]){
      event.preventDefault();
      choose(current[activeIndex]);
    }else if(event.key==='Escape'){
      close();
    }
  });
  input.addEventListener('blur',()=>setTimeout(close,120));
  window.addEventListener('resize',()=>{if(menu.classList.contains('open'))place();},{passive:true});
  window.addEventListener('scroll',()=>{if(menu.classList.contains('open'))place();},{passive:true,capture:true});

  const observer=new MutationObserver(()=>{if(!document.body.contains(input)){observer.disconnect();menu.remove();}});
  observer.observe(document.body,{childList:true,subtree:true});
  return {refresh:render,close};
}

function renderWorks(detail,stage,worksHost,markDirty){
  worksHost.replaceChildren();
  if(!stage.trabajos.length)worksHost.append(element('p',{className:'muted',text:'Sin trabajos detallados.'}));
  stage.trabajos.forEach((work,workIndex)=>{
    const card=element('article',{className:`editor-work-card${work.cancelado?' cancelled':''}`});
    const catalogWork=findWorkType(detail.catalogos.tipos_trabajo,work.tipo_trabajo);
    const workType=createInput({value:catalogWork?workTypeVisibleValue(catalogWork):(work.tipo_trabajo||'')});
    workType.placeholder='Escribe para buscar o crear un tipo';
    bindText(workType,work,'tipo_trabajo',markDirty);
    attachAutocomplete(workType,{
      items:()=>detail.catalogos.tipos_trabajo,
      value:workTypeVisibleValue,
      label:item=>workTypeVisibleValue(item),
      meta:item=>item.nombre&&item.nombre!==workTypeVisibleValue(item)?item.nombre:'',
      onSelect:item=>{work.tipo_trabajo=item.codigo||item.nombre||'';}
    });

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
    card.append(element('div',{className:'editor-work-header'},[element('strong',{text:`${workIndex+1}. ${work.tipo_trabajo||'Trabajo'}`}),element('span',{className:'badge',text:work.id?`Versión ${work.version}`:'Nuevo'})]),element('div',{className:'editor-grid'},[fieldLabel('Tipo',workType),fieldLabel('Categoría técnica',category),fieldLabel('Kilómetros',km),fieldLabel('Expediente',expediente)]),element('p',{className:'muted',text:'Empieza a escribir y verás solo las coincidencias. Si escribes un tipo nuevo, al guardar quedará incorporado al listado para las próximas T.'}),element('div',{className:'editor-grid editor-grid-two'},[fieldLabel('Motivo de entrada / primer diagnóstico',reason),fieldLabel('Diagnóstico real',diagnosis),fieldLabel('Descripción',description),fieldLabel('Peritaje / estado',appraisal),fieldLabel('Observaciones',observations)]),cancelled.label,cancelBox);
    worksHost.append(card);
  });
}

export function renderStagesSection(detail,markDirty){
  const section=element('section',{className:'editor-section editor-stages-section'},[element('div',{className:'editor-section-heading'},[element('div',{},[element('h3',{text:'4. T y trabajos asociados'}),element('p',{className:'muted',text:'Taller, Centro y Tipo de trabajo se autocompletan mientras escribes. Los valores nuevos quedan guardados en sus listados.'})])])]);
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

      const workshop=createInput({value:stage.taller_nombre||''});workshop.placeholder='Escribe para buscar o crear un taller';
      const center=createInput({value:stage.centro_nombre||''});center.placeholder='Escribe para buscar o crear un centro';
      const matchingWorkshop=()=>exactByName(detail.catalogos.talleres,workshop.value);
      const syncWorkshop=()=>{stage.taller_nombre=workshop.value.trim();const match=matchingWorkshop();stage.taller_id=match?.id||null;if(!match){stage.centro_taller_id=null;}markDirty();};
      const syncCenter=()=>{stage.centro_nombre=center.value.trim();const matchWorkshop=matchingWorkshop();const matchCenter=exactByName(matchWorkshop?.centros||[],center.value);stage.centro_taller_id=matchCenter?.id||null;markDirty();};
      workshop.addEventListener('input',syncWorkshop);workshop.addEventListener('change',syncWorkshop);
      center.addEventListener('input',syncCenter);center.addEventListener('change',syncCenter);
      attachAutocomplete(workshop,{
        items:()=>detail.catalogos.talleres,
        value:item=>item.nombre||'',
        label:item=>item.nombre||'',
        meta:item=>item.observaciones||'',
        onSelect:item=>{stage.taller_nombre=item.nombre||'';stage.taller_id=item.id||null;stage.centro_nombre='';stage.centro_taller_id=null;center.value='';}
      });
      attachAutocomplete(center,{
        items:()=>matchingWorkshop()?.centros||[],
        value:item=>item.nombre||'',
        label:item=>item.nombre||'',
        meta:item=>[item.poblacion,item.direccion].filter(Boolean).join(' · '),
        onSelect:item=>{stage.centro_nombre=item.nombre||'';stage.centro_taller_id=item.id||null;}
      });

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
      card.append(header,grid,element('p',{className:'muted',text:'Taller y Centro también se filtran mientras escribes. Si introduces uno nuevo, se incorporará al catálogo al guardar.'}),fieldLabel('Observaciones de la T',obs),cancelled.label,cancelBox,element('div',{className:'editor-subheading'},[element('strong',{text:'Trabajos de esta T'})]),worksHost,addWork);
      stagesHost.append(card);
    });
  };
  addStageButton.addEventListener('click',()=>{detail.etapas.push(makeNewStage(detail.etapas));markDirty();renderStages();});
  renderStages();section.append(stagesHost,addStageButton);return section;
}
