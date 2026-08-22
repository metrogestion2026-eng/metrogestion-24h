import '../../r1-alpha29/src/app.js';
import { supabase } from '../../r1-alpha17/src/supabase.js';

const VERSION='r1.0.0-alpha.30';
const versionNode=document.querySelector('#app-version');if(versionNode)versionNode.textContent=VERSION;
const nav=document.querySelector('#module-nav');
const content=document.querySelector('#module-content');

function el(tag,text,cls){const n=document.createElement(tag);if(text!=null)n.textContent=text;if(cls)n.className=cls;return n;}
function fmtDate(v){if(!v)return '—';const [y,m,d]=String(v).slice(0,10).split('-');return y&&m&&d?`${d}/${m}/${y}`:String(v);}
function fmtNum(v,d=0){const n=Number(v);return Number.isFinite(n)?new Intl.NumberFormat('es-ES',{minimumFractionDigits:d,maximumFractionDigits:d}).format(n):'—';}
function ensureStyle(){if(document.querySelector('#alpha30-style'))return;const s=document.createElement('style');s.id='alpha30-style';s.textContent=`
.subst-box{border:1px solid rgba(7,89,133,.22);background:rgba(240,249,255,.76);border-radius:12px;padding:11px 12px}.subst-box h4{margin:0 0 8px}.subst-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(145px,1fr));gap:8px}.subst-cell{background:#fff;border:1px solid #dbe8ef;border-radius:10px;padding:9px}.subst-cell strong{display:block;font-size:1.08rem}.subst-period{margin-top:8px;font-size:.9rem}.alpha30-listados-head{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:flex-start}.alpha30-filters{display:grid;grid-template-columns:repeat(auto-fit,minmax(175px,1fr));gap:10px;margin:14px 0}.alpha30-filters label{display:grid;gap:5px;font-weight:700}.alpha30-summary{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;margin:12px 0}.alpha30-metric{border:1px solid #dbe5ec;border-radius:12px;padding:12px;background:#fff}.alpha30-metric strong{display:block;font-size:1.35rem}.alpha30-table-wrap{overflow:auto;border:1px solid #dbe5ec;border-radius:12px;background:#fff}.alpha30-table{width:100%;border-collapse:collapse;min-width:980px}.alpha30-table th,.alpha30-table td{padding:9px 10px;border-bottom:1px solid #e5edf2;text-align:left;vertical-align:top}.alpha30-table th{background:#f1f7fa;position:sticky;top:0;z-index:1}.alpha30-empty{padding:24px;text-align:center}.alpha30-print-title{display:none}@media print{body{background:#fff}.app-header,.session-bar,#module-nav,.alpha30-controls,.alpha30-filters{display:none!important}.page-shell{max-width:none!important;margin:0!important;padding:0!important}.module-content{padding:0!important}.alpha30-print-title{display:block}.alpha30-table-wrap{border:0;overflow:visible}.alpha30-table{min-width:0;font-size:9pt}.alpha30-table th{position:static;background:#eee!important;-webkit-print-color-adjust:exact;print-color-adjust:exact}.alpha30-table th,.alpha30-table td{padding:5px 6px}@page{size:A4 landscape;margin:10mm}}
`;document.head.append(s);}
ensureStyle();

let decorating=false;
async function decorateHotelCards(){if(decorating||!content?.querySelector('.hotel-card'))return;decorating=true;try{
  const [{data:stops},{data:periods}]=await Promise.all([
    supabase.from('paradas_sustitucion_resumen').select('*'),
    supabase.from('facturacion_dfm_periodos').select('*').order('periodo',{ascending:false})
  ]);
  const byStop=new Map((stops||[]).map(r=>[r.numero_parada,r]));
  const latestPeriod=new Map();for(const r of periods||[]){if(!latestPeriod.has(r.numero_parada))latestPeriod.set(r.numero_parada,r);}
  content.querySelectorAll('.hotel-card').forEach(card=>{
    if(card.querySelector('.subst-box'))return;
    let stopNo='';card.querySelectorAll('.detail').forEach(d=>{if(d.querySelector('span')?.textContent?.trim()==='Nº de parada')stopNo=d.querySelector('strong')?.textContent?.trim()||'';});
    const r=byStop.get(stopNo);if(!r)return;
    const box=el('section',null,'subst-box');box.append(el('h4','Sustitución / facturación'));
    const grid=el('div',null,'subst-grid');
    const add=(label,value)=>{const c=el('div',null,'subst-cell');c.append(el('strong',value),el('span',label,'muted'));grid.append(c);};
    add('Días parada total',fmtNum(r.dias_parada_total));
    if(r.clase_facturacion==='R'){
      add('Tipo facturación','1 unidad');
      add('KM sustitución','No aplica');
    }else if(r.sustituto){
      add('Media CTM',r.km_dia!=null?`${fmtNum(r.km_dia)} km/día`:'Sin media');
      add('KM sustitución total',r.km_sustitucion_total!=null?`${fmtNum(r.km_sustitucion_total)} km`:'—');
    }else{
      add('Media CTM',r.km_dia!=null?`${fmtNum(r.km_dia)} km/día`:'Sin media');
      add('KM sustitución','Sin sustituto');
    }
    box.append(grid);
    if(r.clase_facturacion==='DFM'&&r.sustituto){const p=latestPeriod.get(stopNo);if(p)box.append(el('div',`Periodo ${p.periodo}: ${fmtDate(p.tramo_inicio)}–${fmtDate(p.tramo_fin)} · ${fmtNum(p.dias_facturables)} días · ${fmtNum(p.km_facturables)} km`,'subst-period'));}
    const stages=card.querySelector('.hotel-card-stages');if(stages)card.insertBefore(box,stages);else card.append(box);
  });
}finally{decorating=false;}}

if(content){const obs=new MutationObserver(()=>{if(content.querySelector('.hotel-card'))queueMicrotask(decorateHotelCards);});obs.observe(content,{childList:true,subtree:true});}
requestAnimationFrame(decorateHotelCards);

async function renderListados30(){ensureStyle();content.replaceChildren();
  const wrap=el('section');const head=el('div',null,'alpha30-listados-head');const tb=el('div');tb.append(el('p','Informes operativos y facturación','eyebrow'),el('h2','Listados'));const controls=el('div',null,'alpha30-controls');const pb=el('button','🖨️ Imprimir','button primary');pb.type='button';pb.onclick=()=>window.print();controls.append(pb);head.append(tb,controls);wrap.append(head);
  const printTitle=el('div',null,'alpha30-print-title');printTitle.append(el('h2','Metrogestión · Listados'));wrap.append(printTitle);
  const filters=el('div',null,'alpha30-filters');
  const mode=document.createElement('select');[['paradas','Paradas'],['dfm','Facturación DFM'],['r','Sustituciones R']].forEach(([v,t])=>{const o=document.createElement('option');o.value=v;o.textContent=t;mode.append(o);});
  const period=document.createElement('select');const search=document.createElement('input');search.placeholder='DFM, R, matrícula, parada o INC';const from=document.createElement('input');from.type='date';const to=document.createElement('input');to.type='date';
  for(const [label,input] of [['Tipo de listado',mode],['Periodo facturación',period],['Desde',from],['Hasta',to],['Buscar',search]]){const l=el('label');l.append(el('span',label),input);filters.append(l);}wrap.append(filters);
  const summary=el('div',null,'alpha30-summary');const tableWrap=el('div',null,'alpha30-table-wrap');wrap.append(summary,tableWrap);content.append(wrap);
  const [{data:paradas,error:e1},{data:dfm,error:e2},{data:r,error:e3},{data:cierres,error:e4}]=await Promise.all([
    supabase.from('listado_paradas_operativas').select('*').order('fecha_parada',{ascending:false}),
    supabase.from('facturacion_dfm_periodos').select('*').order('periodo',{ascending:false}),
    supabase.from('facturacion_r_sustituciones').select('*').order('fecha_inicio_parada',{ascending:false}),
    supabase.from('cierres_facturacion').select('*').order('periodo',{ascending:false})
  ]);
  const err=e1||e2||e3||e4;if(err){tableWrap.append(el('div',`No se pudo cargar Listados: ${err.message}`,'notice danger'));return;}
  period.append(new Option('Todos',''));for(const c of cierres||[])period.append(new Option(`${c.periodo} · ${fmtDate(c.fecha_inicio)}–${fmtDate(c.fecha_cierre)}`,c.periodo));
  const metric=(label,val)=>{const m=el('div',null,'alpha30-metric');m.append(el('strong',String(val)),el('span',label,'muted'));summary.append(m);};
  const renderTable=(headers,rows)=>{tableWrap.replaceChildren();if(!rows.length){tableWrap.append(el('div','No hay resultados con estos filtros.','alpha30-empty'));return;}const t=el('table',null,'alpha30-table');const th=el('thead');const hr=el('tr');headers.forEach(h=>hr.append(el('th',h)));th.append(hr);const body=el('tbody');rows.forEach(vals=>{const tr=el('tr');vals.forEach(v=>tr.append(el('td',String(v??'—'))));body.append(tr);});t.append(th,body);tableWrap.append(t);};
  function apply(){summary.replaceChildren();const q=search.value.trim().toLowerCase();
    if(mode.value==='dfm'){
      period.disabled=false;let rows=(dfm||[]).slice();if(period.value)rows=rows.filter(x=>x.periodo===period.value);if(from.value)rows=rows.filter(x=>x.tramo_fin>=from.value);if(to.value)rows=rows.filter(x=>x.tramo_inicio<=to.value);if(q)rows=rows.filter(x=>[x.dfm,x.matricula,x.numero_parada,x.sustituto,x.incidencia].some(v=>String(v||'').toLowerCase().includes(q)));
      const days=rows.reduce((a,x)=>a+Number(x.dias_facturables||0),0),km=rows.reduce((a,x)=>a+Number(x.km_facturables||0),0);metric('Paradas',rows.length);metric('Días facturables',fmtNum(days));metric('KM facturables',`${fmtNum(km)} km`);printTitle.querySelector('h2').textContent=`Metrogestión · Facturación DFM${period.value?' · '+period.value:''}`;
      renderTable(['Periodo','Inicio','Fin','DFM','Matrícula','Parada','Sustituto','Días','Media km/día','KM'],rows.map(x=>[x.periodo,fmtDate(x.tramo_inicio),fmtDate(x.tramo_fin),x.dfm,x.matricula,x.numero_parada,x.sustituto,fmtNum(x.dias_facturables),fmtNum(x.km_dia),fmtNum(x.km_facturables)]));return;
    }
    if(mode.value==='r'){
      period.disabled=true;let rows=(r||[]).slice();if(from.value)rows=rows.filter(x=>String(x.fecha_fin_parada||'9999-12-31')>=from.value);if(to.value)rows=rows.filter(x=>String(x.fecha_inicio_parada||'')<=to.value);if(q)rows=rows.filter(x=>[x.r_sustituido,x.matricula,x.numero_parada,x.r_sustituto,x.incidencia].some(v=>String(v||'').toLowerCase().includes(q)));
      const units=rows.reduce((a,x)=>a+Number(x.unidades||0),0),amount=rows.reduce((a,x)=>a+Number(x.importe||0),0);metric('Sustituciones',rows.length);metric('Unidades',fmtNum(units));metric('Importe',rows.some(x=>x.precio_r_unidad!=null)?`${fmtNum(amount,2)} €`:'Precio pendiente');printTitle.querySelector('h2').textContent='Metrogestión · Sustituciones R';
      renderTable(['Inicio','Fin','R sustituido','Parada','R sustituto','Días','Unidades','Precio/u','Importe'],rows.map(x=>[fmtDate(x.fecha_inicio_parada),fmtDate(x.fecha_fin_parada),x.r_sustituido,x.numero_parada,x.r_sustituto,fmtNum(x.dias_parada_total),fmtNum(x.unidades),x.precio_r_unidad==null?'—':`${fmtNum(x.precio_r_unidad,2)} €`,x.importe==null?'—':`${fmtNum(x.importe,2)} €`]));return;
    }
    period.disabled=true;let rows=(paradas||[]).slice();if(from.value)rows=rows.filter(x=>String(x.fecha_parada||'')>=from.value);if(to.value)rows=rows.filter(x=>String(x.fecha_parada||'')<=to.value);if(q)rows=rows.filter(x=>[x.dfm,x.matricula,x.numero_parada,x.incidencia].some(v=>String(v||'').toLowerCase().includes(q)));const days=rows.reduce((a,x)=>a+Number(x.dias_taller||0),0);metric('Paradas',rows.length);metric('Días en taller',fmtNum(days,1));metric('Promedio',rows.length?fmtNum(days/rows.length,1):'0,0');printTitle.querySelector('h2').textContent='Metrogestión · Listado de paradas';
    renderTable(['Fecha','Parada','DFM/R','Matrícula','INC','Causa','Estado','Taller','Días taller','UPC'],rows.map(x=>[fmtDate(x.fecha_parada),x.numero_parada,x.dfm,x.matricula,x.incidencia,x.causa,x.estado,x.talleres||x.lugar,fmtNum(x.dias_taller,1),x.upc]));
  }
  [mode,period,search,from,to].forEach(i=>{i.addEventListener('input',apply);i.addEventListener('change',apply);});apply();
}

if(nav){nav.addEventListener('click',e=>{const b=e.target.closest('[data-alpha29-listados]');if(!b)return;e.preventDefault();e.stopImmediatePropagation();[...nav.querySelectorAll('button')].forEach(x=>x.classList.remove('active'));b.classList.add('active');renderListados30();},true);}
