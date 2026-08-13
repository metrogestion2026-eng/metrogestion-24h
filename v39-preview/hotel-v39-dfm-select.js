// v39 preview · desplegable real de DFM/matrícula para asignar reservas.
(() => {
  'use strict';
  if (window.__metrogestionV39DfmSelectLoaded) return;
  window.__metrogestionV39DfmSelectLoaded = true;

  const URL='https://njtohfkqjjoavtumtmza.supabase.co';
  const KEY='sb_publishable_w1a9DClOM0S4HVJdv_TbKg_W_UkN2W_';
  const sb=window.supabase?.createClient?.(URL,KEY);
  if(!sb) return;

  let rows=[];
  let loading=false;
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const norm=v=>String(v||'').trim().toUpperCase();

  async function loadRows(){
    if(loading)return; loading=true;
    try{
      const q=await sb.from('vehiculos')
        .select('dfm,matricula,tipo,upc,tipo_motor,categoria,marca,activo')
        .eq('activo',true)
        .order('dfm');
      if(q.error)throw q.error;
      rows=(q.data||[]).filter(v=>!['RESERVA','BAJA'].includes(norm(v.categoria)));
    } finally { loading=false; }
  }

  function refreshInfo(select){
    const v=rows.find(x=>norm(x.dfm)===norm(select.value));
    const info=document.getElementById('v39-assign-vehicle-info');
    const conf=document.getElementById('v39-assign-confirm-text');
    const reserve=String(document.getElementById('v39-assign-reserve')?.textContent||'').replace(/^Reserva\s+/i,'').trim();
    if(!v){
      if(info)info.innerHTML='Selecciona un DFM de la flota.';
      if(conf)conf.textContent='Selecciona el vehículo sustituido.';
      return;
    }
    if(info)info.innerHTML=`<strong>${esc(v.dfm)} · ${esc(v.matricula||'—')}</strong><div class="text-small">${esc(v.marca||'—')} · ${esc(v.tipo_motor||v.tipo||'—')} · UPC ${esc(v.upc||'—')}</div>`;
    if(conf)conf.innerHTML=`La reserva <strong>${esc(reserve)}</strong> sustituirá a <strong>${esc(v.dfm)}</strong>. Al guardar se creará su Nº de parada y aparecerá en la Pizarra activa.`;
  }

  async function setup(){
    const old=document.getElementById('v39-assign-vehicle');
    if(!old)return;

    await loadRows();

    let select=old;
    if(old.tagName!=='SELECT'){
      select=document.createElement('select');
      select.id='v39-assign-vehicle';
      select.className='form-select';
      select.setAttribute('aria-label','DFM o matrícula del vehículo sustituido');
      old.replaceWith(select);
    }

    const current=norm(select.value);
    select.innerHTML='<option value="">Selecciona DFM / matrícula…</option>'+rows.map(v=>{
      const extra=[v.marca,v.tipo_motor||v.tipo].filter(Boolean).join(' · ');
      return `<option value="${esc(v.dfm)}">${esc(v.dfm)} · ${esc(v.matricula||'—')}${extra?' · '+esc(extra):''}</option>`;
    }).join('');
    if(current && rows.some(v=>norm(v.dfm)===current))select.value=current;
    else select.value='';

    if(select.dataset.v39RealSelect!=='1'){
      select.dataset.v39RealSelect='1';
      select.addEventListener('change',()=>refreshInfo(select));
    }
    refreshInfo(select);
  }

  // El modal ya existe oculto al cargar la capa v39. Lo convertimos nada más aparecer
  // y volvemos a comprobar cada vez que se pulsa una reserva disponible.
  const ob=new MutationObserver(()=>setTimeout(setup,30));
  ob.observe(document.documentElement,{childList:true,subtree:true});
  document.addEventListener('click',e=>{
    if(e.target.closest?.('#hotel-v39-reserves .v39-res.v39-assignable'))setTimeout(setup,80);
  },true);
  setTimeout(setup,250);
})();
