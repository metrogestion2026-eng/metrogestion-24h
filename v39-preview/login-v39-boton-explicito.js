// v39 preview · login estable: campos editables y acceso solo tras pulsación real en Entrar.
(() => {
  'use strict';
  if (window.__metrogestionV39ExplicitLoginLoaded) return;
  window.__metrogestionV39ExplicitLoginLoaded = true;

  let armedUntil = 0;
  let installed = false;

  function enableInput(input){
    if(!input) return;
    input.disabled = false;
    input.readOnly = false;
    input.removeAttribute('disabled');
    input.removeAttribute('readonly');
    input.style.pointerEvents = 'auto';
    input.style.userSelect = 'text';
    input.style.webkitUserSelect = 'text';
    input.tabIndex = 0;
  }

  function install(){
    if (installed) return true;
    const form = document.querySelector('#login-form');
    const button = document.querySelector('#mock-enter');
    const user = document.querySelector('#mock-user');
    const password = document.querySelector('#mock-pin');
    const message = document.querySelector('#login-message');
    if (!form || !button || !user || !password) return false;
    installed = true;

    enableInput(user);
    enableInput(password);
    password.type = 'password';
    form.setAttribute('autocomplete','off');
    button.type = 'submit';
    button.disabled = false;

    // Solo una pulsación física sobre Entrar arma un único submit.
    const arm = event => {
      if (event && event.isTrusted === false) return;
      armedUntil = Date.now() + 1800;
    };
    button.addEventListener('pointerdown', arm, true);
    button.addEventListener('touchstart', arm, {capture:true, passive:true});
    button.addEventListener('mousedown', arm, true);
    button.addEventListener('click', arm, true);

    // Enter, autofill o un submit programático no pueden iniciar sesión.
    form.addEventListener('submit', event => {
      const allowed = armedUntil > Date.now();
      armedUntil = 0;
      if (allowed) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (message) message.textContent = 'Pulsa el botón Entrar para comprobar el acceso.';
    }, true);

    [user,password].forEach(input => {
      input.addEventListener('pointerdown', () => enableInput(input), true);
      input.addEventListener('focus', () => enableInput(input), true);
      input.addEventListener('keydown', event => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        event.stopImmediatePropagation();
        if (message) message.textContent = 'Pulsa el botón Entrar para continuar.';
      }, true);
    });

    // Algunas WebView/Android vuelven a marcar readonly al restaurar una pestaña.
    const repair = () => { enableInput(user); enableInput(password); button.disabled = false; };
    window.addEventListener('focus', repair);
    document.addEventListener('visibilitychange', () => { if(!document.hidden) repair(); });
    setInterval(repair, 1000);
  }

  if (!install()) {
    const timer=setInterval(()=>{ if (install()) clearInterval(timer); },100);
    setTimeout(()=>clearInterval(timer),10000);
  }
})();
