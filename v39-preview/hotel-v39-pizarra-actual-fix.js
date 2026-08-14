// v39 preview · fecha real de la pizarra actual, inmediata y estable durante el día.
(() => {
  'use strict';
  if (window.__metrogestionV39CurrentBoardDateFixLoaded) return;
  window.__metrogestionV39CurrentBoardDateFixLoaded = true;

  const URL='https://njtohfkqjjoavtumtmza.supabase.co';
  const KEY='sb_publishable_w1a9DClOM0S4HVJdv_TbKg_W_UkN2W_';
  const CACHE='metrogestion_v39_current_board_date';
  const sb=window.supabase?.createClient?.(URL,KEY);
  if(!sb) return;

  let currentDate='';
  let syncing=false;
  let observer=null;

  const todayMadrid=()=>new Intl.DateTimeFormat('en-CA',{
    timeZone:'Europe/Madrid',year:'numeric',month:'2-digit',day:'2-digit'
  }).format(new Date());

  const fmt=iso=>{
    const [y,m,d]=String(iso||'').split('-');
    return y&&m&&d?`${d}/${m}/${y}`:'';
  };

  const expectedText=()=>currentDate
    ? `Pizarra en curso del ${fmt(currentDate)} · sincronización en tiempo real`
    : 'Cargando pizarra actual…';

  function paint(){
    const label=document.querySelector('#hotel-date');
    if(!label) return;
    const text=expectedText();
    if(label.textContent!==text) label.textContent=text;
  }

  function loadTodayCache(){
    try{
      const cached=localStorage.getItem(CACHE)||'';
      if(cached===todayMadrid()) currentDate=cached;
    }catch{}
    paint();
  }

  function watchLabel(){
    observer?.disconnect();
    const label=document.querySelector('#hotel-date');
    if(!label) return;
    observer=new MutationObserver(()=>{
      if(currentDate && label.textContent!==expectedText()) paint();
    });
    observer.observe(label,{childList:true,characterData:true,subtree:true});
  }

  async function syncDate(){
    if(syncing) return;
    syncing=true;
    try{
      const {data:{session}}=await sb.auth.getSession();
      if(!session) return;
      const {data,error}=await sb.from('pizarras')
        .select('fecha')
        .eq('estado','en_curso')
        .order('fecha',{ascending:false})
        .limit(1)
        .maybeSingle();
      if(error||!data?.fecha) return;
      currentDate=data.fecha;
      try{localStorage.setItem(CACHE,currentDate);}catch{}
      paint();
      watchLabel();
    }catch(e){
      console.warn('v39 fecha pizarra:',e);
    }finally{
      syncing=false;
    }
  }

  loadTodayCache();
  watchLabel();
  syncDate();
  setTimeout(syncDate,100);
  setTimeout(syncDate,300);
  setTimeout(syncDate,700);
  setTimeout(syncDate,1500);

  document.addEventListener('click',e=>{
    if(e.target.closest?.('#hotel-tab,.hotel-subtab')){
      paint();
      setTimeout(syncDate,0);
    }
  },true);
  sb.auth.onAuthStateChange((_event,session)=>{if(session)setTimeout(syncDate,0)});
  window.addEventListener('focus',()=>{paint();setTimeout(syncDate,0)});
})();
