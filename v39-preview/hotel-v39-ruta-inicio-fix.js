// v39 preview · corrige ruta inicial y recuperación de pestañas tras cargar sesión/permisos.
(() => {
  'use strict';
  if (window.__metrogestionV39RouteFixLoaded) return;
  window.__metrogestionV39RouteFixLoaded = true;

  const URL='https://njtohfkqjjoavtumtmza.supabase.co';
  const KEY='sb_publishable_w1a9DClOM0S4HVJdv_TbKg_W_UkN2W_';
  const sb=window.supabase?.createClient?.(URL,KEY);
  if(!sb) return;

  let applying=false;
  let defaultOpened=false;

  async function can(mod,edit=false){
    const {data,error}=await sb.rpc(edit?'puede_editar_modulo_v39':'puede_ver_modulo_v39',{p_modulo:mod});
    if(error) return false;
    return data===true;
  }

  async function readPerms(){
    const [activar,hotel,tprog,talleres]=await Promise.all([
      can('activar24h'),can('hotel'),can('t_programadas'),can('talleres')
    ]);
    return {activar,hotel,tprog,talleres,gestion:hotel||tprog||talleres};
  }

  function restoreTabs(p){
    const activation=document.querySelector('#activate-tab');
    const hotel=document.querySelector('#hotel-tab');
    if(activation) activation.classList.toggle('hidden',!p.activar);
    if(hotel) hotel.classList.toggle('hidden',!p.gestion);

    // Las pestañas internas v39 se gestionan también por su capa original;
    // aquí solo reparamos el estado oculto prematuro de las entradas principales.
  }

  function closeV39Modals(){
    document.querySelectorAll('#v39-modal,#v39-assign-modal,#v39-tedit-modal,#v39-mail-modal,#v39-workshop-modal,#v39-workshop-multi-modal').forEach(x=>x.remove?.());
  }

  async function openHotel(forceBoard=true){
    const p=await readPerms();
    restoreTabs(p);
    if(!p.gestion){
      const a=document.querySelector('#activate-tab');
      if(a&&p.activar) a.click();
      return false;
    }

    closeV39Modals();
    const hotel=document.querySelector('#hotel-tab');
    if(hotel){
      hotel.classList.remove('hidden');
      hotel.removeAttribute('aria-disabled');
      hotel.click();
    }

    setTimeout(()=>{
      if(forceBoard && p.hotel){
        const board=document.querySelector('.hotel-subtab[data-hotel-view="board"]');
        if(board) board.click();
      }
      document.querySelector('#v39-view-tprog')?.classList.add('hidden');
      document.querySelector('#v39-view-talleres')?.classList.add('hidden');
      try{window.scrollTo({top:0,behavior:'smooth'});}catch{window.scrollTo(0,0)}
    },120);
    return true;
  }

  async function apply({openDefault=false}={}){
    if(applying) return;
    applying=true;
    try{
      const {data:{session}}=await sb.auth.getSession();
      if(!session) return;
      const p=await readPerms();
      restoreTabs(p);
      if(openDefault && !defaultOpened){
        defaultOpened=true;
        if(p.gestion) await openHotel(true);
        else if(p.activar) document.querySelector('#activate-tab')?.click();
      }
    } finally { applying=false; }
  }

  // El botón fijo Gestión debe funcionar aunque Hotel hubiera quedado oculto visualmente.
  document.addEventListener('click',e=>{
    const b=e.target.closest?.('#v39-home-fixed');
    if(!b) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    openHotel(true);
  },true);

  sb.auth.onAuthStateChange((event,session)=>{
    if(session) setTimeout(()=>apply({openDefault:true}),120);
  });

  window.addEventListener('focus',()=>setTimeout(()=>apply({openDefault:false}),80));
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)setTimeout(()=>apply({openDefault:false}),80)});
  setTimeout(()=>apply({openDefault:true}),500);
  setTimeout(()=>apply({openDefault:false}),1400);
})();
