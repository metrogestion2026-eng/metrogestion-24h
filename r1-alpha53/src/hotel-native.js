import { clear,element,notice } from '../../r1-alpha17/src/dom.js';
import { supabase } from '../../r1-alpha17/src/supabase.js';
import { openHotelEditor } from '../../r1-alpha17/src/modules/hotel-editor.js';
import { loadDocumentsForGroups } from './hotel-documents.js';
import { HOTEL_FILTERS,ensureNativeHotelStyle,metric,formatBoardDate } from './hotel-utils.js';
import { renderHotelCard } from './hotel-card.js';

ensureNativeHotelStyle();

async function getHotelAccess(){
  const{data:authData,error:authError}=await supabase.auth.getUser();if(authError||!authData?.user)return{view:false,editFicha:false,editDocuments:false};
  const{data:profile,error}=await supabase.from('usuarios').select('activo,tipo_usuario,permisos').eq('id',authData.user.id).maybeSingle();if(error||profile?.activo!==true)return{view:false,editFicha:false,editDocuments:false};
  if(profile.tipo_usuario==='administrador_principal')return{view:true,editFicha:true,editDocuments:true};
  const permission=profile.permisos?.hotel||{},documentation=profile.permisos?.documentacion||{};const editFicha=permission.editar===true;const view=editFicha||permission.ver===true||permission.leer===true;const editDocuments=editFicha||documentation.editar===true;
  return{view,editFicha,editDocuments};
}

async function renderHotelNative(container,access={view:false,editFicha:false,editDocuments:false}){
  clear(container);container.dataset.alpha53HotelNative='loading';let editMode=false,activeFilter='all';
  const headingActions=element('div',{className:'hotel-heading-actions'},[element('span',{className:'badge',text:'Hotel activo real · Alpha53'})]);
  const modeButton=access.editFicha?element('button',{className:'button secondary hotel-mode-button',type:'button',text:'🔒 Modo lectura'}):null;if(modeButton)headingActions.prepend(modeButton);
  const title=element('h2',{text:'Hotel · Pizarra actual'}),subtitle=element('p',{className:'muted',text:'Cargando fecha de pizarra…'});
  container.append(element('div',{className:'module-heading'},[element('div',{},[title,subtitle]),headingActions]));
  if(!access.view){container.append(notice('No tienes permiso para consultar el Hotel.','danger'));container.dataset.alpha53HotelNative='1';return;}
  const loading=notice('Cargando Hotel, T y documentación…','warning');container.append(loading);
  const[boardResult,hotelResult,editableResult]=await Promise.all([
    supabase.from('pizarras').select('id,fecha,estado').eq('estado','en_curso').maybeSingle(),
    supabase.from('hotel_actual_detalle').select('*').order('orden',{ascending:true}),
    access.editFicha?supabase.from('hotel_edicion_piloto').select('registro_hotel_id').eq('activo',true):Promise.resolve({data:[],error:null}),
  ]);
  if(boardResult.error){container.append(notice(`Hotel se cargó, pero no pudo leerse la fecha de la pizarra: ${boardResult.error.message}`,'warning'));subtitle.textContent='Fecha de pizarra no disponible.';}
  else if(boardResult.data){title.textContent=`Hotel · Pizarra actual · ${formatBoardDate(boardResult.data.fecha)}`;subtitle.textContent=`Pizarra del ${formatBoardDate(boardResult.data.fecha)} · ${boardResult.data.estado==='en_curso'?'en curso':boardResult.data.estado}.`;}
  else subtitle.textContent='No se encontró una pizarra en curso.';
  if(hotelResult.error){loading.remove();container.append(notice(`No se pudo cargar Hotel: ${hotelResult.error.message}`,'danger'));container.dataset.alpha53HotelNative='1';return;}
  if(editableResult.error)container.append(notice(`Hotel se cargó, pero no pudo comprobarse la edición: ${editableResult.error.message}`,'warning'));
  const rows=hotelResult.data||[],recordIds=rows.map(row=>row.id).filter(Boolean);let stages=[];
  if(recordIds.length){const{data,error}=await supabase.from('etapas_hotel').select('id,registro_hotel_id,seguimiento_id,grupo_documental_id,nombre,posicion,estado,tipo_etapa,taller_id,centro_taller_id,lugar,fecha_prevista,fecha_inicio_real,fecha_fin_real,fecha_real,observaciones,cancelado,motivo_cancelacion,version,actualizado_en').in('registro_hotel_id',recordIds).order('posicion',{ascending:true});
    if(error){loading.remove();container.append(notice(`Hotel existe, pero no se pudieron cargar sus T: ${error.message}`,'danger'));container.dataset.alpha53HotelNative='1';return;}stages=data||[];}
  const stagesByRecord=new Map();stages.forEach(stage=>{const list=stagesByRecord.get(stage.registro_hotel_id)||[];list.push(stage);stagesByRecord.set(stage.registro_hotel_id,list);});
  let documentsByGroup=new Map();try{documentsByGroup=await loadDocumentsForGroups(stages.map(stage=>stage.grupo_documental_id));}catch(error){container.append(notice(`Las fichas se cargaron, pero no pudo leerse la documentación: ${error.message}`,'warning'));}loading.remove();
  const editableIds=new Set((editableResult.data||[]).map(row=>row.registro_hotel_id));
  const summary=element('div',{className:'summary-grid'},HOTEL_FILTERS.map(filter=>metric(filter,filter.states?rows.filter(row=>filter.states.has(row.estado)).length:rows.length)));
  const modeNotice=element('div'),list=element('div',{className:'grid'});container.append(summary,modeNotice,list);
  const applyFilter=()=>{const selected=HOTEL_FILTERS.find(filter=>filter.key===activeFilter)||HOTEL_FILTERS[0];list.querySelectorAll('.hotel-card').forEach(card=>{const hidden=Boolean(selected.states&&!selected.states.has(card.dataset.state||''));card.classList.remove('hotel-filter-hidden','alpha33-pending-hidden','alpha51-native-filter-hidden');card.classList.toggle('alpha53-native-filter-hidden',hidden);});summary.querySelectorAll('.hotel-filter-metric').forEach(node=>{const active=node.dataset.hotelFilter===selected.key;node.classList.toggle('is-active',active);node.dataset.alpha53Active=active?'1':'0';node.setAttribute('aria-pressed',active?'true':'false');});};
  const activateMetric=target=>{const key=target?.dataset?.hotelFilter;if(!HOTEL_FILTERS.some(filter=>filter.key===key))return;activeFilter=key;applyFilter();};
  summary.addEventListener('click',event=>{const target=event.target.closest('.hotel-filter-metric');if(!target)return;event.preventDefault();event.stopPropagation();activateMetric(target);});
  summary.addEventListener('keydown',event=>{const target=event.target.closest('.hotel-filter-metric');if(!target||!['Enter',' '].includes(event.key))return;event.preventDefault();event.stopPropagation();activateMetric(target);});
  const renderRows=()=>{list.replaceChildren();modeNotice.replaceChildren();
    if(access.editFicha)modeNotice.append(editMode?notice(`✏️ Lectura y edición activada · ${editableIds.size} fichas autorizadas. Los documentos de las T se gestionan desde su propio bloque.`,'warning'):notice('🔒 Protección de la ficha activada. Los documentos se añaden únicamente mediante el botón explícito de cada T.','success'));
    else modeNotice.append(notice(access.editDocuments?'Modo lectura de ficha. La documentación de las T está autorizada.':'Modo lectura permanente.','success'));
    rows.forEach(row=>list.append(renderHotelCard(row,stagesByRecord.get(row.id)||[],documentsByGroup,{editMode:access.editFicha&&editMode,editableIds,canEditDocuments:access.editDocuments,onOpenEditor:async id=>openHotelEditor(id,{onSaved:async()=>renderHotelNative(container,access)})})));applyFilter();};
  if(modeButton)modeButton.addEventListener('click',()=>{editMode=!editMode;modeButton.textContent=editMode?'✏️ Lectura y edición':'🔒 Modo lectura';modeButton.classList.toggle('primary',editMode);modeButton.classList.toggle('secondary',!editMode);renderRows();});
  renderRows();container.dataset.alpha53HotelNative='1';
}

const nav=document.querySelector('#module-nav'),content=document.querySelector('#module-content'),appView=document.querySelector('#app-view');let rendering=false,scheduled=false;
async function openNativeHotel(button){if(!content||rendering)return;rendering=true;try{nav?.querySelectorAll('button').forEach(node=>node.classList.toggle('active',node===button));const access=await getHotelAccess();await renderHotelNative(content,access);}catch(error){clear(content);content.append(notice(`No se pudo cargar Hotel: ${error?.message||'error desconocido'}`,'danger'));content.dataset.alpha53HotelNative='1';}finally{rendering=false;}}
function scheduleTakeover(){if(scheduled)return;scheduled=true;queueMicrotask(()=>{scheduled=false;if(!nav||!content||!appView||appView.classList.contains('hidden')||rendering)return;const button=nav.querySelector('button[data-module="hotel"].active');if(!button||content.dataset.alpha53HotelNative==='1'||!content.querySelector('.summary-grid'))return;openNativeHotel(button);});}
nav?.addEventListener('click',event=>{const button=event.target.closest('button[data-module]');if(!button)return;if(button.dataset.module!=='hotel'){if(content)delete content.dataset.alpha53HotelNative;return;}if(content)delete content.dataset.alpha53HistoryNative;event.preventDefault();event.stopImmediatePropagation();openNativeHotel(button);},true);
if(appView){const observer=new MutationObserver(scheduleTakeover);observer.observe(appView,{attributes:true,childList:true,subtree:true});}scheduleTakeover();
