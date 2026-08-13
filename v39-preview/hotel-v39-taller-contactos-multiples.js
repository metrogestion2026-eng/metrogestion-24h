// v39 preview · ficha de taller con múltiples contactos, teléfonos y correos.
(() => {
  'use strict';
  if (window.__metrogestionV39WorkshopMultiContactsLoaded) return;
  window.__metrogestionV39WorkshopMultiContactsLoaded = true;

  const URL='https://njtohfkqjjoavtumtmza.supabase.co';
  const KEY='sb_publishable_w1a9DClOM0S4HVJdv_TbKg_W_UkN2W_';
  const sb=window.supabase?.createClient?.(URL,KEY); if(!sb)return;
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let workshops=[];

  const splitList=v=>String(v||'').split(/[;,\n]+/).map(x=>x.trim()).filter(Boolean);
  const uniq=a=>[...new Set(a.map(x=>String(x).trim()).filter(Boolean))];

  function style(){
    if(document.getElementById('v39-workshop-multi-css'))return;
    const s=document.createElement('style');s.id='v39-workshop-multi-css';s.textContent=`
      #v39-workshop-multi-modal{position:fixed;inset:0;z-index:8200;background:rgba(15,23,42,.7);padding:12px;overflow:auto}
      #v39-workshop-multi-sheet{max-width:860px;margin:2vh auto;background:#fff;border-radius:16px;padding:16px;box-shadow:0 20px 70px rgba(0,0,0,.4)}
      .v39-contact-row{border:2px solid #dbeafe;background:#f8fbff;border-radius:12px;padding:12px;display:grid;gap:9px}
      .v39-contact-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}
      .v39-contact-row textarea{min-height:72px}
      .v39-contact-toolbar{display:flex;justify-content:space-between;gap:8px;align-items:center;flex-wrap:wrap}
      .v39-contact-flags{display:flex;gap:14px;flex-wrap:wrap;align-items:center}
      @media(max-width:650px){.v39-contact-grid{grid-template-columns:1fr}}
    `;document.head.appendChild(s);
  }

  async function loadWorkshops(){
    const {data,error}=await sb.rpc('listar_talleres_v39');
    if(error)throw error;
    workshops=Array.isArray(data)?data:[];
    return workshops;
  }

  function contactCard(c={}){
    const phones=uniq([...(c.telefonos||[]),c.telefono||'']);
    const mails=uniq([...(c.correos||[]),c.correo||'']);
    const row=document.createElement('div');row.className='v39-contact-row';
    row.innerHTML=`
      <div class="v39-contact-toolbar"><strong>Contacto</strong><button type="button" class="btn btn-secondary v39-contact-remove">🗑 Quitar</button></div>
      <div class="v39-contact-grid">
        <label>Nombre / persona<input class="form-control v39-c-name" value="${esc(c.nombre||'')}"></label>
        <label>Cargo / área<input class="form-control v39-c-role" value="${esc(c.cargo||'')}"></label>
      </div>
      <label>📞 Teléfonos <span class="text-small text-muted">(pueden ser varios; sepáralos con coma o una línea)</span><textarea class="form-control v39-c-phones" placeholder="934 00 00 00\n600 000 000">${esc(phones.join('\n'))}</textarea></label>
      <label>✉️ Correos <span class="text-small text-muted">(pueden ser varios; sepáralos con coma o una línea)</span><textarea class="form-control v39-c-mails" placeholder="taller@empresa.com\nrecepcion@empresa.com">${esc(mails.join('\n'))}</textarea></label>
      <div class="v39-contact-flags">
        <label style="display:flex;grid-template-columns:auto 1fr;align-items:center;gap:7px"><input class="v39-c-main" type="checkbox" ${c.es_principal?'checked':''}> Contacto principal</label>
        <label style="display:flex;grid-template-columns:auto 1fr;align-items:center;gap:7px"><input class="v39-c-send" type="checkbox" ${c.usar_para_envios!==false?'checked':''}> Usar correos para envíos</label>
      </div>
      <label>Observaciones<input class="form-control v39-c-notes" value="${esc(c.observaciones||'')}"></label>`;
    row.querySelector('.v39-contact-remove').onclick=()=>row.remove();
    return row;
  }

  function readContacts(host){
    return [...host.querySelectorAll('.v39-contact-row')].map(row=>({
      nombre:row.querySelector('.v39-c-name').value.trim(),
      cargo:row.querySelector('.v39-c-role').value.trim(),
      telefonos:uniq(splitList(row.querySelector('.v39-c-phones').value)),
      correos:uniq(splitList(row.querySelector('.v39-c-mails').value).map(x=>x.toLowerCase())),
      es_principal:row.querySelector('.v39-c-main').checked,
      usar_para_envios:row.querySelector('.v39-c-send').checked,
      tipo:'general',
      observaciones:row.querySelector('.v39-c-notes').value.trim()
    })).filter(c=>c.nombre||c.telefonos.length||c.correos.length);
  }

  async function openEditor(id){
    try{
      await loadWorkshops();
      const item=id?workshops.find(x=>x.id===id):null;
      document.getElementById('v39-workshop-multi-modal')?.remove();
      const modal=document.createElement('div');modal.id='v39-workshop-multi-modal';
      modal.innerHTML=`<div id="v39-workshop-multi-sheet" class="stack">
        <div class="hotel-title"><div><strong style="font-size:21px">${item?'✏️ Editar taller':'➕ Nuevo taller'}</strong><div class="text-small text-muted">Ficha única del taller. Añade tantos contactos, teléfonos y correos como necesites.</div></div><button type="button" class="btn btn-secondary v39-wm-close">Cerrar</button></div>
        <div class="detail-grid">
          <label>Nombre del taller<input id="v39-wm-name" class="form-control" value="${esc(item?.nombre||'')}"></label>
          <label>Ubicación / población<input id="v39-wm-loc" class="form-control" value="${esc(item?.ubicacion||'')}"></label>
        </div>
        <div class="card stack" style="background:#f8fafc;border:2px solid #cbd5e1">
          <div class="hotel-title"><div><strong>👥 Contactos · teléfonos · correos</strong><div class="text-small text-muted">Cada contacto puede tener varios teléfonos y varios correos.</div></div><button id="v39-wm-add-contact" type="button" class="btn btn-secondary">+ Añadir contacto</button></div>
          <div id="v39-wm-contacts" class="stack"></div>
        </div>
        <button id="v39-wm-save" type="button" class="btn btn-primary">Guardar ficha completa</button>
        <div id="v39-wm-msg" class="text-small"></div>
      </div>`;
      document.body.appendChild(modal);
      const host=modal.querySelector('#v39-wm-contacts');
      const contacts=item?.contactos||[];
      if(contacts.length)contacts.filter(c=>c.activo!==false).forEach(c=>host.appendChild(contactCard(c)));
      else host.appendChild(contactCard({es_principal:true,usar_para_envios:true}));
      modal.querySelector('#v39-wm-add-contact').onclick=()=>host.appendChild(contactCard({usar_para_envios:true}));
      modal.querySelector('.v39-wm-close').onclick=()=>modal.remove();
      modal.onclick=e=>{if(e.target===modal)modal.remove()};
      modal.querySelector('#v39-wm-save').onclick=async()=>{
        const btn=modal.querySelector('#v39-wm-save'),msg=modal.querySelector('#v39-wm-msg');
        const name=modal.querySelector('#v39-wm-name').value.trim();
        if(!name){msg.textContent='Indica el nombre del taller.';return}
        const contactsPayload=readContacts(host);
        btn.disabled=true;msg.textContent='Guardando ficha y contactos…';
        const {data,error}=await sb.rpc('guardar_ficha_taller_v39',{p_taller_id:id||null,p_nombre:name,p_ubicacion:modal.querySelector('#v39-wm-loc').value.trim(),p_contactos:contactsPayload});
        if(error){msg.textContent='Error: '+error.message;btn.disabled=false;return}
        msg.textContent=`✓ Ficha guardada · ${contactsPayload.length} contacto(s).`;
        workshops=await loadWorkshops();
        setTimeout(()=>{
          modal.remove();
          const tab=document.querySelector('[data-v39-view="talleres"]');
          if(tab)tab.click();
          window.dispatchEvent(new Event('focus'));
        },450);
      };
    }catch(e){alert('No se pudo abrir la ficha del taller: '+(e?.message||'error'))}
  }

  document.addEventListener('click',e=>{
    const edit=e.target.closest('.v39-w-edit');
    const add=e.target.closest('#v39-new-workshop');
    if(!edit&&!add)return;
    e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();
    openEditor(edit?.dataset.id||null);
  },true);

  style();
})();