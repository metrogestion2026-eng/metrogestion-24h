import '../../r1-alpha33/src/app.js';
import { supabase } from '../../r1-alpha17/src/supabase.js';

const VERSION='r1.0.0-alpha.47';
const versionNode=document.querySelector('#app-version');
if(versionNode)versionNode.textContent=VERSION;

const nav=document.querySelector('#module-nav');
const content=document.querySelector('#module-content');
const FIXED_LOCATIONS={
  abrera:{name:'Bloque logístico Abrera',plus:'GV6V+62 Abrera',coordinates:'41.510562, 1.892562'},
  sansa:{name:'Bloque logístico Sansa',plus:"CRJ3+HG Sant Sadurní d'Anoia",coordinates:'41.431438, 1.803813'},
  disfrimur:{name:'Nave Disfrimur',plus:"CRM4+G2 Sant Sadurní d'Anoia",coordinates:'41.433813, 1.805063'}
};
const MERCEDES_PHONE='0080057777777';
const MERCEDES_PORTAL='https://mytruckpoint.mercedes-benz-trucks.com/landing';
const ESCALATION=[
  {name:'TM Barcelona',phone:'606 655 189',tel:'606655189',ext:'4507',detail:'Aviso obligatorio 24H'},
  {name:'Gestión Mantenimiento BCN',phone:'697 728 258',tel:'697728258',ext:'4512',detail:'Contrato, taller y planificación'},
  {name:'Área de Mantenimiento',phone:'669 208 633',tel:'669208633',ext:'4135',detail:'Todas las delegaciones'}
];

function el(tag,text,cls){const n=document.createElement(tag);if(text!==undefined&&text!==null)n.textContent=text;if(cls)n.className=cls;return n;}
function fmtDate(v){if(!v)return'—';const d=new Date(String(v).slice(0,10)+'T00:00:00');return Number.isNaN(d.getTime())?String(v):d.toLocaleDateString('es-ES');}
function fmtDateTime(v){if(!v)return'—';const d=new Date(v);return Number.isNaN(d.getTime())?String(v):d.toLocaleString('es-ES',{dateStyle:'short',timeStyle:'short'});}
function fmtTime(v){return v?String(v).slice(0,5):'—';}
function parseKm(v){const n=Number(String(v||'').replace(/\D/g,''));return Number.isFinite(n)?n:0;}
function validPhone(v){return /^\+?\d{9,15}$/.test(String(v||'').replace(/[\s()-]/g,''));}
function requestId(){return'h24_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,9);}

function ensureStyle(){
  if(document.querySelector('#alpha47-style'))return;
  const s=document.createElement('style');s.id='alpha47-style';s.textContent=`
  .h47-shell{display:grid;gap:14px}.h47-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap}.h47-tabs{display:flex;gap:8px;flex-wrap:wrap;border-bottom:1px solid #dbe5ec;padding-bottom:10px}.h47-tabs .active{background:#075985;color:#fff;border-color:#075985}.h47-card{border:1px solid #dbe5ec;border-radius:14px;padding:14px;background:#fff;display:grid;gap:12px}.h47-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.h47-wide{grid-column:1/-1}.h47-card label{display:grid;gap:5px;font-weight:700}.h47-card input,.h47-card select,.h47-card textarea{width:100%;box-sizing:border-box;min-height:44px;padding:9px 10px;border:1px solid #aebdca;border-radius:10px;background:#fff;font:inherit}.h47-card textarea{min-height:90px}.h47-choice{display:flex;align-items:flex-start;gap:12px;width:100%;text-align:left;padding:14px;border:1px solid #dbe5ec;border-radius:12px;background:#fff;cursor:pointer;font:inherit;color:inherit}.h47-choice:hover{background:#f1f7fa}.h47-check{display:flex!important;align-items:flex-start;gap:9px;padding:10px;border:1px solid #dbe5ec;border-radius:10px;font-weight:500!important}.h47-check input{width:20px;height:20px;min-height:0;flex:0 0 auto}.h47-progress{height:7px;background:#e5edf2;border-radius:999px;overflow:hidden}.h47-progress span{display:block;height:100%;background:#075985}.h47-context{display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap;padding:10px 12px;border:1px solid #dbe5ec;border-radius:10px;background:#fff}.h47-context strong{color:#075985}.h47-nav{display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;position:sticky;bottom:0;padding:10px 0;background:linear-gradient(180deg,rgba(255,255,255,.5),#fff 25%)}.h47-status{padding:11px 12px;border-radius:10px;background:#f1f7fa}.h47-status.danger{background:#fff1f2;color:#991b1b}.h47-status.success{background:#f0fdf4;color:#166534}.h47-summary{display:grid;gap:0}.h47-row{display:grid;grid-template-columns:175px 1fr;gap:10px;padding:8px;border-bottom:1px solid #e5edf2}.h47-call{border:2px solid #0ea5e9;border-radius:14px;padding:14px;display:grid;gap:10px}.h47-inc-list{display:grid;gap:10px}.h47-inc{border:1px solid #dbe5ec;border-radius:12px;background:#fff;overflow:hidden}.h47-inc summary{cursor:pointer;padding:12px 14px;list-style:none;display:grid;gap:4px}.h47-inc summary::-webkit-details-marker{display:none}.h47-inc-top{display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap}.h47-state{padding:3px 8px;border-radius:999px;background:#fff7ed;color:#9a3412;font-size:.8rem;font-weight:700}.h47-state.closed{background:#f0fdf4;color:#166534}.h47-inc-detail{padding:0 14px 14px}.h47-empty{padding:18px;border:1px dashed #cbd5e1;border-radius:12px;text-align:center;color:#64748b}.h47-hidden{display:none!important}.h47-contact-list{display:grid;gap:8px}.h47-contact{display:grid;grid-template-columns:1fr auto;gap:10px;padding:10px;border:1px solid #fecaca;border-radius:10px;background:#fff;color:#7f1d1d;text-decoration:none}.h47-contact small{display:block}.h47-mercedes{padding:12px;border:1px solid #dbe5ec;border-radius:12px;background:#f8fafc;display:grid;gap:8px}
  @media(max-width:700px){.h47-grid{grid-template-columns:1fr}.h47-wide{grid-column:auto}.h47-row{grid-template-columns:1fr}.h47-nav .button,.h47-tabs .button{flex:1 1 145px}.h47-contact{grid-template-columns:1fr}}
  `;document.head.append(s);
}
ensureStyle();

function installNavButton(attempt=0){
  if(!nav)return;
  if(nav.querySelector('[data-h47-24h]'))return;
  const sample=nav.querySelector('button');
  if(!sample){if(attempt<30)setTimeout(()=>installNavButton(attempt+1),250);return;}
  const b=document.createElement('button');b.type='button';b.dataset.h47_24h='1';b.setAttribute('data-h47-24h','1');b.className=sample.className;b.textContent='🚨 Activar 24H';
  b.addEventListener('click',()=>{[...nav.querySelectorAll('button')].forEach(x=>x.classList.remove('active'));b.classList.add('active');render24H();});
  nav.insertBefore(b,nav.firstChild);
}
installNavButton();
supabase.auth.onAuthStateChange((_event,session)=>{if(session)setTimeout(()=>installNavButton(),300);});

async function getProfile(){
  const {data:{user}}=await supabase.auth.getUser();if(!user)return null;
  const {data}=await supabase.from('usuarios').select('id,nombre,apellidos,correo,tipo_usuario').eq('id',user.id).maybeSingle();
  return data||{id:user.id,correo:user.email,tipo_usuario:''};
}

function render24H(){
  content.replaceChildren();
  const shell=el('section',null,'h47-shell');
  const head=el('div',null,'h47-head');const copy=el('div');copy.append(el('p','Asistencia en carretera','eyebrow'),el('h2','Activar 24H'),el('div','Módulo reconstruido de forma nativa sobre la base limpia.','muted'));
  const manual=el('button','📄 Manual 24H','button secondary compact');manual.type='button';manual.onclick=()=>window.open('../Manual_24H_DFM_v2_1.pdf','_blank','noopener');head.append(copy,manual);
  const tabs=el('div',null,'h47-tabs');const tabAct=el('button','🚨 Activación','button secondary compact active');const tabInc=el('button','📋 Incidencias','button secondary compact');tabAct.type=tabInc.type='button';tabs.append(tabAct,tabInc);
  const host=el('div');shell.append(head,tabs,host);content.append(shell);
  const selectTab=(which)=>{tabAct.classList.toggle('active',which==='act');tabInc.classList.toggle('active',which==='inc');if(which==='act')renderStart(host);else renderIncidences(host);};
  tabAct.onclick=()=>selectTab('act');tabInc.onclick=()=>selectTab('inc');selectTab('act');
}

function renderStart(host){
  host.replaceChildren();const box=el('section',null,'h47-card');
  box.append(el('div','Paso 0 de 7 · Manual o ser guiado','muted'),el('h3','¿Cómo quieres realizar la activación 24H?'));
  const m=el('button',null,'h47-choice');m.type='button';m.append(el('span','📄'),el('span','Abrir el manual PDF'));m.onclick=()=>window.open('../Manual_24H_DFM_v2_1.pdf','_blank','noopener');
  const g=el('button',null,'h47-choice');g.type='button';g.append(el('span','➡️'),el('span','Ser guiado por la app'));g.onclick=()=>renderWizard(host);
  box.append(m,g);host.append(box);
}

async function renderWizard(host){
  host.replaceChildren();
  const status=el('div','Cargando vehículos…','h47-status');host.append(status);
  const {data:fleet,error}=await supabase.from('vehiculos').select('id,dfm,matricula,categoria,clase_vehiculo,tipo_motor,marca,modelo,bastidor,upc,telefono,fecha_alta_manteniment,fin_contrato_fecha,fin_contrato_km,km_actual,activo').eq('activo',true).neq('categoria','R').order('dfm');
  if(error){status.className='h47-status danger';status.textContent='No se pudieron cargar los vehículos: '+error.message;return;}
  status.remove();
  const vehicles=fleet||[],byDfm=new Map(vehicles.map(v=>[String(v.dfm),v]));
  const state={safe:false,people:false,loadChecked:false,ubicacion_tipo:'abrera',ubicacion_formato:'coordinates',carga:'Tractora suelta',resultado:'seguimiento_abierto'};
  let vehicle=null,current=0,activationId=null;
  const stepNames=['Identificar vehículo','Seguridad · Procedimiento 0','Ubicación y avería','Revisar datos para comunicar','Contrato y llamada','Registrar activación','Seguimiento'];
  const root=el('section',null,'h47-shell');const step=el('div');const progress=el('div',null,'h47-progress');const fill=el('span');progress.append(fill);
  const ctx=el('div',null,'h47-context');const ctxD=el('span');ctxD.append(el('span','Vehículo activo','muted'),document.createElement('br'),el('strong','DFM —'));const ctxM=el('span');ctxM.append(el('span','Matrícula','muted'),document.createElement('br'),el('strong','—'));ctx.append(ctxD,ctxM);
  const card=el('section',null,'h47-card');const notice=el('div','', 'h47-status h47-hidden');const navBox=el('div',null,'h47-nav');const prev=el('button','← Paso anterior','button secondary');const next=el('button','Siguiente →','button primary');prev.type=next.type='button';navBox.append(prev,next);root.append(step,progress,ctx,card,notice,navBox);host.append(root);
  const show=(msg,type='')=>{notice.textContent=msg;notice.className='h47-status'+(type?' '+type:'');};const clear=()=>{notice.className='h47-status h47-hidden';notice.textContent='';};
  const updateCtx=()=>{ctxD.querySelector('strong').textContent=vehicle?'DFM '+vehicle.dfm:'DFM —';ctxM.querySelector('strong').textContent=vehicle?.matricula||'—';};
  const input=(id,label,type='text',value='')=>{const l=el('label');l.append(el('span',label));const i=document.createElement('input');i.id=id;i.type=type;i.value=value??'';l.append(i);return[l,i];};
  const select=(id,label,opts,value='')=>{const l=el('label');l.append(el('span',label));const s=document.createElement('select');s.id=id;opts.forEach(([v,t])=>s.append(new Option(t,v)));s.value=value;l.append(s);return[l,s];};
  const textarea=(id,label,value='')=>{const l=el('label');l.append(el('span',label));const t=document.createElement('textarea');t.id=id;t.value=value??'';l.append(t);return[l,t];};
  const check=(id,text,val=false)=>{const l=el('label',null,'h47-check');const i=document.createElement('input');i.type='checkbox';i.id=id;i.checked=val;l.append(i,el('span',text));return[l,i];};
  const coverage=()=>{if(!vehicle)return{ok:false,reason:'Selecciona un vehículo.'};const km=parseKm(state.km_actual),limit=Number(vehicle.fin_contrato_km||0),today=new Date();today.setHours(0,0,0,0);const end=vehicle.fin_contrato_fecha?new Date(vehicle.fin_contrato_fecha+'T00:00:00'):null;const kmExceeded=limit>0&&km>limit,dateExceeded=end&&today>end;return{ok:!kmExceeded&&!dateExceeded,km,limit,end,kmExceeded,dateExceeded};};
  const summary=()=>[
    ['DFM',vehicle?.dfm],['Matrícula',vehicle?.matricula],['Marca / modelo',[vehicle?.marca,vehicle?.modelo].filter(Boolean).join(' ')],['Bastidor',vehicle?.bastidor],['UPC',vehicle?.upc],['Kilómetros actuales',state.km_actual?parseKm(state.km_actual).toLocaleString('es-ES')+' km':''],['Conductor',state.conductor],['Teléfono',state.telefono],['Ubicación',state.ubicacion],['Avería',state.averia],['Código alarma',state.codigo_alarma],['Color del aviso',state.color_alarma],['Semirremolque',state.semirremolque],['Carga',state.carga]
  ];
  const payload=()=>({dfm:String(vehicle?.dfm||''),matricula:vehicle?.matricula||'',marca:vehicle?.marca||'',modelo:vehicle?.modelo||'',bastidor:vehicle?.bastidor||'',upc:vehicle?.upc||'',km_actual:String(parseKm(state.km_actual)||''),contrato_km:String(vehicle?.fin_contrato_km||''),fin_contrato_fecha:vehicle?.fin_contrato_fecha||'',cobertura_ok:String(coverage().ok),conductor:state.conductor||'',telefono_conductor:state.telefono||'',ubicacion_tipo:state.ubicacion_tipo||'',ubicacion_referencia:state.ubicacion||'',carretera:state.carretera||'',punto_km:state.punto_km||'',sentido:state.sentido||'',averia:state.averia||'',codigo_alarma:state.codigo_alarma||'',color_alarma:state.color_alarma||'',semirremolque:state.semirremolque||'',carga:state.carga||'',numero_caso:state.numero_caso||'',hora_activacion:state.hora_activacion||'',eta_tecnico:state.eta_tecnico||'',proveedor:state.proveedor||'',tecnico_llegado:String(Boolean(state.tecnico_llegado)),hora_llegada:state.hora_llegada||'',diagnostico_confirmado:String(Boolean(state.diagnostico_confirmado)),diagnostico:state.diagnostico||'',reparado_carretera:String(Boolean(state.reparado_carretera)),trasladado_taller:String(Boolean(state.trasladado_taller)),taller_traslado:state.taller_traslado||'',estado_operativo_confirmado:String(Boolean(state.estado_operativo_confirmado)),resultado:state.resultado||'seguimiento_abierto',estado:['reparado_carretera','operativo'].includes(state.resultado)?'cerrada':'abierta'});
  const save=async()=>{const {data,error}=await supabase.rpc('guardar_activacion_24h',{p_id:activationId,p_payload:payload(),p_request_id:requestId()});if(error)throw error;activationId=data?.id||activationId;return data;};

  function render(){clear();card.replaceChildren();fill.style.width=((current+1)/7*100)+'%';step.textContent=`Paso ${current+1} de 7 · ${stepNames[current]}`;prev.disabled=current===0;next.textContent=current===6?'Guardar seguimiento':'Siguiente →';
    if(current===0){
      card.append(el('h3','¿Qué vehículo necesita asistencia?'));
      const [ld,dfm]=input('h47-dfm','DFM o matrícula'),dl=document.createElement('datalist');dl.id='h47-fleet';dfm.setAttribute('list',dl.id);vehicles.forEach(v=>dl.append(new Option(`DFM ${v.dfm} · ${v.matricula||''}`,String(v.dfm))));dfm.value=vehicle?.dfm||'';
      const [lk,km]=input('h47-km','Kilómetros actuales','text',state.km_actual||'');km.inputMode='numeric';const grid=el('div',null,'h47-grid');grid.append(ld,lk);card.append(grid,dl);
      const cov=coverage();if(vehicle){const info=el('div',null,'h47-status'+(!cov.ok?' danger':''));info.textContent=`${vehicle.marca||'—'} ${vehicle.modelo||''} · Fin fecha ${fmtDate(vehicle.fin_contrato_fecha)} · Fin km ${vehicle.fin_contrato_km?Number(vehicle.fin_contrato_km).toLocaleString('es-ES'):'—'} km`;card.append(info);if(cov.kmExceeded||cov.dateExceeded){const block=el('div',null,'h47-status danger');block.append(el('strong','⛔ FUERA DE COBERTURA'),el('div',[cov.kmExceeded?'kilometraje contractual superado':'',cov.dateExceeded?'fecha contractual superada':''].filter(Boolean).join(' y ')));const list=el('div',null,'h47-contact-list');ESCALATION.forEach(c=>{const a=el('a',null,'h47-contact');a.href='tel:'+c.tel;const left=el('span');left.append(el('strong',c.name),el('small',c.detail));a.append(left,el('b',`${c.phone} · Ext. ${c.ext}`));list.append(a);});block.append(list);card.append(block);}}
      dfm.onchange=()=>{const raw=dfm.value.toUpperCase().replace(/^DFM\s*/,'').split('·')[0].trim();vehicle=byDfm.get(raw)||vehicles.find(v=>String(v.matricula||'').toUpperCase()===raw)||null;state.km_actual=vehicle?.km_actual||'';state.telefono=vehicle?.telefono||'';updateCtx();render();};km.oninput=()=>{state.km_actual=km.value;};km.onblur=()=>render();
    }
    if(current===1){
      card.append(el('h3','Procedimiento 0'));if(!state.telefono&&vehicle?.telefono)state.telefono=vehicle.telefono;
      const [a,ca]=check('h47-safe','Vehículo detenido en lugar seguro o correctamente señalizado',state.safe),[b,cb]=check('h47-people','Conductor y ocupantes fuera de peligro',state.people),[c,cc]=check('h47-loadcheck','Se ha comprobado si la carga está afectada',state.loadChecked),[ln,n]=input('h47-driver','Conductor','text',state.conductor||''),[lp,p]=input('h47-phone','Teléfono del conductor','tel',state.telefono||'');const grid=el('div',null,'h47-grid');grid.append(ln,lp);card.append(a,b,c,grid);ca.onchange=()=>state.safe=ca.checked;cb.onchange=()=>state.people=cb.checked;cc.onchange=()=>state.loadChecked=cc.checked;n.oninput=()=>state.conductor=n.value;p.oninput=()=>state.telefono=p.value;
    }
    if(current===2){
      card.append(el('h3','Ubicación y avería'));
      const [lt,t]=select('h47-ltype','Tipo de ubicación',[['abrera','Bloque logístico Abrera'],['sansa','Bloque logístico Sansa'],['disfrimur','Nave Disfrimur'],['industrial','Polígono'],['store','Tienda'],['road','Carretera / autopista / autovía'],['other','Otro']],state.ubicacion_tipo||'abrera');const [lf,f]=select('h47-lformat','Formato de ubicación',[['coordinates','Coordenadas'],['plus','Plus Code'],['manual','Ubicación']],state.ubicacion_formato||'coordinates');const [lr,r]=input('h47-location','Referencia de ubicación','text',state.ubicacion||'');const [la,a]=textarea('h47-fault','Descripción literal del aviso',state.averia||'');const [lc,c]=input('h47-alarm','Código de alarma','text',state.codigo_alarma||'');const [lcol,col]=select('h47-color','Color del aviso',[['','Sin testigo'],['Amarillo','Amarillo'],['Rojo','Rojo'],['Otro','Otro']],state.color_alarma||'');const [ltr,tr]=input('h47-trailer','Semirremolque','text',state.semirremolque||'');const [ll,load]=select('h47-load','Carga',[['Sin carga','Sin carga'],['Con carga','Con carga'],['Tractora suelta','Tractora suelta']],state.carga||'Tractora suelta');const road=el('div',null,'h47-grid h47-wide');const [lroad,roadn]=input('h47-road','Carretera','text',state.carretera||''),[lpk,pk]=input('h47-pk','Punto kilométrico','text',state.punto_km||''),[ls,sen]=input('h47-dir','Sentido','text',state.sentido||'');road.append(lroad,lpk,ls);const grid=el('div',null,'h47-grid');grid.append(lt,lf,lr,la,lc,lcol,ltr,ll,road);card.append(grid);
      const syncLocation=()=>{state.ubicacion_tipo=t.value;state.ubicacion_formato=f.value;const fixed=FIXED_LOCATIONS[t.value];if(fixed&&f.value!=='manual'){state.ubicacion=f.value==='coordinates'?fixed.coordinates:fixed.plus;r.value=state.ubicacion;r.readOnly=true;}else{r.readOnly=false;if(f.value==='manual'&&fixed&&(!state.ubicacion||state.ubicacion===fixed.coordinates||state.ubicacion===fixed.plus)){state.ubicacion='';r.value='';}}road.classList.toggle('h47-hidden',t.value!=='road');};syncLocation();t.onchange=syncLocation;f.onchange=syncLocation;r.oninput=()=>state.ubicacion=r.value;a.oninput=()=>state.averia=a.value;c.oninput=()=>state.codigo_alarma=c.value;col.onchange=()=>state.color_alarma=col.value;tr.oninput=()=>state.semirremolque=tr.value;load.onchange=()=>state.carga=load.value;roadn.oninput=()=>state.carretera=roadn.value;pk.oninput=()=>state.punto_km=pk.value;sen.oninput=()=>state.sentido=sen.value;
    }
    if(current===3){card.append(el('h3','Datos preparados para comunicar al 24H'));const s=el('div',null,'h47-summary');summary().forEach(([k,v])=>{if(v!==undefined&&v!==null&&String(v)!=='')s.append(row(k,String(v)));});const [lc,c]=check('h47-confirm','He revisado los datos y están preparados para comunicarlos',state.confirmed);c.onchange=()=>state.confirmed=c.checked;card.append(s,lc);}
    if(current===4){
      card.append(el('h3','Contrato y llamada'));const cov=coverage();const covBox=el('div',cov.ok?`Cobertura comprobada · Fin fecha ${fmtDate(vehicle?.fin_contrato_fecha)} · Límite ${vehicle?.fin_contrato_km?Number(vehicle.fin_contrato_km).toLocaleString('es-ES')+' km':'—'}`:'Fuera de cobertura. No continúes con la asistencia desde la app.','h47-status '+(cov.ok?'success':'danger'));card.append(covBox);
      if(String(vehicle?.marca||'').toUpperCase().startsWith('MERCEDES')){const m=el('div',null,'h47-mercedes');m.append(el('strong','1. Primera opción · Mercedes-Benz Trucks'),el('span','Comunica la avería mediante My TruckPoint for Mercedes-Benz Trucks.'));const open=el('a','Abrir Mercedes / My TruckPoint','button primary');open.href=MERCEDES_PORTAL;open.target='_blank';open.rel='noopener';m.append(open,el('strong','2. Si no puedes hacerlo por la app/portal, llama al Service24h'));const call=el('a','📞 Llamar al Service24h · 00800 5 777 7777','button secondary');call.href='tel:'+MERCEDES_PHONE;m.append(call);card.append(m);}else{card.append(el('div','Canal 24H por marca pendiente de configuración específica.','h47-status'));}
      const callMode=el('div',null,'h47-call');callMode.append(el('strong','Modo llamada'),el('div','Lee al operador los datos revisados en el Paso 4.','muted'));const s=el('div',null,'h47-summary');summary().forEach(([k,v])=>{if(v)s.append(row(k,String(v)));});const [ln,n]=input('h47-case','Número facilitado por el operador','text',state.numero_caso||'');n.oninput=()=>state.numero_caso=n.value;callMode.append(s,ln);card.append(callMode);
    }
    if(current===5){
      card.append(el('h3','Registrar activación'));const caseBox=el('div',state.numero_caso?`Número de asistencia / caso: ${state.numero_caso}`:'Número de asistencia / caso todavía no registrado.','h47-status '+(state.numero_caso?'success':'danger'));const [lh,h]=input('h47-activation-time','Hora de activación','time',state.hora_activacion||''),[le,e]=input('h47-eta','ETA del técnico','time',state.eta_tecnico||''),[lp,p]=input('h47-provider','Taller o proveedor asignado','text',state.proveedor||'');const grid=el('div',null,'h47-grid');grid.append(lh,le,lp);card.append(caseBox,grid,el('div','Se registrará la activación y quedará abierta para seguimiento.','h47-status'));h.oninput=()=>state.hora_activacion=h.value;e.oninput=()=>state.eta_tecnico=e.value;p.oninput=()=>state.proveedor=p.value;
    }
    if(current===6){
      card.append(el('h3','Seguimiento'));const [a,ca]=check('h47-arrived','Técnico llegado',state.tecnico_llegado),[lh,h]=input('h47-arrival','Hora real de llegada','time',state.hora_llegada||''),[d,cd]=check('h47-diagnosis-ok','Diagnóstico confirmado',state.diagnostico_confirmado),[ld,diag]=textarea('h47-diagnosis','Diagnóstico',state.diagnostico||''),[rr,crr]=check('h47-roadrepair','Reparado en carretera',state.reparado_carretera),[tt,ctt]=check('h47-transfer','Trasladado a taller',state.trasladado_taller),[lt,taller]=input('h47-workshop','Taller de traslado','text',state.taller_traslado||''),[op,cop]=check('h47-operational','Estado operativo confirmado',state.estado_operativo_confirmado),[lr,res]=select('h47-result','Resultado',[['seguimiento_abierto','Seguimiento abierto'],['reparado_carretera','Reparado en carretera'],['trasladado_taller','Trasladado a taller · mantener misma INC'],['necesita_sustitucion','Necesita sustitución'],['operativo','Operativo']],state.resultado||'seguimiento_abierto');card.append(a,lh,d,ld,rr,tt,lt,op,lr);ca.onchange=()=>state.tecnico_llegado=ca.checked;h.oninput=()=>state.hora_llegada=h.value;cd.onchange=()=>state.diagnostico_confirmado=cd.checked;diag.oninput=()=>state.diagnostico=diag.value;crr.onchange=()=>{state.reparado_carretera=crr.checked;if(crr.checked){state.trasladado_taller=false;ctt.checked=false;state.resultado='reparado_carretera';res.value=state.resultado;}};ctt.onchange=()=>{state.trasladado_taller=ctt.checked;if(ctt.checked){state.reparado_carretera=false;crr.checked=false;state.resultado='trasladado_taller';res.value=state.resultado;}};taller.oninput=()=>state.taller_traslado=taller.value;cop.onchange=()=>state.estado_operativo_confirmado=cop.checked;res.onchange=()=>state.resultado=res.value;
    }
  }

  function validate(){
    if(current===0){if(!vehicle)return'Selecciona un vehículo.';if(!parseKm(state.km_actual))return'Introduce los kilómetros actuales.';const cov=coverage();if(!cov.ok)return'El vehículo está fuera de cobertura contractual.';}
    if(current===1){if(!state.safe||!state.people||!state.loadChecked)return'Completa el Procedimiento 0.';if(!state.conductor)return'Introduce el conductor.';if(!validPhone(state.telefono))return'Introduce un teléfono del conductor válido.';}
    if(current===2){if(!state.ubicacion)return'Introduce la ubicación.';if(!state.averia)return'Describe la avería.';if(state.ubicacion_tipo==='road'&&(!state.carretera||!state.punto_km||!state.sentido))return'Completa carretera, punto kilométrico y sentido.';}
    if(current===3&&!state.confirmed)return'Confirma que has revisado los datos.';
    if(current===4&&!state.numero_caso)return'Anota el número facilitado por el operador antes de continuar.';
    return'';
  }
  prev.onclick=()=>{if(current>0){current--;render();}};
  next.onclick=async()=>{const problem=validate();if(problem){show(problem,'danger');return;}try{if(current===5){await save();show('Activación registrada. Continúa con el seguimiento.','success');current=6;render();return;}if(current===6){await save();show('Seguimiento guardado.','success');return;}current++;render();}catch(e){show('No se pudo guardar: '+(e?.message||e),'danger');}};
  render();
}

function row(label,value){const r=el('div',null,'h47-row');r.append(el('strong',label),el('span',value||'—'));return r;}

async function renderIncidences(host){
  host.replaceChildren();const profile=await getProfile(),admin=profile?.tipo_usuario==='administrador_principal';const box=el('section',null,'h47-card');box.append(el('h3',admin?'Todas las incidencias 24H':'Mis incidencias 24H'),el('div',admin?'Vista global de activaciones de todos los usuarios.':'Solo se muestran las activaciones creadas por tu usuario.','muted'));const loading=el('div','Cargando incidencias…','h47-status');box.append(loading);host.append(box);
  const {data:rows,error}=await supabase.from('activaciones_24h').select('id,dfm,matricula,marca,modelo,km_actual,conductor,ubicacion_referencia,averia,codigo_alarma,color_alarma,semirremolque,carga,numero_caso,hora_activacion,eta_tecnico,proveedor,diagnostico,resultado,estado,creado_por,creado_en,actualizado_en').order('creado_en',{ascending:false});if(error){loading.className='h47-status danger';loading.textContent='No se pudieron cargar las incidencias: '+error.message;return;}
  const creators=new Map();if(admin){const ids=[...new Set((rows||[]).map(r=>r.creado_por).filter(Boolean))];if(ids.length){const {data:users}=await supabase.from('usuarios').select('id,nombre,apellidos,correo').in('id',ids);(users||[]).forEach(u=>creators.set(u.id,u));}}
  loading.remove();const list=el('div',null,'h47-inc-list');if(!(rows||[]).length)list.append(el('div',admin?'No hay activaciones 24H registradas.':'Todavía no tienes activaciones 24H registradas.','h47-empty'));
  (rows||[]).forEach(r=>{const d=document.createElement('details');d.className='h47-inc';const sum=document.createElement('summary');const top=el('div',null,'h47-inc-top');top.append(el('strong',`DFM ${r.dfm||'—'} · ${r.matricula||'—'}${r.numero_caso?' · Caso '+r.numero_caso:''}`),el('span',r.estado==='cerrada'?'CERRADA':'ABIERTA','h47-state '+(r.estado==='cerrada'?'closed':'')));sum.append(top,el('div',`${fmtDateTime(r.creado_en)} · ${r.resultado||'seguimiento abierto'}`,'muted'));d.append(sum);const detail=el('div',null,'h47-inc-detail');if(admin){const u=creators.get(r.creado_por),name=u?[u.nombre,u.apellidos].filter(Boolean).join(' ').trim()||u.correo:r.creado_por;detail.append(row('Creada por',name));}detail.append(row('Vehículo',[r.marca,r.modelo].filter(Boolean).join(' ')),row('Kilómetros',r.km_actual?Number(r.km_actual).toLocaleString('es-ES')+' km':'—'),row('Conductor',r.conductor),row('Ubicación',r.ubicacion_referencia),row('Avería',r.averia),row('Alarma',[r.codigo_alarma,r.color_alarma].filter(Boolean).join(' · ')),row('Semirremolque',r.semirremolque),row('Carga',r.carga),row('N.º asistencia / caso',r.numero_caso),row('Hora activación',fmtTime(r.hora_activacion)),row('ETA técnico',fmtTime(r.eta_tecnico)),row('Proveedor / taller',r.proveedor),row('Diagnóstico',r.diagnostico),row('Resultado',r.resultado),row('Última actualización',fmtDateTime(r.actualizado_en)));d.append(detail);list.append(d);});box.append(list);
}
