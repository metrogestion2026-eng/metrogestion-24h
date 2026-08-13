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
    #v39-tprog-list{display:grid;gap:8px}.v39-tprog{background:#fff;border:1px solid #fde68a;border-left:6px solid #f59e0b;border-radius:11px;padding:10px;cursor:pointer}.v39-tprog.recovered{border-left-color:#7c3aed}.v39-tprog.overdue{border-left-color:#dc2626;background:#fff7f7}.v39-tprog .meta{font-size:12px;color:#64748b}.v39-tprog .row{display:flex;justify-content:space-between;gap:8px;align-items:flex-start;flex-wrap:wrap}.v39-tprog-group{font-weight:900;margin-top:6px}
  `;document.head.appendChild(s)}

  function ensurePanel(){const panel=document.querySelector('#hotel-programmed-tasks');if(!panel)return null;panel.innerHTML=`<div class="hotel-title"><div><strong>📅 T programadas</strong><div class="text-small text-muted">Toda T pendiente permanece aquí hasta realizarla o anularla, aunque el vehículo ya esté recuperado.</div></div><span id="v39-tprog-count" class="badge">…</span></div><div id="v39-tprog-list"></div>`;return panel}

  function render(items){const panel=ensurePanel();if(!panel)return;const list=panel.querySelector('#v39-tprog-list'),count=panel.querySelector('#v39-tprog-count');count.textContent=String(items.length);const t=today();const groups=[
    ['⚠ Vencidas',items.filter(x=>x.planned&&x.planned<t),'overdue'],
    ['📌 Hoy',items.filter(x=>x.planned===t),'today'],
    ['🗓 Próximas',items.filter(x=>x.planned&&x.planned>t),'future'],
    ['📝 Sin fecha programada',items.filter(x=>!x.planned),'nodate']
  ];
  list.innerHTML=groups.map(([title,arr,kind])=>arr.length?`<div class="v39-tprog-group">${title} · ${arr.length}</div>${arr.map(x=>`<article class="v39-tprog ${x.recovered?'recovered':''} ${kind==='overdue'?'overdue':''} stage" data-stage-id="${esc(x.stageId)}"><div class="row"><div><strong>${esc(x.vehicle)} · ${esc(x.position)}T · ${esc(x.name||'T')}</strong><div class="meta">Parada ${esc(x.stopNumber||'—')} · ${esc(x.status||'pendiente')}${x.location?' · '+esc(x.location):''}</div></div><span class="badge">${x.recovered?'Recuperado · T pendiente':(x.planned?showDay(x.planned):'Pendiente')}</span></div>${x.planned?`<div class="meta">Programada: ${esc(showDay(x.planned))}</div>`:'<div class="meta">Pendiente de asignar fecha.</div>'}</article>`).join('')}`:'').join('')||'<div class="card">✓ No hay T pendientes.</div>';
  }

  async function load(force=false){const n=Date.now();if(loading||(!force&&n-last<3500))return;const panel=document.querySelector('#hotel-programmed-tasks');if(!panel)return;loading=true;try{const b=await sb.from('pizarras').select('id,fecha').eq('estado','en_curso').order('fecha',{ascending:false}).limit(1).maybeSingle();if(b.error)throw b.error;if(!b.data)throw new Error('No hay pizarra en curso');const q=await sb.from('registros_hotel').select('id,numero_parada,vehiculo_sustituido,vehiculo_reserva,retirado_hotel_activo,etapas_hotel(id,nombre,posicion,estado,lugar,fecha_prevista,fecha_real)').eq('pizarra_id',b.data.id).eq('oculto',false);if(q.error)throw q.error;const items=[];(q.data||[]).forEach(r=>(r.etapas_hotel||[]).forEach(e=>{const st=String(e.estado||'').toLowerCase();if(st==='realizada'||st==='anulada')return;items.push({stageId:e.id,position:Number(e.posicion||0),name:e.nombre||'',status:e.estado||'pendiente',location:e.lugar||'',planned:day(e.fecha_prevista),recovered:r.retirado_hotel_activo===true,stopNumber:r.numero_parada||'',vehicle:r.vehiculo_sustituido?((String(r.vehiculo_sustituido).startsWith('R')?'R ':'DFM ')+r.vehiculo_sustituido):('Reserva '+(r.vehiculo_reserva||'—'))})}));items.sort((a,b)=>Number(b.recovered)-Number(a.recovered)||(a.planned||'9999').localeCompare(b.planned||'9999')||a.vehicle.localeCompare(b.vehicle,'es',{numeric:true})||a.position-b.position);render(items)}catch(e){const p=ensurePanel();if(p)p.querySelector('#v39-tprog-list').innerHTML=`<div class="card" style="color:#991b1b">No se pudieron cargar las T pendientes: ${esc(e?.message||'error')}</div>`}finally{last=Date.now();loading=false}}

  function schedule(){clearTimeout(timer);timer=setTimeout(()=>load(false),120)}
  style();const ob=new MutationObserver(m=>{if(m.every(x=>x.target.closest?.('#hotel-programmed-tasks')))return;schedule()});ob.observe(document.documentElement,{childList:true,subtree:true});window.addEventListener('focus',()=>load(true));document.addEventListener('click',e=>{if(e.target.closest('.v39-tprog'))setTimeout(()=>load(true),500)},true);schedule();
})();
