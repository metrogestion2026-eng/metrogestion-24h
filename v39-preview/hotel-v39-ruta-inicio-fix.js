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

  function showContainer(nav){
    if(!nav) return;
    nav.classList.remove('hidden');
    nav.removeAttribute('hidden');
    nav.removeAttribute('aria-hidden');
    nav.style.removeProperty('display');
    nav.style.removeProperty('visibility');
    nav.style.removeProperty('opacity');
  }

  function showTab(tab,allowed){
    if(!tab) return;
    if(allowed){
      tab.classList.remove('hidden','locked-tab');
      tab.removeAttribute('hidden');
      tab.removeAttribute('aria-hidden');
      tab.setAttribute('aria-disabled','false');
      tab.style.removeProperty('display');
      tab.style.removeProperty('visibility');
      tab.style.removeProperty('opacity');
    } else {
      tab.classList.add('hidden');
      tab.setAttribute('aria-disabled','true');
    }
  }

  function enforceTabs(){
    if(!perms || !appReady()) return false;
    const nav=document.querySelector('#mock-app .tabs');
    const activation=document.querySelector('#activate-tab');
    const hotel=document.querySelector('#hotel-tab');
    if(!nav || !activation || !hotel) return false;

    showContainer(nav);
    if(activation.parentElement!==nav) nav.insertBefore(activation,nav.firstChild);
    if(hotel.parentElement!==nav) nav.insertBefore(hotel,activation.nextSibling);

    showTab(activation,perms.activar);
    showTab(hotel,perms.gestion);

    const hotelView=document.querySelector('#view-hotel');
    if(perms.gestion && hotelView && !hotelView.classList.contains('hidden')){
      hotel.classList.add('btn-primary');
      hotel.classList.remove('btn-secondary','locked-tab','hidden');
    }
    return true;
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
    if(!nav || !activation || !hotel) return false;
    observer=new MutationObserver(queueRepair);
    observer.observe(nav,{childList:true,subtree:false,attributes:true,attributeFilter:['class','style','hidden','aria-hidden']});
    observer.observe(activation,{attributes:true,attributeFilter:['class','style','hidden','aria-hidden','aria-disabled']});
    observer.observe(hotel,{attributes:true,attributeFilter:['class','style','hidden','aria-hidden','aria-disabled']});
    return true;
  }

  async function apply(){
    if(applying || !appReady()) return false;
    applying=true;
    try{
      const {data:{session}}=await sb.auth.getSession();
      if(!session) return false;
      const [activar,hotel,tprog,talleres]=await Promise.all([
        can('activar24h'),can('hotel'),can('t_programadas'),can('talleres')
      ]);
      perms={activar,hotel,tprog,talleres,gestion:hotel||tprog||talleres};
      enforceTabs();
      installObserver();
      return true;
    } finally {
      applying=false;
    }
  }

  // La restauración de sesión puede tardar varios segundos en Android.
  // Durante el arranque se insiste hasta que el menú y sus botones existen de verdad.
  const startupTimer=setInterval(()=>{
    if(perms){
      enforceTabs();
      installObserver();
    } else {
      apply();
    }
  },400);
  setTimeout(()=>clearInterval(startupTimer),15000);

  document.addEventListener('click',e=>{
    if(e.target.closest?.('#activate-tab,#hotel-tab,.hotel-subtab')) setTimeout(queueRepair,0);
  },true);

  sb.auth.onAuthStateChange((_event,session)=>{
    if(!session){
      perms=null;
      observer?.disconnect();
      observer=null;
      return;
    }
    setTimeout(apply,150);
    setTimeout(apply,600);
    setTimeout(apply,1400);
  });

  window.addEventListener('focus',()=>setTimeout(apply,80));
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)setTimeout(apply,80)});
  setTimeout(apply,300);
})();
