// v39 preview · selector de día exacto para Histórico; ayer por defecto.
(() => {
  'use strict';
  if (window.__metrogestionV39HistoryDayLoaded) return;
  window.__metrogestionV39HistoryDayLoaded = true;

  const madridIso = (daysOffset=0) => {
    const base = new Date(Date.now() + daysOffset * 86400000);
    return new Intl.DateTimeFormat('en-CA', {
      timeZone:'Europe/Madrid', year:'numeric', month:'2-digit', day:'2-digit'
    }).format(base);
  };
  const yesterday = () => madridIso(-1);

  function historyVisible(){
    const panel=document.querySelector('#hotel-history-list');
    return Boolean(panel && panel.getClientRects().length);
  }

  function ensureDayField(){
    const month=document.querySelector('#hotel-history-month');
    if(!month) return null;
    let input=document.querySelector('#v39-history-day');
    if(input) return input;

    const wrap=document.createElement('label');
    wrap.id='v39-history-day-wrap';
    wrap.textContent='Buscar día';
    wrap.style.marginTop='10px';

    input=document.createElement('input');
    input.id='v39-history-day';
    input.type='date';
    input.className='form-control';
    input.setAttribute('aria-label','Buscar día exacto en el histórico');
    wrap.appendChild(input);

    const monthLabel=month.closest('label') || month.parentElement;
    monthLabel?.insertAdjacentElement('afterend',wrap);

    // Histórico abre por defecto en el día anterior para evitar descargar un mes completo.
    input.value=yesterday();
    month.value=input.value.slice(0,7);

    input.addEventListener('change',()=>{
      if(input.value){
        month.value=input.value.slice(0,7);
      }
      document.dispatchEvent(new CustomEvent('v39-history-scope-change',{
        detail:{day:input.value||'',month:month.value||''}
      }));
    });

    month.addEventListener('change',()=>{
      // Si el usuario cambia de mes manualmente, se borra el día y se permite la consulta mensual.
      if(input.value && !input.value.startsWith(month.value)) input.value='';
      document.dispatchEvent(new CustomEvent('v39-history-scope-change',{
        detail:{day:input.value||'',month:month.value||''}
      }));
    });

    requestAnimationFrame(()=>document.dispatchEvent(new CustomEvent('v39-history-scope-change',{
      detail:{day:input.value,month:month.value}
    })));
    return input;
  }

  document.addEventListener('click',e=>{
    if(e.target.closest?.('.hotel-subtab[data-hotel-view="history"]')){
      setTimeout(ensureDayField,80);
    }
  },true);

  window.addEventListener('focus',()=>{if(historyVisible()) ensureDayField();});
  setTimeout(()=>{if(historyVisible()) ensureDayField();},800);
})();
