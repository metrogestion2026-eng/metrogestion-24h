// v39 preview · fuerza siempre la fecha real de la pizarra en curso.
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

  const fmt = iso => {
    if(!iso) return '';
    const [y,m,d]=String(iso).split('-');
    return y&&m&&d ? `${d}/${m}/${y}` : iso;
  };

  async function refreshCurrentBoard(){
    if(running) return;
    running=true;
    try {
      const {data:{session}}=await sb.auth.getSession();
      if(!session) return;
      const {data,error}=await sb.from('pizarras')
        .select('id,fecha,estado')
        .eq('estado','en_curso')
        .order('fecha',{ascending:false})
        .limit(1)
        .maybeSingle();
      if(error || !data?.fecha) return;
      currentDate=data.fecha;
      apply();
    } finally {
      running=false;
    }
  }

  function apply(){
    if(!currentDate) return;
    const label=document.querySelector('#hotel-date');
    if(label) label.textContent=`Pizarra en curso del ${fmt(currentDate)} · sincronización en tiempo real`;
  }

  const observer=new MutationObserver(apply);
  observer.observe(document.documentElement,{childList:true,subtree:true,characterData:true});
  sb.auth.onAuthStateChange((_event,session)=>{ if(session) setTimeout(refreshCurrentBoard,100); });
  window.addEventListener('focus',()=>setTimeout(refreshCurrentBoard,80));
  document.addEventListener('visibilitychange',()=>{ if(!document.hidden) setTimeout(refreshCurrentBoard,80); });
  setInterval(()=>{ apply(); refreshCurrentBoard(); },3000);
  setTimeout(refreshCurrentBoard,250);
  setTimeout(refreshCurrentBoard,1200);
})();
