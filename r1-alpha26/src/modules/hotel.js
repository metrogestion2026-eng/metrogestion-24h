import { renderHotel as renderBaseHotel } from '../../../r1-alpha17/src/modules/hotel.js';
import { supabase } from '../../../r1-alpha17/src/supabase.js';
import { openHotelCreate } from '../../../r1-alpha20/src/modules/hotel-create.js';
import { openHotelEditor } from '../../../r1-alpha24/src/modules/hotel-editor.js';

const fmt = value => {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : new Intl.DateTimeFormat('es-ES', { dateStyle: 'short', timeStyle: 'short' }).format(date);
};
function dateInfo(stage) {
  if (stage.cancelado || stage.estado === 'anulada') return '';
  if (stage.estado === 'realizada') {
    const value = stage.fecha_real || stage.fecha_fin_real || stage.fecha_inicio_real;
    return value ? `Realizada: ${fmt(value)}` : '';
  }
  if (stage.estado === 'en_curso') {
    const value = stage.fecha_inicio_real || stage.fecha_prevista;
    return value ? `Inicio: ${fmt(value)}` : '';
  }
  return stage.fecha_prevista ? `Programada: ${fmt(stage.fecha_prevista)}` : 'Sin fecha';
}
function metaText(stage) {
  const parts = [];
  if (stage.taller) parts.push(stage.taller);
  if (stage.centro && stage.centro !== stage.taller) parts.push(stage.centro);
  if (stage.lugar && stage.lugar !== stage.taller && stage.lugar !== stage.centro) parts.push(stage.lugar);
  const date = dateInfo(stage);
  if (date) parts.push(date);
  return parts.join(' · ') || 'Sin taller, lugar ni fecha';
}
function addDetailStyle() {
  if (document.querySelector('#alpha26-stage-style')) return;
  const style = document.createElement('style');
  style.id = 'alpha26-stage-style';
  style.textContent = `.hotel-stage-row.alpha26-clickable{cursor:pointer}.hotel-stage-row.alpha26-clickable:hover{filter:brightness(.985);box-shadow:0 0 0 2px rgba(7,89,133,.12)}.hotel-stage-row.alpha26-clickable:focus{outline:3px solid rgba(7,89,133,.25);outline-offset:2px}.stage-readonly-overlay{position:fixed;inset:0;background:rgba(15,23,42,.48);z-index:10020;display:flex;align-items:center;justify-content:center;padding:24px}.stage-readonly-panel{width:min(920px,100%);max-height:90vh;overflow:auto;background:#fff;border-radius:18px;padding:22px;box-shadow:0 24px 70px rgba(15,23,42,.28)}.stage-readonly-head{display:flex;justify-content:space-between;gap:16px;align-items:flex-start;margin-bottom:16px}.stage-readonly-head h2{margin:.15rem 0}.stage-readonly-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:10px;margin:14px 0}.stage-readonly-field{border:1px solid #dbe5ec;border-radius:12px;padding:10px 12px;background:#f8fbfd}.stage-readonly-field span{display:block;font-size:.78rem;color:#64748b;margin-bottom:3px}.stage-readonly-field strong{white-space:pre-wrap}.stage-readonly-notes,.stage-readonly-work{border:1px solid #dbe5ec;border-radius:12px;padding:12px;margin-top:12px}.stage-readonly-work h4{margin:0 0 8px}.stage-readonly-badge{display:inline-block;padding:4px 8px;border-radius:999px;background:#e0f2fe;color:#075985;font-weight:700;font-size:.8rem}@media(max-width:640px){.stage-readonly-overlay{padding:10px}.stage-readonly-panel{padding:16px;border-radius:14px}}`;
  document.head.append(style);
}
function detailField(label, value) {
  const box = document.createElement('div');
  box.className = 'stage-readonly-field';
  const labelNode = document.createElement('span');
  labelNode.textContent = label;
  const valueNode = document.createElement('strong');
  valueNode.textContent = value === 0 ? '0' : (value || '—');
  box.append(labelNode, valueNode);
  return box;
}
function openStageDetail(stage) {
  addDetailStyle();
  document.querySelector('.stage-readonly-overlay')?.remove();
  const overlay = document.createElement('div');
  overlay.className = 'stage-readonly-overlay';
  const panel = document.createElement('section');
  panel.className = 'stage-readonly-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  const head = document.createElement('div');
  head.className = 'stage-readonly-head';
  const titleWrap = document.createElement('div');
  const badge = document.createElement('span');
  badge.className = 'stage-readonly-badge';
  badge.textContent = 'Solo lectura';
  const title = document.createElement('h2');
  title.textContent = `${stage.posicion}T · ${stage.nombre || 'T'}`;
  const subtitle = document.createElement('p');
  subtitle.className = 'muted';
  subtitle.textContent = 'Detalle completo de la T. Esta vista no modifica ningún dato.';
  titleWrap.append(badge, title, subtitle);
  const closeButton = document.createElement('button');
  closeButton.className = 'button secondary compact';
  closeButton.type = 'button';
  closeButton.textContent = 'Cerrar';
  head.append(titleWrap, closeButton);
  panel.append(head);
  const grid = document.createElement('div');
  grid.className = 'stage-readonly-grid';
  grid.append(detailField('Estado', stage.estado),detailField('Tipo de T', stage.tipo_etapa),detailField('Taller', stage.taller),detailField('Centro', stage.centro),detailField('Lugar / referencia', stage.lugar),detailField('Fecha programada', fmt(stage.fecha_prevista)),detailField('Inicio real', fmt(stage.fecha_inicio_real)),detailField('Fin real', fmt(stage.fecha_fin_real)),detailField('Fecha realizada', fmt(stage.fecha_real)),detailField('Versión', stage.version),detailField('Acción de sistema', stage.accion_sistema));
  panel.append(grid);
  if (stage.observaciones) {
    const notes = document.createElement('div');notes.className='stage-readonly-notes';const heading=document.createElement('strong');heading.textContent='Observaciones';const text=document.createElement('p');text.textContent=stage.observaciones;notes.append(heading,text);panel.append(notes);
  }
  if (stage.cancelado && stage.motivo_cancelacion) {
    const notes = document.createElement('div');notes.className='stage-readonly-notes';const heading=document.createElement('strong');heading.textContent='Motivo de anulación';const text=document.createElement('p');text.textContent=stage.motivo_cancelacion;notes.append(heading,text);panel.append(notes);
  }
  const works = Array.isArray(stage.trabajos) ? stage.trabajos : [];
  const worksTitle = document.createElement('h3');worksTitle.textContent=`Trabajos asociados · ${works.length}`;panel.append(worksTitle);
  if (!works.length) { const empty=document.createElement('p');empty.className='muted';empty.textContent='No hay trabajos asociados a esta T.';panel.append(empty); }
  works.forEach((work,index)=>{const card=document.createElement('article');card.className='stage-readonly-work';const heading=document.createElement('h4');heading.textContent=`${index+1}. ${work.tipo_trabajo||'Trabajo'}`;card.append(heading);const workGrid=document.createElement('div');workGrid.className='stage-readonly-grid';workGrid.append(detailField('Categoría técnica',work.categoria_tecnica),detailField('Km avería',work.km_averia),detailField('Expediente',work.expediente),detailField('Motivo / primer diagnóstico',work.motivo_entrada),detailField('Diagnóstico real',work.diagnostico_real),detailField('Descripción',work.descripcion),detailField('Peritaje / estado',work.peritaje_estado),detailField('Observaciones',work.observaciones),detailField('Cancelado',work.cancelado?'Sí':'No'),detailField('Motivo cancelación',work.motivo_cancelacion));card.append(workGrid);panel.append(card);});
  overlay.append(panel);document.body.append(overlay);
  const onKeyDown=event=>{if(event.key==='Escape')close();};
  const close=()=>{document.removeEventListener('keydown',onKeyDown);overlay.remove();};
  closeButton.addEventListener('click',close);overlay.addEventListener('click',event=>{if(event.target===overlay)close();});document.addEventListener('keydown',onKeyDown);
}
function enhanceStages(container, rows) {
  const cards=[...container.querySelectorAll('.hotel-card')];
  cards.forEach((card,cardIndex)=>{const stages=Array.isArray(rows[cardIndex]?.etapas_resumen)?rows[cardIndex].etapas_resumen:[];const nodes=[...card.querySelectorAll('.hotel-stage-row')];nodes.forEach((node,index)=>{const stage=stages[index];if(!stage)return;const meta=node.querySelector('.hotel-stage-meta');const desiredMeta=metaText(stage);if(meta&&meta.textContent!==desiredMeta)meta.textContent=desiredMeta;node.classList.add('alpha26-clickable');node.tabIndex=0;node.setAttribute('role','button');node.title='Abrir detalle completo de la T (solo lectura)';if(node.dataset.alpha26StageId===stage.id)return;node.dataset.alpha26StageId=stage.id;node.addEventListener('click',event=>{event.stopPropagation();openStageDetail(stage);});node.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();openStageDetail(stage);}});});});
}
export async function renderHotel(container, access = { view: false, edit: false }) {
  await renderBaseHotel(container, access);
  const { data: rows, error: rowsError } = await supabase.from('hotel_actual_detalle').select('id,etapas_resumen').order('orden', { ascending: true });
  const currentRows = rowsError ? [] : (rows || []);
  enhanceStages(container, currentRows);
  if (!access.edit) return;
  const ids=currentRows.map(row=>row.id);
  const tagEditorButtons=()=>{container.querySelectorAll('.hotel-card').forEach((card,index)=>{const button=card.querySelector('.hotel-open-editor');if(button&&ids[index])button.dataset.registroId=ids[index];});};
  if(container.__alpha26EditorHandler)container.removeEventListener('click',container.__alpha26EditorHandler,true);
  const captureEditor=event=>{const button=event.target.closest?.('.hotel-open-editor[data-registro-id]');if(!button||!container.contains(button))return;event.preventDefault();event.stopImmediatePropagation();openHotelEditor(button.dataset.registroId,{onSaved:async()=>renderHotel(container,access)});};
  container.__alpha26EditorHandler=captureEditor;container.addEventListener('click',captureEditor,true);
  const actions=container.querySelector('.hotel-heading-actions');const modeButton=container.querySelector('.hotel-mode-button');if(!actions||!modeButton)return;
  const addButton=document.createElement('button');addButton.type='button';addButton.className='button primary hidden';addButton.textContent='＋ Añadir ficha';addButton.title='Crear una nueva ficha en la pizarra actual';addButton.addEventListener('click',()=>openHotelCreate({onSaved:async()=>renderHotel(container,access)}));
  const refreshAfterModeChange=()=>{tagEditorButtons();enhanceStages(container,currentRows);addButton.classList.toggle('hidden',!modeButton.classList.contains('primary'));};
  modeButton.addEventListener('click',refreshAfterModeChange);actions.prepend(addButton);tagEditorButtons();refreshAfterModeChange();
}
