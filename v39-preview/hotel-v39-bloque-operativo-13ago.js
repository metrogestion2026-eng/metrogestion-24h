// v39 preview · bloque operativo 13/08: permisos claros, modo lectura por ficha, relevos temporales y maestro de reservas.
(() => {
  'use strict';
  if (window.__metrogestionV39BloqueOperativo13AgoLoaded) return;
  window.__metrogestionV39BloqueOperativo13AgoLoaded = true;

  const URL='https://njtohfkqjjoavtumtmza.supabase.co';
  const KEY='sb_publishable_w1a9DClOM0S4HVJdv_TbKg_W_UkN2W_';
  const sb=window.supabase?.createClient?.(URL,KEY); if(!sb)return;
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const norm=v=>String(v||'').trim().toUpperCase();
  const modules=[['activar24h','Activar 24H'],['hotel','Hotel'],['reservas','Reservas'],['t_programadas','T programadas'],['talleres','Talleres'],['historico','Histórico'],['resumen','Panel resumen'],['predictivo','Predictivo'],['itv_tramites','ITV y trámites'],['documentacion','Documentación'],['informes','Informes']];
  let isPrincipal=false,canEditHotel=false,canEditReserves=false,canAdminUsers=false;
  let activeRows=[],activeReliefs=[];

  async function rpcBool(name,args={}){try{const {data}=await sb.rpc(name,args);return data===true}catch{return false}}
  async function loadPerms(){
    [isPrincipal,canEditHotel,canEditReserves,canAdminUsers]=await Promise.all([
      rpcBool('es_administrador_principal'),rpcBool('puede_editar_modulo_v39',{p_modulo:'hotel'}),rpcBool('puede_editar_modulo_v39',{p_modulo:'reservas'}),rpcBool('puede_editar_modulo_v39',{p_modulo:'usuarios'})
    ]);
    enforceStopNumberSecurity();
    installPermissionMatrixV2();
    decorateHotelCards();
    decorateReserves();
  }

  function enforceStopNumberSecurity(){
    document.querySelectorAll('.v39-stop-edit').forEach(b=>{b.style.display=isPrincipal?'':'none'});
    document.querySelectorAll('.v39-stop-number-editor').forEach(box=>{
      if(!isPrincipal){const btn=box.querySelector('.v39-stop-edit');if(btn)btn.remove();}
    });
  }

  function hideLegacyHotelPermissionBlocks(){
    document.querySelectorAll('#admin-user-list .card').forEach(card=>{
      const text=card.textContent||'';
      if(text.includes('Permiso del Hotel') || text.includes('Cambiar a ver y editar Hotel')){
        const candidate=[...card.querySelectorAll('.card')].find(x=>(x.textContent||'').includes('Permiso del Hotel'));
        if(candidate)candidate.style.display='none';
        card.querySelectorAll('button').forEach(b=>{if(/Cambiar a ver y editar Hotel|Retirar permiso/i.test(b.textContent||''))b.style.display='none'});
      }
    });
  }

  async function installPermissionMatrixV2(){
    hideLegacyHotelPermissionBlocks();
    const view=document.querySelector('#view-users');if(!view)return;
    const old=document.querySelector('#v39-permissions-matrix');if(old)old.style.display='none';
    let box=document.querySelector('#v39-permissions-matrix-v2');
    if(!canAdminUsers){if(box)box.remove();return}
    if(!box){
      box=document.createElement('div');box.id='v39-permissions-matrix-v2';box.className='card stack';
      box.innerHTML='<div><strong>🔐 Acceso por pestaña</strong><div class="text-small text-muted">Tres estados claros: sin acceso, solo lectura o ver y editar.</div></div><div id="v39-perm-v2-users">Cargando…</div>';
      const anchor=document.querySelector('#admin-user-list');view.insertBefore(box,anchor||null);
    }
    const host=box.querySelector('#v39-perm-v2-users');
    const q=await sb.from('usuarios').select('id,nombre,apellidos,tipo_usuario,activo,permisos').eq('activo',true).order('nombre');
    if(q.error){host.textContent='No se pudieron cargar permisos: '+q.error.message;return}
    host.innerHTML=(q.data||[]).map(u=>{
      const principal=u.tipo_usuario==='administrador_principal';
      return `<article class="card stack" data-v39-perm-user="${u.id}"><strong>${esc((u.nombre||'')+' '+(u.apellidos||''))}${principal?' · ADMIN PRINCIPAL':''}</strong>${modules.map(([m,l])=>{const p=u.permisos?.[m]||{};const edit=principal||p.editar===true;const read=edit||principal||p.ver===true||p.leer===true;const mode=edit?'edit':read?'read':'none';return `<div class="viz-row" style="align-items:center"><span>${esc(l)}</span><select class="form-select v39-perm-mode" data-module="${m}" style="width:auto;min-width:175px" ${principal?'disabled':''}><option value="none" ${mode==='none'?'selected':''}>Sin acceso</option><option value="read" ${mode==='read'?'selected':''}>🔒 Solo lectura</option><option value="edit" ${mode==='edit'?'selected':''}>✏️ Ver y editar</option></select></div>`}).join('')}</article>`
    }).join('');
    host.querySelectorAll('.v39-perm-mode').forEach(sel=>sel.addEventListener('change',async()=>{
      const row=sel.closest('[data-v39-perm-user]');const mode=sel.value;sel.disabled=true;
      const {error}=await sb.rpc('actualizar_permiso_modulo_usuario_v39',{p_usuario_id:row.dataset.v39PermUser,p_modulo:sel.dataset.module,p_ver:mode!=='none',p_editar:mode==='edit'});
      if(error){alert('No se pudo guardar el permiso: '+error.message);sel.disabled=false;return}
      sel.disabled=false;
    }));
  }

  const editSelectors=[
    '.hotel-unit-edit','.hotel-stage-add','.hotel-status-select','.hotel-stage-action','.stage-drag-handle','.hotel-stop-date-control input','.hotel-entry-date-control input','.hotel-entry-date-control select','.v39-stop-edit','.hotel-edit-save','.hotel-stage-date-save','.hotel-stage-date-pending'
  ].join(',');

  function setCardMode(card,editing){
    card.dataset.v39CardEditing=editing?'1':'0';
    const read=card.querySelector('.v39-card-read'),edit=card.querySelector('.v39-card-edit');
    if(read){read.classList.toggle('btn-primary',!editing);read.classList.toggle('btn-secondary',editing)}
    if(edit){edit.classList.toggle('btn-primary',editing);edit.classList.toggle('btn-secondary',!editing)}
    card.querySelectorAll(editSelectors).forEach(el=>{
      if(!canEditHotel || !editing){if(!el.dataset.v39PrevDisabled)el.dataset.v39PrevDisabled=el.disabled?'1':'0';el.disabled=true;el.style.opacity='.48';}
      else{el.disabled=el.dataset.v39PrevDisabled==='1';el.style.opacity='';}
    });
  }

  function decorateHotelCards(){
    document.querySelectorAll('article.hotel-unit').forEach(card=>{
      if(!card.querySelector('.v39-card-mode')){
        const bar=document.createElement('div');bar.className='v39-card-mode hotel-actions';bar.style.cssText='border-top:1px solid #dbe4ec;padding-top:9px;margin-top:4px';
        if(canEditHotel){bar.innerHTML='<button type="button" class="btn btn-primary v39-card-read">🔒 Solo lectura</button><button type="button" class="btn btn-secondary v39-card-edit">✏️ Lectura y edición</button>';bar.querySelector('.v39-card-read').onclick=e=>{e.stopPropagation();setCardMode(card,false)};bar.querySelector('.v39-card-edit').onclick=e=>{e.stopPropagation();setCardMode(card,true)};}
        else bar.innerHTML='<span class="badge">🔒 Solo lectura</span>';
        card.appendChild(bar);
      }
      if(card.dataset.v39CardEditing!=='1')setCardMode(card,false);
    });
    enforceStopNumberSecurity();
    renderReliefsOnCards();
  }

  function identifyFleetCard(card){const t=card.querySelector('.hotel-primary strong')?.textContent||'';let m=t.match(/(?:DFM|Semirremolque)\s+([A-Z0-9]+)/i);if(m)return norm(m[1]);m=t.match(/Reserva\s+([A-Z0-9]+)/i);return m?norm(m[1]):''}
  function fmtDate(v){if(!v)return'—';try{return new Date(v).toLocaleString('es-ES',{timeZone:'Europe/Madrid',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'})}catch{return v}}

  async function loadReliefs(){
    try{
      const b=await sb.from('pizarras').select('id').eq('estado','en_curso').order('fecha',{ascending:false}).limit(1).maybeSingle();if(b.error||!b.data)return;
      const [r,l]=await Promise.all([
        sb.from('registros_hotel').select('id,seguimiento_id,numero_parada,vehiculo_sustituido,vehiculo_reserva,estado,retirado_hotel_activo').eq('pizarra_id',b.data.id).eq('oculto',false),
        sb.from('relevos_temporales_hotel').select('*').eq('estado','activo')
      ]);
      activeRows=r.data||[];activeReliefs=l.data||[];renderReliefsOnCards();
    }catch(e){console.warn('v39 relevos:',e)}
  }

  function rowBySeguimiento(id){return activeRows.find(r=>r.seguimiento_id===id)}
  function renderReliefsOnCards(){
    if(!activeReliefs.length)return;
    document.querySelectorAll('article.hotel-unit').forEach(card=>{
      const code=identifyFleetCard(card);if(!code)return;
      card.querySelectorAll('.v39-relief-info').forEach(x=>x.remove());
      activeReliefs.forEach(rel=>{
        const o=rowBySeguimiento(rel.origen_seguimiento_id),d=rowBySeguimiento(rel.destino_seguimiento_id);if(!o||!d)return;
        let html='';
        if(norm(o.vehiculo_sustituido||o.vehiculo_reserva)===code){html=`<strong>🔁 RELEVO TEMPORAL ACTIVO</strong><div><strong>${esc(rel.vehiculo_cedido)}</strong> está cubriendo temporalmente a <strong>${esc(rel.vehiculo_relevado)}</strong>, reserva de la parada <strong>${esc(d.numero_parada||'—')}</strong> (${esc(d.vehiculo_sustituido||'—')}).</div><div class="text-small">Motivo: ${esc(rel.motivo)} · Hasta: ${esc(fmtDate(rel.fecha_limite))} · Ubicación informada: ${esc(rel.lugar_actual||'sin indicar')}</div>`}
        if(norm(d.vehiculo_sustituido||d.vehiculo_reserva)===code){html=`<strong>🔁 SUSTITUCIÓN EN CADENA</strong><div>La reserva <strong>${esc(rel.vehiculo_relevado)}</strong> está temporalmente relevada por <strong>${esc(rel.vehiculo_cedido)}</strong>, que mantiene su propia parada <strong>${esc(o.numero_parada||'—')}</strong>.</div><div class="text-small">Motivo: ${esc(rel.motivo)} · Hasta: ${esc(fmtDate(rel.fecha_limite))}</div>`}
        if(html){const box=document.createElement('div');box.className='v39-relief-info card';box.style.cssText='border:2px solid #7c3aed;background:#f5f3ff;color:#4c1d95';box.innerHTML=html;const title=card.querySelector('.hotel-title');title?.insertAdjacentElement('afterend',box)}
      });
      if(canEditHotel && !card.querySelector('.v39-relief-create')){
        const actions=card.querySelector('.v39-card-mode');if(actions){const b=document.createElement('button');b.type='button';b.className='btn btn-secondary v39-relief-create';b.textContent='🔁 Relevo temporal';b.onclick=e=>{e.stopPropagation();openReliefModal(code)};actions.appendChild(b);if(card.dataset.v39CardEditing!=='1'){b.disabled=true;b.style.opacity='.48'}}
      }
    });
  }

  async function openReliefModal(originCode){
    if(!canEditHotel)return;
    const origin=activeRows.find(r=>norm(r.vehiculo_sustituido||r.vehiculo_reserva)===originCode);if(!origin)return alert('No encuentro la parada origen.');
    const candidates=activeRows.filter(r=>r.id!==origin.id&&!r.retirado_hotel_activo&&r.vehiculo_reserva&&r.estado!=='reserva_liberada'&&r.estado!=='anulado');
    const m=document.createElement('div');m.id='v39-relief-modal';m.style.cssText='position:fixed;inset:0;z-index:9500;background:rgba(15,23,42,.68);padding:12px;overflow:auto';m.innerHTML=`<div class="card stack" style="max-width:700px;margin:2vh auto"><div class="hotel-title"><div><strong>🔁 Crear relevo temporal</strong><div class="text-small text-muted">${esc(originCode)} mantiene su propia parada, pero cubre temporalmente la reserva de otra parada.</div></div><button class="btn btn-secondary v39-close">Cerrar</button></div><label>Parada que necesita relevo<select id="v39-rel-dest" class="form-select"><option value="">Selecciona…</option>${candidates.map(x=>`<option value="${x.id}">${esc(x.numero_parada||'—')} · ${esc(x.vehiculo_sustituido||'—')} · reserva ${esc(x.vehiculo_reserva)}</option>`).join('')}</select></label><label>Motivo<input id="v39-rel-reason" class="form-control" placeholder="Ej. 2610 sin aire acondicionado"></label><label>Fecha límite<input id="v39-rel-limit" class="form-control" type="datetime-local"></label><label>Ubicación actual del vehículo que cubre<input id="v39-rel-place" class="form-control"></label><label>Observaciones<textarea id="v39-rel-obs" class="form-control"></textarea></label><button id="v39-rel-save" class="btn btn-primary">Guardar relevo</button><div id="v39-rel-msg" class="text-small"></div></div>`;document.body.appendChild(m);m.querySelector('.v39-close').onclick=()=>m.remove();m.querySelector('#v39-rel-save').onclick=async()=>{const dest=activeRows.find(r=>r.id===m.querySelector('#v39-rel-dest').value);const reason=m.querySelector('#v39-rel-reason').value.trim();if(!dest)return m.querySelector('#v39-rel-msg').textContent='Selecciona la parada destino.';if(!reason)return m.querySelector('#v39-rel-msg').textContent='Indica el motivo.';const {error}=await sb.rpc('crear_relevo_temporal_v39',{p_origen_registro_id:origin.id,p_destino_registro_id:dest.id,p_vehiculo_relevado:dest.vehiculo_reserva,p_motivo:reason,p_fecha_limite:m.querySelector('#v39-rel-limit').value?new Date(m.querySelector('#v39-rel-limit').value).toISOString():null,p_lugar:m.querySelector('#v39-rel-place').value.trim(),p_observaciones:m.querySelector('#v39-rel-obs').value.trim()});if(error)return m.querySelector('#v39-rel-msg').textContent='Error: '+error.message;m.querySelector('#v39-rel-msg').textContent='✓ Relevo guardado';await loadReliefs();setTimeout(()=>m.remove(),450)};
  }

  function reserveCode(card){const t=card.querySelector('strong')?.textContent||'';const m=t.match(/Reserva\s+([^\s·]+)/i);return m?norm(m[1]):''}
  function decorateReserves(){
    const panel=document.querySelector('#hotel-v39-reserves');if(!panel)return;
    let actions=panel.querySelector('.v39-reserve-master-actions');if(!actions){actions=document.createElement('div');actions.className='v39-reserve-master-actions hotel-actions';actions.style.margin='8px 0';if(canEditReserves)actions.innerHTML='<button type="button" class="btn btn-primary v39-reserve-new">+ Crear reserva</button>';panel.insertBefore(actions,panel.children[1]||null);actions.querySelector('.v39-reserve-new')?.addEventListener('click',e=>{e.stopPropagation();openNewReserve()})}
    panel.querySelectorAll('.v39-res').forEach(card=>{if(card.querySelector('.v39-reserve-baja'))return;const code=reserveCode(card);if(!code||!canEditReserves)return;const b=document.createElement('button');b.type='button';b.className='btn btn-secondary v39-reserve-baja';b.style.marginTop='8px';b.textContent='⛔ Dar de baja';b.onclick=e=>{e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();bajaReserve(code)};card.appendChild(b)});
  }

  function modalBase(id,title){document.getElementById(id)?.remove();const m=document.createElement('div');m.id=id;m.style.cssText='position:fixed;inset:0;z-index:9600;background:rgba(15,23,42,.68);padding:12px;overflow:auto';m.innerHTML=`<div class="card stack" style="max-width:720px;margin:2vh auto"><div class="hotel-title"><strong>${title}</strong><button class="btn btn-secondary v39-close">Cerrar</button></div><div class="v39-body"></div></div>`;document.body.appendChild(m);m.querySelector('.v39-close').onclick=()=>m.remove();return m}
  function openNewReserve(){const m=modalBase('v39-new-reserve-modal','➕ Crear nueva reserva');const b=m.querySelector('.v39-body');b.innerHTML='<div class="detail-grid"><label>Código / DFM<input id="v39-r-code" class="form-control"></label><label>Matrícula<input id="v39-r-plate" class="form-control"></label><label>Tipo<input id="v39-r-type" class="form-control"></label><label>UPC<input id="v39-r-upc" class="form-control"></label><label>Tipo motor<input id="v39-r-engine" class="form-control"></label><label>Marca<input id="v39-r-brand" class="form-control"></label><label>Bastidor<input id="v39-r-vin" class="form-control"></label></div><label>Comentario<input id="v39-r-comment" class="form-control"></label><button id="v39-r-save" class="btn btn-primary">Guardar reserva</button><div id="v39-r-msg" class="text-small"></div>';b.querySelector('#v39-r-save').onclick=async()=>{const code=b.querySelector('#v39-r-code').value.trim();if(!code)return b.querySelector('#v39-r-msg').textContent='Indica el código.';const {error}=await sb.rpc('crear_reserva_v39',{p_codigo:code,p_matricula:b.querySelector('#v39-r-plate').value,p_tipo:b.querySelector('#v39-r-type').value,p_upc:b.querySelector('#v39-r-upc').value,p_tipo_motor:b.querySelector('#v39-r-engine').value,p_marca:b.querySelector('#v39-r-brand').value,p_bastidor:b.querySelector('#v39-r-vin').value,p_comentario:b.querySelector('#v39-r-comment').value});if(error)return b.querySelector('#v39-r-msg').textContent='Error: '+error.message;b.querySelector('#v39-r-msg').textContent='✓ Reserva creada';m.remove();window.dispatchEvent(new Event('focus'))}}
  async function bajaReserve(code){if(!confirm(`¿Seguro que quieres dar de baja la reserva ${code}?\n\nNo desaparecerá del histórico.`))return;const reason=prompt('Motivo de la baja (opcional):','')??null;if(reason===null)return;const {error}=await sb.rpc('dar_baja_reserva_v39',{p_codigo:code,p_motivo:reason});if(error)return alert('No se pudo dar de baja: '+error.message);alert(`Reserva ${code} dada de baja.`);window.dispatchEvent(new Event('focus'))}

  function install24hIcon(){const b=document.querySelector('#activate-tab');if(!b||b.dataset.v39Icon==='1')return;b.dataset.v39Icon='1';b.innerHTML='<img src="./icono-gestion-24h.svg" alt="24H" style="width:28px;height:28px;display:block"><span class="text-small">24H</span>';b.title='Activar 24H'}

  function schedule(){clearTimeout(schedule.t);schedule.t=setTimeout(()=>{hideLegacyHotelPermissionBlocks();enforceStopNumberSecurity();decorateHotelCards();decorateReserves();install24hIcon()},80)}
  const ob=new MutationObserver(schedule);ob.observe(document.documentElement,{childList:true,subtree:true});
  window.addEventListener('focus',()=>{loadPerms();loadReliefs();schedule()});
  setTimeout(()=>{loadPerms();loadReliefs();schedule()},900);
})();