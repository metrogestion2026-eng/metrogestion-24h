// Wrapper v36: trazabilidad y agenda persistente de T del Hotel.
const metrogestionNativeFetch = self.fetch.bind(self);

const patchHotelLastModification = html => {
  html=html.replace("let hotelMetricFilter = 'all';","let hotelMetricFilter = 'all';\n      const hotelUserName = id => users.find(account => String(account.id) === String(id || ''))?.name || (String(id || '') === String(sessionUserId || '') ? sessionUser : 'Usuario');\n      const formatHotelModifiedAt = value => { if(!value)return ''; const date=new Date(value); if(Number.isNaN(date.getTime()))return ''; const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Madrid',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()); const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Madrid',year:'numeric',month:'2-digit',day:'2-digit'}).format(date); const time=date.toLocaleTimeString('es-ES',{timeZone:'Europe/Madrid',hour:'2-digit',minute:'2-digit'}); return day===today?'hoy '+time:new Date(day+'T12:00:00').toLocaleDateString('es-ES')+' '+time; };");
  html=html.replace("temporaryReason:row.motivo_sustitucion_temporal || '', temporaryLimit:row.fecha_limite_sustitucion || '',","temporaryReason:row.motivo_sustitucion_temporal || '', temporaryLimit:row.fecha_limite_sustitucion || '',\n        modifiedAt:row.actualizado_en || row.creado_en || '', modifiedBy:row.modificado_por || row.creado_por || '',");
  html=html.replace("${editPanel}\n        </article>`;","${editPanel}\n          <div class=\"text-small\" style=\"margin-top:4px;padding:9px 10px;border-top:2px solid #cbd5e1;background:#f8fafc;border-radius:8px;text-align:right;color:#334155\"><strong>Última modificación:</strong> ${escapeHtml(formatHotelModifiedAt(unit.modifiedAt) || 'sin fecha')} · <strong>${escapeHtml(hotelUserName(unit.modifiedBy))}</strong></div>\n        </article>`;");
  return html;
};

const patchHotelProgrammedTasks = html => {
  html=html.replace('<div id="hotel-summary-cards" class="hotel-summary"></div>','<div id="hotel-programmed-tasks" class="card stack" style="border:3px solid #f59e0b;background:#fffbeb"><div class="hotel-title"><div><strong>📅 T programadas</strong><div class="text-small text-muted">Permanecen visibles hasta marcar la T como realizada o anulada, aunque el vehículo ya esté recuperado.</div></div><span id="hotel-programmed-count" class="badge">0</span></div><div id="hotel-programmed-today" class="stack"></div><div id="hotel-programmed-expired" class="stack"></div></div><div id="hotel-summary-cards" class="hotel-summary"></div>');
  html=html.replace("completedAt:stage.fecha_real || '', position:Number(stage.posicion || 0)","completedAt:stage.fecha_real || '', plannedAt:stage.fecha_prevista || '', position:Number(stage.posicion || 0)");
  html=html.replace("${stage.done&&stage.completedAt?`<span class=\"text-small\"> · Realizado: ${escapeHtml(formatStageDate(stage.completedAt))}</span>`:''}${stage.reason?","${stage.plannedAt?`<span class=\"text-small\"> · Programado: ${escapeHtml(new Date(stage.plannedAt).toLocaleDateString('es-ES'))}</span>`:''}${stage.done&&stage.completedAt?`<span class=\"text-small\"> · Realizado: ${escapeHtml(formatStageDate(stage.completedAt))}</span>`:''}${stage.reason?");

  html=html.replace("const renderHotel = () => {",`const renderHotelProgrammedTasks = () => {
        const box=root.querySelector('#hotel-programmed-tasks'),todayList=root.querySelector('#hotel-programmed-today'),expiredList=root.querySelector('#hotel-programmed-expired'),count=root.querySelector('#hotel-programmed-count');
        if(!box||!todayList||!expiredList||!count)return;
        const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Madrid',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
        const due=[];
        hotelUnits.forEach(unit=>(unit.stages||[]).forEach((stage,index)=>{
          // IMPORTANTE: el estado del vehículo NO interviene. Una T pendiente sigue viva aunque la reserva se haya liberado o el vehículo esté recuperado.
          if(stage.status==='realizada'||stage.status==='anulada'||!stage.plannedAt)return;
          const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Madrid',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(stage.plannedAt));
          if(day<=today)due.push({unit,stage,index,day,expired:day<today});
        }));
        due.sort((a,b)=>a.day.localeCompare(b.day)||Number(a.unit.priority)-Number(b.unit.priority));
        const todayItems=due.filter(item=>!item.expired),expiredItems=due.filter(item=>item.expired);
        count.textContent=String(due.length);
        box.style.borderColor=expiredItems.length?'#dc2626':todayItems.length?'#f59e0b':'#86efac';
        box.style.background=expiredItems.length?'#fff1f2':todayItems.length?'#fffbeb':'#f0fdf4';
        const renderItems=(items,expired)=>items.map(item=>{const vehicle=item.unit.fleet?((item.unit.fleet.startsWith('R')?'R ':'DFM ')+item.unit.fleet):('Reserva '+item.unit.reserve);const when=new Date(item.day+'T12:00:00').toLocaleDateString('es-ES');return '<button type="button" class="card hotel-programmed-jump" data-unit="'+escapeHtml(item.unit.id)+'" style="text-align:left;border-left:6px solid '+(expired?'#dc2626':'#f59e0b')+'"><strong>'+(expired?'⚠ VENCIDA':'📌 HOY')+' · '+escapeHtml(vehicle)+' · '+(item.index+1)+'T</strong><div><strong>'+escapeHtml(item.stage.name)+'</strong></div><div class="text-small">Programado: <strong>'+escapeHtml(when)+'</strong>'+(item.stage.location?' · '+escapeHtml(item.stage.location):'')+'</div></button>';}).join('');
        todayList.innerHTML=todayItems.length?'<div style="font-weight:900;color:#92400e">📌 T PARA HOY · '+todayItems.length+'</div>'+renderItems(todayItems,false):'';
        expiredList.innerHTML=expiredItems.length?'<div style="font-weight:900;color:#991b1b;margin-top:6px">⚠ T VENCIDAS PENDIENTES · '+expiredItems.length+'</div>'+renderItems(expiredItems,true):(!todayItems.length?'<div class="text-small" style="color:#166534"><strong>✓ Sin T pendientes para hoy ni vencidas.</strong></div>':'');
        root.querySelectorAll('.hotel-programmed-jump').forEach(button=>button.addEventListener('click',()=>{hotelMetricFilter='all';const search=root.querySelector('#hotel-search'),unit=hotelUnits.find(item=>item.id===button.dataset.unit);if(search&&unit){search.value=unit.fleet||unit.reserve||'';renderHotel();setTimeout(()=>root.querySelector('#hotel-list')?.scrollIntoView({behavior:'smooth',block:'start'}),0);}}));
      };
      const renderHotel = () => {`);
  html=html.replace("renderHotelHistory();\n        renderHotelSummary(); bindHotelStageButtons();","renderHotelProgrammedTasks();\n        renderHotelHistory();\n        renderHotelSummary(); bindHotelStageButtons();");
  html=html.replace("const location = window.prompt('Lugar o taller de esta T:', unit.location || '');\n          if (location === null) return;\n          const maxPosition","const location = window.prompt('Lugar o taller de esta T:', unit.location || '');\n          if (location === null) return;\n          const plannedDate = window.prompt('Fecha programada de la T (AAAA-MM-DD). Déjalo vacío si todavía no está programada:', '');\n          if (plannedDate === null) return;\n          if (plannedDate.trim() && !/^\\d{4}-\\d{2}-\\d{2}$/.test(plannedDate.trim())) { window.alert('La fecha debe tener formato AAAA-MM-DD.'); return; }\n          const maxPosition");
  html=html.replace("estado:'pendiente', lugar:location.trim(), creado_por:sessionUserId,\n            modificado_por:sessionUserId","estado:'pendiente', lugar:location.trim(), fecha_prevista:plannedDate.trim()?plannedDate.trim()+'T08:00:00+02:00':null, creado_por:sessionUserId,\n            modificado_por:sessionUserId");
  return html;
};

self.fetch=async(input,init)=>{const response=await metrogestionNativeFetch(input,init);try{const request=input instanceof Request?input:new Request(input,init),url=new URL(request.url,self.location.href);if(response.ok&&url.origin===self.location.origin&&url.pathname.endsWith('/metrogestion-2-0.html')){let text=await response.text();text=patchHotelLastModification(text);text=patchHotelProgrammedTasks(text);const headers=new Headers(response.headers);headers.set('Content-Type','text/html; charset=utf-8');headers.set('Cache-Control','no-store');return new Response(text,{status:response.status,statusText:response.statusText,headers});}}catch(error){console.warn('No se pudieron aplicar las mejoras visuales del Hotel',error);}return response;};

importScripts('./sw-metrogestion-core.js');
