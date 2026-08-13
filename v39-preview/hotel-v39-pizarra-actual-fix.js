// v39 preview · fecha real de pizarra actual y apertura segura de Hotel tras login.
(() => {
  'use strict';
  if (window.__metrogestionV39CurrentBoardDateFixLoaded) return;
  window.__metrogestionV39CurrentBoardDateFixLoaded = true;

  const URL='https://njtohfkqjjoavtumtmza.supabase.co';
  const KEY='sb_publishable_w1a9DClOM0S4HVJdv_TbKg_W_UkN2W_';
  const sb=window.supabase?.createClient?.(URL,KEY);
  if(!sb) return;

  let currentDate='';
  let refreshing=false;
  let opening=false;

  const fmt=iso=>{
    if(!iso)return'';
    const [y,m,d]=String(iso).split('-');
    return y&&m&&d?`${d}/${m}/${y}`:iso;
  };

  const visible=el=>{
    if(!el)return false;
    const s=getComputedStyle(el);
    return s.display!=='none'&&s.visibility!=='hidden'&&el.getClientRects().length>0;
  };

  function applyDate(){
    if(!currentDate)return;
    const label=document.querySelector('#hotel-date');
    if(!label)return;
    const text=`Pizarra en curso del ${fmt(currentDate)} · sincronización en tiempo real`;
    if(label.textContent!==text) label.textContent=text;
  }

  async function refreshCurrentBoard(){
    if(refreshing)return;
    refreshing=true;
    try{
      const {data:{session}}=await sb.auth.getSession();
      if(!session){currentDate='';return;}
      const {data,error}=await sb.from('pizarras')
        .select('id,fecha,estado')
        .eq('estado','en_curso')
        .order('fecha',{ascending:false})
        .limit(1)
        .maybeSingle();
      if(error||!data?.fecha)return;
      currentDate=data.fecha;
      applyDate();
    }finally{refreshing=false;}
  }

  async function openHotelAfterLogin(){
    if(opening)return;
    const login=document.querySelector('#mock-login');
    const app=document.querySelector('#mock-app');
    if(visible(login)||!visible(app))return;
    // Si el usuario está en una activación 24H, no cambiarle de pantalla.
    if(visible(document.querySelector('#view-activation')))return;
    opening=true;
    try{
      const {data,error}=await sb.rpc('puede_ver_modulo_v39',{p_modulo:'hotel'});
      if(error||data!==true)return;
      const hotel=document.querySelector('#hotel-tab');
      if(!hotel)return;
      hotel.classList.remove('hidden','locked-tab');
      hotel.setAttribute('aria-disabled','false');
      hotel.click();
      setTimeout(()=>{
        document.querySelector('.hotel-subtab[data-hotel-view="board"]')?.click();
        applyDate();
      },120);
    }finally{
      setTimeout(()=>{opening=false;},500);
    }
  }

  sb.auth.onAuthStateChange((_event,session)=>{
    if(!session){currentDate='';return;}
    setTimeout(refreshCurrentBoard,150);
    setTimeout(openHotelAfterLogin,900);
  });

  window.addEventListener('focus',()=>{
    setTimeout(refreshCurrentBoard,80);
    setTimeout(openHotelAfterLogin,250);
  });
  document.addEventListener('visibilitychange',()=>{
    if(document.hidden)return;
    setTimeout(refreshCurrentBoard,80);
    setTimeout(openHotelAfterLogin,250);
  });

  // Sin MutationObserver ni bucles de escritura: el formulario de login queda libre.
  setInterval(()=>{
    applyDate();
    refreshCurrentBoard();
  },5000);

  setTimeout(refreshCurrentBoard,400);
  setTimeout(openHotelAfterLogin,1600);
})();
