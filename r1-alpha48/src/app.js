import '../../r1-alpha43/src/app.js';
import { supabase } from '../../r1-alpha17/src/supabase.js';

const VERSION='r1.0.0-alpha.48';
const versionNode=document.querySelector('#app-version');
if(versionNode)versionNode.textContent=VERSION;

const content=document.querySelector('#module-content');
const nav=document.querySelector('#module-nav');

function ensureStyle(){
  if(document.querySelector('#alpha48-style'))return;
  const s=document.createElement('style');
  s.id='alpha48-style';
  s.textContent=`
    #a43-incidences-button{display:none!important}
    .a48-tabs{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0 14px;padding-bottom:10px;border-bottom:1px solid #dbe5ec}
    .a48-tabs .active{background:#075985;color:#fff;border-color:#075985}
    .a48-inc-view{display:grid;gap:14px}
    .a48-list{display:grid;gap:10px}
    .a48-card{border:1px solid #dbe5ec;border-radius:12px;background:#fff;overflow:hidden}
    .a48-card summary{cursor:pointer;list-style:none;padding:12px 14px;display:grid;gap:4px}
    .a48-card summary::-webkit-details-marker{display:none}
    .a48-top{display:flex;justify-content:space-between;gap:10px;align-items:center;flex-wrap:wrap}
    .a48-title{font-weight:800}
    .a48-meta{font-size:.9rem;color:#526273}
    .a48-state{padding:3px 8px;border-radius:999px;background:#fff7ed;color:#9a3412;font-size:.8rem;font-weight:700}
    .a48-state.closed{background:#f0fdf4;color:#166534}
    .a48-detail{padding:0 14px 14px;display:grid;gap:8px}
    .a48-row{display:grid;grid-template-columns:175px 1fr;gap:10px;padding:7px 0;border-top:1px solid #edf2f7}
    .a48-empty{padding:18px;border:1px dashed #cbd5e1;border-radius:12px;text-align:center;color:#64748b}
    @media(max-width:700px){.a48-tabs .button{flex:1 1 145px}.a48-row{grid-template-columns:1fr}}
  `;
  document.head.append(s);
}
ensureStyle();

function fmtDateTime(v){if(!v)return'—';const d=new Date(v);return Number.isNaN(d.getTime())?String(v):d.toLocaleString('es-ES',{dateStyle:'short',timeStyle:'short'});}
function fmtTime(v){return v?String(v).slice(0,5):'—';}
function row(label,value){const r=document.createElement('div');r.className='a48-row';const k=document.createElement('strong');k.textContent=label;const v=document.createElement('span');v.textContent=value||'—';r.append(k,v);return r;}

async function getProfile(){
  const {data:{user}}=await supabase.auth.getUser();
  if(!user)return null;
  const {data}=await supabase.from('usuarios').select('id,nombre,apellidos,correo,tipo_usuario').eq('id',user.id).maybeSingle();
  return data||{id:user.id,correo:user.email,tipo_usuario:''};
}

function makeTabs(active='activation'){
  const tabs=document.createElement('div');tabs.className='a48-tabs';tabs.dataset.alpha48Tabs='1';
  const activation=document.createElement('button');activation.type='button';activation.className='button secondary compact'+(active==='activation'?' active':'');activation.textContent='🚨 Activación';
  const incidences=document.createElement('button');incidences.type='button';incidences.className='button secondary compact'+(active==='incidences'?' active':'');incidences.textContent='📋 Incidencias';
  activation.onclick=()=>nav?.querySelector('[data-alpha34-24h]')?.click();
  incidences.onclick=()=>renderIncidences();
  tabs.append(activation,incidences);return tabs;
}

function installTabs(){
  if(!content)return;
  const start=content.querySelector('.a36-start');
  if(start&&!start.querySelector('[data-alpha48-tabs]')){
    const header=start.firstElementChild;
    if(header)header.append(makeTabs('activation'));
  }
  const shell=content.querySelector('.h24-shell');
  if(shell&&!shell.querySelector('[data-alpha48-tabs]')){
    const head=shell.querySelector('.h24-head');
    if(head)head.after(makeTabs('activation'));
  }
}

async function renderIncidences(){
  if(!content)return;
  content.replaceChildren();
  const profile=await getProfile();
  const admin=profile?.tipo_usuario==='administrador_principal';
  const view=document.createElement('section');view.className='a48-inc-view';
  const head=document.createElement('div');
  const eyebrow=document.createElement('p');eyebrow.className='eyebrow';eyebrow.textContent='Asistencia en carretera';
  const title=document.createElement('h2');title.textContent='Activar 24H';
  head.append(eyebrow,title,makeTabs('incidences'));
  const subtitle=document.createElement('h3');subtitle.textContent=admin?'Todas las incidencias 24H':'Mis incidencias 24H';
  const note=document.createElement('div');note.className='muted';note.textContent=admin?'Vista global de las activaciones creadas por todos los usuarios.':'Solo se muestran las activaciones creadas por tu usuario.';
  const loading=document.createElement('div');loading.className='h24-status';loading.textContent='Cargando incidencias…';
  view.append(head,subtitle,note,loading);content.append(view);

  const {data:rows,error}=await supabase.from('activaciones_24h')
    .select('id,dfm,matricula,marca,modelo,km_actual,conductor,ubicacion_referencia,averia,codigo_alarma,color_alarma,semirremolque,carga,numero_caso,hora_activacion,eta_tecnico,proveedor,diagnostico,resultado,estado,creado_por,creado_en,actualizado_en')
    .order('creado_en',{ascending:false});
  if(error){loading.className='h24-status danger';loading.textContent='No se pudieron cargar las incidencias: '+error.message;return;}

  const creators=new Map();
  if(admin){
    const ids=[...new Set((rows||[]).map(r=>r.creado_por).filter(Boolean))];
    if(ids.length){
      const {data:users}=await supabase.from('usuarios').select('id,nombre,apellidos,correo').in('id',ids);
      (users||[]).forEach(u=>creators.set(u.id,u));
    }
  }

  loading.remove();
  const list=document.createElement('div');list.className='a48-list';
  if(!(rows||[]).length){const empty=document.createElement('div');empty.className='a48-empty';empty.textContent=admin?'No hay activaciones 24H registradas.':'Todavía no tienes activaciones 24H registradas.';list.append(empty);}
  (rows||[]).forEach(r=>{
    const card=document.createElement('details');card.className='a48-card';
    const summary=document.createElement('summary');
    const top=document.createElement('div');top.className='a48-top';
    const t=document.createElement('span');t.className='a48-title';t.textContent=`DFM ${r.dfm||'—'} · ${r.matricula||'—'}${r.numero_caso?' · Caso '+r.numero_caso:''}`;
    const st=document.createElement('span');st.className='a48-state '+(r.estado==='cerrada'?'closed':'');st.textContent=r.estado==='cerrada'?'CERRADA':'ABIERTA';
    top.append(t,st);
    const meta=document.createElement('div');meta.className='a48-meta';meta.textContent=`${fmtDateTime(r.creado_en)} · ${r.resultado||'seguimiento abierto'}`;
    summary.append(top,meta);card.append(summary);
    const detail=document.createElement('div');detail.className='a48-detail';
    if(admin){const u=creators.get(r.creado_por);const name=u?([u.nombre,u.apellidos].filter(Boolean).join(' ').trim()||u.correo):r.creado_por;detail.append(row('Creada por',name));}
    detail.append(
      row('Vehículo',[r.marca,r.modelo].filter(Boolean).join(' ')),
      row('Kilómetros',r.km_actual?Number(r.km_actual).toLocaleString('es-ES')+' km':'—'),
      row('Conductor',r.conductor),row('Ubicación',r.ubicacion_referencia),row('Avería',r.averia),
      row('Alarma',[r.codigo_alarma,r.color_alarma].filter(Boolean).join(' · ')),row('Semirremolque',r.semirremolque),row('Carga',r.carga),
      row('N.º asistencia / caso',r.numero_caso),row('Hora activación',fmtTime(r.hora_activacion)),row('ETA técnico',fmtTime(r.eta_tecnico)),
      row('Proveedor / taller',r.proveedor),row('Diagnóstico',r.diagnostico),row('Resultado',r.resultado),row('Última actualización',fmtDateTime(r.actualizado_en))
    );
    card.append(detail);list.append(card);
  });
  view.append(list);
}

const observer=new MutationObserver(()=>installTabs());
if(content)observer.observe(content,{childList:true,subtree:true});
installTabs();
