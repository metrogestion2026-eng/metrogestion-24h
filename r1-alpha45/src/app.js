import '../../r1-alpha43/src/app.js';
import { supabase } from '../../r1-alpha17/src/supabase.js';

const VERSION='r1.0.0-alpha.45';
const versionNode=document.querySelector('#app-version');
if(versionNode)versionNode.textContent=VERSION;

const content=document.querySelector('#module-content');

function ensureStyle(){
  if(document.querySelector('#alpha45-style'))return;
  const s=document.createElement('style');
  s.id='alpha45-style';
  s.textContent=`
  #a43-incidences-button{display:none!important}
  .a45-subnav{display:flex;gap:8px;flex-wrap:wrap;margin:2px 0 12px}
  .a45-subnav .button.active{background:#075985;color:#fff;border-color:#075985}
  .a45-inc-view{display:grid;gap:12px}
  .a45-list{display:grid;gap:10px}
  .a45-card{border:1px solid #dbe5ec;border-radius:12px;background:#fff;overflow:hidden}
  .a45-card summary{cursor:pointer;list-style:none;padding:12px 14px;display:grid;gap:4px}
  .a45-card summary::-webkit-details-marker{display:none}
  .a45-top{display:flex;justify-content:space-between;gap:10px;align-items:center;flex-wrap:wrap}
  .a45-title{font-weight:800}.a45-meta{font-size:.9rem;color:#526273}
  .a45-state{padding:3px 8px;border-radius:999px;background:#f1f5f9;font-size:.8rem;font-weight:700}
  .a45-state.open{background:#fff7ed;color:#9a3412}.a45-state.closed{background:#f0fdf4;color:#166534}
  .a45-detail{padding:0 14px 14px;display:grid;gap:8px}
  .a45-row{display:grid;grid-template-columns:175px 1fr;gap:10px;padding:7px 0;border-top:1px solid #edf2f7}
  .a45-empty{padding:18px;border:1px dashed #cbd5e1;border-radius:12px;text-align:center;color:#64748b}
  @media(max-width:700px){.a45-row{grid-template-columns:1fr}.a45-subnav .button{flex:1 1 140px}}
  `;
  document.head.append(s);
}
ensureStyle();

function fmtDateTime(v){if(!v)return'—';const d=new Date(v);return Number.isNaN(d.getTime())?String(v):d.toLocaleString('es-ES',{dateStyle:'short',timeStyle:'short'});}
function fmtTime(v){return v?String(v).slice(0,5):'—';}
function row(label,value){const r=document.createElement('div');r.className='a45-row';const k=document.createElement('strong');k.textContent=label;const v=document.createElement('span');v.textContent=value||'—';r.append(k,v);return r;}
function creatorLabel(user,id){if(!user)return id||'—';const name=[user.nombre,user.apellidos].filter(Boolean).join(' ').trim();return name?`${name} · ${user.correo||''}`:(user.correo||id||'—');}

async function getProfile(){
  const {data:{user}}=await supabase.auth.getUser();
  if(!user)return null;
  const {data}=await supabase.from('usuarios').select('id,nombre,apellidos,correo,tipo_usuario').eq('id',user.id).maybeSingle();
  return data||{id:user.id,correo:user.email,tipo_usuario:''};
}

async function renderIncidences(shell,host){
  const profile=await getProfile();
  const admin=profile?.tipo_usuario==='administrador_principal';
  host.replaceChildren();
  const view=document.createElement('section');view.className='a45-inc-view';
  const title=document.createElement('div');
  const h3=document.createElement('h3');h3.textContent=admin?'Todas las incidencias 24H':'Mis incidencias 24H';
  const note=document.createElement('div');note.className='muted';note.textContent=admin?'Puedes ver las activaciones de todos los usuarios.':'Solo aparecen las activaciones creadas por tu usuario.';
  title.append(h3,note);view.append(title);
  const status=document.createElement('div');status.className='h24-status';status.textContent='Cargando incidencias…';view.append(status);host.append(view);

  const {data:rows,error}=await supabase.from('activaciones_24h')
    .select('id,dfm,matricula,marca,modelo,km_actual,conductor,ubicacion_referencia,averia,codigo_alarma,color_alarma,semirremolque,carga,numero_caso,hora_activacion,eta_tecnico,proveedor,diagnostico,resultado,estado,creado_por,creado_en,actualizado_en')
    .order('creado_en',{ascending:false});
  if(error){status.className='h24-status danger';status.textContent='No se pudieron cargar las incidencias: '+error.message;return;}

  const creators=new Map();
  if(admin){const ids=[...new Set((rows||[]).map(r=>r.creado_por).filter(Boolean))];if(ids.length){const {data:users}=await supabase.from('usuarios').select('id,nombre,apellidos,correo').in('id',ids);(users||[]).forEach(u=>creators.set(u.id,u));}}

  status.remove();
  const list=document.createElement('div');list.className='a45-list';
  if(!(rows||[]).length){const empty=document.createElement('div');empty.className='a45-empty';empty.textContent=admin?'No hay activaciones 24H registradas.':'Todavía no tienes activaciones 24H registradas.';list.append(empty);}
  (rows||[]).forEach(r=>{
    const card=document.createElement('details');card.className='a45-card';
    const summary=document.createElement('summary');const top=document.createElement('div');top.className='a45-top';
    const t=document.createElement('span');t.className='a45-title';t.textContent=`DFM ${r.dfm||'—'} · ${r.matricula||'—'}${r.numero_caso?' · Caso '+r.numero_caso:''}`;
    const st=document.createElement('span');st.className='a45-state '+(r.estado==='cerrada'?'closed':'open');st.textContent=r.estado==='cerrada'?'CERRADA':'ABIERTA';top.append(t,st);
    const meta=document.createElement('div');meta.className='a45-meta';meta.textContent=`${fmtDateTime(r.creado_en)} · ${r.resultado||'seguimiento abierto'}`;summary.append(top,meta);card.append(summary);
    const detail=document.createElement('div');detail.className='a45-detail';
    if(admin)detail.append(row('Creada por',creatorLabel(creators.get(r.creado_por),r.creado_por)));
    detail.append(row('Vehículo',[r.marca,r.modelo].filter(Boolean).join(' ')||'—'),row('Kilómetros',r.km_actual?Number(r.km_actual).toLocaleString('es-ES')+' km':'—'),row('Conductor',r.conductor),row('Ubicación',r.ubicacion_referencia),row('Avería',r.averia),row('Alarma',[r.codigo_alarma,r.color_alarma].filter(Boolean).join(' · ')),row('Semirremolque',r.semirremolque),row('Carga',r.carga),row('N.º asistencia / caso',r.numero_caso),row('Hora activación',fmtTime(r.hora_activacion)),row('ETA técnico',fmtTime(r.eta_tecnico)),row('Proveedor / taller',r.proveedor),row('Diagnóstico',r.diagnostico),row('Resultado',r.resultado),row('Última actualización',fmtDateTime(r.actualizado_en)));
    card.append(detail);list.append(card);
  });
  view.append(list);
}

function patch24H(){
  const shell=content?.querySelector('.h24-shell');
  if(!shell||shell.querySelector('#a45-subnav'))return;
  const head=shell.querySelector('.h24-head');
  if(!head)return;
  const subnav=document.createElement('div');subnav.id='a45-subnav';subnav.className='a45-subnav';
  const activation=document.createElement('button');activation.type='button';activation.className='button secondary compact active';activation.textContent='🚨 Activación';
  const incidents=document.createElement('button');incidents.type='button';incidents.className='button secondary compact';incidents.textContent='📋 Incidencias';
  const original=[...shell.children].filter(n=>n!==head);
  const host=document.createElement('div');host.id='a45-host';
  original.forEach(n=>host.append(n));
  head.after(subnav,host);subnav.append(activation,incidents);
  activation.onclick=()=>{activation.classList.add('active');incidents.classList.remove('active');host.replaceChildren(...original);};
  incidents.onclick=()=>{incidents.classList.add('active');activation.classList.remove('active');renderIncidences(shell,host);};
}

const observer=new MutationObserver(()=>patch24H());
if(content)observer.observe(content,{childList:true,subtree:true});
patch24H();
