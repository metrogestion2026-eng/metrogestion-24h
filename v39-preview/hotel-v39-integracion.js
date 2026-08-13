// Metrogestion v39 · integración visual sobre la base estable del Hotel.
// Se carga SOLO en la rama de desarrollo v39.
(() => {
  'use strict';
  if (window.__metrogestionV39IntegrationLoaded) return;
  window.__metrogestionV39IntegrationLoaded = true;

  const SUPABASE_URL = 'https://njtohfkqjjoavtumtmza.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_w1a9DClOM0S4HVJdv_TbKg_W_UkN2W_';
  const sb = window.supabase?.createClient?.(SUPABASE_URL, SUPABASE_KEY);
  if (!sb) return;

  let dossierApi = null;
  let dossierPermissions = {canView:false, canEdit:false};
  let currentStageId = '';
  let currentDossier = null;
  let refreshTimer = null;

  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[char]));
  const fmt = value => value ? new Date(value).toLocaleString('es-ES', {
    timeZone:'Europe/Madrid', day:'2-digit', month:'2-digit', year:'numeric',
    hour:'2-digit', minute:'2-digit'
  }) : '—';
  const normalize = value => String(value || '').trim().toUpperCase();
  const stagePending = stage => stage && !['realizada','anulada'].includes(String(stage.estado || stage.status || '').toLowerCase());

  const ensureStyles = () => {
    if (document.getElementById('hotel-v39-style')) return;
    const style = document.createElement('style');
    style.id = 'hotel-v39-style';
    style.textContent = `
      .hotel-v39-clickable-t{cursor:pointer;outline-offset:2px}.hotel-v39-clickable-t:hover{outline:2px solid #38bdf8}
      .hotel-v39-view-hint{font-size:11px;font-weight:850;color:#0369a1;background:#e0f2fe;border:1px solid #7dd3fc;border-radius:999px;padding:3px 7px}
      #hotel-v39-dossier-backdrop{position:fixed;inset:0;background:rgba(15,23,42,.62);z-index:5000;display:none;padding:12px;overflow:auto}
      #hotel-v39-dossier-backdrop.open{display:block}
      #hotel-v39-dossier{max-width:880px;margin:2vh auto;background:#fff;border-radius:16px;padding:16px;box-shadow:0 18px 60px rgba(0,0,0,.35)}
      .hotel-v39-dossier-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
      .hotel-v39-section{border-top:1px solid #dbe4ec;padding-top:12px;margin-top:14px}
      .hotel-v39-doc{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;align-items:center;padding:10px;border:1px solid #dbe4ec;border-radius:10px;margin:7px 0}
      .hotel-v39-thumb{width:120px;height:90px;object-fit:cover;border-radius:8px;border:1px solid #cbd5e1;margin-top:7px}
      #hotel-v39-reserves{border:3px solid #16a34a;background:#f0fdf4}
      .hotel-v39-reserve-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
      .hotel-v39-reserve-card{background:#fff;border:1px solid #bbf7d0;border-left:6px solid #16a34a;border-radius:12px;padding:12px}
      .hotel-v39-reserve-card.pending{border-left-color:#f59e0b;border-color:#fde68a;background:#fffbeb}
      .hotel-v39-metrics{display:flex;gap:8px;flex-wrap:wrap}.hotel-v39-metric{padding:7px 10px;border-radius:999px;background:#fff;border:1px solid #cbd5e1;font-weight:800;font-size:12px}
      @media(max-width:650px){.hotel-v39-dossier-grid,.hotel-v39-reserve-grid{grid-template-columns:1fr}.hotel-v39-doc{grid-template-columns:1fr}#hotel-v39-dossier{margin:0 auto}}
    `;
    document.head.appendChild(style);
  };

  const ensureDossierModal = () => {
    let backdrop = document.getElementById('hotel-v39-dossier-backdrop');
    if (backdrop) return backdrop;
    backdrop = document.createElement('div');
    backdrop.id = 'hotel-v39-dossier-backdrop';
    backdrop.innerHTML = `<div id="hotel-v39-dossier">
      <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start">
        <div><strong id="hotel-v39-dossier-title" style="font-size:22px">Expediente T</strong><div id="hotel-v39-dossier-sub" class="text-small text-muted"></div></div>
        <button id="hotel-v39-dossier-close" class="btn btn-secondary" type="button">Cerrar</button>
      </div>
      <div id="hotel-v39-dossier-body" style="margin-top:10px"></div>
    </div>`;
    document.body.appendChild(backdrop);
    backdrop.addEventListener('click', event => { if (event.target === backdrop) backdrop.classList.remove('open'); });
    backdrop.querySelector('#hotel-v39-dossier-close').addEventListener('click', () => backdrop.classList.remove('open'));
    backdrop.addEventListener('click', handleDossierAction);
    return backdrop;
  };

  const loadApi = async () => {
    if (dossierApi) return dossierApi;
    const mod = await import('./hotel-v39-expediente.js?v=39-20260813');
    dossierApi = mod.createHotelStageDossierApi(sb);
    dossierPermissions = await dossierApi.getPermissions();
    return dossierApi;
  };

  const renderWorks = data => {
    const rows = [...(data.trabajos || []), ...(data.trabajos_legacy || [])];
    if (!rows.length) return '<div class="text-small text-muted">Sin trabajos detallados.</div>';
    return rows.map(work => `<div class="card" style="margin:7px 0">
      <strong>${esc(work.codigo || work.tipo || 'Trabajo')}</strong>
      ${work.categoria_tecnica ? `<div class="text-small">Categoría: <strong>${esc(work.categoria_tecnica)}</strong></div>` : ''}
      ${work.motivo_entrada || work.descripcion ? `<div>${esc(work.motivo_entrada || work.descripcion)}</div>` : ''}
      ${work.diagnostico_real ? `<div><strong>Diagnóstico real:</strong> ${esc(work.diagnostico_real)}</div>` : ''}
      ${work.expediente ? `<div>Expediente: <strong>${esc(work.expediente)}</strong></div>` : ''}
      ${work.km || work.km_averia ? `<div>Km: <strong>${esc(work.km || work.km_averia)}</strong></div>` : ''}
      ${work.peritaje ? `<div>Peritaje: ${esc(work.peritaje)}</div>` : ''}
      ${work.observaciones ? `<div class="text-small text-muted">${esc(work.observaciones)}</div>` : ''}
    </div>`).join('');
  };

  const renderOrders = orders => orders?.length ? orders.map(order => `<div class="hotel-v39-doc">
    <div>Pedido <strong>${esc(order.numero_pedido || '—')}</strong> · OR/hoja taller <strong>${esc(order.numero_or || '—')}</strong>${order.observaciones ? `<div class="text-small text-muted">${esc(order.observaciones)}</div>` : ''}</div>
  </div>`).join('') : '<div class="text-small text-muted">Sin pedido u OR asociados.</div>';

  const renderEmails = emails => emails?.length ? emails.map(mail => `<div class="hotel-v39-doc">
    <div><strong>${esc(mail.asunto || 'Correo')}</strong><div class="text-small">Para: ${esc((mail.para || []).join(', ') || '—')}</div>${(mail.cc || []).length ? `<div class="text-small">CC: ${esc(mail.cc.join(', '))}</div>` : ''}<div class="text-small text-muted">${esc(mail.estado || '')} · ${esc(fmt(mail.enviado_en || mail.preparado_en))}</div></div>
  </div>`).join('') : '<div class="text-small text-muted">Sin correos asociados.</div>';

  const renderDocuments = docs => {
    if (!docs?.length) return '<div class="text-small text-muted">Sin documentos ni fotos asociados.</div>';
    return docs.map((doc,index) => {
      const photo = String(doc.mime_type || '').startsWith('image/');
      return `<div class="hotel-v39-doc" data-doc-index="${index}">
        <div>${photo ? '📷' : '📄'} <strong>${esc(doc.nombre_mostrado || doc.nombre_original || 'Documento')}</strong>
          <div class="text-small text-muted">${esc(doc.categoria || 'documento')}${doc.subcategoria ? ' · '+esc(doc.subcategoria) : ''}${doc.fecha_documento ? ' · '+esc(doc.fecha_documento) : ''}</div>
          ${doc.descripcion ? `<div class="text-small">${esc(doc.descripcion)}</div>` : ''}
          ${photo ? `<img class="hotel-v39-thumb" data-photo-index="${index}" alt="${esc(doc.nombre_mostrado || doc.nombre_original || 'Foto')}">` : ''}
        </div>
        <div class="hotel-actions"><button class="btn btn-secondary hotel-v39-open-doc" data-index="${index}" type="button">Abrir</button>${dossierPermissions.canEdit ? `<button class="btn btn-secondary hotel-v39-delete-doc" data-index="${index}" type="button">Borrar</button>` : ''}</div>
      </div>`;
    }).join('');
  };

  const renderUpload = data => {
    if (!dossierPermissions.canEdit) return '';
    return `<div class="card" style="background:#f8fafc;border:2px dashed #7dd3fc">
      <strong>Adjuntar a esta T</strong>
      <div class="detail-grid" style="margin-top:8px">
        <label>Tipo<select id="hotel-v39-upload-category" class="form-select"><option value="documento">Documento</option><option value="foto">Foto</option><option value="hoja_taller">Hoja taller / OR</option><option value="pedido">Pedido</option><option value="peritaje">Peritaje</option><option value="factura">Factura</option></select></label>
        <label>Archivo<input id="hotel-v39-upload-file" class="form-control" type="file" accept="image/*,application/pdf"></label>
      </div>
      <label style="margin-top:8px">Descripción<input id="hotel-v39-upload-description" class="form-control"></label>
      <button id="hotel-v39-upload" class="btn btn-primary" type="button" style="margin-top:8px">Subir a la T</button>
      <div id="hotel-v39-upload-message" class="text-small"></div>
    </div>`;
  };

  const renderDossier = async data => {
    currentDossier = data;
    const e = data.etapa || {}, p = data.parada || {};
    const backdrop = ensureDossierModal();
    backdrop.querySelector('#hotel-v39-dossier-title').textContent = `${e.posicion || '?'}T · ${e.nombre || 'Etapa'}`;
    backdrop.querySelector('#hotel-v39-dossier-sub').textContent = `Parada ${p.numero_parada || '—'} · ${p.vehiculo_sustituido || ('Reserva '+(p.vehiculo_reserva || '—'))}`;
    const body = backdrop.querySelector('#hotel-v39-dossier-body');
    body.innerHTML = `<div class="hotel-v39-dossier-grid">
      <div class="card"><span class="text-small text-muted">Estado</span><br><strong>${esc(e.estado || '—')}</strong></div>
      <div class="card"><span class="text-small text-muted">Taller / centro</span><br><strong>${esc(e.taller_nombre || e.lugar || '—')}</strong>${e.centro_nombre ? `<div>${esc(e.centro_nombre)}</div>` : ''}</div>
      <div class="card"><span class="text-small text-muted">Programada</span><br><strong>${esc(fmt(e.fecha_prevista))}</strong></div>
      <div class="card"><span class="text-small text-muted">Inicio / realización</span><br><strong>${esc(fmt(e.fecha_inicio_real || e.fecha_real))}</strong></div>
      <div class="card"><span class="text-small text-muted">Fin</span><br><strong>${esc(fmt(e.fecha_fin_real || e.fecha_real))}</strong></div>
      <div class="card"><span class="text-small text-muted">UPC / INC</span><br><strong>${esc(p.upc || '—')} · ${esc(p.incidencia || '—')}</strong></div>
    </div>
    <section class="hotel-v39-section"><h3>🔧 Trabajos</h3>${renderWorks(data)}</section>
    <section class="hotel-v39-section"><h3>📄 Pedidos / OR</h3>${renderOrders(data.ordenes || [])}</section>
    <section class="hotel-v39-section"><h3>📷 Documentos y fotos</h3>${renderDocuments(data.documentos || [])}${renderUpload(data)}</section>
    <section class="hotel-v39-section"><h3>✉️ Correos</h3>${renderEmails(data.envios || [])}</section>
    <section class="hotel-v39-section"><h3>📝 Observaciones y diagnóstico</h3><div>${esc(e.observaciones || '—')}</div>${e.diagnostico_real ? `<div style="margin-top:8px"><strong>Diagnóstico real:</strong> ${esc(e.diagnostico_real)}</div>` : ''}${e.km_averia ? `<div>Km avería: <strong>${esc(e.km_averia)}</strong></div>` : ''}</section>`;
    backdrop.classList.add('open');

    const docs = data.documentos || [];
    docs.forEach(async (doc,index) => {
      if (!String(doc.mime_type || '').startsWith('image/')) return;
      try {
        const url = await dossierApi.getSignedDocumentUrl(doc, 600);
        const img = backdrop.querySelector(`[data-photo-index="${index}"]`);
        if (img) img.src = url;
      } catch {}
    });
  };

  const openStage = async stageId => {
    currentStageId = stageId;
    const backdrop = ensureDossierModal();
    backdrop.querySelector('#hotel-v39-dossier-title').textContent = 'Cargando expediente T…';
    backdrop.querySelector('#hotel-v39-dossier-sub').textContent = '';
    backdrop.querySelector('#hotel-v39-dossier-body').innerHTML = '<div class="card">Consultando trabajos, documentos, fotos, pedidos y correos…</div>';
    backdrop.classList.add('open');
    try {
      await loadApi();
      if (!dossierPermissions.canView) throw new Error('Este usuario no tiene permiso de lectura del Hotel');
      await renderDossier(await dossierApi.getDossier(stageId));
    } catch (error) {
      backdrop.querySelector('#hotel-v39-dossier-body').innerHTML = `<div class="card" style="border:2px solid #ef4444;background:#fff1f2;color:#991b1b"><strong>No se pudo abrir la T.</strong><div>${esc(error?.message || 'Error desconocido')}</div></div>`;
    }
  };

  async function handleDossierAction(event) {
    const open = event.target.closest('.hotel-v39-open-doc');
    if (open && currentDossier) {
      const doc = (currentDossier.documentos || [])[Number(open.dataset.index)];
      if (!doc) return;
      open.disabled = true;
      try { window.open(await dossierApi.getSignedDocumentUrl(doc, 900), '_blank', 'noopener'); }
      catch (error) { alert('No se pudo abrir el documento: '+(error?.message || 'error')); }
      open.disabled = false;
      return;
    }
    const del = event.target.closest('.hotel-v39-delete-doc');
    if (del && currentDossier) {
      const doc = (currentDossier.documentos || [])[Number(del.dataset.index)];
      if (!doc || !confirm('¿Borrar este documento de la T?')) return;
      del.disabled = true;
      try { await dossierApi.deleteDocument(doc); await renderDossier(await dossierApi.getDossier(currentStageId)); }
      catch (error) { alert('No se pudo borrar: '+(error?.message || 'error')); del.disabled = false; }
      return;
    }
    const upload = event.target.closest('#hotel-v39-upload');
    if (upload) {
      const file = document.getElementById('hotel-v39-upload-file')?.files?.[0];
      const category = document.getElementById('hotel-v39-upload-category')?.value || 'documento';
      const description = document.getElementById('hotel-v39-upload-description')?.value || '';
      const message = document.getElementById('hotel-v39-upload-message');
      if (!file) { if (message) message.textContent = 'Selecciona un archivo.'; return; }
      upload.disabled = true; if (message) message.textContent = 'Subiendo…';
      try {
        await dossierApi.uploadDocument({stageId:currentStageId,file,category,description,stopNumber:currentDossier?.parada?.numero_parada || ''});
        await renderDossier(await dossierApi.getDossier(currentStageId));
      } catch (error) {
        if (message) message.textContent = 'No se pudo subir: '+(error?.message || 'error');
        upload.disabled = false;
      }
    }
  }

  const decorateStageRows = () => {
    document.querySelectorAll('.stage[data-stage-id]').forEach(row => {
      if (row.dataset.v39Dossier === '1') return;
      row.dataset.v39Dossier = '1';
      row.classList.add('hotel-v39-clickable-t');
      const label = row.querySelector('span:nth-child(2)');
      if (label && !row.querySelector('.hotel-v39-view-hint')) {
        const hint = document.createElement('span');
        hint.className = 'hotel-v39-view-hint';
        hint.textContent = 'Ver expediente';
        label.appendChild(document.createTextNode(' '));
        label.appendChild(hint);
      }
    });
  };

  const mergeReserveCatalog = (catalogRows, vehicleRows) => {
    const map = new Map();
    (vehicleRows || []).forEach(vehicle => {
      const code = normalize(vehicle.dfm);
      if (!code) return;
      map.set(code,{code,plate:normalize(vehicle.matricula),label:String(vehicle.tipo_motor || vehicle.categoria || 'RESERVA'),tasks:''});
    });
    (catalogRows || []).forEach(reserve => {
      const code = normalize(reserve.codigo);
      if (!code) return;
      const old = map.get(code) || {code,plate:'',label:'RESERVA',tasks:''};
      map.set(code,{...old,plate:normalize(reserve.matricula) || old.plate,label:reserve.etiqueta || old.label,tasks:String(reserve.trabajos || '').trim(),catalogState:reserve.estado || ''});
    });
    return [...map.values()].sort((a,b)=>a.code.localeCompare(b.code,'es',{numeric:true}));
  };

  const loadReservePanel = async () => {
    const anchor = document.querySelector('#hotel-summary-cards');
    if (!anchor) return;
    let panel = document.querySelector('#hotel-v39-reserves');
    if (!panel) {
      panel = document.createElement('section');
      panel.id = 'hotel-v39-reserves';
      panel.className = 'card stack';
      anchor.parentNode.insertBefore(panel, anchor);
    }
    panel.innerHTML = '<strong>🟢 Reservas · calculando disponibilidad real…</strong>';
    try {
      const [{data:board,error:boardError},{data:catalog,error:catalogError},{data:vehicles,error:vehicleError}] = await Promise.all([
        sb.from('pizarras').select('id,fecha').eq('estado','en_curso').order('fecha',{ascending:false}).limit(1).maybeSingle(),
        sb.from('reservas_hotel').select('codigo,matricula,etiqueta,trabajos,estado'),
        sb.from('vehiculos').select('dfm,matricula,tipo_motor,categoria').ilike('categoria','%RESERVA%').eq('activo',true)
      ]);
      if (boardError) throw boardError; if (catalogError) throw catalogError; if (vehicleError) throw vehicleError;
      if (!board) throw new Error('No hay pizarra en curso');
      const {data:units,error:unitError} = await sb.from('registros_hotel')
        .select('vehiculo_sustituido,vehiculo_reserva,estado,retirado_hotel_activo,etapas_hotel(estado)')
        .eq('pizarra_id',board.id).eq('oculto',false);
      if (unitError) throw unitError;

      const occupied = new Set(), ownPending = new Set();
      (units || []).forEach(unit => {
        const fleet = normalize(unit.vehiculo_sustituido), reserve = normalize(unit.vehiculo_reserva);
        if (!reserve || unit.retirado_hotel_activo === true) return;
        const activeState = !['reserva_liberada','anulado','libre'].includes(String(unit.estado || '').toLowerCase());
        if (fleet && activeState) occupied.add(reserve);
        if (!fleet && (activeState || (unit.etapas_hotel || []).some(stagePending))) ownPending.add(reserve);
      });

      const all = mergeReserveCatalog(catalog,vehicles);
      const free = all.filter(reserve => !occupied.has(reserve.code));
      const withPending = free.filter(reserve => ownPending.has(reserve.code) || reserve.tasks);
      const available = free.filter(reserve => !ownPending.has(reserve.code) && !reserve.tasks);
      panel.innerHTML = `<div class="hotel-title"><div><strong>🟢 Reservas</strong><div class="text-small text-muted">Ficha limpia desde catálogo · una parada anterior nunca se hereda a una reserva libre.</div></div></div>
        <div class="hotel-v39-metrics"><span class="hotel-v39-metric">Libres ${free.length}</span><span class="hotel-v39-metric">Disponibles ${available.length}</span><span class="hotel-v39-metric">Con pendientes ${withPending.length}</span><span class="hotel-v39-metric">Ocupadas ${occupied.size}</span></div>
        <div class="hotel-v39-reserve-grid">${free.map(reserve => {
          const pending = ownPending.has(reserve.code) || reserve.tasks;
          return `<article class="hotel-v39-reserve-card ${pending?'pending':''}"><div class="hotel-title"><strong>Reserva ${esc(reserve.code)} · ${esc(reserve.plate || '—')}</strong><span class="badge">${pending?'Pendientes propios':'Disponible'}</span></div><div class="text-small text-muted">${esc(reserve.label || 'RESERVA')}</div>${reserve.tasks?`<div style="margin-top:6px"><strong>Pendientes:</strong> ${esc(reserve.tasks)}</div>`:''}<div class="text-small" style="margin-top:6px"><strong>Sin Nº de parada activo</strong></div></article>`;
        }).join('') || '<div class="card">No hay reservas libres.</div>'}</div>`;

      // Ocultamos únicamente las fichas libres heredadas del render antiguo. La fuente v39 es el catálogo limpio de arriba.
      document.querySelectorAll('article.hotel-unit.status-free').forEach(card => {
        if (/Disponible para asignar/i.test(card.textContent || '')) card.style.display = 'none';
      });
    } catch (error) {
      panel.innerHTML = `<strong>🟢 Reservas</strong><div class="text-small" style="color:#991b1b">No se pudo calcular la disponibilidad: ${esc(error?.message || 'error')}</div>`;
    }
  };

  const refreshEnhancements = () => {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => { decorateStageRows(); loadReservePanel(); }, 120);
  };

  ensureStyles();
  ensureDossierModal();
  document.addEventListener('click', event => {
    const row = event.target.closest('.stage[data-stage-id]');
    if (!row) return;
    if (event.target.closest('button,select,input,textarea,label,a')) return;
    const stageId = row.dataset.stageId;
    if (stageId) openStage(stageId);
  }, true);

  const observer = new MutationObserver(refreshEnhancements);
  observer.observe(document.documentElement,{childList:true,subtree:true});
  refreshEnhancements();
})();
