// v39 preview · plegar/desplegar bloques grandes del Hotel.
(() => {
  'use strict';
  if (window.__metrogestionV39CollapsiblesLoaded) return;
  window.__metrogestionV39CollapsiblesLoaded = true;

  const configs = [
    {selector:'#hotel-programmed-tasks', key:'metrogestion_v39_t_programadas_plegado'},
    {selector:'#hotel-v39-reserves', key:'metrogestion_v39_reservas_plegado'}
  ];

  const getStored = key => {
    try { return sessionStorage.getItem(key) === '1'; } catch { return false; }
  };
  const setStored = (key, folded) => {
    try { sessionStorage.setItem(key, folded ? '1' : '0'); } catch {}
  };

  function applyPanel(panel, key) {
    if (!panel) return;
    const header = panel.querySelector(':scope > .hotel-title') || panel.firstElementChild;
    if (!header) return;

    let button = header.querySelector('.v39-fold-toggle');
    if (!button) {
      button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn btn-secondary v39-fold-toggle';
      button.style.width = 'auto';
      button.style.minWidth = '118px';
      button.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        const folded = panel.dataset.v39Folded !== '1';
        panel.dataset.v39Folded = folded ? '1' : '0';
        setStored(key, folded);
        renderState(panel, button, folded);
      });
      header.appendChild(button);
    }

    const folded = panel.dataset.v39Folded === '1' || (panel.dataset.v39Folded !== '0' && getStored(key));
    panel.dataset.v39Folded = folded ? '1' : '0';
    renderState(panel, button, folded);
  }

  function renderState(panel, button, folded) {
    [...panel.children].forEach(child => {
      if (child === panel.querySelector(':scope > .hotel-title') || child === panel.firstElementChild) return;
      child.style.display = folded ? 'none' : '';
    });
    button.textContent = folded ? '▼ Desplegar' : '▲ Plegar';
    button.setAttribute('aria-expanded', folded ? 'false' : 'true');
  }

  function refresh() {
    configs.forEach(cfg => applyPanel(document.querySelector(cfg.selector), cfg.key));
  }

  let timer = null;
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(refresh, 60);
  };

  const observer = new MutationObserver(schedule);
  observer.observe(document.documentElement, {childList:true, subtree:true});
  window.addEventListener('focus', schedule);
  document.addEventListener('click', schedule, true);
  schedule();
})();
