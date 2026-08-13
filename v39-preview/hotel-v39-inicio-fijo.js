// v39 preview · botón fijo para volver a Gestión/Hotel desde pantallas internas autenticadas.
(() => {
  'use strict';
  if (window.__metrogestionV39HomeFixedLoaded) return;
  window.__metrogestionV39HomeFixedLoaded = true;

  const URL='https://njtohfkqjjoavtumtmza.supabase.co';
  const KEY='sb_publishable_w1a9DClOM0S4HVJdv_TbKg_W_UkN2W_';
  const sb=window.supabase?.createClient?.(URL,KEY);
  if(!sb) return;

  let authenticated=false;

  function removeButton(){
    document.getElementById('v39-home-fixed')?.remove();
  }

  function ensureButton(){
    if(!authenticated){
      removeButton();
      return;
    }
    if(document.getElementById('v39-home-fixed')) return;
    const b=document.createElement('button');
    b.id='v39-home-fixed';
    b.type='button';
    b.textContent='🏠 Gestión';
    b.setAttribute('aria-label','Volver a Gestión de Mantenimiento');
    b.style.cssText='position:fixed;right:14px;bottom:14px;z-index:9000;min-height:48px;padding:10px 16px;border:0;border-radius:999px;background:#075985;color:#fff;font-weight:900;font-size:15px;box-shadow:0 8px 24px rgba(15,23,42,.28);cursor:pointer;';
    b.addEventListener('click',()=>{
      // Cierra modales v39 abiertos.
      document.querySelectorAll('#v39-modal,#v39-assign-modal,#v39-tedit-modal,#v39-mail-modal,#v39-workshop-modal,#v39-workshop-multi-modal').forEach(x=>x.remove?.());
      // Entrada principal al Hotel.
      const hotel=document.querySelector('#hotel-tab');
      if(hotel && !hotel.classList.contains('hidden')) hotel.click();
      // Fuerza la vista general de Pizarra actual.
      setTimeout(()=>{
        const board=document.querySelector('.hotel-subtab[data-hotel-view="board"]');
        if(board) board.click();
        document.querySelector('#v39-view-tprog')?.classList.add('hidden');
        document.querySelector('#v39-view-talleres')?.classList.add('hidden');
        try{window.scrollTo({top:0,behavior:'smooth'});}catch{window.scrollTo(0,0)}
      },80);
    });
    document.body.appendChild(b);
  }

  async function syncAuth(){
    const {data:{session}}=await sb.auth.getSession();
    authenticated=!!session;
    ensureButton();
  }

  const observer=new MutationObserver(()=>{
    if(authenticated) ensureButton();
    else removeButton();
  });
  observer.observe(document.documentElement,{childList:true,subtree:true});

  sb.auth.onAuthStateChange((_event,session)=>{
    authenticated=!!session;
    ensureButton();
  });

  syncAuth();
})();
