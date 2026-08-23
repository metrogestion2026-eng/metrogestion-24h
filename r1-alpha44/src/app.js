import '../../r1-alpha43/src/app.js';
import { supabase } from '../../r1-alpha17/src/supabase.js';

const VERSION='r1.0.0-alpha.44';
const versionNode=document.querySelector('#app-version');
if(versionNode)versionNode.textContent=VERSION;

const nav=document.querySelector('#module-nav');
const content=document.querySelector('#module-content');

function ensureStyle(){
  if(document.querySelector('#alpha44-style'))return;
  const s=document.createElement('style');
  s.id='alpha44-style';
  s.textContent=`
  #a43-incidences-button{display:none!important}
  .a44-view{display:grid;gap:14px}
  .a44-head{display:flex;justify-content:space-between;gap:10px;align-items:flex-start;flex-wrap:wrap}
  .a44-list{display:grid;gap:10px}
  .a44-card{border:1px solid #dbe5ec;border-radius:12px;background:#fff;overflow:hidden}
  .a44-card summary{cursor:pointer;list-style:none;padding:12px 14px;display:grid;gap:4px}
  .a44-card summary::-webkit-details-marker{display:none}
  .a44-topline{display:flex;justify-content:space-between;gap:10px;align-items:center;flex-wrap:wrap}
  .a44-title{font-weight:800}
  .a44-meta{font-size:.9rem;color:#526273}
  .a44-state{padding:3px 8px;border-radius:999px;background:#f1f5f9;font-size:.8rem;font-weight:700}
  .a44-state.open{background:#fff7ed;color:#9a3412}.a44-state.closed{background:#f0fdf4;color:#166534}
  .a44-detail{padding:0 14px 14px;display:grid;gap:8px}
  .a44-row{display:grid;grid-template-columns:175px 1fr;gap:10px;padding:7px 0;border-top:1px solid #edf2f7}
  .a44-empty{padding:18px;border:1px dashed #cbd5e1;border-radius:12px;text-align:center;color:#64748b}
  @media(max-width:700px){.a44-row{grid-template-columns:1fr}.a44-head .button{width:100%}}
  `;
  document.head.append(s);
}
ensureStyle();

function fmtDateTime(v){
  if(!v)return '—';
  const d=new Date(v);
  if(Number.isNaN(d.getTime()))return String(v);
  return d.toLocaleString('es-ES',{dateStyle:'short',timeStyle:'short'});
}
function fmtTime(v){return v?String(v).slice(0,5):'—';}
function makeRow(label,value){
  const row=document.createElement('div');row.className='a44-row';
  const k=document.createElement('strong');k.textContent=label;
  const val=document.createElement('span');val.textContent=value||'—';
  row.append(k,val);return row;
}
function creatorLabel(user,id){
  if(!user)return id||'—';
  const name=[user.nombre,user.apellidos].filter(Boolean).join(' ').trim();
  return name?`${name} · ${user.correo||''}`:(user.correo||id||'—');
}

async function currentProfile(){
  const {data:{user}}=await supabase.auth.getUser();
  if(!user)return null;
  const {data}=await supabase.from('usuarios').select('id,nombre,apellidos,correo,tipo_usuario').eq('id',user.id).maybeSingle();
  return data||{id:user.id,correo:user.email,tipo_usuario:''};
}

async function renderIncidences(){
  content.replaceChildren();
  const profile=await currentProfile();
  const admin=profile?.tipo_usuario==='administrador_principal';

  const view=document.createElement('section');view.className='a44-view';
  const head=document.createElement('div');head.className='a44-head';
  const copy=document.createElement('div');
  const eyebrow=document.createElement('p');eyebrow.className='eyebrow';eyebrow.textContent='Activar 24H';
  const h2=document.createElement('h2');h2.textContent=admin?'Todas las incidencias 24H':'Mis incidencias 24H';
  const note=document.createElement('div');note.className='muted';note.textContent=admin?'Vista global de activaciones 24H de todos los usuarios.':'Solo se muestran las activaciones creadas por tu usuario.';
  copy.append(eyebrow,h2,note);
  const back=document.createElement('button');back.type='button';back.className='button secondary';back.textContent='← Activar 24H';
  back.onclick=()=>nav?.querySelector('[data-alpha34-24h]')?.click();
  head.append(copy,back);view.append(head);
  const status=document.createElement('div');status.className='h24-status';status.textContent='Cargando incidencias…';view.append(status);
  content.append(view);

  const {data:rows,error}=await supabase.from('activaciones_24h')
    .select('id,dfm,matricula,marca,modelo,km_actual,conductor,ubicacion_referencia,averia,codigo_alarma,color_alarma,semirremolque,carga,numero_caso,hora_activacion,eta_tecnico,proveedor,diagnostico,resultado,estado,creado_por,creado_en,actualizado_en')
    .order('creado_en',{ascending:false});
  if(error){status.className='h24-status danger';status.textContent='No se pudieron cargar las incidencias: '+error.message;return;}

  const creators=new Map();
  if(admin){
    const ids=[...new Set((rows||[]).map(r=>r.creado_por).filter(Boolean))];
    if(ids.length){
      const {data:users}=await supabase.from('usuarios').select('id,nombre,apellidos,correo').in('id',ids);
      (users||[]).forEach(u=>creators.set(u.id,u));
    }
  }

  status.remove();
  const list=document.createElement('div');list.className='a44-list';
  if(!(rows||[]).length){
    const empty=document.createElement('div');empty.className='a44-empty';
    empty.textContent=admin?'No hay activaciones 24H registradas.':'Todavía no tienes activaciones 24H registradas.';
    list.append(empty);
  }
  (rows||[]).forEach(r=>{
    const card=document.createElement('details');card.className='a44-card';
    const summary=document.createElement('summary');
    const top=document.createElement('div');top.className='a44-topline';
    const title=document.createElement('span');title.className='a44-title';
    title.textContent=`DFM ${r.dfm||'—'} · ${r.matricula||'—'}${r.numero_caso?' · Caso '+r.numero_caso:''}`;
    const state=document.createElement('span');state.className='a44-state '+(r.estado==='cerrada'?'closed':'open');state.textContent=r.estado==='cerrada'?'CERRADA':'ABIERTA';
    top.append(title,state);
    const meta=document.createElement('div');meta.className='a44-meta';meta.textContent=`${fmtDateTime(r.creado_en)} · ${r.resultado||'seguimiento abierto'}`;
    summary.append(top,meta);card.append(summary);
    const detail=document.createElement('div');detail.className='a44-detail';
    if(admin)detail.append(makeRow('Creada por',creatorLabel(creators.get(r.creado_por),r.creado_por)));
    detail.append(
      makeRow('Vehículo',[r.marca,r.modelo].filter(Boolean).join(' ')||'—'),
      makeRow('Kilómetros',r.km_actual?Number(r.km_actual).toLocaleString('es-ES')+' km':'—'),
      makeRow('Conductor',r.conductor),
      makeRow('Ubicación',r.ubicacion_referencia),
      makeRow('Avería',r.averia),
      makeRow('Alarma',[r.codigo_alarma,r.color_alarma].filter(Boolean).join(' · ')),
      makeRow('Semirremolque',r.semirremolque),
      makeRow('Carga',r.carga),
      makeRow('N.º asistencia / caso',r.numero_caso),
      makeRow('Hora activación',fmtTime(r.hora_activacion)),
      makeRow('ETA técnico',fmtTime(r.eta_tecnico)),
      makeRow('Proveedor / taller',r.proveedor),
      makeRow('Diagnóstico',r.diagnostico),
      makeRow('Resultado',r.resultado),
      makeRow('Última actualización',fmtDateTime(r.actualizado_en))
    );
    card.append(detail);list.append(card);
  });
  view.append(list);
}

function ensureNavButton(){
  if(!nav||nav.querySelector('#a44-incidences-tab'))return;
  const activate=nav.querySelector('[data-alpha34-24h]');
  if(!activate)return;
  const button=document.createElement('button');
  button.id='a44-incidences-tab';
  button.type='button';
  button.className=activate.className||'button secondary';
  button.textContent='📋 Incidencias 24H';
  button.onclick=()=>renderIncidences();
  activate.after(button);
}

const observer=new MutationObserver(()=>ensureNavButton());
if(nav)observer.observe(nav,{childList:true,subtree:true});
ensureNavButton();
