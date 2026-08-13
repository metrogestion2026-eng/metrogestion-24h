// v39 preview · limpia la ficha: la T completa es el acceso al expediente.
(() => {
  'use strict';
  if (window.__metrogestionV39SinVerExpedienteLoaded) return;
  window.__metrogestionV39SinVerExpedienteLoaded = true;

  function clean(){
    document.querySelectorAll('.stage[data-stage-id]').forEach(stage=>{
      stage.querySelectorAll('.v39-hint').forEach(h=>h.remove());
      stage.setAttribute('title','Toca la T para abrir su expediente');
      stage.style.cursor='pointer';
    });
  }

  const observer=new MutationObserver(()=>clean());
  observer.observe(document.documentElement,{childList:true,subtree:true});
  clean();
})();
