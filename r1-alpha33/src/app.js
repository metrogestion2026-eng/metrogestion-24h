import '../../r1-alpha31/src/app.js';

const VERSION='r1.0.0-alpha.33';
const versionNode=document.querySelector('#app-version');
if(versionNode)versionNode.textContent=VERSION;

const moduleContent=document.querySelector('#module-content');
let pendingActive=false;
let observer=null;
let scheduled=false;

function ensureStyle(){
  if(document.querySelector('#alpha33-style'))return;
  const style=document.createElement('style');
  style.id='alpha33-style';
  style.textContent=`
    .hotel-card.alpha33-pending-hidden{display:none!important}
  `;
  document.head.append(style);
}

function findSummaryGrid(){
  if(!moduleContent)return null;
  return [...moduleContent.querySelectorAll('.summary-grid')].find(grid=>{
    const labels=[...grid.querySelectorAll('.metric span')].map(n=>n.textContent.trim());
    return ['Fichas activas','En taller','Pendientes de recoger','Pendientes de recuperar'].every(label=>labels.includes(label));
  })||null;
}

function metricByLabel(grid,label){
  return [...grid.querySelectorAll('.metric')].find(metric=>metric.querySelector('span')?.textContent?.trim()===label)||null;
}

function countPending(){
  return [...moduleContent.querySelectorAll('.hotel-card')].filter(card=>(card.dataset.state||'')==='pendiente_taller').length;
}

function withObserverPaused(fn){
  if(observer)observer.disconnect();
  try{fn();}finally{
    if(observer&&moduleContent)observer.observe(moduleContent,{childList:true,subtree:true});
  }
}

function ensurePendingMetric(){
  const grid=findSummaryGrid();
  if(!grid)return null;
  let metric=grid.querySelector('[data-alpha33-pending="1"]');
  if(!metric){
    withObserverPaused(()=>{
      metric=document.createElement('div');
      metric.className='metric hotel-filter-metric';
      metric.dataset.alpha33Pending='1';
      metric.setAttribute('role','button');
      metric.setAttribute('tabindex','0');
      metric.setAttribute('aria-label','Mostrar solo pendientes de taller');
      metric.setAttribute('aria-pressed','false');
      metric.title='Mostrar solo pendientes de taller';
      const strong=document.createElement('strong');
      strong.textContent='0';
      const span=document.createElement('span');
      span.className='muted';
      span.textContent='Pendientes de taller';
      metric.append(strong,span);
      const workshop=metricByLabel(grid,'En taller');
      if(workshop)grid.insertBefore(metric,workshop);else grid.append(metric);
    });
  }
  const strong=metric.querySelector('strong');
  const next=String(countPending());
  if(strong&&strong.textContent!==next){
    withObserverPaused(()=>{strong.textContent=next;});
  }
  return metric;
}

function clearPending(){
  pendingActive=false;
  moduleContent.querySelectorAll('.hotel-card.alpha33-pending-hidden').forEach(card=>card.classList.remove('alpha33-pending-hidden'));
  const metric=findSummaryGrid()?.querySelector('[data-alpha33-pending="1"]');
  if(metric){
    metric.classList.remove('is-active');
    metric.setAttribute('aria-pressed','false');
  }
}

function applyPending(){
  const metric=ensurePendingMetric();
  if(!metric)return;
  if(!pendingActive){
    metric.classList.remove('is-active');
    metric.setAttribute('aria-pressed','false');
    return;
  }
  moduleContent.querySelectorAll('.hotel-card').forEach(card=>{
    card.classList.toggle('alpha33-pending-hidden',(card.dataset.state||'')!=='pendiente_taller');
  });
  const grid=findSummaryGrid();
  grid?.querySelectorAll('.hotel-filter-metric').forEach(item=>{
    if(item!==metric){
      item.classList.remove('is-active');
      item.setAttribute('aria-pressed','false');
    }
  });
  metric.classList.add('is-active');
  metric.setAttribute('aria-pressed','true');
}

function activatePending(){
  const grid=findSummaryGrid();
  if(!grid)return;
  const all=metricByLabel(grid,'Fichas activas');
  if(all)all.click();
  pendingActive=true;
  applyPending();
}

function sync(){
  scheduled=false;
  const grid=findSummaryGrid();
  if(!grid)return;
  ensurePendingMetric();
  applyPending();
}

function scheduleSync(){
  if(scheduled)return;
  scheduled=true;
  requestAnimationFrame(sync);
}

ensureStyle();

moduleContent?.addEventListener('click',event=>{
  const metric=event.target.closest?.('.summary-grid .metric');
  if(!metric)return;
  if(metric.dataset.alpha33Pending==='1'){
    event.preventDefault();
    activatePending();
    return;
  }
  if(metric.classList.contains('hotel-filter-metric'))clearPending();
});

moduleContent?.addEventListener('keydown',event=>{
  const metric=event.target.closest?.('[data-alpha33-pending="1"]');
  if(!metric||!['Enter',' '].includes(event.key))return;
  event.preventDefault();
  activatePending();
});

if(moduleContent){
  observer=new MutationObserver(scheduleSync);
  observer.observe(moduleContent,{childList:true,subtree:true});
}
requestAnimationFrame(sync);
