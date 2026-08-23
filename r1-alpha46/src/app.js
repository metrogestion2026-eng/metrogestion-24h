import '../../r1-alpha45/src/app.js';

const VERSION='r1.0.0-alpha.46';
const versionNode=document.querySelector('#app-version');
if(versionNode)versionNode.textContent=VERSION;

const content=document.querySelector('#module-content');

function ensureStyle(){
  if(document.querySelector('#alpha46-style'))return;
  const s=document.createElement('style');
  s.id='alpha46-style';
  s.textContent=`.a46-gate-tabs{display:flex;gap:8px;flex-wrap:wrap;margin:2px 0 12px}.a46-gate-tabs .button.active{background:#075985;color:#fff;border-color:#075985}@media(max-width:700px){.a46-gate-tabs .button{flex:1 1 140px}}`;
  document.head.append(s);
}
ensureStyle();

function clickAlpha45Incidences(){
  const tryOpen=()=>{
    const subnav=content?.querySelector('#a45-subnav');
    if(!subnav)return false;
    const buttons=[...subnav.querySelectorAll('button')];
    const incidences=buttons.find(b=>b.textContent.includes('Incidencias'));
    if(!incidences)return false;
    incidences.click();
    return true;
  };
  if(tryOpen())return;
  const guided=[...(content?.querySelectorAll('.a36-choice')||[])].find(b=>b.textContent.includes('Ser guiado por la app'));
  if(!guided)return;
  guided.click();
  let attempts=0;
  const timer=setInterval(()=>{
    attempts++;
    if(tryOpen()||attempts>30)clearInterval(timer);
  },50);
}

function patchGate(){
  const start=content?.querySelector('.a36-start');
  if(!start||start.querySelector('#a46-gate-tabs'))return;
  const header=start.firstElementChild;
  if(!header)return;
  const tabs=document.createElement('div');
  tabs.id='a46-gate-tabs';
  tabs.className='a46-gate-tabs';
  const activation=document.createElement('button');
  activation.type='button';
  activation.className='button secondary compact active';
  activation.textContent='🚨 Activación';
  const incidences=document.createElement('button');
  incidences.type='button';
  incidences.className='button secondary compact';
  incidences.textContent='📋 Incidencias';
  tabs.append(activation,incidences);
  header.after(tabs);
  incidences.onclick=()=>clickAlpha45Incidences();
}

const observer=new MutationObserver(()=>patchGate());
if(content)observer.observe(content,{childList:true,subtree:true});
patchGate();
