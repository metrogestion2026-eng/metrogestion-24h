import '../../r1-alpha30/src/app.js';
import { supabase } from '../../r1-alpha17/src/supabase.js';

const VERSION='r1.0.0-alpha.31';
const versionNode=document.querySelector('#app-version');if(versionNode)versionNode.textContent=VERSION;
const content=document.querySelector('#module-content');
const nav=document.querySelector('#module-nav');

function el(tag,text,cls){const n=document.createElement(tag);if(text!=null)n.textContent=text;if(cls)n.className=cls;return n;}
function fmtNum(v,d=0){const n=Number(v);return Number.isFinite(n)?new Intl.NumberFormat('es-ES',{minimumFractionDigits:d,maximumFractionDigits:d}).format(n):'—';}
function ensureStyle(){if(document.querySelector('#alpha31-style'))return;const s=document.createElement('style');s.id='alpha31-style';s.textContent=`
.alpha31-editor{margin-top:10px;padding-top:10px;border-top:1px dashed #b9ccd6}.alpha31-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px}.alpha31-editor label{display:grid;gap:4px;font-weight:700}.alpha31-editor input{width:100%;box-sizing:border-box}.alpha31-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px}.alpha31-status{margin-top:7px;font-size:.9rem}.alpha31-source{margin:0 0 8px;font-size:.9rem}.alpha31-r-config{border:1px solid #dbe5ec;border-radius:12px;padding:12px;background:#fff;margin:12px 0;display:flex;gap:10px;align-items:end;flex-wrap:wrap}.alpha31-r-config label{display:grid;gap:5px;font-weight:700;min-width:180px}.alpha31-r-config input{width:100%;box-sizing:border-box}
`;document.head.append(s);}ensureStyle();

function stopNumber(card){let out='';card.querySelectorAll('.detail').forEach(d=>{if(d.querySelector('span')?.textContent?.trim()==='Nº de parada')out=d.querySelector('strong')?.textContent?.trim()||'';});return out;}

let enhancing=false;
async function enhanceCards(){if(enhancing||!content?.querySelector('.hotel-card .subst-box'))return;enhancing=true;try{
  const [{data:rows,error},{data:rCfg}]=await Promise.all([
    supabase.from('paradas_sustitucion_resumen').select('*'),
    supabase.from('config_facturacion_sustituciones').select('precio_r_unidad').eq('id',1).maybeSingle()
  ]);if(error)return;
  const byStop=new Map((rows||[]).map(r=>[r.numero_parada,r]));
  content.querySelectorAll('.hotel-card').forEach(card=>{
    const box=card.querySelector('.subst-box');if(!box||box.dataset.alpha31==='1')return;const r=byStop.get(stopNumber(card));if(!r)return;box.dataset.alpha31='1';
    box.querySelectorAll('.subst-cell span').forEach(sp=>{if(sp.textContent.trim()==='Media CTM')sp.textContent='Media usada';});
    const editor=el('div',null,'alpha31-editor');
    if(r.clase_facturacion==='DFM'){
      editor.append(el('div',`Automático CTM: ${r.km_dia_automatico==null?'sin dato':fmtNum(r.km_dia_automatico)+' km/día'} · Manual: ${r.km_dia_manual==null?'no':fmtNum(r.km_dia_manual)+' km/día'} · Usado: ${r.km_dia==null?'—':fmtNum(r.km_dia)+' km/día'} · Fuente: ${r.km_dia_fuente||'—'}`,'alpha31-source'));
      const grid=el('div',null,'alpha31-grid');const km=document.createElement('input');km.type='number';km.min='1';km.max='5000';km.step='0.001';km.value=r.km_dia_manual??r.km_dia??'';const obs=document.createElement('input');obs.type='text';obs.placeholder='Motivo o nota opcional';obs.value=r.ajuste_observaciones||'';const lk=el('label');lk.append(el('span','Media km/día manual'),km);const lo=el('label');lo.append(el('span','Observación'),obs);grid.append(lk,lo);editor.append(grid);
      const actions=el('div',null,'alpha31-actions');const save=el('button','Guardar media manual','button primary compact');save.type='button';const reset=el('button','Volver a automático','button secondary compact');reset.type='button';reset.disabled=r.km_dia_manual==null;const status=el('div','', 'alpha31-status');
      save.addEventListener('click',async()=>{const val=Number(km.value);if(!Number.isFinite(val)||val<=0||val>5000){status.textContent='Introduce una media válida entre 1 y 5000 km/día.';return;}save.disabled=true;status.textContent='Guardando…';const {error:e}=await supabase.rpc('guardar_km_dia_sustitucion',{p_seguimiento_id:r.seguimiento_id,p_km_dia:val,p_observaciones:obs.value.trim()});save.disabled=false;if(e){status.textContent=`No se pudo guardar: ${e.message}`;return;}status.textContent='Media manual guardada.';box.remove();});
      reset.addEventListener('click',async()=>{reset.disabled=true;status.textContent='Restaurando CTM…';const {error:e}=await supabase.rpc('guardar_km_dia_sustitucion',{p_seguimiento_id:r.seguimiento_id,p_km_dia:null,p_observaciones:''});if(e){reset.disabled=false;status.textContent=`No se pudo restaurar: ${e.message}`;return;}status.textContent='Vuelve a usarse la media CTM.';box.remove();});
      actions.append(save,reset);editor.append(actions,status);
    }else{
      editor.append(el('div',`Facturación R: 1 unidad fija · Precio actual: ${rCfg?.precio_r_unidad==null?'pendiente de configurar':fmtNum(rCfg.precio_r_unidad,2)+' €'}`,'alpha31-source'));
    }
    box.append(editor);
  });
}finally{enhancing=false;}}

async function enhanceListados(){const h2=[...(content?.querySelectorAll('h2')||[])].find(x=>x.textContent.trim()==='Listados');if(!h2||content.querySelector('.alpha31-r-config'))return;const {data}=await supabase.from('config_facturacion_sustituciones').select('precio_r_unidad').eq('id',1).maybeSingle();const panel=el('div',null,'alpha31-r-config');const inp=document.createElement('input');inp.type='number';inp.min='0';inp.max='100000';inp.step='0.01';inp.value=data?.precio_r_unidad??'';inp.placeholder='Ej. 85,00';const lab=el('label');lab.append(el('span','Precio fijo por sustitución R (€)'),inp);const save=el('button','Guardar precio R','button primary compact');save.type='button';const status=el('span','', 'alpha31-status');save.addEventListener('click',async()=>{const raw=inp.value.trim();const val=raw===''?null:Number(raw);if(val!=null&&(!Number.isFinite(val)||val<0||val>100000)){status.textContent='Precio no válido.';return;}save.disabled=true;status.textContent='Guardando…';const {error}=await supabase.rpc('guardar_precio_r_sustitucion',{p_precio:val});save.disabled=false;if(error){status.textContent=`No se pudo guardar: ${error.message}`;return;}status.textContent='Precio R guardado.';});panel.append(lab,save,status);const filters=content.querySelector('.alpha30-filters');if(filters)filters.before(panel);else h2.parentElement?.after(panel);}

if(content){const obs=new MutationObserver(()=>{queueMicrotask(()=>{enhanceCards();enhanceListados();});});obs.observe(content,{childList:true,subtree:true});}
requestAnimationFrame(()=>{enhanceCards();enhanceListados();});

if(nav){nav.addEventListener('click',()=>setTimeout(()=>{enhanceCards();enhanceListados();},80));}
