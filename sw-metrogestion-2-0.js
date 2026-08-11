// Capa final v36.2: conserva íntegro el wrapper estable y añade correcciones visuales + edición individual por ficha.
importScripts('./sw-metrogestion-v36-base.js');
const metrogestionStableFetch=self.fetch.bind(self);
self.fetch=async(input,init)=>{
  const response=await metrogestionStableFetch(input,init);
  try{
    const request=input instanceof Request?input:new Request(input,init);
    const url=new URL(request.url,self.location.href);
    if(response.ok&&url.origin===self.location.origin&&url.pathname.endsWith('/metrogestion-2-0.html')){
      let html=await response.text();

      // Estado de edición individual por ficha.
      html=html.replace(
        "let hotelMetricFilter = 'all';",
        "let hotelMetricFilter = 'all';\n      let hotelEditingUnitId = '';"
      );
      html=html.replace(
        "const canEditHotel = () => hasHotelEditPermission() && !hotelReadMode;",
        "const canEditHotel = () => hasHotelEditPermission() && (!hotelReadMode || Boolean(hotelEditingUnitId));"
      );

      // Hotel activo: los recuperados/retirados no se muestran en la pizarra.
      html=html.replace(
        "const visible = hotelUnits.filter(unit => matchesMetric(unit) && (!query || Object.values(unit).flat(3).join(' ').toLowerCase().includes(query)));",
        "const visible = hotelUnits.filter(unit => unit.retiredFromActive !== true && matchesMetric(unit) && (!query || Object.values(unit).flat(3).join(' ').toLowerCase().includes(query)));"
      );

      // PARADA Nº debe ser la primera referencia visual, antes de DFM/Semirremolque.
      html=html.replace(
        "          ${stopHeading}\\n          ${stagesHeading}\\n          ${stages}",
        "          ${stagesHeading}\\n          ${stages}"
      );
      html=html.replace(
        "return `<article class=\\\"card stack hotel-unit status-${escapeHtml(unit.state)} ${contractAlerts.length?'contract-expired':''}\\\">\\n          <div class=\\\"hotel-title\\\">",
        "return `<article data-hotel-unit-id=\\\"${escapeHtml(unit.id)}\\\" class=\\\"card stack hotel-unit status-${escapeHtml(unit.state)} ${contractAlerts.length?'contract-expired':''}\\\">\\n          ${stopHeading}\\n          <div class=\\\"viz-row hotel-card-lockbar\\\" style=\\\"align-items:center;padding:8px 10px;border:2px solid #cbd5e1;border-radius:10px;background:#f8fafc\\\"><strong>🔒 Ficha protegida</strong><button type=\\\"button\\\" class=\\\"btn btn-secondary hotel-card-edit-toggle\\\" data-id=\\\"${escapeHtml(unit.id)}\\\">✏️ Editar ficha</button></div>\\n          <div class=\\\"hotel-title\\\">"
      );

      // Bloquea todas las fichas salvo la seleccionada y enlaza su botón propio.
      html=html.replace(
        "const renderHotel = () => {",
        `const applyHotelCardLocks=()=>{\n        root.querySelectorAll('.hotel-unit[data-hotel-unit-id]').forEach(card=>{\n          const id=card.dataset.hotelUnitId||'', editing=Boolean(hotelEditingUnitId)&&hotelEditingUnitId===id;\n          const bar=card.querySelector('.hotel-card-lockbar'),toggle=card.querySelector('.hotel-card-edit-toggle');\n          if(bar){const title=bar.querySelector('strong');if(title)title.textContent=editing?'✏️ Edición de esta ficha':'🔒 Ficha protegida';}\n          if(toggle){toggle.textContent=editing?'🔒 Finalizar edición':'✏️ Editar ficha';toggle.classList.toggle('btn-primary',editing);toggle.classList.toggle('btn-secondary',!editing);}\n          card.querySelectorAll('button,input,select,textarea').forEach(control=>{if(control.classList.contains('hotel-card-edit-toggle'))return;control.disabled=!editing;});\n          if(toggle&&!toggle.dataset.bound){toggle.dataset.bound='1';toggle.addEventListener('click',()=>{if(!hasHotelEditPermission()){window.alert('Este usuario no tiene permiso para modificar el Hotel.');return;}const opening=hotelEditingUnitId!==id;hotelEditingUnitId=opening?id:'';hotelReadMode=!opening;renderHotel();if(opening)setTimeout(()=>root.querySelector('.hotel-unit[data-hotel-unit-id="'+CSS.escape(id)+'"]')?.scrollIntoView({behavior:'smooth',block:'start'}),50);});}\n        });\n      };\n      const renderHotel = () => {`
      );
      html=html.replace(
        "root.querySelector('#hotel-list').innerHTML = visible.map(renderHotelUnit).join('') || '<div class=\"card\">No hay resultados en la pizarra actual.</div>';",
        "root.querySelector('#hotel-list').innerHTML = visible.map(renderHotelUnit).join('') || '<div class=\"card\">No hay resultados en la pizarra actual.</div>'; applyHotelCardLocks();"
      );

      // Después de guardar, la ficha vuelve automáticamente a lectura.
      html=html.replace(
        "const showHotelSaved=(message='✓ Cambios guardados correctamente')=>{",
        "const showHotelSaved=(message='✓ Cambios guardados correctamente')=>{hotelEditingUnitId='';hotelReadMode=true;"
      );

      const headers=new Headers(response.headers);
      headers.set('Content-Type','text/html; charset=utf-8');
      headers.set('Cache-Control','no-store');
      return new Response(html,{status:response.status,statusText:response.statusText,headers});
    }
  }catch(error){console.warn('No se pudieron aplicar las correcciones visuales v36.2',error);}
  return response;
};
