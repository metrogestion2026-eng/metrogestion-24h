// v39 preview · restaura pestañas según permisos sin navegar automáticamente.
(() => {
  'use strict';
  if (window.__metrogestionV39RouteFixLoaded) return;
  window.__metrogestionV39RouteFixLoaded = true;

  const URL='https://njtohfkqjjoavtumtmza.supabase.co';
  const KEY='sb_publishable_w1a9DClOM0S4HVJdv_TbKg_W_UkN2W_';
  const sb=window.supabase?.createClient?.(URL,KEY);
  if(!sb) return;

  let applying=false;

  async function can(mod){
    const {data,error}=await sb.rpc('puede_ver_modulo_v39',{p_modulo:mod});
    if(error) return false;
    return data===true;
  }

  async function readPerms(){
    const [activar,hotel,tprog,talleres]=await Promise.all([
      can('activar24h'),can('hotel'),can('t_programadas'),can('talleres')
    ]);
    return {activar,hotel,tprog,talleres,gestion:hotel||tprog||talleres};
  }

  function appReady(){
    const login=document.querySelector('#mock-login');
    const app=document.querySelector('#mock-app');
    const label=document.querySelector('#session-label');
    return Boolean(
      login && login.classList.contains('hidden') &&
      app && !app.classList.contains('hidden') &&
      String(label?.textContent||'').trim()
    );
  }

  function showTab(tab,allowed){
    if(!tab) return;
    tab.classList.toggle('hidden',!allowed);
    if(allowed){
      tab.removeAttribute('hidden');
      tab.style.removeProperty('display');
      tab.style.removeProperty('visibility');
      tab.style.removeProperty('opacity');
      tab.removeAttribute('aria-hidden');
      tab.setAttribute('aria-disabled','false');
      tab.classList.remove('locked-tab');
    }else{
      tab.setAttribute('aria-disabled','true');
    }
  }

  function restoreTabs(p){
    const nav=document.querySelector('#mock-app .tabs');
    const activation=document.querySelector('#activate-tab');
    const hotel=document.querySelector('#hotel-tab');

    if(nav && activation && activation.parentElement!==nav) nav.insertBefore(activation,nav.firstChild);
    if(nav && hotel && hotel.parentElement!==nav){
      nav.insertBefore(hotel,activation?.nextSibling||nav.firstChild);
    }

    showTab(activation,p.activar);
    showTab(hotel,p.gestion);

    const hotelView=document.querySelector('#view-hotel');
    if(hotel && hotelView && !hotelView.classList.contains('hidden')){
      hotel.classList.add('btn-primary');
      hotel.classList.remove('btn-secondary');
    }
  }

  async function apply(){
    if(applying || !appReady()) return;
    applying=true;
    try{
      const {data:{session}}=await sb.auth.getSession();
      if(!session) return;
      const p=await readPerms();
      restoreTabs(p);
      // Importante: NO hacemos click en ninguna pestaña aquí.
      // El usuario navega manualmente una vez cargado su perfil.
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
