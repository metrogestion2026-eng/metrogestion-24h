// Capa final v36.1: conserva íntegro el wrapper estable y aplica solo correcciones visuales.
importScripts('./sw-metrogestion-v36-base.js');
const metrogestionStableFetch=self.fetch.bind(self);
self.fetch=async(input,init)=>{
  const response=await metrogestionStableFetch(input,init);
  try{
    const request=input instanceof Request?input:new Request(input,init);
    const url=new URL(request.url,self.location.href);
    if(response.ok&&url.origin===self.location.origin&&url.pathname.endsWith('/metrogestion-2-0.html')){
      let html=await response.text();
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
        "return `<article class=\\\"card stack hotel-unit status-${escapeHtml(unit.state)} ${contractAlerts.length?'contract-expired':''}\\\">\\n          ${stopHeading}\\n          <div class=\\\"hotel-title\\\">"
      );
      const headers=new Headers(response.headers);
      headers.set('Content-Type','text/html; charset=utf-8');
      headers.set('Cache-Control','no-store');
      return new Response(html,{status:response.status,statusText:response.statusText,headers});
    }
  }catch(error){console.warn('No se pudieron aplicar las correcciones visuales v36.1',error);}
  return response;
};
