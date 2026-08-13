// Nota de Hotel visible solo para administrador principal.
(() => {
  'use strict';
  const sb=window.supabase?.createClient?.('https://njtohfkqjjoavtumtmza.supabase.co','sb_publishable_w1a9DClOM0S4HVJdv_TbKg_W_UkN2W_');
  if(!sb)return;
  let principal=false;
  const aplicar=()=>document.querySelectorAll('#view-hotel .sync-note').forEach(n=>n.style.display=principal?'':'none');
  const revisar=async()=>{const {data}=await sb.rpc('es_administrador_principal');principal=data===true;aplicar();};
  new MutationObserver(aplicar).observe(document.documentElement,{childList:true,subtree:true});
  window.addEventListener('focus',revisar);
  revisar();
})();
