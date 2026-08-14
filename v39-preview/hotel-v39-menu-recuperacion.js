// v39 preview · menú de recuperación robusto para sesiones restauradas.
(() => {
  'use strict';
  if (window.__metrogestionV39RecoveryMenuLoaded) return;
  window.__metrogestionV39RecoveryMenuLoaded = true;

  const URL='https://njtohfkqjjoavtumtmza.supabase.co';
  const KEY='sb_publishable_w1a9DClOM0S4HVJdv_TbKg_W_UkN2W_';
  const sb=window.supabase?.createClient?.(URL,KEY);
  if(!sb) return;

  let running=false;
  let observer=null;
  let perms=null;

  const isVisible=el=>{
    if(!el) return false;
    const s=getComputedStyle(el);
    return s.display!=='none' && s.visibility!=='hidden' && el.getClientRects().length>0;
  };

  function authenticatedUiReady(){
    const app=document.querySelector('#mock-app');
    const login=document.querySelector('#mock-login');
    const label=document.querySelector('#session-label');
    return isVisible(app) && !isVisible(login) && !!String(label?.textContent||'').trim();
  }

  async function can(mod){
    const {data,error}=await sb.rpc('puede_ver_modulo_v39',{p_modulo:mod});
    return !error && data===true;
  }

  function ensureContainer(){
    const app=document.querySelector('#mock-app');
    if(!app) return null;
    let box=document.querySelector('#v39-recovery-menu');
    if(!box){
      box=document.createElement('nav');
      box.id='v39-recovery-menu';
      box.className='tabs';
      box.setAttribute('aria-label','Accesos principales v39');
      const topbar=app.querySelector('.topbar');
      topbar?.insertAdjacentElement('afterend',box);
    }
    box.classList.remove('hidden');
    box.style.removeProperty('display');
    return box;
  }

  function makeButton(id,label,target,allowed){
    let btn=document.querySelector('#'+id);
    if(!allowed){ btn?.remove(); return; }
    if(!btn){
      btn=document.createElement('button');
      btn.id=id;
      btn.type='button';
      btn.className='btn btn-secondary';
      btn.textContent=label;
      btn.addEventListener('click',()=>document.querySelector(target)?.click());
      ensureContainer()?.appendChild(btn);
    }
    btn.classList.remove('hidden');
    btn.style.removeProperty('display');
  }

  function sync(){
    if(!authenticatedUiReady() || !perms) return;

    const nativeActivate=document.querySelector('#activate-tab');
    const nativeHotel=document.querySelector('#hotel-tab');
    const nativeTabs=nativeActivate?.parentElement;
    const nativeHealthy=isVisible(nativeActivate) && (!perms.hotel || isVisible(nativeHotel));

    if(nativeHealthy){
      document.querySelector('#v39-recovery-menu')?.remove();
      return;
    }

    const box=ensureContainer();
    if(!box) return;
    makeButton('v39-recovery-activate','Activar 24H','#activate-tab',perms.activar);
    makeButton('v39-recovery-hotel','Hotel · Pizarra diaria','#hotel-tab',perms.hotel);

    const hotelView=document.querySelector('#view-hotel');
    const activateView=document.querySelector('#view-incidences');
    const h=document.querySelector('#v39-recovery-hotel');
    const a=document.querySelector('#v39-recovery-activate');
    if(h){
      const active=hotelView && !hotelView.classList.contains('hidden');
      h.classList.toggle('btn-primary',active);
      h.classList.toggle('btn-secondary',!active);
    }
    if(a){
      const active=activateView && !activateView.classList.contains('hidden');
      a.classList.toggle('btn-primary',active);
      a.classList.toggle('btn-secondary',!active);
    }
  }

  async function apply(){
    if(running || !authenticatedUiReady()) return;
    running=true;
    try{
      const {data:{session}}=await sb.auth.getSession();
      if(!session) return;
      const [activar,hotel]=await Promise.all([can('activar24h'),can('hotel')]);
      perms={activar,hotel};
      sync();
      observer?.disconnect();
      const app=document.querySelector('#mock-app');
      if(app){
        observer=new MutationObserver(()=>requestAnimationFrame(sync));
        observer.observe(app,{subtree:true,childList:true,attributes:true,attributeFilter:['class','style','hidden','aria-hidden']});
      }
    } finally { running=false; }
  }

  document.addEventListener('click',e=>{
    if(e.target.closest?.('#activate-tab,#hotel-tab,.hotel-subtab')) requestAnimationFrame(sync);
  },true);

  sb.auth.onAuthStateChange((_event,session)=>{
    if(!session){ perms=null; observer?.disconnect(); observer=null; document.querySelector('#v39-recovery-menu')?.remove(); return; }
    setTimeout(apply,120);
    setTimeout(apply,700);
    setTimeout(apply,1600);
  });

  const timer=setInterval(()=>{
    if(perms) sync(); else apply();
  },500);
  setTimeout(()=>clearInterval(timer),20000);

  window.addEventListener('focus',()=>setTimeout(apply,80));
  document.addEventListener('visibilitychange',()=>{ if(!document.hidden) setTimeout(apply,80); });
  setTimeout(apply,250);
})();
