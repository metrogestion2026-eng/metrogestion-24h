import '../../r1-alpha34/src/app.js';
import { supabase } from '../../r1-alpha17/src/supabase.js';

const VERSION='r1.0.0-alpha.36';
const versionNode=document.querySelector('#app-version');
if(versionNode)versionNode.textContent=VERSION;

const nav=document.querySelector('#module-nav');
const content=document.querySelector('#module-content');
let bypassGate=false;
let contractToken=0;

const ESCALATION=[
  {name:'TM Barcelona',phone:'606 655 189',tel:'606655189',ext:'4507',detail:'Aviso obligatorio 24H'},
  {name:'Gestión Mantenimiento BCN',phone:'697 728 258',tel:'697728258',ext:'4512',detail:'Contrato, taller y planificación'},
  {name:'Área de Mantenimiento',phone:'669 208 633',tel:'669208633',ext:'4135',detail:'Todas las delegaciones'}
];

function ensureStyle(){
  if(document.querySelector('#alpha36-style'))return;
  const style=document.createElement('style');
  style.id='alpha36-style';
  style.textContent=`
    .a36-start{display:grid;gap:14px}.a36-start-card{border:1px solid #dbe5ec;border-radius:14px;padding:16px;background:#fff;display:grid;gap:14px}
    .a36-choice{display:flex;align-items:flex-start;gap:12px;width:100%;text-align:left;padding:14px;border:1px solid #dbe5ec;border-radius:12px;background:#fff;cursor:pointer;font:inherit;color:inherit}
    .a36-choice:hover,.a36-choice:focus-visible{background:#f1f7fa;border-color:#7ab7d8}.a36-choice-icon{font-size:1.35rem;line-height:1.2}.a36-choice-copy{display:grid;gap:3px}.a36-choice-copy strong{font-size:1rem}.a36-choice-copy span{color:#526273;font-size:.9rem}
    .a36-manual-note{padding:12px;border-radius:10px;background:#eef6fb;border:1px solid #b9d9ea}.a36-km-block{margin-top:12px;border:2px solid #dc2626!important;background:#fff1f2!important;color:#991b1b!important}
    .a36-km-block strong{display:block;margin-bottom:6px}.a36-contact-list{display:grid;gap:8px;margin-top:10px}.a36-contact{display:grid;grid-template-columns:1fr auto;gap:10px;align-items:center;padding:10px;border:1px solid #fecaca;border-radius:10px;background:#fff;color:#7f1d1d;text-decoration:none}
    .a36-contact small{display:block;color:#7f1d1d;opacity:.8;margin-top:2px}.a36-contact b{white-space:nowrap}.a36-km-over{border-color:#dc2626!important;outline:3px solid rgba(220,38,38,.14)}
    @media(max-width:640px){.a36-contact{grid-template-columns:1fr}.a36-contact b{white-space:normal}}
  `;
  document.head.append(style);
}
ensureStyle();

function get24hButton(){return nav?.querySelector('[data-alpha34-24h]')||null;}

function showStartGate(button){
  if(!content)return;
  [...(nav?.querySelectorAll('button')||[])].forEach(b=>b.classList.remove('active'));
  button?.classList.add('active');
  content.replaceChildren();

  const shell=document.createElement('section');shell.className='a36-start';
  const header=document.createElement('div');
  const eyebrow=document.createElement('p');eyebrow.className='eyebrow';eyebrow.textContent='Asistencia en carretera';
  const title=document.createElement('h2');title.textContent='Activar 24H';
  const step=document.createElement('div');step.className='muted';step.textContent='Paso 0 de 7 · Manual o ser guiado';
  header.append(eyebrow,title,step);

  const card=document.createElement('section');card.className='a36-start-card';
  const h=document.createElement('h3');h.textContent='¿Cómo quieres realizar la activación 24H?';

  const manual=document.createElement('button');manual.type='button';manual.className='a36-choice';
  const mi=document.createElement('span');mi.className='a36-choice-icon';mi.textContent='📄';
  const mc=document.createElement('span');mc.className='a36-choice-copy';
  const ms=document.createElement('strong');ms.textContent='Abrir el manual PDF';
  const md=document.createElement('span');md.textContent='Se abre fuera de la app, directamente en el visor PDF del teléfono';
  mc.append(ms,md);manual.append(mi,mc);

  const guided=document.createElement('button');guided.type='button';guided.className='a36-choice';
  const gi=document.createElement('span');gi.className='a36-choice-icon';gi.textContent='➡️';
  const gc=document.createElement('span');gc.className='a36-choice-copy';
  const gs=document.createElement('strong');gs.textContent='Ser guiado por la app';
  const gd=document.createElement('span');gd.textContent='Continuar paso a paso con controles y avisos automáticos';
  gc.append(gs,gd);guided.append(gi,gc);

  const note=document.createElement('div');note.className='a36-manual-note';note.hidden=true;
  const noteStrong=document.createElement('strong');noteStrong.textContent='Manual operativo · versión 2.1';
  const noteText=document.createElement('span');noteText.textContent=' El PDF se ha abierto en una pestaña nueva.';
  note.append(noteStrong,noteText);

  manual.addEventListener('click',()=>{
    window.open('../Manual_24H_DFM_v2_1.pdf','_blank','noopener');
    note.hidden=false;
  });
  guided.addEventListener('click',()=>{
    bypassGate=true;
    button?.click();
  });

  card.append(h,manual,guided,note);shell.append(header,card);content.append(shell);
}

nav?.addEventListener('click',event=>{
  const button=event.target.closest('[data-alpha34-24h]');
  if(!button)return;
  if(bypassGate){bypassGate=false;return;}
  event.preventDefault();
  event.stopImmediatePropagation();
  showStartGate(button);
},true);

function parseKm(value){const digits=String(value||'').replace(/\D/g,'');return digits?Number(digits):0;}
function currentShell(){return content?.querySelector('.h24-shell')||null;}
function currentDfm(shell){
  const raw=String(shell?.querySelector('#h24-dfm')?.value||'').trim().toUpperCase();
  const match=raw.match(/(?:DFM\s*)?(\d{3,5})/i);
  if(match)return match[1];
  const ctx=String(shell?.querySelector('.h24-context strong')?.textContent||'');
  return ctx.match(/(\d{3,5})/)?.[1]||'';
}
function nextButton(shell){return shell?.querySelector('.h24-nav .button.primary')||null;}

function clearKmBlock(shell){
  shell?.querySelector('#a36-km-block')?.remove();
  shell?.querySelector('#h24-km')?.classList.remove('a36-km-over');
  const next=nextButton(shell);
  if(next?.dataset.a36KmBlocked==='1'){
    next.disabled=false;
    delete next.dataset.a36KmBlocked;
  }
}

function showKmBlock(shell,km,limit){
  clearKmBlock(shell);
  const input=shell.querySelector('#h24-km');
  const next=nextButton(shell);
  input?.classList.add('a36-km-over');
  if(next){next.disabled=true;next.dataset.a36KmBlocked='1';}

  const box=document.createElement('div');box.id='a36-km-block';box.className='h24-status danger a36-km-block';
  const title=document.createElement('strong');title.textContent='⛔ FUERA DE COBERTURA POR KILÓMETROS';
  const detail=document.createElement('div');detail.textContent=`KM actuales: ${km.toLocaleString('es-ES')} · Fin de contrato: ${limit.toLocaleString('es-ES')} km. No puedes continuar con la activación 24H desde la app.`;
  const instruction=document.createElement('div');instruction.style.marginTop='8px';instruction.textContent='Llama por este orden:';
  const list=document.createElement('div');list.className='a36-contact-list';
  ESCALATION.forEach(c=>{
    const a=document.createElement('a');a.className='a36-contact';a.href=`tel:${c.tel}`;
    const left=document.createElement('span');
    const name=document.createElement('strong');name.textContent=c.name;
    const small=document.createElement('small');small.textContent=c.detail;
    left.append(name,small);
    const phone=document.createElement('b');phone.textContent=`${c.phone} · Ext. ${c.ext}`;
    a.append(left,phone);list.append(a);
  });
  box.append(title,detail,instruction,list);
  const anchor=input?.closest('label')||shell.querySelector('.h24-card');
  if(anchor?.parentNode)anchor.after(box);
}

async function enforceKmContract(){
  const shell=currentShell();
  const input=shell?.querySelector('#h24-km');
  if(!shell||!input)return;
  const dfm=currentDfm(shell);const km=parseKm(input.value);
  if(!dfm||!km){clearKmBlock(shell);return;}
  const token=++contractToken;
  const {data,error}=await supabase.from('vehiculos').select('dfm,fin_contrato_km').eq('dfm',dfm).maybeSingle();
  if(token!==contractToken)return;
  if(error||!data){clearKmBlock(shell);return;}
  const limit=Number(data.fin_contrato_km||0);
  if(limit>0&&km>limit)showKmBlock(shell,km,limit);else clearKmBlock(shell);
}

content?.addEventListener('input',event=>{if(event.target?.id==='h24-km')enforceKmContract();});
content?.addEventListener('change',event=>{if(event.target?.id==='h24-dfm')setTimeout(enforceKmContract,0);});
