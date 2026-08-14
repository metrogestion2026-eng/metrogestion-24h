// v39 preview · login estable: campos nuevos/editables y acceso solo tras pulsar Entrar.
(() => {
  'use strict';
  if (window.__metrogestionV39ExplicitLoginLoaded) return;
  window.__metrogestionV39ExplicitLoginLoaded = true;

  let armedUntil = 0;
  let installed = false;

  function freshInput(oldInput){
    if(!oldInput) return null;
    const input=document.createElement('input');
    [...oldInput.attributes].forEach(attr=>input.setAttribute(attr.name,attr.value));
    input.value=oldInput.value||'';
    input.disabled=false;
    input.readOnly=false;
    input.removeAttribute('disabled');
    input.removeAttribute('readonly');
    input.style.pointerEvents='auto';
    input.style.userSelect='text';
    input.style.webkitUserSelect='text';
    input.tabIndex=0;
    oldInput.replaceWith(input);
    return input;
  }

  function enableInput(input){
    if(!input) return;
    input.disabled=false;
    input.readOnly=false;
    input.removeAttribute('disabled');
    input.removeAttribute('readonly');
    input.style.pointerEvents='auto';
    input.style.userSelect='text';
    input.style.webkitUserSelect='text';
    input.tabIndex=0;
  }

  function install(){
    if(installed) return true;
    const form=document.querySelector('#login-form');
    const button=document.querySelector('#mock-enter');
    const oldUser=document.querySelector('#mock-user');
    const oldPassword=document.querySelector('#mock-pin');
    const message=document.querySelector('#login-message');
    if(!form||!button||!oldUser||!oldPassword) return false;

    installed=true;
    const user=freshInput(oldUser);
    const password=freshInput(oldPassword);
    password.type='password';
    form.setAttribute('autocomplete','off');
    button.type='submit';
    button.disabled=false;

    // Solo una pulsación real sobre Entrar permite un único submit.
    const arm=event=>{
      if(event?.isTrusted===false) return;
      armedUntil=Date.now()+1800;
    };
    button.addEventListener('pointerdown',arm,true);
    button.addEventListener('touchstart',arm,{capture:true,passive:true});
    button.addEventListener('mousedown',arm,true);
    button.addEventListener('click',arm,true);

    // Enter/autorrelleno/submits programáticos no inician sesión.
    form.addEventListener('submit',event=>{
      const allowed=armedUntil>Date.now();
      armedUntil=0;
      if(allowed) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if(message) message.textContent='Pulsa el botón Entrar para comprobar el acceso.';
    },true);

    [user,password].forEach(input=>{
      const unlock=()=>enableInput(input);
      input.addEventListener('pointerdown',unlock,true);
      input.addEventListener('touchstart',unlock,{capture:true,passive:true});
      input.addEventListener('focus',unlock,true);
      input.addEventListener('keydown',event=>{
        if(event.key!=='Enter') return;
        event.preventDefault();
        event.stopImmediatePropagation();
        if(message) message.textContent='Pulsa el botón Entrar para continuar.';
      },true);
    });

    const repair=()=>{
      enableInput(document.querySelector('#mock-user'));
      enableInput(document.querySelector('#mock-pin'));
      button.disabled=false;
    };
    window.addEventListener('focus',repair);
    document.addEventListener('visibilitychange',()=>{if(!document.hidden)repair();});
    setInterval(repair,750);
    return true;
  }

  if(!install()){
    const timer=setInterval(()=>{if(install())clearInterval(timer);},100);
    setTimeout(()=>clearInterval(timer),10000);
  }
})();
