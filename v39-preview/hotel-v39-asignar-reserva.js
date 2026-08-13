// v39 preview · asignar una reserva disponible a un vehículo sustituido.
(() => {
  'use strict';
  if (window.__metrogestionV39AssignReserveLoaded) return;
  window.__metrogestionV39AssignReserveLoaded = true;

  const URL='https://njtohfkqjjoavtumtmza.supabase.co';
  const KEY='sb_publishable_w1a9DClOM0S4HVJdv_TbKg_W_UkN2W_';
  const sb=window.supabase?.createClient?.(URL,KEY);
  if(!sb) return;

  let vehicles=[];
  let currentReserve='';
  let decorating=false;
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const norm=v=>String(v||'').trim().toUpperCase();
  const madridDay=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Madrid',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());

  function addStyle(){
    if(document.getElementById('v39-assign-reserve-css')) return;
    const s=document.createElement('style');s.id='v39-assign-reserve-css';s.textContent=`
      .v39-res.v39-assignable{cursor:pointer;position:relative;transition:transform .12s ease,box-shadow .12s ease}
      .v39-res.v39-assignable:hover,.v39-res.v39-assignable:focus{outline:3px solid #16a34a;outline-offset:2px;box-shadow:0 8px 22px rgba(22,163,74,.16)}
      .v39-res.v39-assignable:active{transform:scale(.995)}
      .v39-assign-hint{display:inline-flex;margin-top:8px;padding:5px 9px;border-radius:999px;background:#dcfce7;border:1px solid #86efac;color:#166534;font-size:12px;font-weight:900}
      .v39-res.pending .v39-assign-hint{background:#fff7ed;border-color:#fdba74;color:#9a3412}
      #v39-assign-modal{position:fixed;inset:0;z-index:6500;display:none;background:rgba(15,23,42,.68);padding:12px;overflow:auto}
      #v39-assign-modal.open{display:block}
      #v39-assign-sheet{max-width:760px;margin:2vh auto;background:#fff;border-radius:16px;padding:16px;box-shadow:0 20px 65px rgba(0,0,0,.38)}
      #v39-assign-sheet .grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
      #v39-assign-vehicle-info{border-left:6px solid #0284c7;background:#f0f9ff}
      #v39-assign-confirm{border:2px solid #86efac;background:#f0fdf4}
      @media(max-width:650px){#v39-assign-sheet .grid{grid-template-columns:1fr}#v39-assign-sheet{margin:0 auto}}
    `;document.head.appendChild(s);
  }

  function modal(){
    let m=document.getElementById('v39-assign-modal');
    if(m) return m;
    m=document.createElement('div');m.id='v39-assign-modal';
    m.innerHTML=`<div id="v39-assign-sheet">
      <div class="hotel-title"><div><strong style="font-size:22px">🔁 Asignar reserva</strong><div class="text-small text-muted">Crea la parada del vehículo sustituido y la pasa a la Pizarra activa.</div></div><button id="v39-assign-close" class="btn btn-secondary" type="button">Cerrar</button></div>
      <div class="card" style="margin-top:12px;background:#ecfdf3;border:2px solid #86efac"><span class="text-small text-muted">Reserva seleccionada</span><br><strong id="v39-assign-reserve" style="font-size:20px"></strong></div>
      <div class="grid" style="margin-top:12px">
        <label>DFM / matrícula del sustituido<input id="v39-assign-vehicle" class="form-control" list="v39-assign-vehicles" autocomplete="off" placeholder="Ej. 2490 o 6774MJM"><datalist id="v39-assign-vehicles"></datalist></label>
        <label>Prioridad<select id="v39-assign-priority" class="form-select"><option value="0">0 · Máxima</option><option value="1">1 · Parado / no operativo</option><option value="2">2 · Legal</option><option value="3">3 · Seguridad / frenos</option><option value="4">4 · Confort</option><option value="5" selected>5 · Planificado</option></select></label>
        <label>Estado<select id="v39-assign-status" class="form-select"><option value="pendiente_taller" selected>Pendiente taller</option><option value="planificado">Planificado</option><option value="pendiente_diagnostico">Pendiente diagnóstico</option><option value="pendiente_autorizacion">Pendiente autorización</option><option value="en_taller">En taller</option><option value="pendiente_repuestos">Pendiente repuestos</option><option value="terminado_pendiente_recogida">Terminado · pendiente recoger</option><option value="recogido_pendiente_ruta">Recogido · pendiente ruta</option></select></label>
        <label>Fecha de parada<input id="v39-assign-date" class="form-control" type="date"></label>
        <label>Lugar / taller<input id="v39-assign-place" class="form-control" placeholder="Autodis, Frigicoll, Sansa…"></label>
        <label>INC principal (opcional)<input id="v39-assign-inc" class="form-control"></label>
      </div>
      <div id="v39-assign-vehicle-info" class="card" style="margin-top:10px">Introduce el DFM o matrícula para comprobar el vehículo.</div>
      <label style="margin-top:10px">Causa / motivo de la parada<input id="v39-assign-cause" class="form-control" placeholder="M, AV, GP, GC, ITV, MCD…"></label>
      <div class="grid" style="margin-top:10px">
        <label>1T inicial (opcional)<input id="v39-assign-stage" class="form-control" placeholder="Ej. Entrada Auto Distribución"></label>
        <label>Fecha/hora 1T (opcional)<input id="v39-assign-stage-date" class="form-control" type="datetime-local"></label>
      </div>
      <label style="margin-top:10px">Observaciones<input id="v39-assign-notes" class="form-control"></label>
      <div id="v39-assign-confirm" class="card" style="margin-top:12px"><strong>Confirma la sustitución</strong><div id="v39-assign-confirm-text" class="text-small">Selecciona el vehículo sustituido.</div></div>
      <div class="hotel-actions" style="margin-top:12px"><button id="v39-assign-save" class="btn btn-primary" type="button">Guardar y pasar a Pizarra</button><button id="v39-assign-cancel" class="btn btn-secondary" type="button">Cancelar</button></div>
      <div id="v39-assign-message" class="text-small" style="margin-top:8px"></div>
    </div>`;
    document.body.appendChild(m);
    m.addEventListener('click',e=>{if(e.target===m)closeModal()});
    m.querySelector('#v39-assign-close').onclick=closeModal;
    m.querySelector('#v39-assign-cancel').onclick=closeModal;
    m.querySelector('#v39-assign-vehicle').addEventListener('input',refreshVehicleInfo);
    m.querySelector('#v39-assign-save').addEventListener('click',saveAssignment);
    return m;
  }

  function closeModal(){document.getElementById('v39-assign-modal')?.classList.remove('open')}
  function selectedVehicle(){
    const q=norm(document.getElementById('v39-assign-vehicle')?.value);
    return vehicles.find(v=>norm(v.dfm)===q||norm(v.matricula)===q||norm(`${v.dfm} · ${v.matricula}`)===q)||null;
  }
  function refreshVehicleInfo(){
    const info=document.getElementById('v39-assign-vehicle-info');
    const conf=document.getElementById('v39-assign-confirm-text');
    const v=selectedVehicle();
    if(!v){if(info)info.innerHTML='Introduce un DFM o matrícula válido de la flota.';if(conf)conf.textContent='Selecciona el vehículo sustituido.';return}
    if(info)info.innerHTML=`<strong>${esc(v.dfm)} · ${esc(v.matricula||'—')}</strong><div class="text-small">${esc(v.marca||'—')} · ${esc(v.tipo_motor||v.tipo||'—')} · UPC ${esc(v.upc||'—')}</div>`;
    if(conf)conf.innerHTML=`La reserva <strong>${esc(currentReserve)}</strong> sustituirá a <strong>${esc(v.dfm)}</strong>. Al guardar se creará su Nº de parada y aparecerá en la Pizarra activa.`;
  }

  async function loadVehicles(){
    const q=await sb.from('vehiculos').select('dfm,matricula,tipo,upc,tipo_motor,categoria,marca,activo').eq('activo',true).order('dfm');
    if(q.error) throw q.error;
    vehicles=(q.data||[]).filter(v=>!['RESERVA','BAJA'].includes(norm(v.categoria)));
    const dl=document.getElementById('v39-assign-vehicles');
    if(dl)dl.innerHTML=vehicles.map(v=>`<option value="${esc(v.dfm)} · ${esc(v.matricula||'')}">${esc(v.marca||'')} ${esc(v.tipo_motor||'')}</option>`).join('');
  }

  async function openAssignment(code,card){
    if(card?.classList.contains('pending')){window.alert('Esta reserva tiene trabajos propios pendientes. No está disponible para asignarla hasta resolverlos.');return}
    currentReserve=norm(code);if(!currentReserve)return;
    const m=modal();m.querySelector('#v39-assign-reserve').textContent=`Reserva ${currentReserve}`;
    m.querySelector('#v39-assign-date').value=madridDay();
    m.querySelector('#v39-assign-vehicle').value='';
    m.querySelector('#v39-assign-cause').value='';
    m.querySelector('#v39-assign-place').value='';
    m.querySelector('#v39-assign-inc').value='';
    m.querySelector('#v39-assign-stage').value='';
    m.querySelector('#v39-assign-stage-date').value='';
    m.querySelector('#v39-assign-notes').value='';
    m.querySelector('#v39-assign-message').textContent='Cargando vehículos…';
    m.classList.add('open');refreshVehicleInfo();
    try{
      const perm=await sb.rpc('puede_editar_hotel');
      if(perm.error)throw perm.error;
      if(perm.data!==true)throw new Error('Este usuario no tiene permiso para editar el Hotel.');
      await loadVehicles();
      m.querySelector('#v39-assign-message').textContent='';
      m.querySelector('#v39-assign-vehicle').focus();
    }catch(e){m.querySelector('#v39-assign-message').textContent='No se puede asignar: '+(e?.message||'error');m.querySelector('#v39-assign-save').disabled=true;}
  }

  async function saveAssignment(){
    const save=document.getElementById('v39-assign-save'),msg=document.getElementById('v39-assign-message');
    const v=selectedVehicle();
    const cause=String(document.getElementById('v39-assign-cause')?.value||'').trim();
    if(!v){msg.textContent='Selecciona un DFM o matrícula válido.';return}
    if(!cause){msg.textContent='Indica la causa o motivo de la parada.';return}
    const stage=String(document.getElementById('v39-assign-stage')?.value||'').trim();
    const rawStageDate=document.getElementById('v39-assign-stage-date')?.value||'';
    const stageDate=rawStageDate?new Date(rawStageDate).toISOString():null;
    save.disabled=true;msg.textContent='Guardando sustitución y creando la parada…';
    try{
      const {data,error}=await sb.rpc('crear_sustitucion_desde_reserva_v39',{
        p_reserva:currentReserve,
        p_vehiculo:v.dfm,
        p_causa:cause,
        p_prioridad:Number(document.getElementById('v39-assign-priority')?.value||5),
        p_estado:document.getElementById('v39-assign-status')?.value||'pendiente_taller',
        p_lugar:String(document.getElementById('v39-assign-place')?.value||'').trim(),
        p_fecha_parada:document.getElementById('v39-assign-date')?.value||null,
        p_incidencia:String(document.getElementById('v39-assign-inc')?.value||'').trim(),
        p_observaciones:String(document.getElementById('v39-assign-notes')?.value||'').trim(),
        p_primera_t:stage||null,
        p_fecha_t:stageDate
      });
      if(error)throw error;
      msg.innerHTML=`✓ Guardado. <strong>${esc(v.dfm)}</strong> está en Pizarra con la reserva <strong>${esc(currentReserve)}</strong> · Nº parada <strong>${esc(data?.numero_parada||'creado')}</strong>.`;
      save.textContent='✓ Añadido a Pizarra';
      setTimeout(()=>location.reload(),1000);
    }catch(e){msg.textContent='No se pudo guardar: '+(e?.message||'error');save.disabled=false;}
  }

  function extractReserve(card){
    const text=String(card.querySelector('strong')?.textContent||'');
    const m=text.match(/Reserva\s+([^\s·]+)/i);
    return m?norm(m[1]):'';
  }
  function decorate(){
    if(decorating)return;decorating=true;
    document.querySelectorAll('#hotel-v39-reserves .v39-res').forEach(card=>{
      if(card.dataset.v39Assign==='1')return;
      const code=extractReserve(card);if(!code)return;
      card.dataset.v39Assign='1';card.dataset.reserveCode=code;card.tabIndex=0;card.setAttribute('role','button');
      card.classList.add('v39-assignable');
      const h=document.createElement('span');h.className='v39-assign-hint';h.textContent=card.classList.contains('pending')?'Pendientes propios · no asignable':'Toca para asignar sustitución';card.appendChild(h);
      card.addEventListener('click',()=>openAssignment(code,card));
      card.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();openAssignment(code,card)}});
    });
    decorating=false;
  }
  addStyle();modal();
  const ob=new MutationObserver(()=>setTimeout(decorate,60));ob.observe(document.documentElement,{childList:true,subtree:true});
  window.addEventListener('focus',()=>setTimeout(decorate,100));
  setTimeout(decorate,300);
})();
