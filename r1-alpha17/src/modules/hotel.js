import { clear, detail, element, notice } from '../dom.js';
import { supabase } from '../supabase.js';
import { openHotelEditor } from './hotel-editor.js';

const STATE_LABELS = Object.freeze({planificado:'Pendiente de parar',pendiente_taller:'Pendiente de taller',pendiente_diagnostico:'Pendiente de diagnóstico',pendiente_autorizacion:'Pendiente de autorización',en_taller:'En taller',pendiente_repuestos:'Pendiente de repuestos',terminado_pendiente_recogida:'Pendiente de recoger',recogido_pendiente_ruta:'Pendiente de recuperar',reserva_liberada:'Reserva libre',recuperado:'Recuperado',anulado:'Anulado'});
const STAGE_STATE_LABELS = Object.freeze({pendiente:'Pendiente',programada:'Programada',en_curso:'En curso',realizada:'Realizada',anulada:'Anulada'});
const activeRenders = new WeakMap();

function metric(label,value){return element('div',{className:'metric'},[element('strong',{text:value}),element('span',{className:'muted',text:label})]);}
function formatDateTime(value){if(!value)return '';const date=new Date(value);return Number.isNaN(date.getTime())?'':new Intl.DateTimeFormat('es-ES',{dateStyle:'short',timeStyle:'short'}).format(date);}
function formatBoardDate(value){if(!value)return 'Fecha no disponible';const [y,m,d]=String(value).split('-');return y&&m&&d?`${d}/${m}/${y}`:String(value);}
function normalizeStages(value){if(Array.isArray(value))return value;if(typeof value!=='string'||!value.trim())return [];try{const parsed=JSON.parse(value);return Array.isArray(parsed)?parsed:[];}catch{return [];}}
function vehicleLabel(row){if(row.dfm)return `${String(row.dfm).startsWith('R')?'Semirremolque':'DFM'} ${row.dfm}${row.matricula?` · ${row.matricula}`:''}`;return `${row.tipo_sustituto==='RESERVA'?'Reserva':'Unidad'} ${row.sustituto||row.reserva||'—'}${(row.matricula_sustituto||row.matricula_reserva)?` · ${row.matricula_sustituto||row.matricula_reserva}`:''}`;}
function substituteText(row){const code=row.sustituto||row.reserva;if(!code)return 'Sin sustituto asignado';const type=row.tipo_sustituto||'RESERVA';const mat=row.matricula_sustituto||row.matricula_reserva;const extra=type==='RESERVA'&&row.etiqueta_sustituto?` · ${row.etiqueta_sustituto}`:'';return `${type} ${code}${mat?` · ${mat}`:''}${extra}`;}
function stageVisual(stage){if(stage.cancelado===true||stage.estado==='anulada')return{marker:'×',className:'stage-cancelled',label:'Anulada'};if(stage.estado==='realizada')return{marker:'✓',className:'stage-done',label:'Realizada'};if(stage.estado==='en_curso')return{marker:'→',className:'stage-active',label:'En curso'};if(stage.estado==='programada')return{marker:'○',className:'stage-scheduled',label:'Programada'};return{marker:'○',className:'stage-pending',label:STAGE_STATE_LABELS[stage.estado]||stage.estado||'Pendiente'};}
function stageDate(stage){if(stage.cancelado===true||stage.estado==='anulada')return null;if(stage.estado==='realizada')return{label:'Realizada',value:stage.fecha_real||stage.fecha_fin_real||stage.fecha_inicio_real};if(stage.estado==='en_curso')return{label:'Inicio',value:stage.fecha_inicio_real||stage.fecha_prevista};return{label:'Programada',value:stage.fecha_prevista};}
function defaultStageMeta(stage) {
  const date = stageDate(stage);
  const parts = stage.lugar ? [stage.lugar] : [];
  if (date?.value) parts.push(`${date.label}: ${formatDateTime(date.value)}`);
  else if (stage.cancelado !== true && stage.estado !== 'anulada') parts.push('Sin fecha');
  return parts.join(' · ') || 'Sin lugar ni fecha';
}
function identity(value) { return typeof value === 'string' ? value.trim() : ''; }
function countIdentities(items) {
  const counts = new Map();
  for (const item of items) {
    const id = identity(item?.id);
    if (id) counts.set(id, (counts.get(id) || 0) + 1);
  }
  return counts;
}
function renderStage(stage, row, context) {
  const visual = stageVisual(stage);
  const content = element('div', { className: 'hotel-stage-content' }, [
    element('div', { className: 'hotel-stage-main' }, [
      element('strong', { text: `${stage.posicion ?? '—'}T · ${stage.nombre || 'T sin nombre'}` }),
      element('span', { className: `hotel-stage-status ${visual.className}`, text: visual.label }),
    ]),
    element('div', { className: 'hotel-stage-meta', text: context.formatStageMeta(stage, row) }),
  ]);
  if (stage.observaciones) content.append(element('div', { className: 'hotel-stage-note', text: stage.observaciones }));
  if ((stage.cancelado === true || stage.estado === 'anulada') && stage.motivo_cancelacion) content.append(element('div', { className: 'hotel-stage-note cancelled-note', text: `Motivo: ${stage.motivo_cancelacion}` }));
  const node = element('div', {
    className: `hotel-stage-row ${visual.className}`,
    dataset: { registroId: identity(row.id), etapaId: identity(stage.id) },
  }, [element('span', { className: 'hotel-stage-marker', text: visual.marker }), content]);
  if (context.hasRecordIdentity(row) && context.hasStageIdentity(stage, row) && context.onOpenStage) {
    node.classList.add('alpha26-clickable');
    node.tabIndex = 0;
    node.setAttribute('role', 'button');
    node.title = 'Abrir detalle completo de la T (solo lectura)';
    const open = event => {
      if (!context.isCurrent() || !context.container.contains(node)) return;
      if (node.dataset.registroId !== row.id || node.dataset.etapaId !== stage.id
        || node.closest('.hotel-card')?.dataset.registroId !== row.id) return;
      event.stopPropagation();
      context.onOpenStage(stage, row);
    };
    node.addEventListener('click', open);
    node.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(event); }
    });
  }
  return node;
}
function renderStages(row, context) {
  const stages = row.etapas_resumen.slice().sort((a, b) =>
    Number(Boolean(a.cancelado)) - Number(Boolean(b.cancelado)) || Number(a.posicion || 0) - Number(b.posicion || 0)
      || identity(a.id).localeCompare(identity(b.id)));
  const active = stages.filter(stage => stage.cancelado !== true && stage.estado !== 'anulada');
  const cancelled = stages.filter(stage => stage.cancelado === true || stage.estado === 'anulada');
  const section = element('section', { className: 'hotel-card-stages' });
  section.append(element('div', { className: 'hotel-stage-heading' }, [
    element('h4', { text: 'T de la parada' }),
    element('span', { className: 'badge', text: `${active.length} activa${active.length === 1 ? '' : 's'}` }),
  ]));
  const list = element('div', { className: 'hotel-stage-list' });
  if (!active.length) list.append(element('div', { className: 'hotel-stage-empty', text: 'No hay T activas registradas.' }));
  else active.forEach(stage => list.append(renderStage(stage, row, context)));
  section.append(list);
  if (cancelled.length) {
    const old = element('div', { className: 'hotel-stage-list cancelled-list' });
    cancelled.forEach(stage => old.append(renderStage(stage, row, context)));
    section.append(element('details', { className: 'hotel-stage-history' }, [element('summary', { text: `T anuladas / histórico · ${cancelled.length}` }), old]));
  }
  return section;
}
function renderCard(row, context) {
  const badges = element('div', { className: 'hotel-card-badges' }, [
    element('span', { className: 'badge', text: `Prioridad ${row.prioridad ?? '—'}` }),
    element('span', { className: 'badge', text: STATE_LABELS[row.estado] || row.estado || 'Sin estado' }),
    element('span', { className: 'badge', text: `Fondo ${row.fondo_visual || 'blanco'}` }),
    row.trazo_marron ? element('span', { className: 'badge hotel-brown-outline-badge', text: 'Trazo marrón' }) : null,
  ]);
  const card = element('article', {
    className: `card hotel-card hotel-final-card hotel-bg-${row.fondo_visual || 'blanco'}${row.trazo_marron ? ' hotel-outline-brown' : ''}`,
    dataset: { state: row.estado || '', registroId: identity(row.id) },
  }, [
    element('div', { className: 'hotel-card-head' }, [element('div', {}, [element('h3', { text: vehicleLabel(row) }), element('div', { className: 'hotel-substitute-line', text: substituteText(row) })]), badges]),
    element('div', { className: 'detail-grid' }, [detail('Nº de parada', row.numero_parada), detail('Lugar', row.lugar), detail('UPC', row.upc), detail('Causa', row.causa), detail('INC', row.incidencia), detail('Próximo', row.proximo), detail('T realizadas', `${row.t_realizadas ?? 0} de ${row.total_t ?? 0}`), detail('T pendientes', row.t_pendientes ?? 0)]),
    row.observaciones ? element('section', { className: 'hotel-final-notes' }, [element('strong', { text: 'Anotaciones' }), element('p', { text: row.observaciones })]) : null,
    renderStages(row, context),
  ]);
  if (context.editMode && context.editableIds.has(row.id) && context.hasRecordIdentity(row)) {
    const button = element('button', { className: 'button primary hotel-open-editor', type: 'button', text: 'Abrir edición completa', dataset: { registroId: row.id } });
    button.addEventListener('click', () => {
      if (!context.isCurrent() || !context.container.contains(button) || button.closest('.hotel-card') !== card
        || card.dataset.registroId !== row.id || button.dataset.registroId !== row.id) return;
      context.openEditor(row.id, { onSaved: context.reload });
    });
    card.append(button);
  }
  return card;
}

// Hooks receive the row/stage being drawn, never an object selected by position
// in another query. Re-rendering a mode recreates handlers from the same snapshot.
export async function renderHotel(container,access={view:false,edit:false},options={}){
  const token = {};
  activeRenders.set(container, token);
  clear(container);let editMode=false;
  const headingActions=element('div',{className:'hotel-heading-actions'},[element('span',{className:'badge',text:'Hotel activo real · pruebas'})]);
  const modeButton=access.edit?element('button',{className:'button secondary hotel-mode-button',type:'button',text:'🔒 Modo lectura'}):null;if(modeButton)headingActions.prepend(modeButton);
  const title=element('h2',{text:'Hotel · Pizarra actual'});const subtitle=element('p',{className:'muted',text:'Cargando fecha de pizarra…'});
  const heading=element('div',{className:'module-heading'},[element('div',{},[title,subtitle]),headingActions]);
  container.append(heading);
  const isCurrent=()=>activeRenders.get(container)===token&&container.contains(heading);
  const reload=()=>isCurrent()?renderHotel(container,access,options):Promise.resolve(null);
  const loading=notice('Cargando Hotel activo y T…','warning');container.append(loading);
  let results;
  try {
    results=await Promise.all([
      supabase.from('pizarras').select('id,fecha,estado').eq('estado','en_curso').maybeSingle(),
      supabase.from('hotel_actual_detalle').select('*').order('orden',{ascending:true}).order('id',{ascending:true}),
      access.edit?supabase.from('hotel_edicion_piloto').select('registro_hotel_id').eq('activo',true):Promise.resolve({data:[],error:null})
    ]);
  } catch(error) {
    if(!isCurrent())return null;
    loading.remove();
    container.append(notice(`No se pudo cargar Hotel: ${error?.message||'error de conexión'}`,'danger'));
    return null;
  }
  if(!isCurrent())return null;
  const [boardResult,hotelResult,editableResult]=results;
  loading.remove();
  if(boardResult.error){container.append(notice(`Hotel se cargó, pero no pudo leerse la fecha de la pizarra: ${boardResult.error.message}`,'warning'));subtitle.textContent='Fecha de pizarra no disponible.';}else if(boardResult.data){title.textContent=`Hotel · Pizarra actual · ${formatBoardDate(boardResult.data.fecha)}`;subtitle.textContent=`Pizarra del ${formatBoardDate(boardResult.data.fecha)} · ${boardResult.data.estado==='en_curso'?'en curso':boardResult.data.estado}.`;}else{subtitle.textContent='No se encontró una pizarra en curso.';}
  if(hotelResult.error){container.append(notice(`No se pudo cargar Hotel: ${hotelResult.error.message}`,'danger'));return;}
  if(editableResult.error)container.append(notice(`Hotel se cargó, pero no pudo comprobarse la edición: ${editableResult.error.message}`,'warning'));
  const rows=(hotelResult.data||[]).map(row=>({...row,etapas_resumen:normalizeStages(row.etapas_resumen)}));
  const recordCounts=countIdentities(rows);
  const stageCounts=countIdentities(rows.flatMap(row=>row.etapas_resumen));
  const editableIds=new Set((editableResult.error?[]:editableResult.data||[]).map(row=>row.registro_hotel_id));
  const context={
    container,isCurrent,reload,editableIds,
    formatStageMeta:options.formatStageMeta||defaultStageMeta,
    onOpenStage:options.onOpenStage,
    openEditor:options.openEditor||openHotelEditor,
    hasRecordIdentity:row=>Boolean(identity(row.id))&&recordCounts.get(row.id)===1,
    hasStageIdentity:(stage,row)=>Boolean(identity(stage.id))&&stageCounts.get(stage.id)===1
      &&(!stage.registro_hotel_id||stage.registro_hotel_id===row.id),
  };
  const summary=element('div',{className:'summary-grid'},[metric('Fichas activas',rows.length),metric('En taller',rows.filter(r=>['en_taller','pendiente_diagnostico','pendiente_autorizacion','pendiente_repuestos'].includes(r.estado)).length),metric('Pendientes de recoger',rows.filter(r=>r.estado==='terminado_pendiente_recogida').length),metric('Pendientes de recuperar',rows.filter(r=>r.estado==='recogido_pendiente_ruta').length)]);
  const modeNotice=element('div');const list=element('div',{className:'grid'});container.append(summary,modeNotice,list);
  const addButton=access.edit&&options.openCreate?element('button',{className:'button primary hidden',type:'button',text:'＋ Añadir ficha',title:'Crear una nueva ficha en la pizarra actual'}):null;
  if(addButton){
    addButton.addEventListener('click',()=>{if(isCurrent()&&editMode&&container.contains(addButton))options.openCreate({onSaved:reload});});
    headingActions.prepend(addButton);
  }
  const renderRows=()=>{if(!isCurrent())return;list.replaceChildren();modeNotice.replaceChildren();if(access.edit)modeNotice.append(editMode?notice(`✏️ Lectura y edición activada · ${editableIds.size} fichas autorizadas.`,'warning'):notice('🔒 Protección activada: ninguna ficha puede modificarse.','success'));else modeNotice.append(notice('Modo lectura permanente.','success'));addButton?.classList.toggle('hidden',!editMode);rows.forEach(row=>list.append(renderCard(row,{...context,editMode:access.edit&&editMode})));};
  if(modeButton)modeButton.addEventListener('click',()=>{if(!isCurrent())return;editMode=!editMode;modeButton.textContent=editMode?'✏️ Lectura y edición':'🔒 Modo lectura';modeButton.classList.toggle('primary',editMode);modeButton.classList.toggle('secondary',!editMode);renderRows();});
  renderRows();
  return {isCurrent};
}
