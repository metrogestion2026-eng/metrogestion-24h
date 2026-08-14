// v39 preview · adapta el texto de T programadas al permiso real del usuario.
(() => {
  'use strict';
  if (window.__metrogestionV39TprogTextoPermisoLoaded) return;
  window.__metrogestionV39TprogTextoPermisoLoaded = true;

  const URL='https://njtohfkqjjoavtumtmza.supabase.co';
  const KEY='sb_publishable_w1a9DClOM0S4HVJdv_TbKg_W_UkN2W_';
  const sb=window.supabase?.createClient?.(URL,KEY);
  if(!sb) return;

  let canEdit=false;

  async function sync(){
    try{
      const {data:{session}}=await sb.auth.getSession();
      if(!session) return;
      const [t,h]=await Promise.all([
        sb.rpc('puede_editar_modulo_v39',{p_modulo:'t_programadas'}),
        sb.rpc('puede_editar_modulo_v39',{p_modulo:'hotel'})
      ]);
      canEdit=t.data===true || h.data===true;
      apply();
    }catch{canEdit=false;apply();}
  }

  function apply(){
    const card=document.querySelector('#v39-view-tprog > .card');
    if(!card) return;
    const text=card.querySelector('.text-small.text-muted');
    if(!text) return;
    text.textContent=canEdit
      ? 'Edición directa: fechas, taller, realizada, anular, posición y correo.'
      : 'Consulta de T programadas · Solo lectura.';
  }

  const observer=new MutationObserver(apply);
  observer.observe(document.documentElement,{childList:true,subtree:true});
  sb.auth.onAuthStateChange((_event,session)=>{if(session)setTimeout(sync,100)});
  window.addEventListener('focus',()=>setTimeout(sync,80));
  setTimeout(sync,250);
  setTimeout(sync,1200);
})();
