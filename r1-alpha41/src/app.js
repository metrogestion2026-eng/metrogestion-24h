import '../../r1-alpha40/src/app.js';

const VERSION='r1.0.0-alpha.41';
const versionNode=document.querySelector('#app-version');
if(versionNode)versionNode.textContent=VERSION;

const content=document.querySelector('#module-content');
const MERCEDES_PHONE='0080057777777';
const MERCEDES_PORTAL='https://mytruckpoint.mercedes-benz-trucks.com/landing';

function ensureStyle(){
  if(document.querySelector('#alpha41-style'))return;
  const s=document.createElement('style');
  s.id='alpha41-style';
  s.textContent=`.a41-mercedes-first{display:grid;gap:8px;padding:12px;border:1px solid #dbe5ec;border-radius:12px;background:#f8fafc}.a41-mercedes-first .button{width:100%;box-sizing:border-box}.a41-mercedes-second{font-weight:700;margin-top:2px}.a41-auto-phone{background:#f1f5f9!important;font-weight:700}`;
  document.head.append(s);
}
ensureStyle();

function summaryValue(label){
  const rows=[...(content?.querySelectorAll('.h24-summary-row')||[])];
  const row=rows.find(r=>r.firstElementChild?.textContent?.trim().toLowerCase()===label.toLowerCase());
  return row?.lastElementChild?.textContent?.trim()||'';
}

function patchMercedesStep(){
  const mode=content?.querySelector('#a40-call-mode');
  if(!mode||mode.dataset.alpha41==='1')return;
  const brandModel=summaryValue('Marca / modelo').toUpperCase();
  if(!brandModel.startsWith('MERCEDES'))return;

  mode.dataset.alpha41='1';
  const phone=mode.querySelector('#a40-assistance-phone');
  const call=mode.querySelector('#a40-call-button');
  const phoneWrap=phone?.closest('label');
  if(!phone||!call||!phoneWrap)return;

  const first=document.createElement('section');
  first.id='a41-mercedes-first';
  first.className='a41-mercedes-first';
  const title=document.createElement('strong');
  title.textContent='1. Primera opción · Mercedes-Benz Trucks';
  const text=document.createElement('span');
  text.textContent='Comunica la avería mediante My TruckPoint for Mercedes-Benz Trucks. La información del vehículo queda preparada para acelerar la asistencia.';
  const open=document.createElement('a');
  open.className='button primary';
  open.href=MERCEDES_PORTAL;
  open.target='_blank';
  open.rel='noopener';
  open.textContent='Abrir Mercedes / My TruckPoint';
  first.append(title,text,open);
  phoneWrap.before(first);

  const second=document.createElement('div');
  second.className='a41-mercedes-second';
  second.textContent='2. Si no puedes hacerlo por Mercedes / My TruckPoint, llama al Service24h';
  phoneWrap.before(second);

  const label=phoneWrap.querySelector('span');
  if(label)label.textContent='Mercedes-Benz Trucks Service24h';
  phone.value=MERCEDES_PHONE;
  phone.readOnly=true;
  phone.classList.add('a41-auto-phone');
  const note=phoneWrap.querySelector('.a40-note');
  if(note)note.textContent='Número oficial Mercedes-Benz Trucks Service24h · 00800 5 777 7777.';
  phone.dispatchEvent(new Event('input',{bubbles:true}));
  call.textContent='📞 Llamar al Service24h';
  call.disabled=false;
}

const observer=new MutationObserver(()=>patchMercedesStep());
if(content)observer.observe(content,{childList:true,subtree:true});
patchMercedesStep();
