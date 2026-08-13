// v39 preview · ruta inicial: Hotel por defecto cuando el usuario tiene acceso.
(() => {
  'use strict';
  if (window.__metrogestionV39PreferredEntryLoaded) return;
  window.__metrogestionV39PreferredEntryLoaded = true;

  const URL='https://njtohfkqjjoavtumtmza.supabase.co';
  const KEY='sb_publishable_w1a9DClOM0S4HVJdv_TbKg_W_UkN2W_';
  const sb=window.supabase?.createClient?.(URL,KEY);
  if(!sb) return;

  let openedForSession=false;
  let running=false;

  function visible(el){
    if(!el) return false;
    const s=getComputedStyle(el);
    return s.display!=='none' && s.visibility!=='hidden' && el.getClientRects().length>0;
  }

  function pending24h(){
    if(Number(localStorage.getItem('metrogestion24h_call_return_until')||0)>Date.now()) return true;
    try {
      const p=JSON.parse(localStorage.getItem('metrogestion24h_activation_progress_v1')||'null');
      if(p?.expiresAt && Number(p.expiresAt)>Date.now()) return true;
    } catch {}
    return visible(document.querySelector('#view-activation'));
  }

  async function apply(){
    if(running) return;
    running=true;
    try {
      const {data:{session}}=await sb.auth.getSession();
      const login=document.querySelector('#mock-login');
      const app=document.querySelector('#mock-app');
      if(!session || visible(login) || !visible(app)){
        if(!session || visible(login)) openedForSession=false;
        return;
      }
      if(openedForSession || pending24h()) return;

      const {data,error}=await sb.rpc('puede_ver_modulo_v39',{p_modulo:'hotel'});
      if(error || data!==true) return;

      const hotel=document.querySelector('#hotel-tab');
      if(!hotel) return;
      openedForSession=true;
      hotel.classList.remove('hidden','locked-tab');
      hotel.setAttribute('aria-disabled','false');
      hotel.click();
      setTimeout(()=>{
        document.querySelector('.hotel-subtab[data-hotel-view="board"]')?.click();
        try{window.scrollTo({top:0,behavior:'smooth'});}catch{window.scrollTo(0,0)}
      },100);
    } finally {
      running=false;
    }
  }

  const observer=new MutationObserver(()=>setTimeout(apply,80));
  observer.observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['class','style']});

  sb.auth.onAuthStateChange((_event,session)=>{
    if(!session) openedForSession=false;
    setTimeout(apply,220);
    setTimeout(apply,700);
  });

  setTimeout(apply,500);
  setTimeout(apply,1400);
})();
