import { clear, detail, element, notice } from '../dom.js';
import { supabase } from '../supabase.js';
import { openHotelEditor } from './hotel-editor.js';

function madridDate(date){return new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Madrid',year:'numeric',month:'2-digit',day:'2-digit'}).format(date);}
function yesterday(){const d=new Date();d.setDate(d.getDate()-1);return madridDate(d);}
function titleFor(row){if(row.dfm)return `${String(row.dfm).startsWith('R')?'Semirremolque':'DFM'} ${row.dfm} · ${row.matricula||'—'}`;return `Reserva ${row.reserva||'—'} · ${row.matricula_reserva||'—'}`;}

function renderHistoricalCard(row,stages,canEdit,onSaved){
  const stageList=element('div',{className:'grid'});
  if(!stages.length) stageList.append(element('span',{className:'muted',text:'Sin T registradas.'}));
  else stages.forEach(stage=>{const cancelled=stage.cancelado?` · CANCELADA: ${stage.motivo_cancelacion||'sin motivo'}`:'';stageList.append(element('div',{className:'badge',text:`${stage.posicion}T · ${stage.nombre} · ${stage.estado}${cancelled}`}));});
  const flags=[];if(row.retirado_hotel_activo)flags.push('Retirado del Hotel activo');if(row.cancelado)flags.push(`Cancelado${row.motivo_cancelacion?`: ${row.motivo_cancelacion}`:''}`);
  const card=element('article',{className:'card hotel-card',dataset:{state:row.estado||''}},[
    element('div',{className:'hotel-card-head'},[
      element('div',{},[element('h3',{text:titleFor(row)}),flags.length?element('div',{className:'muted',text:flags.join(' · ')}):null]),
      element('span',{className:'badge',text:row.numero_parada?`Parada ${row.numero_parada}`:'Sin nº de parada'})
    ]),
    element('div',{className:'detail-grid'},[detail('Estado',row.estado),detail('Reserva',row.reserva),detail('Prioridad',row.prioridad),detail('Lugar',row.lugar),detail('Causa',row.causa),detail('INC',row.incidencia),detail('T realizadas',`${row.t_realizadas??0} de ${row.total_t??0}`),detail('Versión',row.version),detail('Última modificación',row.actualizado_en?new Date(row.actualizado_en).toLocaleString('es-ES'):'—')]),stageList]);
  if(canEdit){const b=element('button',{className:'button primary compact',type:'button',text:'Editar ficha histórica'});b.addEventListener('click',()=>openHotelEditor(row.id,{onSaved}));card.append(element('div',{className:'reserve-actions'},[b]));}
  return card;
}

async function loadDay(container,dateValue,canEdit){
  const resultHost=container.querySelector('[data-history-results]');clear(resultHost);
  const shownDate=new Date(`${dateValue}T12:00:00`).toLocaleDateString('es-ES');resultHost.append(notice(`Cargando la pizarra del ${shownDate}…`,'warning'));
  const {data:board,error:boardError}=await supabase.from('pizarras').select('id,fecha,estado').eq('fecha',dateValue).maybeSingle();
  if(boardError){clear(resultHost);resultHost.append(notice(`No se pudo buscar la pizarra: ${boardError.message}`,'danger'));return;}
  if(!board){clear(resultHost);resultHost.append(notice('No existe una pizarra para el día seleccionado.','warning'));return;}
  const {data:rows,error:rowsError}=await supabase.from('hotel_por_dia').select('*').eq('fecha_pizarra',dateValue).order('orden',{ascending:true});
  if(rowsError){clear(resultHost);resultHost.append(notice(`No se pudo cargar la pizarra del día: ${rowsError.message}`,'danger'));return;}
  const ids=(rows||[]).map(row=>row.id);let stages=[];
  if(ids.length){const {data:stageRows,error:stagesError}=await supabase.from('etapas_hotel').select('id,registro_hotel_id,nombre,posicion,estado,lugar,fecha_prevista,fecha_inicio_real,fecha_fin_real,fecha_real,observaciones,cancelado,motivo_cancelacion,version,actualizado_en').in('registro_hotel_id',ids).order('posicion',{ascending:true});if(stagesError){clear(resultHost);resultHost.append(notice(`La pizarra existe, pero no se pudieron cargar sus T: ${stagesError.message}`,'danger'));return;}stages=stageRows||[];}
  const stagesByRecord=new Map();stages.forEach(stage=>{const list=stagesByRecord.get(stage.registro_hotel_id)||[];list.push(stage);stagesByRecord.set(stage.registro_hotel_id,list);});
  clear(resultHost);
  if(board.estado==='archivada') resultHost.append(element('div',{className:'notice danger'},[element('strong',{text:'⚠ PIZARRA ANTERIOR'}),element('div',{text:`Estás viendo y editando la pizarra del ${shownDate}. Los cambios quedan registrados en esta fecha.`})]));
  else resultHost.append(notice(`Pizarra del ${shownDate} · estado ${board.estado}.`,'success'));
  const reload=()=>loadDay(container,dateValue,canEdit);(rows||[]).forEach(row=>resultHost.append(renderHistoricalCard(row,stagesByRecord.get(row.id)||[],canEdit,reload)));
  if(!(rows||[]).length)resultHost.append(notice('La pizarra existe, pero no contiene registros.','warning'));
}

export async function renderHistory(container,canEdit=false){
  clear(container);const dateInput=element('input',{type:'date',value:yesterday(),'aria-label':'Fecha de la pizarra'});const searchButton=element('button',{className:'button primary',type:'button',text:'Buscar día'});const resultHost=element('div',{className:'grid',dataset:{historyResults:'1'}});
  searchButton.addEventListener('click',()=>{if(dateInput.value)loadDay(container,dateInput.value,canEdit);});
  container.append(element('div',{className:'module-heading'},[element('div',{},[element('h2',{text:'Histórico por día'}),element('p',{className:'muted',text:'Las pizarras anteriores se pueden editar con la misma ficha que Hotel. El aviso PIZARRA ANTERIOR evita confundirlas con el día en curso.'})]),element('span',{className:'badge',text:canEdit?'Histórico editable':'Solo lectura'})]),element('div',{className:'toolbar'},[element('label',{},[document.createTextNode('Fecha'),dateInput]),searchButton]),resultHost);
  await loadDay(container,dateInput.value,canEdit);
}
