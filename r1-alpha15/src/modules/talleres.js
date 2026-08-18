import { clear, detail, element, notice } from '../dom.js';
import { supabase } from '../supabase.js';

function input(value='',type='text'){const el=element('input',{type});el.value=value??'';return el;}
function textarea(value=''){const el=element('textarea');el.value=value??'';return el;}
function checkbox(checked=false){const el=element('input',{type:'checkbox'});el.checked=checked===true;return el;}
function field(label,control){return element('label',{className:'editor-field'},[element('span',{text:label}),control]);}
function statusText(host,text,kind=''){host.className=`status-message ${kind}`.trim();host.textContent=text;}

async function loadAll(){
  const [t,c,k]=await Promise.all([
    supabase.from('talleres').select('*').order('nombre'),
    supabase.from('centros_taller').select('*').order('nombre'),
    supabase.from('taller_contactos').select('*').order('es_principal',{ascending:false}).order('nombre')
  ]);
  if(t.error) throw t.error;if(c.error) throw c.error;if(k.error) throw k.error;
  return {talleres:t.data||[],centros:c.data||[],contactos:k.data||[]};
}

async function saveWorkshop(row,controls,message){
  const payload={nombre:controls.nombre.value.trim(),observaciones:controls.observaciones.value.trim(),activo:controls.activo.checked};
  if(!payload.nombre){statusText(message,'El nombre del taller es obligatorio.','error');return false;}
  const q=row?.id?supabase.from('talleres').update(payload).eq('id',row.id):supabase.from('talleres').insert(payload);
  const {error}=await q;if(error){statusText(message,error.message,'error');return false;}statusText(message,'Taller guardado.','success');return true;
}
async function saveCenter(row,tallerId,controls,message){
  const payload={taller_id:tallerId,nombre:controls.nombre.value.trim(),direccion:controls.direccion.value.trim(),poblacion:controls.poblacion.value.trim(),codigo_postal:controls.codigo_postal.value.trim(),plus_code:controls.plus_code.value.trim(),observaciones:controls.observaciones.value.trim(),activo:controls.activo.checked};
  if(!payload.nombre){statusText(message,'El nombre del centro es obligatorio.','error');return false;}
  const q=row?.id?supabase.from('centros_taller').update(payload).eq('id',row.id):supabase.from('centros_taller').insert(payload);
  const {error}=await q;if(error){statusText(message,error.message,'error');return false;}statusText(message,'Centro guardado.','success');return true;
}
async function saveContact(row,tallerId,controls,message){
  const payload={taller_id:tallerId,centro_taller_id:controls.centro.value||null,nombre:controls.nombre.value.trim(),cargo:controls.cargo.value.trim(),telefono:controls.telefono.value.trim(),extension:controls.extension.value.trim(),correo:controls.correo.value.trim(),observaciones:controls.observaciones.value.trim(),es_principal:controls.es_principal.checked,usar_para_envios:controls.usar_para_envios.checked,activo:controls.activo.checked};
  if(!payload.telefono){statusText(message,'El teléfono es obligatorio para guardar el contacto.','error');return false;}
  const q=row?.id?supabase.from('taller_contactos').update(payload).eq('id',row.id):supabase.from('taller_contactos').insert(payload);
  const {error}=await q;if(error){statusText(message,error.message,'error');return false;}statusText(message,'Contacto guardado.','success');return true;
}

function workshopForm(row,canEdit,message,onSaved){
  const c={nombre:input(row?.nombre||''),observaciones:textarea(row?.observaciones||''),activo:checkbox(row?.activo??true)};
  const host=element('div',{className:'editor-grid'},[field('Nombre',c.nombre),field('Observaciones',c.observaciones),field('Activo',c.activo)]);
  if(canEdit){const b=element('button',{className:'button primary compact',type:'button',text:row?.id?'Guardar taller':'Crear taller'});b.addEventListener('click',async()=>{b.disabled=true;if(await saveWorkshop(row,c,message))await onSaved();b.disabled=false;});host.append(b);}return host;
}
function centerForm(row,tallerId,canEdit,message,onSaved){
  const c={nombre:input(row?.nombre||''),direccion:input(row?.direccion||''),poblacion:input(row?.poblacion||''),codigo_postal:input(row?.codigo_postal||''),plus_code:input(row?.plus_code||''),observaciones:textarea(row?.observaciones||''),activo:checkbox(row?.activo??true)};
  const host=element('div',{className:'editor-grid'},[field('Centro',c.nombre),field('Dirección',c.direccion),field('Población',c.poblacion),field('Código postal',c.codigo_postal),field('Plus Code',c.plus_code),field('Observaciones',c.observaciones),field('Activo',c.activo)]);
  if(canEdit){const b=element('button',{className:'button primary compact',type:'button',text:row?.id?'Guardar centro':'Crear centro'});b.addEventListener('click',async()=>{b.disabled=true;if(await saveCenter(row,tallerId,c,message))await onSaved();b.disabled=false;});host.append(b);}return host;
}
function contactForm(row,tallerId,centers,canEdit,message,onSaved){
  const select=element('select');select.append(element('option',{value:'',text:'General del taller'}));centers.forEach(x=>select.append(element('option',{value:x.id,text:x.nombre})));select.value=row?.centro_taller_id||'';
  const c={centro:select,nombre:input(row?.nombre||''),cargo:input(row?.cargo||''),telefono:input(row?.telefono||''),extension:input(row?.extension||''),correo:input(row?.correo||'','email'),observaciones:textarea(row?.observaciones||''),es_principal:checkbox(row?.es_principal||false),usar_para_envios:checkbox(row?.usar_para_envios||false),activo:checkbox(row?.activo??true)};
  const host=element('div',{className:'editor-grid'},[field('Centro',c.centro),field('Contacto',c.nombre),field('Cargo',c.cargo),field('Teléfono',c.telefono),field('Extensión',c.extension),field('Correo',c.correo),field('Observaciones',c.observaciones),field('Principal',c.es_principal),field('Usar para envíos',c.usar_para_envios),field('Activo',c.activo)]);
  if(canEdit){const b=element('button',{className:'button primary compact',type:'button',text:row?.id?'Guardar contacto':'Crear contacto'});b.addEventListener('click',async()=>{b.disabled=true;if(await saveContact(row,tallerId,c,message))await onSaved();b.disabled=false;});host.append(b);}return host;
}

function workshopCard(row,data,canEdit,message,onSaved){
  const centers=data.centros.filter(x=>x.taller_id===row.id);const contacts=data.contactos.filter(x=>x.taller_id===row.id);
  const card=element('article',{className:'card'},[
    element('div',{className:'module-heading'},[element('div',{},[element('h3',{text:row.nombre}),element('p',{className:'muted',text:row.observaciones||'Sin observaciones'})]),element('span',{className:'badge',text:row.activo?'ACTIVO':'BAJA'})]),
    element('div',{className:'detail-grid'},[detail('Centros activos',centers.filter(x=>x.activo).length),detail('Contactos activos',contacts.filter(x=>x.activo).length)])
  ]);
  if(canEdit){const edit=element('details',{},[element('summary',{text:'Editar taller'}),workshopForm(row,canEdit,message,onSaved)]);card.append(edit);}
  const ch=element('details',{},[element('summary',{text:`Centros · ${centers.length}`})]);
  centers.forEach(c=>{const cc=element('div',{className:'card'},[element('strong',{text:c.nombre}),element('div',{className:'detail-grid'},[detail('Dirección',c.direccion||'—'),detail('Población',c.poblacion||'—'),detail('CP',c.codigo_postal||'—'),detail('Plus Code',c.plus_code||'—'),detail('Estado',c.activo?'Activo':'Baja')])]);if(canEdit){const e=element('details',{},[element('summary',{text:'Editar centro'}),centerForm(c,row.id,canEdit,message,onSaved)]);cc.append(e);}ch.append(cc);});
  if(canEdit){const add=element('details',{},[element('summary',{text:'+ Añadir centro'}),centerForm(null,row.id,canEdit,message,onSaved)]);ch.append(add);}card.append(ch);
  const kh=element('details',{},[element('summary',{text:`Contactos · ${contacts.length}`})]);
  contacts.forEach(k=>{const centro=centers.find(c=>c.id===k.centro_taller_id);const kc=element('div',{className:'card'},[element('strong',{text:k.nombre||k.telefono}),element('div',{className:'detail-grid'},[detail('Centro',centro?.nombre||'General'),detail('Cargo',k.cargo||'—'),detail('Teléfono',k.telefono),detail('Extensión',k.extension||'—'),detail('Correo',k.correo||'—'),detail('Principal',k.es_principal?'Sí':'No'),detail('Envíos',k.usar_para_envios?'Sí':'No'),detail('Estado',k.activo?'Activo':'Baja')])]);if(canEdit){kc.append(element('details',{},[element('summary',{text:'Editar contacto'}),contactForm(k,row.id,centers,canEdit,message,onSaved)]));}kh.append(kc);});
  if(canEdit)kh.append(element('details',{},[element('summary',{text:'+ Añadir contacto'}),contactForm(null,row.id,centers,canEdit,message,onSaved)]));card.append(kh);
  return card;
}

export async function renderTalleres(container,canEdit=false){
  clear(container);const message=element('p',{className:'status-message'});container.append(element('div',{className:'module-heading'},[element('div',{},[element('h2',{text:'Talleres'}),element('p',{className:'muted',text:'Maestro único de talleres, centros y contactos usado por Hotel y las T.'})]),element('span',{className:'badge',text:canEdit?'Edición autorizada':'Solo lectura'})]),message);
  let data;try{data=await loadAll();}catch(error){container.append(notice(error.message,'danger'));return;}
  const active=data.talleres.filter(x=>x.activo);container.append(element('div',{className:'summary-grid'},[element('div',{className:'metric'},[element('strong',{text:data.talleres.length}),element('span',{className:'muted',text:'Talleres registrados'})]),element('div',{className:'metric'},[element('strong',{text:active.length}),element('span',{className:'muted',text:'Talleres activos'})]),element('div',{className:'metric'},[element('strong',{text:data.centros.filter(x=>x.activo).length}),element('span',{className:'muted',text:'Centros activos'})]),element('div',{className:'metric'},[element('strong',{text:data.contactos.filter(x=>x.activo).length}),element('span',{className:'muted',text:'Contactos activos'})])]));
  const rerender=()=>renderTalleres(container,canEdit);
  if(canEdit)container.append(element('details',{},[element('summary',{text:'+ Nuevo taller'}),workshopForm(null,canEdit,message,rerender)]));
  const host=element('div',{className:'hotel-list'});active.forEach(row=>host.append(workshopCard(row,data,canEdit,message,rerender)));container.append(host);
  const inactive=data.talleres.filter(x=>!x.activo);if(inactive.length){const off=element('details',{},[element('summary',{text:`Talleres de baja · ${inactive.length}`})]);inactive.forEach(row=>off.append(workshopCard(row,data,canEdit,message,rerender)));container.append(off);}
}
