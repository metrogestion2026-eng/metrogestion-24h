// v39 preview · menú principal robusto para sesiones restauradas.
// No navega automáticamente: solo garantiza que 24H y Hotel estén disponibles según permisos.
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
  let repairQueued=false;

  const isVisible=el=>{
    if(!el) return false;
    const s=getComputedStyle(el);
    return s.display!=='none' && s.visibility!=='hidden' && el.getClientRects().length>0;
  };

  function authenticatedUiReady(){
    const app=document.querySelector('#mock-app');
    const login=document.querySelector('#mock-login');
    return isVisible(app) && !isVisible(login);
  }

  async function rpcBool(name,args={}){
    try{
      const {data,error}=await sb.rpc(name,args);
      return !error && data===true;
    }catch{return false}
  }

  function show(el){
    if(!el) return;
    el.classList.remove('hidden','locked-tab');
    el.removeAttribute('hidden');
    el.removeAttribute('aria-hidden');
    el.setAttribute('aria-disabled','false');
    el.style.removeProperty('display');
    el.style.removeProperty('visibility');
    el.style.removeProperty('opacity');
    el.style.removeProperty('pointer-events');
  }

  function hide(el){
    if(!el) return;
    el.classList.add('hidden');
    el.setAttribute('aria-disabled','true');
  }

  function ensureNativeTabs(){
    if(!perms || !authenticatedUiReady()) return false;
    const activate=document.querySelector('#activate-tab');
    const hotel=document.querySelector('#hotel-tab');
    if(!activate || !hotel) return false;

    const nav=activate.parentElement || hotel.parentElement;
    show(nav);

    if(perms.activar) show(activate); else hide(activate);
    if(perms.hotel) show(hotel); else hide(hotel);

    // Si por una reconstrucción ambos botones acabaron en contenedores distintos,
    // se vuelven a agrupar en el contenedor principal sin cambiar de vista.
    if(nav && hotel.parentElement!==nav) nav.insertBefore(hotel,activate.nextSibling);

    const hotelView=document.querySelector('#view-hotel');
    if(perms.hotel && hotelView && !hotelView.classList.contains('hidden')){
      hotel.classList.add('btn-primary');
      hotel.classList.remove('btn-secondary');
    }
    const actView=document.querySelector('#view-incidences');
    if(perms.activar && actView && !actView.classList.contains('hidden')){
      activate.classList.add('btn-primary');
      activate.classList.remove('btn-secondary');
    }
    return true;
  }

  function ensureRecoveryContainer(){
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
    show(box);
    return box;
  }

  function recoveryButton(id,label,target,allowed){
    let btn=document.querySelector('#'+id);
    if(!allowed){btn?.remove();return}
    if(!btn){
      btn=document.createElement('button');
      btn.id=id;
      btn.type='button';
      btn.className='btn btn-secondary';
      btn.textContent=label;
      btn.addEventListener('click',()=>document.querySelector(target)?.click());
      ensureRecoveryContainer()?.appendChild(btn);
    }
    show(btn);
  }

  function sync(){
    if(!perms || !authenticatedUiReady()) return;
    ensureNativeTabs();

    const nativeActivate=document.querySelector('#activate-tab');
    const nativeHotel=document.querySelector('#hotel-tab');
    const healthy=(!perms.activar || isVisible(nativeActivate)) && (!perms.hotel || isVisible(nativeHotel));

    if(healthy){
      document.querySelector('#v39-recovery-menu')?.remove();
      return;
    }

    ensureRecoveryContainer();
    recoveryButton('v39-recovery-activate','Activar 24H','#activate-tab',perms.activar);
    recoveryButton('v39-recovery-hotel','Hotel · Pizarra diaria','#hotel-tab',perms.hotel);
  }

  function queueSync(){
    if(repairQueued) return;
    repairQueued=true;
    requestAnimationFrame(()=>{repairQueued=false;sync()});
  }

  function installObserver(){
    observer?.disconnect();
    const app=document.querySelector('#mock-app');
    if(!app) return;
    observer=new MutationObserver(queueSync);
    observer.observe(app,{subtree:true,childList:true,attributes:true,attributeFilter:['class','style','hidden','aria-hidden','aria-disabled']});
  }

  async function apply(){
    if(running || !authenticatedUiReady()) return false;
    running=true;
    try{
      const {data:{session}}=await sb.auth.getSession();
      if(!session) return false;

      const [principal,activar,hotel]=await Promise.all([
        rpcBool('es_administrador_principal'),
        rpcBool('puede_ver_modulo_v39',{p_modulo:'activar24h'}),
        rpcBool('puede_ver_modulo_v39',{p_modulo:'hotel'})
      ]);

      // El administrador principal nunca depende de una lectura intermedia de permisos.
      perms={
        principal,
        activar:principal || activar,
        hotel:principal || hotel
      };
      sync();
      installObserver();
      return true;
    } finally {
      running=false;
    }
  }

  document.addEventListener('click',e=>{
    if(e.target.closest?.('#activate-tab,#hotel-tab,.hotel-subtab,#v39-recovery-menu')) queueSync();
  },true);

  sb.auth.onAuthStateChange((_event,session)=>{
    if(!session){
      perms=null;
      observer?.disconnect();
      observer=null;
      document.querySelector('#v39-recovery-menu')?.remove();
      return;
    }
    setTimeout(apply,100);
    setTimeout(apply,500);
    setTimeout(apply,1200);
    setTimeout(apply,2500);
  });

  // Durante el arranque se vuelven a leer permisos; no se conserva un falso negativo.
  let attempts=0;
  const startup=setInterval(()=>{
    attempts+=1;
    apply();
    if(attempts>=30) clearInterval(startup);
  },600);

  window.addEventListener('focus',()=>setTimeout(apply,60));
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)setTimeout(apply,60)});
  setTimeout(apply,200);
})();
