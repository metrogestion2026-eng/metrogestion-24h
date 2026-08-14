// v39 preview · muestra la fecha real de la pizarra en curso sin navegar ni tocar el login.
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

  async function syncDate(){
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

  document.addEventListener('click',e=>{
    if(e.target.closest?.('#hotel-tab,.hotel-subtab[data-hotel-view="board"]')) setTimeout(syncDate,180);
  },true);
  sb.auth.onAuthStateChange((_event,session)=>{if(session)setTimeout(syncDate,700)});
  window.addEventListener('focus',()=>setTimeout(syncDate,120));
  setTimeout(syncDate,1600);
})();
