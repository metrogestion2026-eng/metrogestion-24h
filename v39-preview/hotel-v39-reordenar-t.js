// v39 preview · reordenación manual de T pendientes sin arrastrar.
(() => {
  'use strict';
  if (window.__metrogestionV39ReorderTLoaded) return;
  window.__metrogestionV39ReorderTLoaded = true;

  const URL='https://njtohfkqjjoavtumtmza.supabase.co';
  const KEY='sb_publishable_w1a9DClOM0S4HVJdv_TbKg_W_UkN2W_';
  const sb=window.supabase?.createClient?.(URL,KEY);
  if(!sb)return;

  let busy=false,timer=null;

  async function decorate(){
    if(busy)return;
    const cards=[...document.querySelectorAll('#v39-tprog-list .v39-tprog-stage[data-stage-id]')];
    if(!cards.length)return;
    const ids=cards.map(c=>c.dataset.stageId).filter(Boolean);
    if(!ids.length)return;
    busy=true;
    try{
      const {data,error}=await sb.from('etapas_hotel').select('id,registro_hotel_id,posicion,estado').in('id',ids);
      if(error)throw error;
      const rows=data||[];
      const recordIds=[...new Set(rows.map(r=>r.registro_hotel_id).filter(Boolean))];
      if(!recordIds.length)return;
      const all=await sb.from('etapas_hotel').select('id,registro_hotel_id,posicion,estado,nombre').in('registro_hotel_id',recordIds).order('posicion');
      if(all.error)throw all.error;
      const byRecord=new Map();
      (all.data||[]).forEach(r=>{
        if(['realizada','anulada'].includes(String(r.estado||'').toLowerCase()))return;
        if(!byRecord.has(r.registro_hotel_id))byRecord.set(r.registro_hotel_id,[]);
        byRecord.get(r.registro_hotel_id).push(r);
      });
      const byId=new Map(rows.map(r=>[r.id,r]));
      cards.forEach(card=>{
        if(card.querySelector('.v39-pos-wrap'))return;
        const row=byId.get(card.dataset.stageId);if(!row)return;
        const choices=(byRecord.get(row.registro_hotel_id)||[]).sort((a,b)=>a.posicion-b.posicion);
        const wrap=document.createElement('label');
        wrap.className='v39-pos-wrap';
        wrap.style.cssText='display:flex;align-items:center;gap:7px;margin-top:7px;font-size:12px;font-weight:850;';
        const sel=document.createElement('select');
        sel.className='form-select v39-pos-select';
        sel.style.cssText='width:auto;min-width:110px;min-height:36px;padding:5px 30px 5px 9px;';
        choices.forEach(x=>{const o=document.createElement('option');o.value=String(x.posicion);o.textContent=`${x.posicion}T`;if(x.id===row.id)o.selected=true;sel.appendChild(o)});
        wrap.append('Posición ',sel);
        sel.addEventListener('click',e=>e.stopPropagation());
        sel.addEventListener('change',async e=>{
          e.stopPropagation();
          const nueva=Number(sel.value);sel.disabled=true;
          try{
            const {error:rpcError}=await sb.rpc('reordenar_t_hotel_v39',{p_etapa_id:row.id,p_nueva_posicion:nueva});
            if(rpcError)throw rpcError;
            location.reload();
          }catch(err){alert('No se pudo cambiar la posición de la T: '+(err?.message||'error'));sel.value=String(row.posicion);sel.disabled=false;}
        });
        card.appendChild(wrap);
      });
    }catch(e){console.warn('v39 reordenar T:',e)}finally{busy=false}
  }

  function schedule(){clearTimeout(timer);timer=setTimeout(decorate,100)}
  const ob=new MutationObserver(schedule);ob.observe(document.documentElement,{childList:true,subtree:true});
  window.addEventListener('focus',schedule);schedule();
})();
