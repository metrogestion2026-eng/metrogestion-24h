// v39 preview · ajustes operativos solicitados en pruebas.
(() => {
  'use strict';
  if (window.__metrogestionV39OperationalFixesLoaded) return;
  window.__metrogestionV39OperationalFixesLoaded = true;

  const URL='https://njtohfkqjjoavtumtmza.supabase.co';
  const KEY='sb_publishable_w1a9DClOM0S4HVJdv_TbKg_W_UkN2W_';
  const sb=window.supabase?.createClient?.(URL,KEY);
  let canEdit=false;
  let selectedCardKey='';
  let timer=null;

  const norm=v=>String(v||'').trim().replace(/\s+/g,' ').toUpperCase();
  const cardKey=card=>norm(card?.querySelector('.hotel-primary > strong')?.textContent || card?.querySelector('.hotel-title strong')?.textContent || '');

  function style(){
    if(document.getElementById('v39-operational-css')) return;
    const s=document.createElement('style');
    s.id='v39-operational-css';
    s.textContent=`
      .v39-fold-toggle{display:none!important}
      .v39-fold-v2{width:auto!important;min-width:118px!important;white-space:nowrap}
      .v39-card-edit-btn{width:auto!important;align-self:flex-start;margin:2px 0 8px auto}
      .v39-card-locked select,.v39-card-locked input,.v39-card-locked textarea,.v39-card-locked .hotel-stage-add,.v39-card-locked .hotel-unit-edit,.v39-card-locked .hotel-stage-action,.v39-card-locked .stage-drag-handle{pointer-events:none!important;opacity:.55!important}
      .v39-t-archive{border:1px dashed #94a3b8;border-radius:10px;background:#f8fafc;padding:8px 10px}
      .v39-t-archive summary{cursor:pointer;font-weight:850;color:#475569}
      .v39-t-archive .stage-list{margin-top:8px}
      .v39-res.pending .v39-assign-hint{background:#ecfdf3!important;border-color:#86efac!important;color:#166534!important}
      @media(max-width:650px){.v39-fold-v2,.v39-card-edit-btn{width:100%!important;margin-left:0}}
    `;
    document.head.appendChild(s);
  }

  function stored(key){try{return sessionStorage.getItem(key)==='1'}catch{return false}}
  function saveStored(key,val){try{sessionStorage.setItem(key,val?'1':'0')}catch{}}

  function applyFold(selector,key){
    const panel=document.querySelector(selector);if(!panel)return;
    const header=panel.querySelector(':scope > .hotel-title');if(!header)return;
    let btn=header.querySelector('.v39-fold-v2');
    if(!btn){
      btn=document.createElement('button');
      btn.type='button';btn.className='btn btn-secondary v39-fold-v2';
      btn.addEventListener('click',e=>{
        e.preventDefault();e.stopPropagation();
        const folded=panel.dataset.v39FoldV2!=='1';
        panel.dataset.v39FoldV2=folded?'1':'0';saveStored(key,folded);renderFold(panel,btn,folded);
      });
      header.appendChild(btn);
    }
    const folded=panel.dataset.v39FoldV2==='1'||(panel.dataset.v39FoldV2!=='0'&&stored(key));
    panel.dataset.v39FoldV2=folded?'1':'0';renderFold(panel,btn,folded);
  }
  function renderFold(panel,btn,folded){
    const header=panel.querySelector(':scope > .hotel-title');
    [...panel.children].forEach(ch=>{if(ch!==header)ch.style.display=folded?'none':''});
    btn.textContent=folded?'▼ Desplegar':'▲ Plegar';btn.setAttribute('aria-expanded',folded?'false':'true');
  }

  function archiveAnnulledStages(card){
    const annulled=[...card.querySelectorAll('li.stage.annulled')];
    let archive=card.querySelector(':scope > .v39-t-archive');
    if(!annulled.length){archive?.remove();return}
    if(!archive){
      archive=document.createElement('details');archive.className='v39-t-archive';
      archive.innerHTML='<summary></summary><ul class="stage-list v39-t-archive-list"></ul>';
      const actions=card.querySelector(':scope > .hotel-actions');
      if(actions)card.insertBefore(archive,actions);else card.appendChild(archive);
    }
    const list=archive.querySelector('.v39-t-archive-list');
    annulled.forEach(stage=>list.appendChild(stage));
    archive.querySelector('summary').textContent=`🗂 T anuladas / histórico · ${list.children.length}`;
  }

  function decoratePendingReserves(){
    document.querySelectorAll('#hotel-v39-reserves .v39-res.pending').forEach(card=>{
      const hint=card.querySelector('.v39-assign-hint');
      if(hint)hint.textContent='Tiene pendientes propios · se puede asignar';
    });
  }

  // El módulo anterior bloqueaba cualquier tarjeta .pending. Para v39, los pendientes
  // no impiden usar la reserva; la comprobación real de disponibilidad queda en servidor.
  function temporarilyAllowPending(card){
    if(!card?.classList.contains('pending'))return;
    card.dataset.v39PendingRestore='1';card.classList.remove('pending');
    setTimeout(()=>{if(card.dataset.v39PendingRestore==='1'){card.classList.add('pending');delete card.dataset.v39PendingRestore}},0);
  }
  document.addEventListener('click',e=>{
    const card=e.target.closest('#hotel-v39-reserves .v39-res.pending.v39-assignable');
    if(card)temporarilyAllowPending(card);
  },true);
  document.addEventListener('keydown',e=>{
    if(e.key!=='Enter'&&e.key!==' ')return;
    const card=e.target.closest('#hotel-v39-reserves .v39-res.pending.v39-assignable');
    if(card)temporarilyAllowPending(card);
  },true);

  function setReadMode(read){
    const box=document.querySelector('#hotel-read-mode');
    if(!box)return false;
    box.checked=read;box.dispatchEvent(new Event('change',{bubbles:true}));return true;
  }

  function findCard(key){return [...document.querySelectorAll('article.hotel-unit')].find(c=>cardKey(c)===key)||null}

  function activateSelectedCard(){
    const cards=[...document.querySelectorAll('article.hotel-unit')];
    if(!selectedCardKey){cards.forEach(c=>c.classList.remove('v39-card-locked'));return}
    cards.forEach(c=>c.classList.toggle('v39-card-locked',cardKey(c)!==selectedCardKey));
    const selected=findCard(selectedCardKey);if(!selected)return;
    const btn=selected.querySelector('.v39-card-edit-btn');if(btn)btn.textContent='🔒 Finalizar edición';
    const open=selected.querySelector('.hotel-unit-edit');
    if(open&&!selected.querySelector('.hotel-edit-panel:not(.hidden)')&&open.dataset.v39AutoOpened!=='1'){
      open.dataset.v39AutoOpened='1';setTimeout(()=>open.click(),40);
    }
  }

  function toggleCardEdit(card){
    if(!canEdit)return;
    const key=cardKey(card);if(!key)return;
    if(selectedCardKey===key){
      selectedCardKey='';setReadMode(true);setTimeout(refresh,120);return;
    }
    selectedCardKey=key;
    const read=document.querySelector('#hotel-read-mode');
    if(read?.checked){setReadMode(false);setTimeout(()=>{refresh();activateSelectedCard()},160)}
    else{refresh();activateSelectedCard()}
  }

  function decorateCards(){
    document.querySelectorAll('article.hotel-unit').forEach(card=>{
      archiveAnnulledStages(card);
      if(!canEdit)return;
      let btn=card.querySelector(':scope > .v39-card-edit-btn');
      if(!btn){
        btn=document.createElement('button');btn.type='button';btn.className='btn btn-secondary v39-card-edit-btn';
        btn.textContent='✏️ Editar todo';
        btn.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();toggleCardEdit(card)});
        const title=card.querySelector(':scope > .hotel-title');
        if(title)title.insertAdjacentElement('afterend',btn);else card.prepend(btn);
      }
      btn.textContent=selectedCardKey===cardKey(card)?'🔒 Finalizar edición':'✏️ Editar todo';
    });
    activateSelectedCard();
  }

  function refresh(){
    applyFold('#hotel-programmed-tasks','metrogestion_v39_t_programadas_plegado_v2');
    applyFold('#hotel-v39-reserves','metrogestion_v39_reservas_plegado_v2');
    decoratePendingReserves();decorateCards();
  }
  function schedule(){clearTimeout(timer);timer=setTimeout(refresh,70)}

  async function initPerm(){
    try{const {data,error}=await sb.rpc('puede_editar_hotel');if(!error)canEdit=data===true}catch{}
    refresh();
  }

  style();initPerm();
  const ob=new MutationObserver(schedule);ob.observe(document.documentElement,{childList:true,subtree:true});
  window.addEventListener('focus',schedule);schedule();
})();
