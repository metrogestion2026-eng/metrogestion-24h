import '../../r1-alpha42/src/app.js';
import { supabase } from '../../r1-alpha17/src/supabase.js';

const VERSION='r1.0.0-alpha.43';
const versionNode=document.querySelector('#app-version');
if(versionNode)versionNode.textContent=VERSION;

const content=document.querySelector('#module-content');

function ensureStyle(){
  if(document.querySelector('#alpha43-style'))return;
  const s=document.createElement('style');
  s.id='alpha43-style';
  s.textContent=`
  .a43-inc-btn{min-height:42px}
  .a43-view{display:grid;gap:14px}
  .a43-head{display:flex;justify-content:space-between;gap:10px;align-items:flex-start;flex-wrap:wrap}
  .a43-list{display:grid;gap:10px}
  .a43-card{border:1px solid #dbe5ec;border-radius:12px;background:#fff;overflow:hidden}
  .a43-card summary{cursor:pointer;list-style:none;padding:12px 14px;display:grid;gap:4px}
  .a43-card summary::-webkit-details-marker{display:none}
  .a43-topline{display:flex;justify-content:space-between;gap:10px;align-items:center;flex-wrap:wrap}
  .a43-title{font-weight:800}
  .a43-meta{font-size:.9rem;color:#526273}
  .a43-state{padding:3px 8px;border-radius:999px;background:#f1f5f9;font-size:.8rem;font-weight:700}
  .a43-state.open{background:#fff7ed;color:#9a3412}.a43-state.closed{background:#f0fdf4;color:#166534}
  .a43-detail{padding:0 14px 14px;display:grid;gap:8px}
  .a43-row{display:grid;grid-template-columns:170px 1fr;gap:10px;padding:7px 0;border-top:1px solid #edf2f7}
  .a43-empty{padding:18px;border:1px dashed #cbd5e1;border-radius:12px;text-align:center;color:#64748b}
  @media(max-width:700px){.a43-row{grid-template-columns:1fr}.a43-head .button{width:100%}}
  `;
  document.head.append(s);
}
ensureStyle();

function isPrimaryAdmin(){
  return (document.querySelector('#session-role')?.textContent||'').trim()==='Administrador principal';
}
function fmtDateTime(v){
  if(!v)return '—';
  const d=new Date(v);
  if(Number.isNaN(d.getTime()))return String(v);
  return d.toLocaleString('es-ES',{dateStyle:'short',timeStyle:'short'});
}
function fmtTime(v){return v?String(v).slice(0,5):'—';}
function labelCreator(user,id){
  if(!user)return id||'—';
  const name=[user.nombre,user.apellidos].filter(Boolean).join(' ').trim();
  return name?`${name} · ${user.correo||''}`:(user.correo||id||'—');
}
function makeRow(label,value){
  const row=document.createElement('div');row.className='a43-row';
  const k=document.createElement('strong');k.textContent=label;
  const v=document.createElement('span');v.textContent=value||'—';
  row.append(k,v);return row;
}

async function openIncidences(shell){
  const admin=isPrimaryAdmin();
  shell.classList.add('h24-hidden');
  const view=document.createElement('section');view.id='a43-incidences';view.className='a43-view';
  const head=document.createElement('div');head.className='a43-head';
  const copy=document.createElement('div');
  const eyebrow=document.createElement('p');eyebrow.className='eyebrow';eyebrow.textContent='Activar 24H';
  const h2=document.createElement('h2');h2.textContent=admin?'Todas las incidencias 24H':'Mis incidencias 24H';
  const note=document.createElement('div');note.className='muted';note.textContent=admin?'Puedes ver las activaciones creadas por todos los usuarios.':'Solo se muestran las activaciones creadas por tu usuario.';
  copy.append(eyebrow,h2,note);
  const back=document.createElement('button');back.type='button';back.className='button secondary';back.textContent='← Volver a Activar 24H';
  back.onclick=()=>{view.remove();shell.classList.remove('h24-hidden');};
  head.append(copy,back);view.append(head);
  const status=document.createElement('div');status.className='h24-status';status.textContent='Cargando incidencias…';view.append(status);
  shell.after(view);

  const {data:rows,error}=await supabase.from('activaciones_24h')
    .select('id,dfm,matricula,marca,modelo,km_actual,conductor,ubicacion_referencia,averia,codigo_alarma,color_alarma,semirremolque,carga,numero_caso,hora_activacion,eta_tecnico,proveedor,diagnostico,resultado,estado,creado_por,creado_en,actualizado_en')
    .order('creado_en',{ascending:false});
  if(error){status.className='h24-status danger';status.textContent='No se pudieron cargar las incidencias: '+error.message;return;}

  const creatorIds=[...new Set((rows||[]).map(r=>r.creado_por).filter(Boolean))];
  const creators=new Map();
  if(creatorIds.length){
    const {data:users}=await supabase.from('usuarios').select('id,nombre,apellidos,correo').in('id',creatorIds);
    (users||[]).forEach(u=>creators.set(u.id,u));
  }

  status.remove();
  const list=document.createElement('div');list.className='a43-list';
  if(!(rows||[]).length){const empty=document.createElement('div');empty.className='a43-empty';empty.textContent=admin?'No hay activaciones 24H registradas.':'Todavía no tienes activaciones 24H registradas.';list.append(empty);}
  (rows||[]).forEach(r=>{
    const card=document.createElement('details');card.className='a43-card';
    const summary=document.createElement('summary');
    const top=document.createElement('div');top.className='a43-topline';
    const title=document.createElement('span');title.className='a43-title';title.textContent=`DFM ${r.dfm||'—'} · ${r.matricula||'—'}${r.numero_caso?' · Caso '+r.numero_caso:''}`;
    const state=document.createElement('span');state.className='a43-state '+(r.estado==='cerrada'?'closed':'open');state.textContent=r.estado==='cerrada'?'CERRADA':'ABIERTA';
    top.append(title,state);
    const meta=document.createElement('div');meta.className='a43-meta';meta.textContent=`${fmtDateTime(r.creado_en)} · ${r.resultado||'seguimiento abierto'}`;
    summary.append(top,meta);card.append(summary);
    const detail=document.createElement('div');detail.className='a43-detail';
    if(admin)detail.append(makeRow('Creada por',labelCreator(creators.get(r.creado_por),r.creado_por)));
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

function patch24H(){
  const shell=content?.querySelector('.h24-shell');
  const manualBox=shell?.querySelector('.h24-manual');
  if(!shell||!manualBox||manualBox.querySelector('#a43-incidences-button'))return;
  const button=document.createElement('button');
  button.id='a43-incidences-button';button.type='button';button.className='button secondary compact a43-inc-btn';
  button.textContent=isPrimaryAdmin()?'📋 Todas las incidencias':'📋 Mis incidencias';
  button.onclick=()=>{if(!content.querySelector('#a43-incidences'))openIncidences(shell);};
  manualBox.append(button);
}

const observer=new MutationObserver(()=>patch24H());
if(content)observer.observe(content,{childList:true,subtree:true});
patch24H();
