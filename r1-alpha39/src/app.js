import '../../r1-alpha38/src/app.js';

const VERSION='r1.0.0-alpha.39';
const versionNode=document.querySelector('#app-version');
if(versionNode)versionNode.textContent=VERSION;

const content=document.querySelector('#module-content');
const captured={km:'',color:'',trailer:''};

function rememberCurrentFields(){
  const km=content?.querySelector('#h24-km');
  if(km)captured.km=km.value.trim();
  const color=content?.querySelector('#h24-color');
  if(color)captured.color=color.value.trim();
  const trailer=content?.querySelector('#h24-trailer');
  if(trailer)captured.trailer=trailer.value.trim();
}

function makeRow(id,label,value){
  const row=document.createElement('div');
  row.id=id;
  row.className='h24-summary-row';
  const key=document.createElement('strong');
  key.textContent=label;
  const val=document.createElement('div');
  val.textContent=value||'—';
  row.append(key,val);
  return row;
}

function formatKm(value){
  const digits=String(value||'').replace(/\D/g,'');
  if(!digits)return '';
  const n=Number(digits);
  return Number.isFinite(n)?`${n.toLocaleString('es-ES')} km`:String(value);
}

function findSummaryRow(summary,label){
  return [...summary.querySelectorAll('.h24-summary-row')].find(row=>{
    const first=row.firstElementChild?.textContent?.trim().toLowerCase();
    return first===label.toLowerCase();
  })||null;
}

function patchReviewSummary(){
  const summary=content?.querySelector('.h24-summary');
  if(!summary)return;

  const kmValue=formatKm(captured.km);
  if(kmValue&&!summary.querySelector('#a39-km-row')){
    const row=makeRow('a39-km-row','Kilómetros actuales',kmValue);
    const anchor=findSummaryRow(summary,'UPC')||findSummaryRow(summary,'Matrícula');
    anchor?anchor.after(row):summary.prepend(row);
  }

  if(captured.color&&!summary.querySelector('#a39-color-row')){
    const row=makeRow('a39-color-row','Color del aviso',captured.color);
    const anchor=findSummaryRow(summary,'Código alarma');
    anchor?anchor.after(row):summary.append(row);
  }

  if(captured.trailer&&!summary.querySelector('#a39-trailer-row')){
    const row=makeRow('a39-trailer-row','Semirremolque',captured.trailer);
    const anchor=findSummaryRow(summary,'Carga');
    anchor?anchor.before(row):summary.append(row);
  }
}

content?.addEventListener('input',event=>{
  if(['h24-km','h24-trailer'].includes(event.target?.id))rememberCurrentFields();
});
content?.addEventListener('change',event=>{
  if(['h24-color','h24-trailer','h24-km'].includes(event.target?.id))rememberCurrentFields();
});

const observer=new MutationObserver(()=>{
  rememberCurrentFields();
  patchReviewSummary();
});
if(content)observer.observe(content,{childList:true,subtree:true});

rememberCurrentFields();
patchReviewSummary();
