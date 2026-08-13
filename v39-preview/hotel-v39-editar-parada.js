// v39 preview · edición controlada del Nº de parada.
// Solo el administrador principal puede ejecutar el cambio; el servidor vuelve a validarlo.
(() => {
  'use strict';
  if (window.__metrogestionV39StopEditorLoaded) return;
  window.__metrogestionV39StopEditorLoaded = true;

  const URL='https://njtohfkqjjoavtumtmza.supabase.co';
  const KEY='sb_publishable_w1a9DClOM0S4HVJdv_TbKg_W_UkN2W_';
  const sb=window.supabase?.createClient?.(URL,KEY);
  if(!sb) return;
  const norm=v=>String(v||'').trim().toUpperCase();
  let rows=[], loading=false, timer=null;

  const identifyCard=card=>{
    const strong=card.querySelector('.hotel-primary strong')?.textContent||'';
    let m=strong.match(/(?:DFM|Semirremolque)\s+([A-Z0-9]+)/i);
    if(m) return {fleet:norm(m[1]),reserve:''};
    m=strong.match(/Reserva\s+([A-Z0-9]+)/i);
    return m?{fleet:'',reserve:norm(m[1])}:null;
  };

  const load=async()=>{
    if(loading)return;loading=true;
    try{
      const b=await sb.from('pizarras').select('id').eq('estado','en_curso').order('fecha',{ascending:false}).limit(1).maybeSingle();
      if(b.error||!b.data)return;
      const r=await sb.from('registros_hotel').select('id,vehiculo_sustituido,vehiculo_reserva,numero_parada,retirado_hotel_activo,estado').eq('pizarra_id',b.data.id).eq('oculto',false);
      if(!r.error)rows=r.data||[];
    }finally{loading=false;decorate();}
  };

  const decorate=()=>{
    document.querySelectorAll('article.hotel-unit').forEach(card=>{
      const id=identifyCard(card);if(!id)return;
      const row=rows.find(r=>id.fleet?norm(r.vehiculo_sustituido)===id.fleet:(!r.vehiculo_sustituido&&norm(r.vehiculo_reserva)===id.reserve));
      if(!row)return;
      let box=card.querySelector('.v39-stop-number-editor');
      if(!box){box=document.createElement('div');box.className='v39-stop-number-editor card';box.style.cssText='margin-top:8px;background:#f8fafc;border:1px dashed #94a3b8;padding:9px';card.appendChild(box);}
      box.innerHTML='<div class="text-small"><strong>Nº de parada:</strong> '+(row.numero_parada||'Sin número')+'</div><button class="btn btn-secondary v39-stop-edit" data-id="'+row.id+'" data-current="'+(row.numero_parada||'')+'" type="button" style="margin-top:6px">✏️ Modificar / quitar Nº parada</button>';
    });
  };

  document.addEventListener('click',async e=>{
    const b=e.target.closest('.v39-stop-edit');if(!b)return;e.preventDefault();e.stopPropagation();
    const current=b.dataset.current||'';
    const next=window.prompt('Nº de parada. Escribe 7 cifras para cambiarlo. Déjalo vacío para eliminarlo.',current);
    if(next===null)return;
    if(next.trim()&&!/^\d{7}$/.test(next.trim())){window.alert('El Nº de parada debe tener 7 cifras.');return;}
    b.disabled=true;b.textContent='Guardando…';
    const {data,error}=await sb.rpc('actualizar_numero_parada_hotel',{p_registro_id:b.dataset.id,p_numero_parada:next.trim()});
    if(error){window.alert('No se pudo modificar el Nº de parada: '+error.message);b.disabled=false;b.textContent='✏️ Modificar / quitar Nº parada';return;}
    window.alert(next.trim()?'Nº de parada actualizado.':'Nº de parada eliminado.');
    await load();
  },true);

  const schedule=()=>{clearTimeout(timer);timer=setTimeout(()=>{decorate();if(!rows.length)load();},80)};
  new MutationObserver(schedule).observe(document.documentElement,{childList:true,subtree:true});
  window.addEventListener('focus',()=>load());
  load();
})();