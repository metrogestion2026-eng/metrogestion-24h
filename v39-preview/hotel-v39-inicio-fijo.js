// v39 preview · el botón flotante Gestión queda retirado.
// La navegación vuelve a hacerse únicamente desde las pestañas principales.
(() => {
  'use strict';
  const removeButton=()=>document.getElementById('v39-home-fixed')?.remove();
  removeButton();
  document.addEventListener('DOMContentLoaded',removeButton,{once:true});
  window.addEventListener('pageshow',removeButton);
})();
