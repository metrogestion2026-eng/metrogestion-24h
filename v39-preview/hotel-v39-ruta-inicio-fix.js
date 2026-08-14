// v39 preview · mantiene visibles las pestañas principales durante la sesión, sin navegación automática.
(() => {
  'use strict';
  if (window.__metrogestionV39RouteFixLoaded) return;
  window.__metrogestionV39RouteFixLoaded = true;

  const URL='https://njtohfkqjjoavtumtmza.supabase.co';
  const KEY='sb_publishable_w1a9DClOM0S4HVJdv_TbKg_W_UkN2W_';
  const sb=window.supabase?.createClient?.(URL,KEY);
  if(!sb) return;

  let applying=false;
  let perms=null;
  let observer=null;
  let repairQueued=false;

  const visible=el=>{
    if(!el) return false;
    const s=getComputedStyle(el);
    return s.display!=='none' && s.visibility!=='hidden' && el.getClientRects().length>0;
  };

  function appReady(){
    const app=document.querySelector('#mock-app');
    const login=document.querySelector('#mock-login');
    const label=document.querySelector('#session-label');
    return visible(app) && !visible(login) && String(label?.textContent||'').trim().length>0;
  }

  async function can(mod){
    const {data,error}=await sb.rpc('puede_ver_modulo_v39',{p_modulo:mod});
    return !error && data===true;
  }

  function showTab(tab,allowed){
    if(!tab) return;
    if(allowed){
      if(tab.classList.contains('hidden')) tab.classList.remove('hidden');
      tab.removeAttribute('hidden');
      tab.removeAttribute('aria-hidden');
      tab.setAttribute('aria-disabled','false');
      tab.classList.remove('locked-tab');
      if(tab.style.display==='none') tab.style.removeProperty('display');
      if(tab.style.visibility==='hidden') tab.style.removeProperty('visibility');
      if(tab.style.opacity==='0') tab.style.removeProperty('opacity');
    } else {
      if(!tab.classList.contains('hidden')) tab.classList.add('hidden');
      tab.setAttribute('aria-disabled','true');
    }
  }

  function enforceTabs(){
    if(!perms || !appReady()) return;
    const nav=document.querySelector('#mock-app .tabs');
    const activation=document.querySelector('#activate-tab');
    const hotel=document.querySelector('#hotel-tab');

    // Si otra capa mueve los botones al cambiar de vista, se devuelven a su menú original.
    if(nav && activation && activation.parentElement!==nav) nav.insertBefore(activation,nav.firstChild);
    if(nav && hotel && hotel.parentElement!==nav) nav.insertBefore(hotel,activation?.nextSibling || nav.firstChild);

    showTab(activation,perms.activar);
    showTab(hotel,perms.gestion);

    // Si Hotel está abierto, el botón permanece visible y marcado como activo.
    const hotelView=document.querySelector('#view-hotel');
    if(hotel && perms.gestion && hotelView && !hotelView.classList.contains('hidden')){
      hotel.classList.add('btn-primary');
      hotel.classList.remove('btn-secondary','locked-tab','hidden');
    }
  }

  function queueRepair(){
    if(repairQueued) return;
    repairQueued=true;
    requestAnimationFrame(()=>{
      repairQueued=false;
      enforceTabs();
    });
  }

  function installObserver(){
    observer?.disconnect();
    const nav=document.querySelector('#mock-app .tabs');
    const activation=document.querySelector('#activate-tab');
    const hotel=document.querySelector('#hotel-tab');
    if(!nav || !activation || !hotel) return;
    observer=new MutationObserver(queueRepair);
    observer.observe(nav,{childList:true,subtree:false});
    observer.observe(activation,{attributes:true,attributeFilter:['class','style','hidden','aria-hidden','aria-disabled']});
    observer.observe(hotel,{attributes:true,attributeFilter:['class','style','hidden','aria-hidden','aria-disabled']});
  }

  async function apply(){
    if(applying || !appReady()) return;
    applying=true;
    try{
      const {data:{session}}=await sb.auth.getSession();
      if(!session) return;
      const [activar,hotel,tprog,talleres]=await Promise.all([
        can('activar24h'),can('hotel'),can('t_programadas'),can('talleres')
      ]);
      perms={activar,hotel,tprog,talleres,gestion:hotel||tprog||talleres};
      enforceTabs();
      installObserver();
    } finally {
      applying=false;
    }
  }

  sb.auth.onAuthStateChange((_event,session)=>{
    if(!session){
      perms=null;
      observer?.disconnect();
      observer=null;
      return;
    }
    setTimeout(apply,500);
    setTimeout(apply,1200);
  });

  window.addEventListener('focus',()=>setTimeout(apply,120));
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)setTimeout(apply,120)});
  setTimeout(apply,800);
  setTimeout(apply,1800);
})();
