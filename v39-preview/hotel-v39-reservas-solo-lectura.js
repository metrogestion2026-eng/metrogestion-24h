// v39 preview · seguridad de Reservas: solo los perfiles con edición pueden asignar.
(() => {
  'use strict';
  if (window.__metrogestionV39ReservasSoloLecturaLoaded) return;
  window.__metrogestionV39ReservasSoloLecturaLoaded = true;

  const URL='https://njtohfkqjjoavtumtmza.supabase.co';
  const KEY='sb_publishable_w1a9DClOM0S4HVJdv_TbKg_W_UkN2W_';
  const sb=window.supabase?.createClient?.(URL,KEY);
  if(!sb) return;

  let checked=false;
  let canAssign=false;

  async function syncPermissions(){
    try{
      const {data:{session}}=await sb.auth.getSession();
      if(!session){ checked=false; canAssign=false; return; }
      const [r,h]=await Promise.all([
        sb.rpc('puede_editar_modulo_v39',{p_modulo:'reservas'}),
        sb.rpc('puede_editar_modulo_v39',{p_modulo:'hotel'})
      ]);
      canAssign=r.data===true && h.data===true;
      checked=true;
      apply();
    }catch{
      canAssign=false;
      checked=true;
      apply();
    }
  }

  function apply(){
    if(!checked) return;

    if(!canAssign){
      document.getElementById('v39-assign-modal')?.remove();
    }

    document.querySelectorAll('#hotel-v39-reserves .v39-res').forEach(card=>{
      if(canAssign){
        card.querySelector('.v39-reserve-readonly')?.remove();
        return;
      }
      card.classList.remove('v39-assignable');
      card.removeAttribute('role');
      card.removeAttribute('tabindex');
      card.style.cursor='default';
      card.querySelectorAll('.v39-assign-hint').forEach(x=>x.remove());
      if(!card.querySelector('.v39-reserve-readonly')){
        const badge=document.createElement('span');
        badge.className='v39-reserve-readonly badge';
        badge.textContent='🔒 Solo lectura';
        badge.style.marginTop='8px';
        card.appendChild(badge);
      }
      card.querySelectorAll('button,input,select,textarea').forEach(el=>{
        el.disabled=true;
        el.setAttribute('aria-disabled','true');
      });
    });
  }

  function blockReadOnlyAction(e){
    const card=e.target.closest?.('#hotel-v39-reserves .v39-res');
    if(!card) return;
    if(!checked || !canAssign){
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  }

  document.addEventListener('click',blockReadOnlyAction,true);
  document.addEventListener('keydown',e=>{
    if(e.key==='Enter' || e.key===' ') blockReadOnlyAction(e);
  },true);

  sb.auth.onAuthStateChange((_event,session)=>{
    if(!session){checked=false;canAssign=false;return;}
    setTimeout(syncPermissions,100);
  });
  window.addEventListener('focus',()=>setTimeout(syncPermissions,80));
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)setTimeout(syncPermissions,80)});

  setInterval(apply,1200);
  setTimeout(syncPermissions,250);
  setTimeout(syncPermissions,1200);
})();
