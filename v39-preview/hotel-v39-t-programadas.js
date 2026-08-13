// v39 preview · T programadas completas: toda T pendiente, con o sin fecha.
(() => {
  'use strict';
  if (window.__metrogestionV39ProgrammedLoaded) return;
  window.__metrogestionV39ProgrammedLoaded = true;

  const URL='https://njtohfkqjjoavtumtmza.supabase.co';
  const KEY='sb_publishable_w1a9DClOM0S4HVJdv_TbKg_W_UkN2W_';
  const sb=window.supabase?.createClient?.(URL,KEY);
  if(!sb)return;

  let loading=false,last=0,timer=null;
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const day=v=>{if(!v)return'';const d=new Date(v);if(Number.isNaN(d.getTime()))return'';return new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Madrid',year:'numeric',month:'2-digit',day:'2-digit'}).format(d)};
  const showDay=v=>v?new Date(v+'T12:00:00').toLocaleDateString('es-ES'):'Sin fecha';
  const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Madrid',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());

  function style(){if(document.getElementById('v39-tprog-css'))return;const s=document.createElement('style');s.id='v39-tprog-css';s.textContent=`
    #hotel-programmed-tasks{border:3px solid #f59e0b!important;background:#fffbeb!important}
    #v39-tprog-list{display:grid;gap:10px}
    .v39-tprog-vehicle{background:#fff;border:2px solid #fde68a;border-left:7px solid #f59e0b;border-radius:12px;padding:11px;display:grid;gap:8px}
    .v39-tprog-vehicle.recovered{border-left-color:#7c3aed}
    .v39-tprog-vehicle.overdue{border-left-color:#dc2626;background:#fffafa}
    .v39-tprog-vehicle-head{display:flex;justify-content:space-between;gap:10px;align-items:flex-start;flex-wrap:wrap;padding-bottom:5px;border-bottom:1px solid #f1e3b6}
    .v39-tprog-vehicle-head strong{font-size:16px}
    .v39-tprog-stage{background:#fffdf7;border:1px solid #fde68a;border-radius:9px;padding:9px;cursor:pointer}
    .v39-tprog-stage:hover{outline:2px solid #fbbf24;outline-offset:1px}
    .v39-tprog-stage .meta{font-size:12px;color:#64748b}
    .v39-tprog-stage .row{display:flex;justify-content:space-between;gap:8px;align-items:flex-start;flex-wrap:wrap}
    .v39-tprog-summary{display:flex;gap:6px;flex-wrap:wrap}
    .v39-tprog-summary .badge{font-weight:850}
  `;document.head.appendChild(s)}

  function ensurePanel(){const panel=document.querySelector('#hotel-programmed-tasks');if(!panel)return null;panel.innerHTML=`<div class="hotel-title"><div><strong>📅 T programadas</strong><div class="text-small text-muted">Agrupadas por DFM/R. Toda T pendiente permanece aquí hasta realizarla o anularla, aunque el vehículo ya esté recuperado.</div></div><span id="v39-tprog-count" class="badge">…</span></div><div id="v39-tprog-list"></div>`;return panel}

  function render(items){
    const panel=ensurePanel();if(!panel)return;
    const list=panel.querySelector('#v39-tprog-list'),count=panel.querySelector('#v39-tprog-count');
    count.textContent=String(items.length);
    const t=today();
    const grouped=new Map();
    items.forEach(x=>{
      const key=x.vehicleCode||x.vehicle;
      if(!grouped.has(key))grouped.set(key,{key,label:x.vehicle,stopNumber:x.stopNumber,recovered:x.recovered,items:[]});
      const g=grouped.get(key);g.items.push(x);g.recovered=g.recovered||x.recovered;if(!g.stopNumber&&x.stopNumber)g.stopNumber=x.stopNumber;
    });
    const vehicles=[...grouped.values()].sort((a,b)=>Number(b.recovered)-Number(a.recovered)||a.key.localeCompare(b.key,'es',{numeric:true}));
    list.innerHTML=vehicles.map(g=>{
      g.items.sort((a,b)=>{
        const rank=x=>x.planned?(x.planned<t?0:x.planned===t?1:2):3;
        return rank(a)-rank(b)||(a.planned||'9999').localeCompare(b.planned||'9999')||a.position-b.position;
      });
      const overdue=g.items.filter(x=>x.planned&&x.planned<t).length;
      const todayCount=g.items.filter(x=>x.planned===t).length;
      const future=g.items.filter(x=>x.planned&&x.planned>t).length;
      const nodate=g.items.filter(x=>!x.planned).length;
      const cls=`v39-tprog-vehicle ${g.recovered?'recovered':''} ${overdue?'overdue':''}`;
      return `<section class="${cls}"><div class="v39-tprog-vehicle-head"><div><strong>${esc(g.label)}</strong><div class="meta">Parada ${esc(g.stopNumber||'—')}</div></div><div class="v39-tprog-summary"><span class="badge">${g.items.length} T pendientes</span>${overdue?`<span class="badge" style="color:#991b1b">⚠ ${overdue} vencidas</span>`:''}${todayCount?`<span class="badge">📌 ${todayCount} hoy</span>`:''}${future?`<span class="badge">🗓 ${future} próximas</span>`:''}${nodate?`<span class="badge">📝 ${nodate} sin fecha</span>`:''}${g.recovered?'<span class="badge">Recuperado · T pendientes</span>':''}</div></div>${g.items.map(x=>{
        const status=x.planned?(x.planned<t?'⚠ Vencida':x.planned===t?'📌 Hoy':'🗓 Próxima'):'📝 Sin fecha';
        return `<article class="v39-tprog-stage stage" data-stage-id="${esc(x.stageId)}"><div class="row"><div><strong>${esc(x.position)}T · ${esc(x.name||'T')}</strong><div class="meta">${esc(x.status||'pendiente')}${x.location?' · '+esc(x.location):''}</div></div><span class="badge">${status}${x.planned?' · '+esc(showDay(x.planned)):''}</span></div>${x.planned?'':`<div class="meta">Pendiente de asignar fecha.</div>`}</article>`;
      }).join('')}</section>`;
    }).join('')||'<div class="card">✓ No hay T pendientes.</div>';
  }

  async function load(force=false){const n=Date.now();if(loading||(!force&&n-last<3500))return;const panel=document.querySelector('#hotel-programmed-tasks');if(!panel)return;loading=true;try{const b=await sb.from('pizarras').select('id,fecha').eq('estado','en_curso').order('fecha',{ascending:false}).limit(1).maybeSingle();if(b.error)throw b.error;if(!b.data)throw new Error('No hay pizarra en curso');const q=await sb.from('registros_hotel').select('id,numero_parada,vehiculo_sustituido,vehiculo_reserva,retirado_hotel_activo,etapas_hotel(id,nombre,posicion,estado,lugar,fecha_prevista,fecha_real)').eq('pizarra_id',b.data.id).eq('oculto',false);if(q.error)throw q.error;const items=[];(q.data||[]).forEach(r=>(r.etapas_hotel||[]).forEach(e=>{const st=String(e.estado||'').toLowerCase();if(st==='realizada'||st==='anulada')return;const code=r.vehiculo_sustituido||r.vehiculo_reserva||'—';items.push({stageId:e.id,position:Number(e.posicion||0),name:e.nombre||'',status:e.estado||'pendiente',location:e.lugar||'',planned:day(e.fecha_prevista),recovered:r.retirado_hotel_activo===true,stopNumber:r.numero_parada||'',vehicleCode:code,vehicle:r.vehiculo_sustituido?((String(r.vehiculo_sustituido).startsWith('R')?'R ':'DFM ')+r.vehiculo_sustituido):('Reserva '+(r.vehiculo_reserva||'—'))})}));render(items)}catch(e){const p=ensurePanel();if(p)p.querySelector('#v39-tprog-list').innerHTML=`<div class="card" style="color:#991b1b">No se pudieron cargar las T pendientes: ${esc(e?.message||'error')}</div>`}finally{last=Date.now();loading=false}}

  function schedule(){clearTimeout(timer);timer=setTimeout(()=>load(false),120)}
  style();const ob=new MutationObserver(m=>{if(m.every(x=>x.target.closest?.('#hotel-programmed-tasks')))return;schedule()});ob.observe(document.documentElement,{childList:true,subtree:true});window.addEventListener('focus',()=>load(true));document.addEventListener('click',e=>{if(e.target.closest('.v39-tprog-stage'))setTimeout(()=>load(true),500)},true);schedule();
})();
