import '../../r1-alpha31/src/app.js';

const VERSION='r1.0.0-alpha.32';
const versionNode=document.querySelector('#app-version');
if(versionNode)versionNode.textContent=VERSION;

const moduleContent=document.querySelector('#module-content');
let pendingActive=false;
let currentGrid=null;
let refreshing=false;

function ensureStyle(){
  if(document.querySelector('#alpha32-style'))return;
  const style=document.createElement('style');
  style.id='alpha32-style';
  style.textContent=`
    .hotel-card.alpha32-pending-hidden{display:none!important}
  `;
  document.head.append(style);
}

function labelsIn(grid){
  return [...grid.querySelectorAll('.metric span')].map(n=>n.textContent.trim());
}

function findSummaryGrid(){
  if(!moduleContent)return null;
  return [...moduleContent.querySelectorAll('.summary-grid')].find(grid=>{
    const labels=labelsIn(grid);
    return ['Fichas activas','En taller','Pendientes de recoger','Pendientes de recuperar'].every(x=>labels.includes(x));
  })||null;
}

function metricByLabel(grid,label){
  return [...grid.querySelectorAll('.metric')].find(m=>m.querySelector('span')?.textContent?.trim()===label)||null;
}

function pendingCount(){
  return [...moduleContent.querySelectorAll('.hotel-card')].filter(card=>(card.dataset.state||'')==='pendiente_taller').length;
}

function ensurePendingMetric(grid){
  let metric=grid.querySelector('[data-alpha32-pending="1"]');
  if(!metric){
    metric=document.createElement('div');
    metric.className='metric hotel-filter-metric';
    metric.dataset.alpha32Pending='1';
    metric.dataset.hotelFilter='pending-workshop';
    metric.setAttribute('role','button');
    metric.setAttribute('tabindex','0');
    metric.setAttribute('aria-label','Mostrar solo pendientes de taller');
    metric.title='Mostrar solo pendientes de taller';
    const strong=document.createElement('strong');
    const span=document.createElement('span');
    span.className='muted';
    span.textContent='Pendientes de taller';
    metric.append(strong,span);
    const workshop=metricByLabel(grid,'En taller');
    if(workshop)grid.insertBefore(metric,workshop);else grid.append(metric);
  }
  const strong=metric.querySelector('strong');
  if(strong)strong.textContent=String(pendingCount());
  return metric;
}

function clearPendingFilter(){
  pendingActive=false;
  moduleContent.querySelectorAll('.hotel-card.alpha32-pending-hidden').forEach(card=>card.classList.remove('alpha32-pending-hidden'));
  const grid=findSummaryGrid();
  const pending=grid?.querySelector('[data-alpha32-pending="1"]');
  if(pending){
    pending.classList.remove('is-active');
    pending.setAttribute('aria-pressed','false');
  }
}

function applyPendingFilter(){
  const grid=findSummaryGrid();
  if(!grid)return;
  const pending=ensurePendingMetric(grid);
  if(!pendingActive){
    pending.classList.remove('is-active');
    pending.setAttribute('aria-pressed','false');
    return;
  }
  moduleContent.querySelectorAll('.hotel-card').forEach(card=>{
    card.classList.toggle('alpha32-pending-hidden',(card.dataset.state||'')!=='pendiente_taller');
  });
  grid.querySelectorAll('.hotel-filter-metric').forEach(metric=>{
    if(metric!==pending){
      metric.classList.remove('is-active');
      metric.setAttribute('aria-pressed','false');
    }
  });
  pending.classList.add('is-active');
  pending.setAttribute('aria-pressed','true');
}

function activatePending(){
  const grid=findSummaryGrid();
  if(!grid)return;
  const all=metricByLabel(grid,'Fichas activas');
  if(all)all.click();
  pendingActive=true;
  applyPendingFilter();
}

function refresh(){
  if(refreshing)return;
  refreshing=true;
  try{
    const grid=findSummaryGrid();
    if(!grid)return;
    if(grid!==currentGrid){
      currentGrid=grid;
      pendingActive=false;
    }
    ensurePendingMetric(grid);
    applyPendingFilter();
  }finally{
    refreshing=false;
  }
}

ensureStyle();

moduleContent?.addEventListener('click',event=>{
  const metric=event.target.closest?.('.summary-grid .metric');
  if(!metric)return;
  if(metric.dataset.alpha32Pending==='1'){
    event.preventDefault();
    activatePending();
    return;
  }
  if(metric.classList.contains('hotel-filter-metric'))clearPendingFilter();
});

moduleContent?.addEventListener('keydown',event=>{
  const metric=event.target.closest?.('.summary-grid .metric');
  if(!metric||metric.dataset.alpha32Pending!=='1'||!['Enter',' '].includes(event.key))return;
  event.preventDefault();
  activatePending();
});

if(moduleContent){
  const observer=new MutationObserver(()=>queueMicrotask(refresh));
  observer.observe(moduleContent,{childList:true,subtree:true});
}
requestAnimationFrame(refresh);
