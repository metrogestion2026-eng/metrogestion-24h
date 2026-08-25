import { supabase } from '../../r1-alpha17/src/supabase.js';

export const HOTEL_DOCUMENT_BUCKET = 'hotel-documentos';
export const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;
export const ALLOWED_MIME = new Set([
  'application/pdf','image/jpeg','image/png','image/webp','image/heic','image/heif',
]);
export const EXTENSION_MIME = Object.freeze({
  pdf:'application/pdf',jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',
  webp:'image/webp',heic:'image/heic',heif:'image/heif',
});
export const DOCUMENT_SELECT = [
  'id','registro_hotel_id','etapa_hotel_id','grupo_etapa_id','seguimiento_id','categoria',
  'nombre_original','nombre_mostrado','storage_bucket','storage_path','mime_type','tamano_bytes',
  'descripcion','cancelado','motivo_cancelacion','cancelado_en','cancelado_por','creado_por',
  'creado_en','version','actualizado_en',
].join(',');

const signedUrlCache = new Map();

export function el(tag,text=null,className=''){
  const node=document.createElement(tag);
  if(text!==null&&text!==undefined)node.textContent=String(text);
  if(className)node.className=className;
  return node;
}
export function formatDateTime(value){
  if(!value)return'—';const date=new Date(value);
  return Number.isNaN(date.getTime())?String(value):date.toLocaleString('es-ES',{dateStyle:'short',timeStyle:'short'});
}
export function formatBytes(value){
  const bytes=Number(value||0);if(!Number.isFinite(bytes)||bytes<=0)return'—';
  if(bytes<1024)return`${bytes} B`;
  if(bytes<1024**2)return`${(bytes/1024).toLocaleString('es-ES',{maximumFractionDigits:1})} KB`;
  return`${(bytes/1024**2).toLocaleString('es-ES',{maximumFractionDigits:1})} MB`;
}
export function categoryLabel(doc){return doc.mime_type==='application/pdf'||doc.categoria==='pdf'?'PDF':'Foto';}
export function isImage(doc){return String(doc?.mime_type||'').startsWith('image/')||doc?.categoria==='foto';}
export function isPreviewableImage(doc){return['image/jpeg','image/png','image/webp'].includes(String(doc?.mime_type||'').toLowerCase());}
export function normaliseMime(file){
  const supplied=String(file?.type||'').toLowerCase();if(ALLOWED_MIME.has(supplied))return supplied;
  const extension=String(file?.name||'').split('.').pop()?.toLowerCase()||'';return EXTENSION_MIME[extension]||'';
}
export function safeFilename(name){
  const original=String(name||'archivo');const dot=original.lastIndexOf('.');
  const extension=dot>0?original.slice(dot+1).toLowerCase().replace(/[^a-z0-9]/g,''):'';
  const base=(dot>0?original.slice(0,dot):original).normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .replace(/[^a-zA-Z0-9_-]+/g,'-').replace(/^-+|-+$/g,'').slice(0,90)||'archivo';
  return extension?`${base}.${extension}`:base;
}
export function randomId(){return globalThis.crypto?.randomUUID?.()||`${Date.now().toString(36)}-${Math.random().toString(36).slice(2,10)}`;}

export function modal(title){
  const overlay=el('div',null,'a53-modal');const card=el('section',null,'a53-modal-card');
  const head=el('div',null,'a53-modal-head');const heading=el('h3',title);
  const close=el('button','Cerrar','button secondary compact');close.type='button';
  head.append(heading,close);card.append(head);overlay.append(card);document.body.append(overlay);
  let dismissHandler=null,removed=false;
  const remove=dismissed=>{if(removed)return;removed=true;overlay.remove();if(dismissed&&typeof dismissHandler==='function')dismissHandler();};
  close.addEventListener('click',()=>remove(true));
  overlay.addEventListener('click',event=>{if(event.target===overlay)remove(true);});
  return{overlay,card,destroy:()=>remove(false),onDismiss:handler=>{dismissHandler=handler;}};
}
export function labelControl(label,control,wide=false){
  const wrapper=el('label',null,wide?'a53-field wide':'a53-field');wrapper.append(el('span',label),control);return wrapper;
}

export async function signedUrl(doc,{download=false,expires=900}={}){
  const bucket=doc.storage_bucket||HOTEL_DOCUMENT_BUCKET;
  const cacheKey=`${bucket}|${doc.storage_path}|${download?'download':'view'}`;
  const cached=signedUrlCache.get(cacheKey);if(cached&&cached.expiresAt>Date.now()+15000)return cached.url;
  const options=download?{download:doc.nombre_original||doc.nombre_mostrado||'archivo'}:undefined;
  const{data,error}=await supabase.storage.from(bucket).createSignedUrl(doc.storage_path,expires,options);
  if(error||!data?.signedUrl)throw new Error(error?.message||'No se pudo crear el enlace privado.');
  signedUrlCache.set(cacheKey,{url:data.signedUrl,expiresAt:Date.now()+expires*1000});return data.signedUrl;
}
export async function openStoredDocument(doc){
  if(isPreviewableImage(doc)){
    const viewer=modal(doc.nombre_mostrado||doc.nombre_original||'Fotografía');
    const status=el('div','Preparando fotografía…','a53-doc-status');const image=el('img',null,'a53-image-preview');
    image.alt=doc.nombre_mostrado||doc.nombre_original||'Fotografía de la T';image.hidden=true;
    const details=el('div',null,'a53-doc-preview-meta');
    details.append(el('strong',categoryLabel(doc)),el('span',`${formatBytes(doc.tamano_bytes)} · ${formatDateTime(doc.creado_en)}`));
    if(doc.descripcion)details.append(el('p',doc.descripcion));viewer.card.append(status,image,details);
    try{image.src=await signedUrl(doc);image.hidden=false;status.remove();}
    catch(error){status.className='a53-doc-status danger';status.textContent=error?.message||'No se pudo abrir la fotografía.';}return;
  }
  const tab=window.open('','_blank');if(tab){tab.opener=null;tab.document.title='Abriendo documento…';tab.document.body.textContent='Preparando documento privado…';}
  try{const url=await signedUrl(doc);if(tab)tab.location.replace(url);else window.location.href=url;}
  catch(error){if(tab)tab.close();window.alert(error?.message||'No se pudo abrir el documento.');}
}
export async function downloadStoredDocument(doc){
  try{const url=await signedUrl(doc,{download:true});const link=document.createElement('a');
    link.href=url;link.download=doc.nombre_original||doc.nombre_mostrado||'archivo';link.target='_blank';link.rel='noopener';
    document.body.append(link);link.click();link.remove();}
  catch(error){window.alert(error?.message||'No se pudo descargar el archivo.');}
}
export async function loadDocumentsForGroups(groupIds){
  const ids=[...new Set((groupIds||[]).filter(Boolean))];const map=new Map(ids.map(id=>[id,[]]));if(!ids.length)return map;
  const{data,error}=await supabase.from('documentos_gestion').select(DOCUMENT_SELECT).in('grupo_etapa_id',ids).order('creado_en',{ascending:false});
  if(error)throw error;(data||[]).forEach(doc=>{const list=map.get(doc.grupo_etapa_id)||[];list.push(doc);map.set(doc.grupo_etapa_id,list);});return map;
}
export async function loadAllDocuments({limit=500}={}){
  const{data,error}=await supabase.from('documentos_gestion').select(DOCUMENT_SELECT).order('creado_en',{ascending:false}).limit(limit);
  if(error)throw error;return data||[];
}
