// v39 preview · un único modo Lectura/Edición compartido por todos los perfiles de Hotel.
// La pantalla es la misma para todos; únicamente cambia el permiso de edición.
(() => {
  'use strict';
  if (window.__metrogestionV39SharedHotelModeLoaded) return;
  window.__metrogestionV39SharedHotelModeLoaded = true;

  const URL='https://njtohfkqjjoavtumtmza.supabase.co';
  const KEY='sb_publishable_w1a9DClOM0S4HVJdv_TbKg_W_UkN2W_';
  const sb=window.supabase?.createClient?.(URL,KEY);
  if(!sb) return;

  let canView=false;
  let canEdit=false;
  let editing=false; // siempre arranca protegido en lectura
  let applying=false;
  let timer=null;

  const editSelectors=[
    '.hotel-unit-edit','.hotel-stage-add','.hotel-status-select','.hotel-stage-action',
    '.stage-drag-handle','.hotel-stop-date-control input','.hotel-entry-date-control input',
    '.hotel-entry-date-control select','.v39-stop-edit','.hotel-edit-save',
    '.hotel-stage-date-save','.hotel-stage-date-pending','.v39-relief-create'
  ].join(',');

  async function rpcBool(name,args={}){
    try{
      const {data,error}=await sb.rpc(name,args);
      return !error && data===true;
    }catch{return false}
  }

  function hotelVisible(){
    const view=document.querySelector('#view-hotel');
    return !!(view && !view.classList.contains('hidden') && view.getClientRects().length);
  }

  function ensureControl(){
    const view=document.querySelector('#view-hotel');
    if(!view || !canView) return null;
    let box=document.querySelector('#v39-hotel-mode-shared');
    if(!box){
      box=document.createElement('div');
      box.id='v39-hotel-mode-shared';
      box.className='card';
      box.style.cssText='display:flex;gap:12px;align-items:center;justify-content:space-between;flex-wrap:wrap;padding:12px 14px';
      const anchor=document.querySelector('#hotel-summary-cards') || document.querySelector('#hotel-list') || view.firstElementChild;
      if(anchor?.parentElement) anchor.parentElement.insertBefore(box,anchor);
      else view.prepend(box);
    }
    box.innerHTML=`
      <label style="display:flex;grid-template-columns:auto 1fr;gap:9px;align-items:center;font-weight:800;cursor:${canEdit?'pointer':'default'}">
        <input id="v39-hotel-read-toggle" type="checkbox" ${editing?'':'checked'} ${canEdit?'':'disabled'} style="width:24px;height:24px;margin:0">
        <span>🔒 Modo lectura</span>
      </label>
      <span id="v39-hotel-mode-status" class="text-small text-muted"></span>`;
    const toggle=box.querySelector('#v39-hotel-read-toggle');
    if(canEdit){
      toggle.addEventListener('change',()=>{
        editing=!toggle.checked;
        applyMode();
      });
    }
    return box;
  }

  function moveSharedActions(card){
    const relief=card.querySelector('.v39-relief-create');
    if(!relief) return;
    let host=card.querySelector('.v39-shared-hotel-actions');
    if(!host){
      host=document.createElement('div');
      host.className='v39-shared-hotel-actions hotel-actions';
      host.style.cssText='border-top:1px solid #dbe4ec;padding-top:9px;margin-top:6px';
      card.appendChild(host);
    }
    if(relief.parentElement!==host) host.appendChild(relief);
  }

  function applyCard(card){
    // Se retiran los antiguos selectores por ficha: el modo ahora es único para toda la pizarra.
    card.querySelectorAll('.v39-card-mode').forEach(bar=>bar.style.setProperty('display','none','important'));
    moveSharedActions(card);

    const allowEdit=canEdit && editing;
    card.dataset.v39CardEditing=allowEdit?'1':'0';
    card.querySelectorAll(editSelectors).forEach(el=>{
      if(!allowEdit){
        if(el.dataset.v39SharedOriginalDisabled===undefined) el.dataset.v39SharedOriginalDisabled=el.disabled?'1':'0';
        el.disabled=true;
        el.style.opacity='.48';
      }else{
        el.disabled=el.dataset.v39SharedOriginalDisabled==='1';
        el.style.opacity='';
      }
    });
  }

  function applyMode(){
    if(applying || !canView) return;
    applying=true;
    try{
      if(!canEdit) editing=false;
      const box=ensureControl();
      const toggle=box?.querySelector('#v39-hotel-read-toggle');
      const status=box?.querySelector('#v39-hotel-mode-status');
      if(toggle) toggle.checked=!editing;
      if(status){
        status.textContent=!canEdit
          ? 'Solo lectura: este usuario no tiene permiso para modificar Hotel.'
          : editing
            ? 'Edición activada: los cambios se guardan en el mismo Hotel compartido.'
            : 'Protección activada: no se pueden modificar datos.';
      }
      document.querySelectorAll('article.hotel-unit').forEach(applyCard);
    }finally{applying=false}
  }

  function schedule(){
    clearTimeout(timer);
    // El bloque operativo antiguo repinta a ~80 ms; aplicamos después para que mande el modo compartido.
    timer=setTimeout(()=>{if(hotelVisible()||document.querySelector('#view-hotel'))applyMode()},140);
  }

  async function loadPermissions(){
    const {data:{session}}=await sb.auth.getSession();
    if(!session){canView=false;canEdit=false;editing=false;return}
    [canView,canEdit]=await Promise.all([
      rpcBool('puede_ver_modulo_v39',{p_modulo:'hotel'}),
      rpcBool('puede_editar_modulo_v39',{p_modulo:'hotel'})
    ]);
    if(!canEdit) editing=false;
    applyMode();
  }

  const style=document.createElement('style');
  style.id='v39-hotel-mode-shared-css';
  style.textContent='.v39-card-mode{display:none!important}';
  document.head.appendChild(style);

  const observer=new MutationObserver(schedule);
  observer.observe(document.documentElement,{childList:true,subtree:true});

  document.addEventListener('click',e=>{
    if(e.target.closest?.('#hotel-tab,.hotel-subtab')) schedule();
  },true);
  window.addEventListener('focus',()=>{loadPermissions();schedule()});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden){loadPermissions();schedule()}});
  sb.auth.onAuthStateChange((_event,session)=>{
    if(!session){canView=false;canEdit=false;editing=false;return}
    setTimeout(loadPermissions,100);
  });

  setTimeout(loadPermissions,350);
  setTimeout(schedule,900);
})();