// v39 preview · el acceso solo se valida tras pulsar explícitamente el botón Entrar.
(() => {
  'use strict';
  if (window.__metrogestionV39ExplicitLoginLoaded) return;
  window.__metrogestionV39ExplicitLoginLoaded = true;

  let armedUntil = 0;
  let installed = false;

  function install(){
    if (installed) return true;
    const form = document.querySelector('#login-form');
    const button = document.querySelector('#mock-enter');
    const password = document.querySelector('#mock-pin');
    const message = document.querySelector('#login-message');
    if (!form || !button || !password) return false;
    installed = true;

    // Evita que Enter/autorrelleno/gestores de contraseñas lancen el submit implícito.
    button.type = 'button';
    form.setAttribute('autocomplete','off');

    const blockImplicitSubmit = event => {
      const allowed = armedUntil > Date.now();
      if (allowed) {
        armedUntil = 0;
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      if (message) message.textContent = 'Pulsa Entrar para comprobar el acceso.';
    };
    form.addEventListener('submit', blockImplicitSubmit, true);

    // Un toque/clic real sobre Entrar arma una única comprobación.
    const arm = () => { armedUntil = Date.now() + 1500; };
    button.addEventListener('pointerdown', arm, true);
    button.addEventListener('touchstart', arm, {capture:true, passive:true});
    button.addEventListener('mousedown', arm, true);
    button.addEventListener('click', event => {
      event.preventDefault();
      if (armedUntil <= Date.now()) {
        if (message) message.textContent = 'Pulsa Entrar para comprobar el acceso.';
        return;
      }
      form.requestSubmit();
    }, true);

    // El teclado nunca debe equivaler a pulsar Entrar.
    [password, document.querySelector('#mock-user')].filter(Boolean).forEach(input => {
      input.addEventListener('keydown', event => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        event.stopImmediatePropagation();
        if (message) message.textContent = 'Pulsa el botón Entrar para continuar.';
      }, true);
    });
  }

  if (!install()) {
    const timer=setInterval(()=>{ if (install()) clearInterval(timer); },100);
    setTimeout(()=>clearInterval(timer),10000);
  }
})();
