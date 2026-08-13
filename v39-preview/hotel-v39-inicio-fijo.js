// v39 preview · botón fijo solo dentro de pantallas internas autenticadas.
(() => {
  'use strict';
  if (window.__metrogestionV39HomeFixedLoaded) return;
  window.__metrogestionV39HomeFixedLoaded = true;

  const URL='https://njtohfkqjjoavtumtmza.supabase.co';
  const KEY='sb_publishable_w1a9DClOM0S4HVJdv_TbKg_W_UkN2W_';
  const sb=window.supabase?.createClient?.(URL,KEY);
  if(!sb) return;

  let authenticated=false;

  function loginVisible(){
    const el=document.querySelector('#incidence-access-mockup .login-wrap');
    if(!el) return false;
    const style=getComputedStyle(el);
    return style.display!=='none' && style.visibility!=='hidden' && el.getClientRects().length>0;
  }

  function removeInternalLoginHint(){
    const target='Utiliza la contraseña creada en Supabase';
    document.querySelectorAll('#incidence-access-mockup .login-wrap p,#incidence-access-mockup .login-wrap small,#incidence-access-mockup .login-wrap .text-small,#incidence-access-mockup .login-wrap span,#incidence-access-mockup .login-wrap div').forEach(el=>{
      const text=(el.textContent||'').replace(/\s+/g,' ').trim();
      if(text.includes(target) && text.length<140) el.remove();
    });
  }

  function removeButton(){
    document.getElementById('v39-home-fixed')?.remove();
  }

  function ensureButton(){
    removeInternalLoginHint();
    if(!authenticated || loginVisible()){
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
      document.querySelectorAll('#v39-modal,#v39-assign-modal,#v39-tedit-modal,#v39-mail-modal,#v39-workshop-modal,#v39-workshop-multi-modal').forEach(x=>x.remove?.());
      const hotel=document.querySelector('#hotel-tab');
      if(hotel && !hotel.classList.contains('hidden')) hotel.click();
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

  const observer=new MutationObserver(ensureButton);
  observer.observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['class','style']});

  sb.auth.onAuthStateChange((_event,session)=>{
    authenticated=!!session;
    ensureButton();
  });

  setInterval(ensureButton,700);
  syncAuth();
})();
