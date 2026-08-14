// v39 preview · carga robusta del Histórico del Hotel tras login/restauración de sesión.
(() => {
  'use strict';
  if (window.__metrogestionV39HistoryLoadLoaded) return;
  window.__metrogestionV39HistoryLoadLoaded = true;

  const URL='https://njtohfkqjjoavtumtmza.supabase.co';
  const KEY='sb_publishable_w1a9DClOM0S4HVJdv_TbKg_W_UkN2W_';
  const sb=window.supabase?.createClient?.(URL,KEY);
  if(!sb) return;

  let loading=false;
  let reloadTimer=null;

  const esc=value=>String(value??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  const fmtDate=iso=>{
    const [y,m,d]=String(iso||'').split('-');
    return y&&m&&d?`${Number(d)}/${Number(m)}/${y}`:'';
  };
  const stateLabel=state=>({
    planificado:'Pendiente de parar',
    pendiente_taller:'Pendiente de taller',
    pendiente_diagnostico:'Pendiente de diagnóstico',
    pendiente_autorizacion:'Pendiente de autorización',
    en_taller:'Realizando trabajos en taller',
    pendiente_repuestos:'Pendiente de repuestos',
    terminado_pendiente_recogida:'Terminado, pendiente de recoger',
    recogido_pendiente_ruta:'Recogido, pendiente de recuperar ruta',
    reserva_liberada:'Reserva libre',
    anulado:'Anulado'
  }[state]||state||'—');

  function currentMonth(){
    const field=document.querySelector('#hotel-history-month');
    if(field?.value) return field.value;
    const p=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Madrid',year:'numeric',month:'2-digit'}).format(new Date());
    if(field) field.value=p;
    return p;
  }

  function nextMonth(month){
    const [y,m]=month.split('-').map(Number);
    const d=new Date(Date.UTC(y,m,1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-01`;
  }

  function historyVisible(){
    const list=document.querySelector('#hotel-history-list');
    return !!(list && list.getClientRects().length);
  }

  async function canView(){
    const {data:{session}}=await sb.auth.getSession();
    if(!session) return false;
    const {data,error}=await sb.rpc('puede_ver_modulo_v39',{p_modulo:'hotel'});
    return !error && data===true;
  }

  function render(rows,pizarrasById,month){
    const list=document.querySelector('#hotel-history-list');
    if(!list) return;
    const query=(document.querySelector('#hotel-history-search')?.value||'').trim().toLowerCase();
    const filtered=rows.filter(row=>{
      const p=pizarrasById.get(row.pizarra_id);
      const text=[p?.fecha,row.vehiculo_sustituido,row.matricula_sustituido,row.vehiculo_reserva,row.matricula_reserva,row.upc,row.lugar,row.estado,row.causa,row.incidencia,row.marca,row.tipo_motor].join(' ').toLowerCase();
      return !query || text.includes(query);
    });

    list.innerHTML=filtered.map(row=>{
      const p=pizarrasById.get(row.pizarra_id)||{};
      const cancelled=p.estado==='anulada'||row.estado==='anulado'||row.oculto===true;
      const primary=row.vehiculo_sustituido
        ? `${String(row.vehiculo_sustituido).startsWith('R')?'R':'DFM'} ${esc(row.vehiculo_sustituido)} · ${esc(row.matricula_sustituido||'—')}`
        : `Reserva ${esc(row.vehiculo_reserva||'—')} · ${esc(row.matricula_reserva||'—')}`;
      const reserve=`Reserva ${esc(row.vehiculo_reserva||'—')} · ${esc(row.matricula_reserva||'—')} · ${esc(row.lugar||'Sin indicar')}`;
      return `<article class="card stack ${cancelled?'text-muted':''}">
        <div><strong>${esc(fmtDate(p.fecha))} · ${primary}</strong></div>
        <div><span class="badge">${esc(cancelled?'Anulado':stateLabel(row.estado))}</span></div>
        <div>${reserve}</div>
        <div class="text-small">UPC: ${esc(row.upc||'—')} · Prioridad ${esc(row.prioridad??'—')} · INC: ${esc(row.incidencia||'Sin incidencia')}</div>
        <div class="text-small text-muted">${esc(row.causa||'Sin causa indicada')}</div>
      </article>`;
    }).join('') || `<div class="card">No hay registros guardados en ${esc(month)}.</div>`;

    // El filtro por día v39 se aplica sobre estas tarjetas cuando exista.
    document.querySelector('#v39-history-day')?.dispatchEvent(new Event('change',{bubbles:false}));
  }

  async function loadHistory(){
    if(loading || !historyVisible()) return;
    if(!(await canView())) return;
    const list=document.querySelector('#hotel-history-list');
    if(!list) return;
    loading=true;
    const month=currentMonth();
    list.innerHTML='<div class="card">Cargando histórico…</div>';
    try{
      const {data:pizarras,error:pError}=await sb.from('pizarras')
        .select('id,fecha,estado,motivo_anulacion')
        .gte('fecha',month+'-01')
        .lt('fecha',nextMonth(month))
        .in('estado',['archivada','anulada'])
        .order('fecha',{ascending:false});
      if(pError) throw pError;
      const ids=(pizarras||[]).map(p=>p.id);
      if(!ids.length){
        list.innerHTML='<div class="card">No hay registros guardados en el mes seleccionado.</div>';
        return;
      }
      const {data:rows,error:rError}=await sb.from('registros_hotel')
        .select('*')
        .in('pizarra_id',ids)
        .order('orden',{ascending:true});
      if(rError) throw rError;
      const byId=new Map((pizarras||[]).map(p=>[p.id,p]));
      const dateRank=new Map((pizarras||[]).map((p,i)=>[p.id,i]));
      (rows||[]).sort((a,b)=>(dateRank.get(a.pizarra_id)??999)-(dateRank.get(b.pizarra_id)??999)||(Number(a.orden||0)-Number(b.orden||0)));
      render(rows||[],byId,month);
    }catch(error){
      list.innerHTML=`<div class="card">No se pudo cargar el histórico: ${esc(error?.message||'error desconocido')}</div>`;
    }finally{
      loading=false;
    }
  }

  function scheduleLoad(delay=0){
    clearTimeout(reloadTimer);
    reloadTimer=setTimeout(loadHistory,delay);
  }

  document.addEventListener('click',e=>{
    if(e.target.closest?.('.hotel-subtab[data-hotel-view="history"]')) scheduleLoad(100);
  },true);
  document.addEventListener('change',e=>{
    if(e.target?.id==='hotel-history-month') scheduleLoad(50);
  },true);
  document.addEventListener('input',e=>{
    if(e.target?.id==='hotel-history-search') scheduleLoad(120);
  },true);

  sb.auth.onAuthStateChange((_event,session)=>{if(session)setTimeout(()=>{if(historyVisible())loadHistory();},500)});
  window.addEventListener('focus',()=>{if(historyVisible())scheduleLoad(50)});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&historyVisible())scheduleLoad(50)});
  setTimeout(()=>{if(historyVisible())loadHistory();},1200);
})();
