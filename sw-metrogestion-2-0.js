// Wrapper v36: conserva el service worker estable y añade mejoras visuales/operativas del Hotel.
const metrogestionNativeFetch = self.fetch.bind(self);

const patchHotelLastModification = html => {
  html = html.replace(
    "let hotelMetricFilter = 'all';",
    "let hotelMetricFilter = 'all';\n      const hotelUserName = id => users.find(account => String(account.id) === String(id || ''))?.name || (String(id || '') === String(sessionUserId || '') ? sessionUser : 'Usuario');\n      const formatHotelModifiedAt = value => {\n        if (!value) return '';\n        const date = new Date(value);\n        if (Number.isNaN(date.getTime())) return '';\n        const today = new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Madrid',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());\n        const day = new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Madrid',year:'numeric',month:'2-digit',day:'2-digit'}).format(date);\n        const time = date.toLocaleTimeString('es-ES',{timeZone:'Europe/Madrid',hour:'2-digit',minute:'2-digit'});\n        return day === today ? 'hoy ' + time : new Date(day + 'T12:00:00').toLocaleDateString('es-ES') + ' ' + time;\n      };"
  );
  html = html.replace(
    "temporaryReason:row.motivo_sustitucion_temporal || '', temporaryLimit:row.fecha_limite_sustitucion || '',",
    "temporaryReason:row.motivo_sustitucion_temporal || '', temporaryLimit:row.fecha_limite_sustitucion || '',\n        modifiedAt:row.actualizado_en || row.creado_en || '', modifiedBy:row.modificado_por || row.creado_por || '',"
  );
  html = html.replace(
    "${editPanel}\n        </article>`;",
    "${editPanel}\n          <div class=\"text-small\" style=\"margin-top:4px;padding:9px 10px;border-top:2px solid #cbd5e1;background:#f8fafc;border-radius:8px;text-align:right;color:#334155\"><strong>Última modificación:</strong> ${escapeHtml(formatHotelModifiedAt(unit.modifiedAt) || 'sin fecha')} · <strong>${escapeHtml(hotelUserName(unit.modifiedBy))}</strong></div>\n        </article>`;"
  );
  return html;
};

const patchHotelProgrammedTasks = html => {
  // Panel diario al principio de Pizarra.
  html = html.replace(
    '<div id="hotel-summary-cards" class="hotel-summary"></div>',
    '<div id="hotel-programmed-tasks" class="card stack" style="border:3px solid #f59e0b;background:#fffbeb"><div class="hotel-title"><div><strong>📅 T programadas</strong><div class="text-small text-muted">Avisos de trabajos previstos para hoy y trabajos vencidos pendientes.</div></div><span id="hotel-programmed-count" class="badge">0</span></div><div id="hotel-programmed-list" class="stack"><div class="text-small text-muted">No hay T programadas vencidas para hoy.</div></div></div><div id="hotel-summary-cards" class="hotel-summary"></div>'
  );

  // La fecha prevista de cada T ya existe en la base; la incorporamos al modelo de pantalla.
  html = html.replace(
    "completedAt:stage.fecha_real || '', position:Number(stage.posicion || 0)",
    "completedAt:stage.fecha_real || '', plannedAt:stage.fecha_prevista || '', position:Number(stage.posicion || 0)"
  );

  // Mostrar fecha programada dentro de la propia T.
  html = html.replace(
    "${stage.done&&stage.completedAt?`<span class=\"text-small\"> · Realizado: ${escapeHtml(formatStageDate(stage.completedAt))}</span>`:''}${stage.reason?",
    "${stage.plannedAt?`<span class=\"text-small\"> · Programado: ${escapeHtml(new Date(stage.plannedAt).toLocaleDateString('es-ES'))}</span>`:''}${stage.done&&stage.completedAt?`<span class=\"text-small\"> · Realizado: ${escapeHtml(formatStageDate(stage.completedAt))}</span>`:''}${stage.reason?"
  );

  // Función que genera el aviso diario. Incluye hoy y vencidas; las realizadas/anuladas no aparecen.
  html = html.replace(
    "const renderHotel = () => {",
    `const renderHotelProgrammedTasks = () => {
        const box=root.querySelector('#hotel-programmed-tasks');
        const list=root.querySelector('#hotel-programmed-list');
        const count=root.querySelector('#hotel-programmed-count');
        if(!box||!list||!count)return;
        const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Madrid',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
        const due=[];
        hotelUnits.forEach(unit => (unit.stages||[]).forEach((stage,index)=>{
          if(stage.status==='realizada'||stage.status==='anulada'||!stage.plannedAt)return;
          const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Madrid',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(stage.plannedAt));
          if(day<=today) due.push({unit,stage,index,day,expired:day<today});
        }));
        due.sort((a,b)=>a.day.localeCompare(b.day)||Number(a.unit.priority)-Number(b.unit.priority));
        count.textContent=String(due.length);
        box.style.borderColor=due.some(item=>item.expired)?'#dc2626':due.length?'#f59e0b':'#86efac';
        box.style.background=due.some(item=>item.expired)?'#fff1f2':due.length?'#fffbeb':'#f0fdf4';
        if(!due.length){list.innerHTML='<div class="text-small" style="color:#166534"><strong>✓ Sin T vencidas para hoy.</strong></div>';return;}
        list.innerHTML=due.map(item=>{
          const vehicle=item.unit.fleet?((item.unit.fleet.startsWith('R')?'R ':'DFM ')+item.unit.fleet):('Reserva '+item.unit.reserve);
          const status=item.expired?'⚠ VENCIDA':'📌 HOY';
          const when=new Date(item.day+'T12:00:00').toLocaleDateString('es-ES');
          return '<button type="button" class="card hotel-programmed-jump" data-unit="'+escapeHtml(item.unit.id)+'" style="text-align:left;border-left:6px solid '+(item.expired?'#dc2626':'#f59e0b')+'"><strong>'+status+' · '+escapeHtml(vehicle)+' · '+(item.index+1)+'T</strong><div>'+escapeHtml(item.stage.name)+'</div><div class="text-small">Programado: <strong>'+escapeHtml(when)+'</strong>'+(item.stage.location?' · '+escapeHtml(item.stage.location):'')+'</div></button>';
        }).join('');
        root.querySelectorAll('.hotel-programmed-jump').forEach(button=>button.addEventListener('click',()=>{
          hotelMetricFilter='all';
          const search=root.querySelector('#hotel-search');
          const unit=hotelUnits.find(item=>item.id===button.dataset.unit);
          if(search&&unit){search.value=unit.fleet||unit.reserve||'';renderHotel();setTimeout(()=>root.querySelector('#hotel-list')?.scrollIntoView({behavior:'smooth',block:'start'}),0);}
        }));
      };
      const renderHotel = () => {`
  );

  html = html.replace(
    "renderHotelHistory();\n        renderHotelSummary(); bindHotelStageButtons();",
    "renderHotelProgrammedTasks();\n        renderHotelHistory();\n        renderHotelSummary(); bindHotelStageButtons();"
  );

  // Al crear una T pedimos también su fecha programada. Queda opcional para T no planificadas.
  html = html.replace(
    "const location = window.prompt('Lugar o taller de esta T:', unit.location || '');\n          if (location === null) return;\n          const maxPosition",
    "const location = window.prompt('Lugar o taller de esta T:', unit.location || '');\n          if (location === null) return;\n          const plannedDate = window.prompt('Fecha programada de la T (AAAA-MM-DD). Déjalo vacío si todavía no está programada:', '');\n          if (plannedDate === null) return;\n          if (plannedDate.trim() && !/^\\d{4}-\\d{2}-\\d{2}$/.test(plannedDate.trim())) { window.alert('La fecha debe tener formato AAAA-MM-DD.'); return; }\n          const maxPosition"
  );
  html = html.replace(
    "estado:'pendiente', lugar:location.trim(), creado_por:sessionUserId,\n            modificado_por:sessionUserId",
    "estado:'pendiente', lugar:location.trim(), fecha_prevista:plannedDate.trim()?plannedDate.trim()+'T08:00:00+02:00':null, creado_por:sessionUserId,\n            modificado_por:sessionUserId"
  );

  return html;
};

self.fetch = async (input, init) => {
  const response = await metrogestionNativeFetch(input, init);
  try {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url, self.location.href);
    if (response.ok && url.origin === self.location.origin && url.pathname.endsWith('/metrogestion-2-0.html')) {
      let text = await response.text();
      text = patchHotelLastModification(text);
      text = patchHotelProgrammedTasks(text);
      const headers = new Headers(response.headers);
      headers.set('Content-Type','text/html; charset=utf-8');
      headers.set('Cache-Control','no-store');
      return new Response(text,{status:response.status,statusText:response.statusText,headers});
    }
  } catch (error) {
    console.warn('No se pudieron aplicar las mejoras visuales del Hotel', error);
  }
  return response;
};

importScripts('./sw-metrogestion-core.js');
