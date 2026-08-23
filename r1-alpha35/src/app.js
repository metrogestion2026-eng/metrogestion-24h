import '../../r1-alpha34/src/app.js';
import { supabase } from '../../r1-alpha17/src/supabase.js';

const VERSION='r1.0.0-alpha.35';
const versionNode=document.querySelector('#app-version');
if(versionNode)versionNode.textContent=VERSION;

const content=document.querySelector('#module-content');
const nav=document.querySelector('#module-nav');
const ESCALATION=['TM','Gestión Mantenimiento BCN','Área de Mantenimiento'];
let checkToken=0;

function ensureStyle(){
  if(document.querySelector('#alpha35-style'))return;
  const style=document.createElement('style');
  style.id='alpha35-style';
  style.textContent=`
    .alpha35-contract-block{margin-top:12px;border:2px solid #dc2626!important;background:#fff1f2!important;color:#991b1b!important}
    .alpha35-contract-block strong{display:block;margin-bottom:6px}
    .alpha35-contract-block ol{margin:7px 0 0;padding-left:22px}
    .alpha35-contract-block li{margin:3px 0;font-weight:700}
    #h24-km.alpha35-km-over{border-color:#dc2626!important;outline:3px solid rgba(220,38,38,.14)}
  `;
  document.head.append(style);
}
ensureStyle();

function parseKm(value){
  const digits=String(value||'').replace(/\D/g,'');
  return digits?Number(digits):0;
}

function getShell(){
  return content?.querySelector('.h24-shell')||null;
}

function getDfm(shell){
  const raw=String(shell?.querySelector('#h24-dfm')?.value||'').trim().toUpperCase();
  const direct=raw.match(/(?:DFM\s*)?(\d{3,5})/i);
  if(direct)return direct[1];
  const ctx=String(shell?.querySelector('.h24-context strong')?.textContent||'');
  return ctx.match(/(\d{3,5})/)?.[1]||'';
}

function getNextButton(shell){
  return shell?.querySelector('.h24-nav .button.primary')||null;
}

function clearContractBlock(shell){
  shell?.querySelector('#alpha35-contract-block')?.remove();
  shell?.querySelector('#h24-km')?.classList.remove('alpha35-km-over');
  const next=getNextButton(shell);
  if(next?.dataset.alpha35KmBlocked==='1'){
    next.disabled=false;
    delete next.dataset.alpha35KmBlocked;
  }
}

function showContractBlock(shell,km,limit){
  clearContractBlock(shell);
  const input=shell.querySelector('#h24-km');
  const next=getNextButton(shell);
  if(input)input.classList.add('alpha35-km-over');
  if(next){
    next.disabled=true;
    next.dataset.alpha35KmBlocked='1';
  }
  const box=document.createElement('div');
  box.id='alpha35-contract-block';
  box.className='h24-status danger alpha35-contract-block';
  const title=document.createElement('strong');
  title.textContent='⛔ FUERA DE COBERTURA POR KILÓMETROS';
  const detail=document.createElement('div');
  detail.textContent=`KM actuales: ${km.toLocaleString('es-ES')} · Fin de contrato: ${limit.toLocaleString('es-ES')} km. No puedes continuar con la activación 24H desde la app.`;
  const call=document.createElement('div');
  call.style.marginTop='8px';
  call.textContent='Contacta, por este orden, con:';
  const list=document.createElement('ol');
  ESCALATION.forEach(name=>{const li=document.createElement('li');li.textContent=name;list.append(li);});
  box.append(title,detail,call,list);
  const anchor=input?.closest('label')||shell.querySelector('.h24-card');
  if(anchor?.parentNode)anchor.after(box);
}

async function enforceKmContract(){
  const shell=getShell();
  const input=shell?.querySelector('#h24-km');
  if(!shell||!input)return;
  const dfm=getDfm(shell);
  const km=parseKm(input.value);
  if(!dfm||!km){clearContractBlock(shell);return;}

  const token=++checkToken;
  const {data,error}=await supabase
    .from('vehiculos')
    .select('dfm,fin_contrato_km')
    .eq('dfm',dfm)
    .maybeSingle();
  if(token!==checkToken)return;
  if(error||!data){clearContractBlock(shell);return;}

  const limit=Number(data.fin_contrato_km||0);
  if(limit>0&&km>limit){
    showContractBlock(shell,km,limit);
  }else{
    clearContractBlock(shell);
  }
}

content?.addEventListener('input',event=>{
  if(event.target?.id==='h24-km')enforceKmContract();
});

content?.addEventListener('change',event=>{
  if(event.target?.id==='h24-dfm')setTimeout(enforceKmContract,0);
});

nav?.addEventListener('click',()=>setTimeout(enforceKmContract,150));

requestAnimationFrame(()=>setTimeout(enforceKmContract,150));
