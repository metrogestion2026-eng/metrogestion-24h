import { clear, detail, element, notice } from '../dom.js';
import { supabase } from '../supabase.js';

function stateLabel(value){return ({libre:'Libre',disponible_con_pendientes:'Libre con pendientes',ocupada:'Ocupada',fuera_servicio:'Fuera de servicio'})[value]||value||'—';}

async function toggleReserve(row, button, message){
  button.disabled=true;
  const { error } = await supabase.rpc('cambiar_estado_reserva_hotel',{p_codigo:row.vehiculo_codigo,p_activo:!row.activo,p_observaciones:''});
  if(error){message.textContent=error.message;button.disabled=false;return;}
  await renderReservas(document.querySelector('#module-content'), true);
}

function reserveCard(row,canEdit,message){
  const card=element('article',{className:'card reserve-card',dataset:{active:String(row.activo)}},[
    element('div',{className:'reserve-head'},[
      element('div',{},[element('h3',{text:`${row.vehiculo_codigo} · ${row.matricula}`}),element('div',{className:'muted',text:`PISSARRA: ${row.etiqueta}`})]),
      element('span',{className:`badge reserve-state ${row.estado}`,text:row.activo?stateLabel(row.estado):'BAJA'})
    ]),
    element('div',{className:'detail-grid'},[
      detail('Característica PISSARRA',row.etiqueta),detail('Estado operativo',stateLabel(row.estado)),detail('Pendientes propios',row.pendientes||'—'),detail('Ubicación',row.ubicacion||'—'),detail('Alta',row.fecha_alta||'—'),detail('Baja',row.fecha_baja||'—')
    ])
  ]);
  if(canEdit){const btn=element('button',{className:'button secondary compact',type:'button',text:row.activo?'Dar de baja':'Dar de alta'});btn.addEventListener('click',()=>toggleReserve(row,btn,message));card.append(element('div',{className:'reserve-actions'},[btn]));}
  return card;
}

export async function renderReservas(container,canEdit=false){
  clear(container);
  const message=element('p',{className:'status-message'});
  container.append(element('div',{className:'module-heading'},[element('div',{},[element('h2',{text:'Reservas fijas'}),element('p',{className:'muted',text:'Catálogo fijo de reservas del Hotel. La característica procede de PISSARRA.'})]),element('span',{className:'badge',text:canEdit?'Alta/Baja autorizada':'Solo lectura'})]),message);
  const {data,error}=await supabase.from('reservas_hotel').select('vehiculo_codigo,matricula,etiqueta,estado,ubicacion,pendientes,activo,fecha_alta,fecha_baja').not('vehiculo_codigo','like','TEST-%').order('vehiculo_codigo');
  if(error){container.append(notice(error.message,'danger'));return;}
  const rows=data||[]; const active=rows.filter(r=>r.activo); const inactive=rows.filter(r=>!r.activo);
  container.append(element('div',{className:'summary-grid'},[element('div',{className:'metric'},[element('strong',{text:rows.length}),element('span',{className:'muted',text:'Reservas registradas'})]),element('div',{className:'metric'},[element('strong',{text:active.length}),element('span',{className:'muted',text:'En alta'})]),element('div',{className:'metric'},[element('strong',{text:inactive.length}),element('span',{className:'muted',text:'En baja'})])]));
  const host=element('div',{className:'reserve-grid'});active.forEach(r=>host.append(reserveCard(r,canEdit,message)));container.append(host);
  if(inactive.length){const details=element('details',{},[element('summary',{text:`Reservas de baja · ${inactive.length}`})]);const off=element('div',{className:'reserve-grid'});inactive.forEach(r=>off.append(reserveCard(r,canEdit,message)));details.append(off);container.append(details);}
}
