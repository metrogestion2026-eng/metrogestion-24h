// v39 preview · botón flotante Gestión retirado definitivamente.
(() => {
  'use strict';
  const removeButton=()=>document.getElementById('v39-home-fixed')?.remove();
  removeButton();
  document.addEventListener('DOMContentLoaded',removeButton,{once:true});
  window.addEventListener('pageshow',removeButton);
  window.addEventListener('focus',removeButton);
  // Neutraliza también una copia antigua del script si hubiera quedado viva en memoria.
  setInterval(removeButton,500);
})();
