// v39 preview · muestra la fecha real de la pizarra en curso desde el primer instante.
(() => {
  'use strict';
  if (window.__metrogestionV39CurrentBoardDateFixLoaded) return;
  window.__metrogestionV39CurrentBoardDateFixLoaded = true;

  const URL='https://njtohfkqjjoavtumtmza.supabase.co';
  const KEY='sb_publishable_w1a9DClOM0S4HVJdv_TbKg_W_UkN2W_';
  const sb=window.supabase?.createClient?.(URL,KEY);
  if(!sb) return;

  const fmt=iso=>{
    const [y,m,d]=String(iso||'').split('-');
    return y&&m&&d?`${d}/${m}/${y}`:'';
  };

  function markLoading(){
    const label=document.querySelector('#hotel-date');
    if(label && label.textContent.includes('03/08/2026')){
      label.textContent='Cargando pizarra actual…';
    }
  }

  async function syncDate(){
    markLoading();
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
      const label=document.querySelector('#hotel-date');
      if(label) label.textContent=`Pizarra en curso del ${fmt(data.fecha)} · sincronización en tiempo real`;
    }catch(e){
      console.warn('v39 fecha pizarra:',e);
    }
  }

  markLoading();
  syncDate();
  setTimeout(syncDate,120);
  setTimeout(syncDate,350);
  setTimeout(syncDate,800);

  document.addEventListener('click',e=>{
    if(e.target.closest?.('#hotel-tab,.hotel-subtab[data-hotel-view="board"]')){
      markLoading();
      setTimeout(syncDate,0);
    }
  },true);
  sb.auth.onAuthStateChange((_event,session)=>{if(session)setTimeout(syncDate,0)});
  window.addEventListener('focus',()=>setTimeout(syncDate,0));
})();
