import { element } from '../../r1-alpha17/src/dom.js';

export const STATE_LABELS=Object.freeze({
  planificado:'Pendiente de parar',pendiente_taller:'Pendiente de taller',asistencia_24h:'Asistencia 24H activa',
  pendiente_diagnostico:'Pendiente de diagnóstico',pendiente_autorizacion:'Pendiente de autorización',
  en_taller:'En taller',pendiente_repuestos:'Pendiente de repuestos',terminado_pendiente_recogida:'Pendiente de recoger',
  recogido_pendiente_ruta:'Pendiente de recuperar',reserva_liberada:'Reserva libre',recuperado:'Recuperado',anulado:'Anulado',
});
export const STAGE_STATE_LABELS=Object.freeze({pendiente:'Pendiente',programada:'Programada',en_curso:'En curso',realizada:'Realizada',anulada:'Anulada'});
export const HOTEL_FILTERS=Object.freeze([
  {key:'all',label:'Fichas activas',states:null,title:'Mostrar todas las fichas activas'},
  {key:'planned',label:'Pendientes de parar',states:new Set(['planificado']),title:'Mostrar solo pendientes de parar'},
  {key:'pending-workshop',label:'Pendientes de taller',states:new Set(['pendiente_taller']),title:'Mostrar solo pendientes de taller'},
  {key:'workshop',label:'En taller',states:new Set(['en_taller','pendiente_diagnostico','pendiente_autorizacion','pendiente_repuestos']),title:'Mostrar solo vehículos en taller'},
  {key:'pickup',label:'Pendientes de recoger',states:new Set(['terminado_pendiente_recogida']),title:'Mostrar solo pendientes de recoger'},
  {key:'recover',label:'Pendientes de recuperar',states:new Set(['recogido_pendiente_ruta']),title:'Mostrar solo pendientes de recuperar'},
]);

export function ensureNativeHotelStyle(){
  if(document.querySelector('#alpha53-native-hotel-style'))return;
  const style=document.createElement('style');style.id='alpha53-native-hotel-style';style.textContent=`
    .hotel-card.alpha53-native-filter-hidden{display:none!important}
    .hotel-filter-metric[data-alpha53-active="1"]{outline:3px solid #075985;outline-offset:2px;background:#f0f9ff}
  `;document.head.append(style);
}
export function metric(filter,value){
  const node=element('div',{className:'metric hotel-filter-metric',dataset:{hotelFilter:filter.key}},[
    element('strong',{text:value}),element('span',{className:'muted',text:filter.label}),
  ]);node.setAttribute('role','button');node.setAttribute('tabindex','0');node.setAttribute('aria-label',filter.title);node.setAttribute('aria-pressed','false');node.title=filter.title;
  if(filter.key==='pending-workshop')node.dataset.alpha33Pending='1';if(filter.key==='planned')node.dataset.alpha51Planned='1';return node;
}
export function formatDateTime(value){if(!value)return'';const date=new Date(value);return Number.isNaN(date.getTime())?'':new Intl.DateTimeFormat('es-ES',{dateStyle:'short',timeStyle:'short'}).format(date);}
export function formatBoardDate(value){if(!value)return'Fecha no disponible';const[year,month,day]=String(value).split('-');return year&&month&&day?`${day}/${month}/${year}`:String(value);}
export function vehicleLabel(row){
  if(row.dfm)return`${String(row.dfm).startsWith('R')?'Semirremolque':'DFM'} ${row.dfm}${row.matricula?` · ${row.matricula}`:''}`;
  return`${row.tipo_sustituto==='RESERVA'?'Reserva':'Unidad'} ${row.sustituto||row.reserva||'—'}${(row.matricula_sustituto||row.matricula_reserva)?` · ${row.matricula_sustituto||row.matricula_reserva}`:''}`;
}
export function substituteText(row){
  const code=row.sustituto||row.reserva;if(!code)return'Sin sustituto asignado';const type=row.tipo_sustituto||'RESERVA';const registration=row.matricula_sustituto||row.matricula_reserva;const extra=type==='RESERVA'&&row.etiqueta_sustituto?` · ${row.etiqueta_sustituto}`:'';
  return`${type} ${code}${registration?` · ${registration}`:''}${extra}`;
}
