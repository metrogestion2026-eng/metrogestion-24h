import { supabase } from '../../r1-alpha17/src/supabase.js';
import {
  el,formatDateTime,formatBytes,categoryLabel,isImage,isPreviewableImage,
  modal,labelControl,signedUrl,openStoredDocument,downloadStoredDocument,
} from './document-core.js';

async function editDocument(doc,reload){
  const dialog=modal('Modificar datos del archivo');const form=el('div',null,'a53-form-grid');
  const name=document.createElement('input');name.value=doc.nombre_mostrado||doc.nombre_original||'';name.maxLength=180;
  const description=document.createElement('textarea');description.value=doc.descripcion||'';description.maxLength=1000;
  const reason=document.createElement('textarea');reason.maxLength=500;reason.placeholder='Explica por qué se modifica';
  form.append(labelControl('Nombre visible',name,true),labelControl('Descripción',description,true),labelControl('Motivo obligatorio',reason,true));
  const status=el('div','','a53-doc-status wide');const actions=el('div',null,'a53-modal-actions wide');
  const cancel=el('button','Cancelar','button secondary');const save=el('button','Guardar modificación','button primary');
  cancel.type=save.type='button';cancel.addEventListener('click',dialog.destroy);
  save.addEventListener('click',async()=>{
    if(reason.value.trim().length<3){status.className='a53-doc-status danger wide';status.textContent='Indica el motivo de la modificación.';reason.focus();return;}
    save.disabled=true;status.className='a53-doc-status wide';status.textContent='Guardando…';
    const{error}=await supabase.rpc('modificar_documento_t',{p_documento_id:doc.id,p_nombre_mostrado:name.value.trim(),p_descripcion:description.value.trim(),p_motivo:reason.value.trim()});
    if(error){save.disabled=false;status.className='a53-doc-status danger wide';status.textContent=error.message;return;}
    dialog.destroy();await reload();
  });
  actions.append(cancel,save);form.append(status,actions);dialog.card.append(form);name.focus();
}

async function askReason(title,label,confirmText){
  return new Promise(resolve=>{
    const dialog=modal(title);let settled=false;
    dialog.onDismiss(()=>{if(!settled){settled=true;resolve(null);}});
    const field=document.createElement('textarea');field.maxLength=500;field.placeholder=label;
    const status=el('div','','a53-doc-status');const actions=el('div',null,'a53-modal-actions');
    const cancel=el('button','Cancelar','button secondary');const confirm=el('button',confirmText,'button primary');
    cancel.type=confirm.type='button';
    const finish=value=>{if(settled)return;settled=true;dialog.destroy();resolve(value);};
    cancel.addEventListener('click',()=>finish(null));
    confirm.addEventListener('click',()=>{const value=field.value.trim();if(value.length<3){status.className='a53-doc-status danger';status.textContent='Escribe un motivo de al menos tres caracteres.';field.focus();return;}finish(value);});
    actions.append(cancel,confirm);dialog.card.append(labelControl('Motivo obligatorio',field,true),status,actions);field.focus();
  });
}

async function changeCancelledState(doc,reload){
  const restoring=doc.cancelado===true;
  const reason=await askReason(restoring?'Restaurar archivo':'Anular archivo',restoring?'Motivo de la restauración':'Motivo de la anulación',restoring?'Restaurar':'Anular');
  if(!reason)return;const fn=restoring?'restaurar_documento_t':'anular_documento_t';
  const{error}=await supabase.rpc(fn,{p_documento_id:doc.id,p_motivo:reason});
  if(error){window.alert(error.message);return;}await reload();
}

async function showDocumentHistory(doc){
  const dialog=modal(`Histórico · ${doc.nombre_mostrado||doc.nombre_original}`);const status=el('div','Cargando movimientos…','a53-doc-status');dialog.card.append(status);
  const{data,error}=await supabase.from('documentos_gestion_historial').select('id,accion,motivo,usuario_id,fecha').eq('documento_id',doc.id).order('fecha',{ascending:false});
  if(error){status.className='a53-doc-status danger';status.textContent=error.message;return;}
  const rows=data||[];const userIds=[...new Set(rows.map(row=>row.usuario_id).filter(Boolean))];const users=new Map();
  if(userIds.length){const{data:userRows}=await supabase.from('usuarios').select('id,nombre,apellidos,correo').in('id',userIds);(userRows||[]).forEach(user=>users.set(user.id,user));}
  status.remove();const list=el('div',null,'a53-doc-history');if(!rows.length)list.append(el('div','No hay movimientos registrados.','a53-empty'));
  rows.forEach(row=>{const user=users.get(row.usuario_id);const name=user?([user.nombre,user.apellidos].filter(Boolean).join(' ').trim()||user.correo):(row.usuario_id?`Usuario ${String(row.usuario_id).slice(0,8)}`:'Sistema');
    const item=el('article',null,'a53-doc-history-item');item.append(el('strong',`${formatDateTime(row.fecha)} · ${String(row.accion||'').toUpperCase()}`),el('span',name,'muted'),el('p',row.motivo||'Sin motivo indicado'));list.append(item);});
  dialog.card.append(list);
}

export function documentCard(doc,canEdit,reload){
  const card=el('article',null,`a53-doc-card${doc.cancelado?' cancelled':''}`);const visual=el('div',null,'a53-doc-visual');
  if(isPreviewableImage(doc)){const image=el('img',null,'a53-doc-thumb');image.alt=doc.nombre_mostrado||doc.nombre_original||'Fotografía';image.loading='lazy';visual.append(image);
    signedUrl(doc).then(url=>{if(image.isConnected)image.src=url;}).catch(()=>visual.replaceChildren(el('span','🖼️','a53-doc-icon')));
  }else visual.append(isImage(doc)?el('span','🖼️','a53-doc-icon'):el('span','PDF','a53-doc-pdf'));
  const main=el('div',null,'a53-doc-main');main.append(el('strong',doc.nombre_mostrado||doc.nombre_original||'Archivo'),el('span',`${categoryLabel(doc)} · ${formatBytes(doc.tamano_bytes)} · ${formatDateTime(doc.creado_en)}`,'muted'));
  if(doc.descripcion)main.append(el('p',doc.descripcion));if(doc.cancelado)main.append(el('div',`ANULADO · ${doc.motivo_cancelacion||'sin motivo'} · ${formatDateTime(doc.cancelado_en)}`,'a53-doc-cancelled-note'));
  const actions=el('div',null,'a53-doc-actions');const open=el('button',isImage(doc)?'Ver foto':'Abrir PDF','button secondary compact');const download=el('button','Descargar','button secondary compact');const history=el('button','Histórico','button secondary compact');
  open.type=download.type=history.type='button';open.addEventListener('click',()=>openStoredDocument(doc));download.addEventListener('click',()=>downloadStoredDocument(doc));history.addEventListener('click',()=>showDocumentHistory(doc));actions.append(open,download,history);
  if(canEdit){if(!doc.cancelado){const edit=el('button','Modificar','button secondary compact');edit.type='button';edit.addEventListener('click',()=>editDocument(doc,reload));actions.append(edit);}
    const state=el('button',doc.cancelado?'Restaurar':'Anular',doc.cancelado?'button primary compact':'button secondary compact');state.type='button';state.addEventListener('click',()=>changeCancelledState(doc,reload));actions.append(state);}
  card.append(visual,main,actions);return card;
}
