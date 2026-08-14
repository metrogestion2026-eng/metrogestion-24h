// v39 preview · evita que la app interna vuelva a registrar el service worker v36.
(() => {
  'use strict';
  if (window.__metrogestionV39NoLegacyUpdaterLoaded) return;
  window.__metrogestionV39NoLegacyUpdaterLoaded = true;

  const sw = navigator.serviceWorker;
  if (sw?.register && !sw.__v39RegisterWrapped) {
    sw.__v39RegisterWrapped = true;
    const originalRegister = sw.register.bind(sw);
    sw.register = async (scriptURL, options) => {
      const url = String(scriptURL || '');
      if (url.includes('sw-metrogestion-2-0.js?v=36')) {
        const current = await sw.getRegistration('./');
        if (current) return current;
      }
      return originalRegister(scriptURL, options);
    };
  }

  const hideLegacyNotice = () => {
    const notice = document.querySelector('#update-notice');
    if (!notice) return;
    notice.classList.remove('visible');
    notice.style.setProperty('display','none','important');
    const button = document.querySelector('#update-now');
    if (button) {
      button.disabled = false;
      button.textContent = 'Actualizar ahora';
    }
  };

  hideLegacyNotice();
  document.addEventListener('DOMContentLoaded', hideLegacyNotice, {once:true});
  window.addEventListener('load', hideLegacyNotice);
  window.addEventListener('pageshow', hideLegacyNotice);
  const observer = new MutationObserver(hideLegacyNotice);
  observer.observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['class','style']});
})();
