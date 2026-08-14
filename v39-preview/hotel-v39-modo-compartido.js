// v39 preview · un único botón global Lectura/Edición para todo Hotel.
// La pantalla es única para todos; únicamente cambia el permiso efectivo del usuario.
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
  let editing=false; // siempre arranca protegido
  let applying=false;
  let timer=null;

  const editableSelectors=[
    '.hotel-unit-edit',
    '.hotel-stage-add',
    '.hotel-status-select',
    '.hotel-stop-date',
    '.hotel-entry-date',
    '.hotel-movement-type',
    '.stage-drag-handle',
    '.hotel-stage-action',
    '.hotel-stage-done',
    '.hotel-stage-date',
    '.hotel-stage-edit',
    '.hotel-stage-annul',
    '.hotel-stage-date-input',
    '.hotel-stage-date-save',
    '.hotel-stage-date-pending',
    '.hotel-edit-panel input',
    '.hotel-edit-panel select',
    '.hotel-edit-panel textarea',
    '.hotel-edit-panel button',
    '.v39-stop-edit',
    '.v39-relief-create'
  ].join(',');

  async function rpcBool(name,args={}){
    try{
      const {data,error}=await sb.rpc(name,args);
      return !error && data===true;
    }catch{return false}
  }

  function hotelView(){ return document.querySelector('#view-hotel'); }
  function hotelVisible(){
    const view=hotelView();
    return !!(view && !view.classList.contains('hidden') && view.getClientRects().length);
  }

  function ensureControl(){
    const view=hotelView();
    if(!view || !canView) return null;

    let box=document.querySelector('#v39-hotel-global-mode');
    if(!box){
      box=document.createElement('div');
      box.id='v39-hotel-global-mode';
      box.className='card';
      box.style.cssText='display:flex;gap:12px;align-items:center;justify-content:space-between;flex-wrap:wrap;padding:12px 14px;margin:10px 0';

      const anchor=document.querySelector('#hotel-summary-cards') || document.querySelector('#hotel-list');
      if(anchor?.parentElement) anchor.parentElement.insertBefore(box,anchor);
      else view.prepend(box);
    }

    if(!box.querySelector('#v39-hotel-global-mode-button')){
      box.innerHTML='<button id="v39-hotel-global-mode-button" type="button" class="btn btn-primary"></button><span id="v39-hotel-global-mode-status" class="text-small text-muted"></span>';
      box.querySelector('#v39-hotel-global-mode-button').addEventListener('click',()=>{
        if(!canEdit) return;
        editing=!editing;
        applyMode();
      });
    }
    return box;
  }

  function applyCard(card,allowEdit){
    // Desaparecen los selectores antiguos por ficha: manda un solo botón para toda la pizarra.
    card.querySelectorAll('.v39-card-mode').forEach(bar=>bar.style.setProperty('display','none','important'));
    card.dataset.v39CardEditing=allowEdit?'1':'0';

    card.querySelectorAll(editableSelectors).forEach(el=>{
      // Las acciones ocultas de T siguen ocultas; solo se habilitan para que el selector pueda dispararlas.
      el.disabled=!allowEdit;
      if(el.classList.contains('hotel-stage-hidden-action')) return;
      el.style.opacity=allowEdit?'':'.48';
    });

    if(!allowEdit){
      card.querySelectorAll('.hotel-edit-panel').forEach(panel=>panel.classList.add('hidden'));
      card.querySelectorAll('.stage-date-editor').forEach(panel=>panel.classList.add('hidden'));
    }
  }

  function applyMode(){
    if(applying || !canView) return;
    applying=true;
    try{
      if(!canEdit) editing=false;
      const allowEdit=canEdit && editing;
      const box=ensureControl();
      const button=box?.querySelector('#v39-hotel-global-mode-button');
      const status=box?.querySelector('#v39-hotel-global-mode-status');

      if(button){
        button.disabled=!canEdit;
        button.textContent=allowEdit?'✏️ Lectura y edición':'🔒 Modo lectura';
        button.classList.toggle('btn-primary',!allowEdit);
        button.classList.toggle('btn-secondary',allowEdit);
        button.setAttribute('aria-pressed',allowEdit?'true':'false');
      }
      if(status){
        status.textContent=!canEdit
          ? 'Solo lectura: este usuario no tiene permiso para modificar Hotel.'
          : allowEdit
            ? 'Edición activada para toda la pizarra, incluidas las T.'
            : 'Protección activada: toda la pizarra está en modo lectura.';
      }

      document.querySelectorAll('#view-hotel article.hotel-unit').forEach(card=>applyCard(card,allowEdit));
    }finally{
      applying=false;
    }
  }

  function schedule(){
    clearTimeout(timer);
    // El bloque operativo repinta las fichas; esta capa aplica después el único modo global.
    timer=setTimeout(()=>{
      if(hotelVisible() || hotelView()) applyMode();
    },160);
  }

  async function loadPermissions(){
    const {data:{session}}=await sb.auth.getSession();
    if(!session){
      canView=false;
      canEdit=false;
      editing=false;
      return;
    }
    [canView,canEdit]=await Promise.all([
      rpcBool('puede_ver_modulo_v39',{p_modulo:'hotel'}),
      rpcBool('puede_editar_modulo_v39',{p_modulo:'hotel'})
    ]);
    if(!canEdit) editing=false;
    applyMode();
  }

  const style=document.createElement('style');
  style.id='v39-hotel-global-mode-css';
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
    if(!session){
      canView=false;
      canEdit=false;
      editing=false;
      return;
    }
    setTimeout(loadPermissions,120);
  });

  setTimeout(loadPermissions,350);
  setTimeout(schedule,900);
})();