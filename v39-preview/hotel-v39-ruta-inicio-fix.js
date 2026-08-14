// v39 preview · corrige ruta inicial y mantiene visibles las pestañas principales según permisos.
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

  function showTab(tab,allowed){
    if(!tab) return;
    tab.classList.toggle('hidden',!allowed);
    if(allowed){
      tab.removeAttribute('hidden');
      tab.style.removeProperty('display');
      tab.style.removeProperty('visibility');
      tab.style.removeProperty('opacity');
      tab.removeAttribute('aria-hidden');
      tab.setAttribute('aria-disabled','false');
    }else{
      tab.setAttribute('aria-disabled','true');
    }
  }

  function restoreTabs(p){
    const nav=document.querySelector('#mock-app .tabs');
    const activation=document.querySelector('#activate-tab');
    const hotel=document.querySelector('#hotel-tab');

    // Si otra capa hubiera movido los botones, los devolvemos a su menú original.
    if(nav && activation && activation.parentElement!==nav) nav.insertBefore(activation,nav.firstChild);
    if(nav && hotel && hotel.parentElement!==nav){
      const after=activation?.nextSibling || nav.firstChild;
      nav.insertBefore(hotel,after);
    }

    showTab(activation,p.activar);
    showTab(hotel,p.gestion);

    // Cuando Hotel está abierto, su pestaña debe verse además como seleccionada.
    const hotelView=document.querySelector('#view-hotel');
    if(hotel && hotelView && !hotelView.classList.contains('hidden')){
      hotel.classList.add('btn-primary');
      hotel.classList.remove('btn-secondary','locked-tab');
    }
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
      showTab(hotel,true);
      hotel.classList.remove('locked-tab');
      hotel.click();
    }

    setTimeout(()=>{
      if(forceBoard && p.hotel){
        const board=document.querySelector('.hotel-subtab[data-hotel-view="board"]');
        if(board) board.click();
      }
      document.querySelector('#v39-view-tprog')?.classList.add('hidden');
      document.querySelector('#v39-view-talleres')?.classList.add('hidden');
      restoreTabs(p);
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

  document.addEventListener('click',e=>{
    const b=e.target.closest?.('#v39-home-fixed');
    if(!b) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    openHotel(true);
  },true);

  sb.auth.onAuthStateChange((_event,session)=>{
    if(session) setTimeout(()=>apply({openDefault:true}),120);
    else defaultOpened=false;
  });

  window.addEventListener('focus',()=>setTimeout(()=>apply({openDefault:false}),80));
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)setTimeout(()=>apply({openDefault:false}),80)});
  setTimeout(()=>apply({openDefault:true}),500);
  setTimeout(()=>apply({openDefault:false}),1400);
})();
