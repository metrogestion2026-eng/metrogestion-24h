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

  function baseReady(){
    const login=document.querySelector('#mock-login');
    const app=document.querySelector('#mock-app');
    const label=document.querySelector('#session-label');
    return Boolean(
      app && !app.classList.contains('hidden') &&
      login && login.classList.contains('hidden') &&
      String(label?.textContent||'').trim()
    );
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

    if(nav && activation && activation.parentElement!==nav) nav.insertBefore(activation,nav.firstChild);
    if(nav && hotel && hotel.parentElement!==nav){
      const after=activation?.nextSibling || nav.firstChild;
      nav.insertBefore(hotel,after);
    }

    showTab(activation,p.activar);
    showTab(hotel,p.gestion);

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
    // Nunca pulsamos Hotel hasta que la base haya terminado de cargar el perfil.
    // Evita el aviso falso «No tienes permiso para consultar el Hotel» durante el login.
    if(!baseReady()) return false;

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

      // La sesión de Supabase puede existir antes de que el HTML base haya cargado
      // el perfil en currentAccount(). Esperamos ese segundo paso antes de abrir vistas.
      if(!baseReady()){
        if(openDefault && !defaultOpened) setTimeout(()=>apply({openDefault:true}),250);
        return;
      }

      const p=await readPerms();
      restoreTabs(p);
      if(openDefault && !defaultOpened){
        if(p.gestion){
          const opened=await openHotel(true);
          if(opened) defaultOpened=true;
        }else if(p.activar){
          document.querySelector('#activate-tab')?.click();
          defaultOpened=true;
        }
      }
    } finally { applying=false; }
  }

  document.addEventListener('click',e=>{
    const b=e.target.closest?.('#v39-home-fixed');
    if(!b) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if(baseReady()) openHotel(true);
  },true);

  sb.auth.onAuthStateChange((_event,session)=>{
    if(session) setTimeout(()=>apply({openDefault:true}),250);
    else defaultOpened=false;
  });

  window.addEventListener('focus',()=>setTimeout(()=>apply({openDefault:false}),100));
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)setTimeout(()=>apply({openDefault:false}),100)});
  setTimeout(()=>apply({openDefault:true}),700);
  setTimeout(()=>apply({openDefault:true}),1500);
  setTimeout(()=>apply({openDefault:false}),2500);
})();
