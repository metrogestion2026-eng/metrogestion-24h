// v39 preview · Panel resumen alimentado exclusivamente desde hotel_actual_v39.
(() => {
  'use strict';
  if (window.__metrogestionV39PanelFuenteUnicaLoaded) return;
  window.__metrogestionV39PanelFuenteUnicaLoaded = true;

  const URL='https://njtohfkqjjoavtumtmza.supabase.co';
  const KEY='sb_publishable_w1a9DClOM0S4HVJdv_TbKg_W_UkN2W_';
  const sb=window.supabase?.createClient?.(URL,KEY);
  if(!sb) return;

  const workshopStates=['pendiente_diagnostico','pendiente_autorizacion','en_taller','pendiente_repuestos'];
  let channel=null;
  let reloadTimer=null;

  const esc=value=>String(value??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  const visible=el=>!!(el&&el.getClientRects().length&&!el.classList.contains('hidden'));
  const dashboardVisible=()=>visible(document.querySelector('#hotel-dashboard'));
  const fmtDate=value=>value ? new Date(value).toLocaleDateString('es-ES',{timeZone:'Europe/Madrid'}) : 'Fecha pendiente';
  const fmtTime=()=>new Date().toLocaleTimeString('es-ES',{timeZone:'Europe/Madrid',hour:'2-digit',minute:'2-digit'});

  const metric=(label,value,filter)=>`<button class="metric v39-panel-metric" data-filter="${filter}" type="button"><strong>${value}</strong><span class="text-small text-muted">${esc(label)}</span></button>`;

  async function loadContracts(rows){
    const codes=[...new Set(rows.flatMap(r=>[r.dfm,r.reserva]).map(x=>String(x||'').trim()).filter(Boolean))];
    if(!codes.length) return new Map();
    const {data,error}=await sb.from('vehiculos')
      .select('dfm,matricula,fecha_matriculacion,clase_vehiculo')
      .in('dfm',codes);
    if(error) return new Map();
    return new Map((data||[]).map(v=>[String(v.dfm||'').trim().toUpperCase(),v]));
  }

  function expired(vehicle){
    if(!vehicle?.fecha_matriculacion) return false;
    const cls=String(vehicle.clase_vehiculo||'').toLowerCase();
    const years=cls.includes('tractora')?3:cls.includes('rigid')?4:0;
    if(!years) return false;
    const limit=new Date(vehicle.fecha_matriculacion+'T12:00:00');
    limit.setFullYear(limit.getFullYear()+years);
    const now=new Date();
    now.setHours(0,0,0,0);
    return now>limit;
  }

  async function renderPanel(){
    if(!dashboardVisible()) return;
    const cards=document.querySelector('#hotel-dashboard-cards');
    const workshopList=document.querySelector('#hotel-workshop-list');
    const priorityList=document.querySelector('#hotel-priority-list');
    if(!cards||!workshopList||!priorityList) return;

    cards.innerHTML='<div class="card">Cargando desde Hotel…</div>';
    workshopList.innerHTML='<div class="text-small text-muted">Cargando…</div>';
    priorityList.innerHTML='<div class="text-small text-muted">Cargando…</div>';

    const {data:rows,error}=await sb.from('hotel_actual_v39').select('*').order('orden',{ascending:true});
    if(error){
      cards.innerHTML=`<div class="card">No se pudo cargar el Panel desde Hotel: ${esc(error.message)}</div>`;
      return;
    }
    const data=rows||[];
    const contracts=await loadContracts(data);

    const active=data.filter(r=>!['reserva_liberada','anulado'].includes(r.estado)).length;
    const free=data.filter(r=>r.estado==='reserva_liberada').length;
    const planned=data.filter(r=>r.estado==='planificado').length;
    const pendingWorkshop=data.filter(r=>r.estado==='pendiente_taller').length;
    const workshop=data.filter(r=>workshopStates.includes(r.estado)).length;
    const ready=data.filter(r=>r.estado==='terminado_pendiente_recogida').length;
    const route=data.filter(r=>r.estado==='recogido_pendiente_ruta').length;
    const expiredCount=data.filter(r=>{
      const a=contracts.get(String(r.dfm||'').trim().toUpperCase());
      const b=contracts.get(String(r.reserva||'').trim().toUpperCase());
      return expired(a)||expired(b);
    }).length;

    cards.innerHTML=
      metric('Movimientos activos',active,'occupied')+
      metric('Reservas libres',free,'free')+
      metric('Pendientes de parar',planned,'planned')+
      metric('Pendientes de taller',pendingWorkshop,'pending-workshop')+
      metric('En taller',workshop,'workshop')+
      metric('Terminados para recoger',ready,'ready')+
      metric('Recogidos, recuperar ruta',route,'route')+
      metric('Fuera de contrato',expiredCount,'contract-expired');

    let source=document.querySelector('#v39-panel-source');
    if(!source){
      source=document.createElement('div');
      source.id='v39-panel-source';
      source.className='card text-small';
      cards.insertAdjacentElement('beforebegin',source);
    }
    source.innerHTML=`<strong>Fuente única: Hotel</strong> · Pizarra actual · ${data.length} registros · actualizado ${fmtTime()}`;

    const workshopRows=data.filter(r=>workshopStates.includes(r.estado));
    workshopList.innerHTML=workshopRows.map(r=>{
      const vehicle=r.dfm?`DFM ${esc(r.dfm)} · ${esc(r.matricula||'—')}`:`Reserva ${esc(r.reserva||'—')} · ${esc(r.matricula_reserva||'—')}`;
      return `<div class="stage"><span class="badge ${Number(r.prioridad)<=1?'priority-1':''}">P${esc(r.prioridad??'—')}</span><div><strong>${vehicle}</strong><div class="text-small">${esc(r.lugar||'Lugar sin indicar')} · desde ${esc(fmtDate(r.fecha_entrada))}</div><div class="text-small text-muted">Reserva ${esc(r.reserva||'—')} · ${esc(r.etiqueta_reserva||'')}</div></div></div>`;
    }).join('')||'<div class="text-small text-muted">No hay vehículos en taller.</div>';

    priorityList.innerHTML=data
      .filter(r=>!['reserva_liberada','anulado'].includes(r.estado))
      .sort((a,b)=>(Number(a.prioridad??99)-Number(b.prioridad??99))||(Number(a.orden??0)-Number(b.orden??0)))
      .map(r=>{
        const vehicle=r.dfm?`${String(r.dfm).startsWith('R')?'Semirremolque':'DFM'} ${esc(r.dfm)}`:`Reserva ${esc(r.reserva||'—')}`;
        return `<div class="stage"><span class="badge ${Number(r.prioridad)<=1?'priority-1':''}">P${esc(r.prioridad??'—')}</span><strong>${vehicle}</strong><span>${esc(r.causa||'Sin causa indicada')}</span></div>`;
      }).join('')||'<div class="text-small text-muted">No hay movimientos activos.</div>';
  }

  function schedule(delay=0){
    clearTimeout(reloadTimer);
    reloadTimer=setTimeout(renderPanel,delay);
  }

  document.addEventListener('click',e=>{
    if(e.target.closest?.('.hotel-subtab[data-hotel-view="summary"]')) schedule(120);
    const metricButton=e.target.closest?.('.v39-panel-metric');
    if(metricButton){
      const filter=metricButton.dataset.filter;
      document.querySelector('.hotel-subtab[data-hotel-view="board"]')?.click();
      setTimeout(()=>document.querySelector(`#hotel-summary-cards .hotel-metric-filter[data-filter="${CSS.escape(filter)}"]`)?.click(),80);
    }
  },true);

  function subscribe(){
    if(channel) return;
    channel=sb.channel('v39-panel-fuente-hotel')
      .on('postgres_changes',{event:'*',schema:'public',table:'registros_hotel'},()=>{if(dashboardVisible())schedule(420)})
      .on('postgres_changes',{event:'*',schema:'public',table:'etapas_hotel'},()=>{if(dashboardVisible())schedule(420)})
      .on('postgres_changes',{event:'*',schema:'public',table:'pizarras'},()=>{if(dashboardVisible())schedule(420)})
      .subscribe();
  }

  sb.auth.onAuthStateChange((_event,session)=>{if(session){subscribe();setTimeout(()=>{if(dashboardVisible())renderPanel();},500)}});
  window.addEventListener('focus',()=>{if(dashboardVisible())schedule(80)});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&dashboardVisible())schedule(80)});
  setTimeout(()=>{subscribe();if(dashboardVisible())renderPanel();},1200);
})();
