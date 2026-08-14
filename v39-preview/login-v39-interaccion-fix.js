// v39 preview · garantiza que ninguna capa transparente bloquee el formulario de acceso.
(() => {
  'use strict';
  if (window.__metrogestionV39LoginInteractionFixLoaded) return;
  window.__metrogestionV39LoginInteractionFixLoaded = true;

  const OVERLAYS = ['#v39-modal','#v39-assign-modal','#update-notice','#v39-home-fixed'];

  function loginVisible(){
    const login=document.querySelector('#mock-login');
    if(!login) return false;
    const s=getComputedStyle(login);
    return s.display!=='none' && s.visibility!=='hidden' && login.getClientRects().length>0;
  }

  function repair(){
    if(!loginVisible()) return;
    const login=document.querySelector('#mock-login');
    const form=document.querySelector('#login-form');
    const user=document.querySelector('#mock-user');
    const pass=document.querySelector('#mock-pin');
    const enter=document.querySelector('#mock-enter');

    [login,form,user,pass,enter].forEach(el=>{
      if(!el) return;
      el.removeAttribute('inert');
      el.removeAttribute('aria-hidden');
      el.style.pointerEvents='auto';
      el.style.position=el===login||el===form ? 'relative' : (el.style.position||'relative');
      el.style.zIndex='2147483000';
    });

    [user,pass].forEach(input=>{
      if(!input) return;
      input.disabled=false;
      input.readOnly=false;
      input.removeAttribute('disabled');
      input.removeAttribute('readonly');
      input.tabIndex=0;
      input.style.touchAction='manipulation';
      input.style.userSelect='text';
      input.style.webkitUserSelect='text';
    });

    OVERLAYS.forEach(selector=>{
      document.querySelectorAll(selector).forEach(el=>{
        el.style.setProperty('display','none','important');
        el.style.setProperty('pointer-events','none','important');
      });
    });
  }

  const style=document.createElement('style');
  style.id='v39-login-interaction-css';
  style.textContent=`
    #mock-login{position:relative!important;z-index:2147483000!important;pointer-events:auto!important}
    #mock-login #login-form,#mock-login input,#mock-login button{position:relative!important;z-index:2147483001!important;pointer-events:auto!important}
    #mock-login input{touch-action:manipulation!important;-webkit-user-select:text!important;user-select:text!important}
  `;
  document.head.appendChild(style);

  document.addEventListener('pointerdown',e=>{
    if(e.target.closest?.('#mock-login')) repair();
  },true);
  document.addEventListener('touchstart',e=>{
    if(e.target.closest?.('#mock-login')) repair();
  },{capture:true,passive:true});
  window.addEventListener('focus',repair);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)repair();});
  setInterval(repair,500);
  setTimeout(repair,0);
})();