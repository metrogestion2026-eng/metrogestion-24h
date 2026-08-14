// v39 preview · filtro por día exacto dentro del Histórico del Hotel.
(() => {
  'use strict';
  if (window.__metrogestionV39HistoryDayLoaded) return;
  window.__metrogestionV39HistoryDayLoaded = true;

  let observer=null;
  let selectedDay='';

  const fmtVariants=iso=>{
    const [y,m,d]=String(iso||'').split('-');
    if(!y||!m||!d) return [];
    const di=String(Number(d));
    const mi=String(Number(m));
    return [`${di}/${mi}/${y}`,`${d}/${m}/${y}`];
  };

  function historyVisible(){
    const panel=document.querySelector('#hotel-history-list');
    return Boolean(panel && panel.getClientRects().length);
  }

  function applyFilter(){
    const list=document.querySelector('#hotel-history-list');
    if(!list) return;
    const variants=fmtVariants(selectedDay);
    [...list.children].forEach(card=>{
      if(!selectedDay){
        card.style.removeProperty('display');
        return;
      }
      const text=(card.textContent||'').replace(/\s+/g,' ').trim();
      const matches=variants.some(v=>text.includes(v));
      card.style.display=matches?'':'none';
    });

    let empty=document.querySelector('#v39-history-day-empty');
    const visibleCards=[...list.children].filter(card=>card.id!=='v39-history-day-empty' && card.style.display!=='none');
    if(selectedDay && !visibleCards.length){
      if(!empty){
        empty=document.createElement('div');
        empty.id='v39-history-day-empty';
        empty.className='card';
        list.appendChild(empty);
      }
      empty.style.display='';
      const [y,m,d]=selectedDay.split('-');
      empty.textContent=`No hay registros guardados el ${d}/${m}/${y}.`;
    }else if(empty){
      empty.style.display='none';
    }
  }

  function ensureDayField(){
    const month=document.querySelector('#hotel-history-month');
    if(!month) return;
    if(document.querySelector('#v39-history-day')) return;

    const wrap=document.createElement('label');
    wrap.id='v39-history-day-wrap';
    wrap.textContent='Buscar día';
    wrap.style.marginTop='10px';

    const input=document.createElement('input');
    input.id='v39-history-day';
    input.type='date';
    input.className='form-control';
    input.setAttribute('aria-label','Buscar día exacto en el histórico');
    wrap.appendChild(input);

    const monthLabel=month.closest('label') || month.parentElement;
    monthLabel?.insertAdjacentElement('afterend',wrap);

    input.addEventListener('change',()=>{
      selectedDay=input.value||'';
      if(selectedDay){
        const targetMonth=selectedDay.slice(0,7);
        if(month.value!==targetMonth){
          month.value=targetMonth;
          month.dispatchEvent(new Event('change',{bubbles:true}));
          setTimeout(applyFilter,350);
          setTimeout(applyFilter,900);
          return;
        }
      }
      applyFilter();
    });

    month.addEventListener('change',()=>{
      if(selectedDay && !selectedDay.startsWith(month.value)){
        selectedDay='';
        input.value='';
      }
      setTimeout(applyFilter,350);
    });

    const search=document.querySelector('#hotel-history-search');
    search?.addEventListener('input',()=>setTimeout(applyFilter,0));

    const list=document.querySelector('#hotel-history-list');
    if(list){
      observer?.disconnect();
      observer=new MutationObserver(()=>requestAnimationFrame(applyFilter));
      observer.observe(list,{childList:true});
    }
  }

  document.addEventListener('click',e=>{
    if(e.target.closest?.('.hotel-subtab[data-hotel-view="history"]')){
      setTimeout(()=>{ensureDayField();applyFilter();},150);
    }
  },true);

  window.addEventListener('focus',()=>{if(historyVisible()){ensureDayField();applyFilter();}});
  setTimeout(ensureDayField,1200);
})();
