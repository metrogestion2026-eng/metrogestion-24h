// v39 preview · módulo Reservas como vista consumidora de Hotel, sin duplicar datos.
(() => {
  'use strict';
  if (window.__metrogestionV39ReservationsModuleLoaded) return;
  window.__metrogestionV39ReservationsModuleLoaded = true;

  let reserveButton=null;
  let moduleView=null;
  let originalParent=null;
  let originalNextSibling=null;
  let active=false;

  const visible=el=>!!(el && el.getClientRects().length && !el.classList.contains('hidden'));

  function findReserveButton(){
    return [...document.querySelectorAll('.app-tab[data-view="reservas"]')][0] || null;
  }

  function ensureView(){
    if(moduleView) return moduleView;
    const app=document.querySelector('#mock-app');
    if(!app) return null;
    moduleView=document.createElement('section');
    moduleView.id='view-reservas-v39';
    moduleView.className='stack hidden';
    moduleView.innerHTML=`
      <div class="topbar">
        <div><strong>Reservas</strong><div class="text-small text-muted">Disponibilidad alimentada exclusivamente por Hotel.</div></div>
        <button id="v39-reservas-volver-hotel" class="btn btn-secondary" type="button">← Volver a Hotel</button>
      </div>
      <div class="card sync-note text-small"><strong>Fuente única: Hotel.</strong> Aquí no se introduce ningún dato nuevo. La disponibilidad se actualiza con la pizarra y las reservas de Hotel.</div>
      <div id="v39-reservas-host" class="stack"></div>`;
    app.appendChild(moduleView);
    moduleView.querySelector('#v39-reservas-volver-hotel')?.addEventListener('click',()=>document.querySelector('#hotel-tab')?.click());
    return moduleView;
  }

  function hideBaseViews(){
    document.querySelectorAll('#mock-app > section').forEach(section=>{
      if(section!==moduleView) section.classList.add('hidden');
    });
  }

  function restoreReservePanel(){
    const panel=document.querySelector('#hotel-v39-reserves');
    if(panel && originalParent && panel.parentElement!==originalParent){
      if(originalNextSibling && originalNextSibling.parentElement===originalParent) originalParent.insertBefore(panel,originalNextSibling);
      else originalParent.appendChild(panel);
    }
  }

  function leaveReservations(){
    if(!active) return;
    active=false;
    moduleView?.classList.add('hidden');
    restoreReservePanel();
    reserveButton?.classList.remove('btn-primary');
    reserveButton?.classList.add('btn-secondary');
  }

  function openReservations(){
    reserveButton=findReserveButton();
    const view=ensureView();
    if(!reserveButton || !view) return;

    const panel=document.querySelector('#hotel-v39-reserves');
    if(!panel){
      // Fuerza una carga normal de Hotel para que su bloque vivo de reservas se cree.
      document.querySelector('#hotel-tab')?.click();
      setTimeout(openReservations,180);
      return;
    }

    if(!originalParent){
      originalParent=panel.parentElement;
      originalNextSibling=panel.nextSibling;
    }

    active=true;
    hideBaseViews();
    view.classList.remove('hidden');
    const host=view.querySelector('#v39-reservas-host');
    if(panel.parentElement!==host) host.appendChild(panel);

    document.querySelectorAll('.app-tab').forEach(btn=>{
      btn.classList.remove('btn-primary');
      btn.classList.add('btn-secondary');
    });
    reserveButton.classList.remove('locked-tab','btn-secondary');
    reserveButton.classList.add('btn-primary');
    reserveButton.setAttribute('aria-disabled','false');
    reserveButton.removeAttribute('title');
    view.scrollIntoView({block:'start'});
  }

  function install(){
    reserveButton=findReserveButton();
    if(!reserveButton) return false;
    reserveButton.classList.remove('locked-tab');
    reserveButton.setAttribute('aria-disabled','false');
    reserveButton.title='Reservas · datos procedentes de Hotel';

    reserveButton.addEventListener('click',event=>{
      event.preventDefault();
      event.stopImmediatePropagation();
      openReservations();
    },true);

    document.addEventListener('click',event=>{
      const tab=event.target.closest?.('.app-tab');
      if(tab && tab!==reserveButton) leaveReservations();
    },true);
    return true;
  }

  if(!install()){
    const timer=setInterval(()=>{if(install()) clearInterval(timer);},100);
    setTimeout(()=>clearInterval(timer),10000);
  }
})();