// v39 preview · visibilidad de pestañas principales después del login, sin navegación automática.
(() => {
  'use strict';
  if (window.__metrogestionV39RouteFixLoaded) return;
  window.__metrogestionV39RouteFixLoaded = true;

  const URL='https://njtohfkqjjoavtumtmza.supabase.co';
  const KEY='sb_publishable_w1a9DClOM0S4HVJdv_TbKg_W_UkN2W_';
  const sb=window.supabase?.createClient?.(URL,KEY);
  if(!sb) return;

  let applying=false;

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
    tab.classList.toggle('hidden',!allowed);
    if(allowed){
      tab.removeAttribute('hidden');
      tab.removeAttribute('aria-hidden');
      tab.setAttribute('aria-disabled','false');
      tab.classList.remove('locked-tab');
      tab.style.removeProperty('display');
      tab.style.removeProperty('visibility');
      tab.style.removeProperty('opacity');
    } else {
      tab.setAttribute('aria-disabled','true');
    }
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
      showTab(document.querySelector('#activate-tab'),activar);
      showTab(document.querySelector('#hotel-tab'),hotel||tprog||talleres);
    } finally {
      applying=false;
    }
  }

  sb.auth.onAuthStateChange((_event,session)=>{
    if(session){
      setTimeout(apply,500);
      setTimeout(apply,1200);
    }
  });
  window.addEventListener('focus',()=>setTimeout(apply,120));
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)setTimeout(apply,120)});
  setTimeout(apply,800);
  setTimeout(apply,1800);
})();
