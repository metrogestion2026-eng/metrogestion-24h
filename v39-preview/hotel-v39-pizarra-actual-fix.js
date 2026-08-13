// v39 preview · fuerza siempre la fecha real de la pizarra en curso y abre Hotel al terminar el login.
(() => {
  'use strict';
  if (window.__metrogestionV39CurrentBoardDateFixLoaded) return;
  window.__metrogestionV39CurrentBoardDateFixLoaded = true;

  const URL='https://njtohfkqjjoavtumtmza.supabase.co';
  const KEY='sb_publishable_w1a9DClOM0S4HVJdv_TbKg_W_UkN2W_';
  const sb=window.supabase?.createClient?.(URL,KEY);
  if(!sb) return;

  let currentDate='';
  let running=false;
  let openedHotel=false;

  const fmt = iso => {
    if(!iso) return '';
    const [y,m,d]=String(iso).split('-');
    return y&&m&&d ? `${d}/${m}/${y}` : iso;
  };

  const visible = el => {
    if(!el) return false;
    const style=getComputedStyle(el);
    return style.display!=='none' && style.visibility!=='hidden' && el.getClientRects().length>0;
  };

  function apply(){
    if(!currentDate) return;
    const label=document.querySelector('#hotel-date');
    if(label) label.textContent=`Pizarra en curso del ${fmt(currentDate)} · sincronización en tiempo real`;
  }

  async function openHotelWhenReady(){
    if(openedHotel) return;
    const login=document.querySelector('#mock-login');
    const app=document.querySelector('#mock-app');
    if(!visible(app) || visible(login) || visible(document.querySelector('#view-activation'))) return;
    const {data,error}=await sb.rpc('puede_ver_modulo_v39',{p_modulo:'hotel'});
    if(error || data!==true) return;
    const hotel=document.querySelector('#hotel-tab');
    if(!hotel) return;
    openedHotel=true;
    hotel.classList.remove('hidden','locked-tab');
    hotel.setAttribute('aria-disabled','false');
    hotel.click();
    setTimeout(()=>document.querySelector('.hotel-subtab[data-hotel-view="board"]')?.click(),100);
  }

  async function refreshCurrentBoard(){
    if(running) return;
    running=true;
    try {
      const {data:{session}}=await sb.auth.getSession();
      if(!session){ openedHotel=false; return; }
      const {data,error}=await sb.from('pizarras')
        .select('id,fecha,estado')
        .eq('estado','en_curso')
        .order('fecha',{ascending:false})
        .limit(1)
        .maybeSingle();
      if(error || !data?.fecha) return;
      currentDate=data.fecha;
      apply();
      setTimeout(openHotelWhenReady,120);
    } finally {
      running=false;
    }
  }

  const observer=new MutationObserver(()=>{
    apply();
    if(!openedHotel) setTimeout(openHotelWhenReady,100);
  });
  observer.observe(document.documentElement,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['class','style']});

  sb.auth.onAuthStateChange((_event,session)=>{
    if(!session) openedHotel=false;
    if(session){
      setTimeout(refreshCurrentBoard,150);
      setTimeout(openHotelWhenReady,700);
    }
  });
  window.addEventListener('focus',()=>setTimeout(refreshCurrentBoard,80));
  document.addEventListener('visibilitychange',()=>{ if(!document.hidden) setTimeout(refreshCurrentBoard,80); });
  setInterval(()=>{ apply(); refreshCurrentBoard(); },3000);
  setTimeout(refreshCurrentBoard,250);
  setTimeout(refreshCurrentBoard,1200);
  setTimeout(openHotelWhenReady,2200);
})();
