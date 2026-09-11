import { supabase } from '../../r1-alpha17/src/supabase.js';

const nav = document.querySelector('#module-nav');
const content = document.querySelector('#module-content');
let profilePromise = null;
let historyLoadRunning = false;
let historyTimer = null;
let interactiveLoadRunning = false;
let interactiveTimer = null;

function clean(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function localDateKey(value = new Date()) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function normaliseReserveDraft(draft, userId = null) {
  const pending = clean(draft.pendientes).toLocaleUpperCase('es-ES');
  return {
    vehiculo_codigo: clean(draft.vehiculo_codigo).toLocaleUpperCase('es-ES').replace(/\s+/g, ''),
    matricula: clean(draft.matricula).toLocaleUpperCase('es-ES').replace(/\s+/g, ''),
    etiqueta: clean(draft.etiqueta).toLocaleUpperCase('es-ES'),
    ubicacion: clean(draft.ubicacion),
    pendientes: pending,
    estado: pending ? 'disponible_con_pendientes' : 'libre',
    activo: true,
    fecha_alta: localDateKey(),
    fecha_baja: null,
    creado_por: userId,
    modificado_por: userId,
  };
}

async function currentProfile() {
  if (profilePromise) return profilePromise;
  profilePromise = (async () => {
    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError || !authData?.user?.id) return null;
    const { data, error } = await supabase
      .from('usuarios')
      .select('id,tipo_usuario,permisos,activo')
      .eq('id', authData.user.id)
      .maybeSingle();
    if (error) throw error;
    return data || null;
  })();
  return profilePromise;
}

function canCreateReserve(profile) {
  if (profile?.activo !== true) return false;
  if (profile.tipo_usuario === 'administrador_principal') return true;
  return profile.permisos?.reservas?.editar === true || profile.permisos?.hotel?.editar === true;
}

function field(labelText, { name, required = false, placeholder = '', value = '', multiline = false } = {}) {
  const label = document.createElement('label');
  label.className = 'a70-reserve-field';
  const caption = document.createElement('span');
  caption.textContent = `${labelText}${required ? ' *' : ''}`;
  const input = document.createElement(multiline ? 'textarea' : 'input');
  input.name = name;
  input.required = required;
  input.placeholder = placeholder;
  input.value = value;
  if (name === 'vehiculo_codigo' || name === 'matricula') {
    input.autocapitalize = 'characters';
    input.spellcheck = false;
  }
  label.append(caption, input);
  return label;
}

function closeModal(overlay) {
  overlay.remove();
  document.body.classList.remove('a70-reserve-modal-open');
}

function reloadReservations() {
  const button = nav?.querySelector('[data-module="reservas"]');
  if (button) button.click();
}

function friendlyError(error) {
  if (error?.code === '23505') return 'Ya existe una reserva con ese código.';
  if (error?.code === '42501') return 'Tu usuario o dispositivo no tiene permiso para modificar reservas.';
  return error?.message || 'No se pudo guardar la reserva.';
}

export function splitReservePending(value) {
  return String(value ?? '')
    .split(/\s*[+,;|\n]+\s*/)
    .map(clean)
    .filter(Boolean);
}

function editDraftFromForm(form) {
  const values = Object.fromEntries(new FormData(form));
  return {
    matricula: clean(values.matricula).toLocaleUpperCase('es-ES').replace(/\s+/g, ''),
    etiqueta: clean(values.etiqueta).toLocaleUpperCase('es-ES'),
    ubicacion: clean(values.ubicacion),
    pendientes: splitReservePending(values.pendientes).join(' + '),
  };
}

async function saveInteractiveReserve(row, draft, profile) {
  const { data, error } = await supabase
    .from('reservas_hotel')
    .update({ ...draft, modificado_por: profile.id })
    .eq('id', row.id)
    .eq('version', row.version)
    .select('id,version')
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('La ficha ha cambiado desde que la abriste. Recarga Reservas antes de volver a guardar.');
  return data;
}

function setFormDisabled(form, disabled) {
  form.querySelectorAll('input,textarea,button').forEach(node => { node.disabled = disabled; });
}

function openEditModal(row, profile) {
  const overlay = document.createElement('div');
  overlay.className = 'a70-reserve-modal';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-labelledby', 'a75-reserve-edit-title');

  const card = document.createElement('section');
  card.className = 'a70-reserve-modal-card';
  const heading = document.createElement('div');
  heading.className = 'a70-reserve-modal-head';
  const copy = document.createElement('div');
  const eyebrow = document.createElement('p');
  eyebrow.className = 'eyebrow';
  eyebrow.textContent = 'Ficha interactiva de Reserva';
  const title = document.createElement('h2');
  title.id = 'a75-reserve-edit-title';
  title.textContent = `${row.vehiculo_codigo} · ${row.matricula}`;
  copy.append(eyebrow, title);
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'button secondary compact';
  close.textContent = 'Cerrar';
  close.addEventListener('click', () => closeModal(overlay));
  heading.append(copy, close);

  const identity = document.createElement('p');
  identity.className = 'muted a75-reserve-edit-note';
  identity.textContent = `Código ${row.vehiculo_codigo} protegido como identidad. El estado se recalcula automáticamente según pendientes y ocupación.`;

  const form = document.createElement('form');
  form.className = 'a70-reserve-form';
  form.append(
    field('Matrícula', { name: 'matricula', required: true, value: row.matricula }),
    field('Característica PISSARRA', { name: 'etiqueta', value: row.etiqueta }),
    field('Ubicación', { name: 'ubicacion', value: row.ubicacion }),
    field('Pendientes activos', { name: 'pendientes', value: row.pendientes, multiline: true })
  );
  form.lastElementChild.classList.add('wide');

  const pendingBox = document.createElement('section');
  pendingBox.className = 'a75-pending-box wide';
  const pendingTitle = document.createElement('strong');
  pendingTitle.textContent = 'Dar pendientes por realizados';
  const pendingHelp = document.createElement('p');
  pendingHelp.className = 'muted';
  pendingHelp.textContent = 'Cada botón retira únicamente ese pendiente y guarda la ficha.';
  const pendingList = document.createElement('div');
  pendingList.className = 'a75-pending-list';
  pendingBox.append(pendingTitle, pendingHelp, pendingList);
  form.append(pendingBox);

  const status = document.createElement('p');
  status.className = 'status-message a70-reserve-status wide';
  const actions = document.createElement('div');
  actions.className = 'a70-reserve-modal-actions wide';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'button secondary';
  cancel.textContent = 'Cancelar';
  cancel.addEventListener('click', () => closeModal(overlay));
  const save = document.createElement('button');
  save.type = 'submit';
  save.className = 'button primary';
  save.textContent = 'Guardar cambios';
  actions.append(cancel, save);
  form.append(status, actions);

  const finishSave = async (draft, successText) => {
    setFormDisabled(form, true);
    status.textContent = 'Guardando…';
    try {
      await saveInteractiveReserve(row, draft, profile);
      status.classList.add('success');
      status.textContent = successText;
      window.setTimeout(() => {
        closeModal(overlay);
        reloadReservations();
      }, 450);
    } catch (error) {
      status.textContent = friendlyError(error);
      setFormDisabled(form, false);
    }
  };

  const renderPendingButtons = () => {
    pendingList.replaceChildren();
    const tokens = splitReservePending(form.elements.pendientes.value);
    if (!tokens.length) {
      const empty = document.createElement('span');
      empty.className = 'muted';
      empty.textContent = 'No hay pendientes activos.';
      pendingList.append(empty);
      return;
    }
    tokens.forEach((token, index) => {
      const item = document.createElement('div');
      item.className = 'a75-pending-item';
      const label = document.createElement('span');
      label.textContent = token;
      const done = document.createElement('button');
      done.type = 'button';
      done.className = 'button secondary compact';
      done.textContent = '✓ Dar por realizado';
      done.addEventListener('click', () => {
        if (!window.confirm(`¿Dar por realizado el pendiente “${token}” de ${row.vehiculo_codigo}?`)) return;
        const draft = editDraftFromForm(form);
        const current = splitReservePending(draft.pendientes);
        draft.pendientes = current.filter((_, currentIndex) => currentIndex !== index).join(' + ');
        finishSave(draft, `✓ Pendiente “${token}” realizado.`);
      });
      item.append(label, done);
      pendingList.append(item);
    });
  };

  form.elements.pendientes.addEventListener('input', renderPendingButtons);
  form.addEventListener('submit', event => {
    event.preventDefault();
    const draft = editDraftFromForm(form);
    if (!draft.matricula) {
      status.textContent = 'Indica la matrícula.';
      return;
    }
    finishSave(draft, '✓ Ficha de reserva actualizada.');
  });
  renderPendingButtons();

  card.append(heading, identity, form);
  overlay.append(card);
  overlay.addEventListener('click', event => {
    if (event.target === overlay) closeModal(overlay);
  });
  document.body.append(overlay);
  document.body.classList.add('a70-reserve-modal-open');
  form.elements.matricula?.focus();
}

async function openCreateModal(profile) {
  const overlay = document.createElement('div');
  overlay.className = 'a70-reserve-modal';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-labelledby', 'a70-reserve-modal-title');

  const card = document.createElement('section');
  card.className = 'a70-reserve-modal-card';
  const heading = document.createElement('div');
  heading.className = 'a70-reserve-modal-head';
  const copy = document.createElement('div');
  const eyebrow = document.createElement('p');
  eyebrow.className = 'eyebrow';
  eyebrow.textContent = 'Catálogo de reservas';
  const title = document.createElement('h2');
  title.id = 'a70-reserve-modal-title';
  title.textContent = 'Crear nueva reserva';
  copy.append(eyebrow, title);
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'button secondary compact';
  close.textContent = 'Cerrar';
  close.addEventListener('click', () => closeModal(overlay));
  heading.append(copy, close);

  const explanation = document.createElement('p');
  explanation.className = 'muted';
  explanation.textContent = 'La reserva se crea en alta. El estado real se recalcula automáticamente según sus pendientes y su uso en el Hotel.';

  const form = document.createElement('form');
  form.className = 'a70-reserve-form';
  form.append(
    field('Código de la reserva', { name: 'vehiculo_codigo', required: true, placeholder: 'Ej. 2750 o R1600' }),
    field('Matrícula', { name: 'matricula', required: true, placeholder: 'Ej. 1234ABC' }),
    field('Característica PISSARRA', { name: 'etiqueta', placeholder: 'Ej. IVECO, 33/SD…' }),
    field('Ubicación', { name: 'ubicacion', placeholder: 'Ubicación actual' }),
    field('Pendientes propios', { name: 'pendientes', placeholder: 'Trabajos o restricciones pendientes', multiline: true })
  );
  form.lastElementChild.classList.add('wide');

  const status = document.createElement('p');
  status.className = 'status-message a70-reserve-status wide';
  const actions = document.createElement('div');
  actions.className = 'a70-reserve-modal-actions wide';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'button secondary';
  cancel.textContent = 'Cancelar';
  cancel.addEventListener('click', () => closeModal(overlay));
  const save = document.createElement('button');
  save.type = 'submit';
  save.className = 'button primary';
  save.textContent = 'Crear reserva';
  actions.append(cancel, save);
  form.append(status, actions);

  form.addEventListener('submit', async event => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(form));
    const payload = normaliseReserveDraft(values, profile.id);
    if (!payload.vehiculo_codigo || !payload.matricula) {
      status.textContent = 'Indica el código y la matrícula.';
      return;
    }
    save.disabled = true;
    status.textContent = 'Creando reserva…';
    const { error } = await supabase.from('reservas_hotel').insert(payload);
    if (error) {
      status.textContent = friendlyError(error);
      save.disabled = false;
      return;
    }
    status.classList.add('success');
    status.textContent = 'Reserva creada correctamente.';
    window.setTimeout(() => {
      closeModal(overlay);
      reloadReservations();
    }, 500);
  });

  card.append(heading, explanation, form);
  overlay.append(card);
  overlay.addEventListener('click', event => {
    if (event.target === overlay) closeModal(overlay);
  });
  const onKeyDown = event => {
    if (event.key !== 'Escape' || !overlay.isConnected) return;
    closeModal(overlay);
    document.removeEventListener('keydown', onKeyDown);
  };
  document.addEventListener('keydown', onKeyDown);
  document.body.append(overlay);
  document.body.classList.add('a70-reserve-modal-open');
  form.elements.vehiculo_codigo?.focus();
}

async function ensureCreateButton() {
  const headingTitle = [...(content?.querySelectorAll('.module-heading h2') || [])]
    .find(node => clean(node.textContent).toLocaleLowerCase('es-ES') === 'reservas fijas');
  const heading = headingTitle?.closest('.module-heading');
  if (!heading || heading.dataset.a70ReserveCreate === '1') return;
  try {
    const profile = await currentProfile();
    if (!canCreateReserve(profile) || !heading.isConnected) return;
    headingTitle.textContent = 'Reservas';
    const subtitle = heading.querySelector('.muted');
    if (subtitle) subtitle.textContent = 'Catálogo operativo de reservas del Hotel. Puedes crear nuevas reservas y gestionar sus altas y bajas.';
    const badge = heading.querySelector('.badge');
    const actions = document.createElement('div');
    actions.className = 'a70-reserve-heading-actions';
    if (badge) actions.append(badge);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'button primary compact';
    button.textContent = '+ Crear nueva reserva';
    button.addEventListener('click', () => openCreateModal(profile));
    actions.append(button);
    heading.append(actions);
    heading.dataset.a70ReserveCreate = '1';
  } catch (error) {
    console.warn('No se pudo habilitar la creación de reservas.', error);
  }
}

function reserveCodeFromCard(card) {
  return clean(card.querySelector('h3')?.textContent).split(' · ')[0]
    .toLocaleUpperCase('es-ES');
}

function formatResolvedDate(value) {
  if (!value) return 'Fecha no registrada';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return clean(value);
  return new Intl.DateTimeFormat('es-ES', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date);
}

function appendResolvedHistory(card, rows) {
  card.dataset.a72ResolvedHistory = '1';
  if (!rows.length) return;

  const details = document.createElement('details');
  details.className = 'a72-resolved-history';
  const summary = document.createElement('summary');
  summary.textContent = `Pendientes resueltos · ${rows.length}`;
  const list = document.createElement('div');
  list.className = 'a72-resolved-history-list';

  rows.forEach(row => {
    const item = document.createElement('div');
    item.className = 'a72-resolved-history-item';
    const title = document.createElement('strong');
    title.textContent = row.pendiente_texto || row.pendiente_codigo || 'Pendiente';
    const trace = document.createElement('span');
    const stage = `${row.etapa_posicion || '—'}T · ${clean(row.etapa_nombre) || 'T realizada'}`;
    const stop = row.numero_parada ? ` · actuación ${row.numero_parada}` : '';
    trace.textContent = `${stage}${stop} · ${formatResolvedDate(row.resuelto_en)}`;
    item.append(title, trace);
    list.append(item);
  });

  const note = document.createElement('p');
  note.className = 'muted a72-resolved-history-note';
  note.textContent = 'Conservado en el histórico; no se puede borrar.';
  details.append(summary, list, note);
  card.append(details);
}

async function ensureResolvedHistory() {
  if (historyLoadRunning || !content) return;
  const cards = [...content.querySelectorAll('.reserve-card')]
    .filter(card => card.dataset.a72ResolvedHistory !== '1');
  if (!cards.length) return;

  const pairs = cards
    .map(card => ({ card, code: reserveCodeFromCard(card) }))
    .filter(item => item.code);
  if (!pairs.length) return;

  historyLoadRunning = true;
  try {
    const codes = [...new Set(pairs.map(item => item.code))];
    const { data, error } = await supabase
      .from('reservas_pendientes_resueltos')
      .select('reserva_codigo,pendiente_codigo,pendiente_texto,numero_parada,etapa_posicion,etapa_nombre,resuelto_en,origen')
      .in('reserva_codigo', codes)
      .order('resuelto_en', { ascending: false });
    if (error) throw error;

    const byCode = new Map();
    (data || []).forEach(row => {
      const code = clean(row.reserva_codigo).toLocaleUpperCase('es-ES');
      if (!byCode.has(code)) byCode.set(code, []);
      byCode.get(code).push(row);
    });
    pairs.forEach(({ card, code }) => {
      if (card.isConnected) appendResolvedHistory(card, byCode.get(code) || []);
    });
  } catch (error) {
    console.warn('No se pudo cargar el histórico de pendientes resueltos.', error);
  } finally {
    historyLoadRunning = false;
  }
}

async function ensureInteractiveReserveCards() {
  if (interactiveLoadRunning || !content) return;
  const cards = [...content.querySelectorAll('.reserve-card')]
    .filter(card => !card.dataset.a75InteractiveReserve);
  if (!cards.length) return;

  cards.forEach(card => { card.dataset.a75InteractiveReserve = 'loading'; });
  interactiveLoadRunning = true;
  try {
    const profile = await currentProfile();
    if (!canCreateReserve(profile)) {
      cards.forEach(card => { card.dataset.a75InteractiveReserve = 'readonly'; });
      return;
    }

    const pairs = cards
      .map(card => ({ card, code: reserveCodeFromCard(card) }))
      .filter(item => item.code);
    if (!pairs.length) return;

    const codes = [...new Set(pairs.map(item => item.code))];
    const { data, error } = await supabase
      .from('reservas_hotel')
      .select('id,vehiculo_codigo,matricula,etiqueta,estado,ubicacion,pendientes,activo,version')
      .in('vehiculo_codigo', codes);
    if (error) throw error;

    const byCode = new Map((data || []).map(row => [
      clean(row.vehiculo_codigo).toLocaleUpperCase('es-ES'),
      row,
    ]));
    pairs.forEach(({ card, code }) => {
      const row = byCode.get(code);
      if (!row || !card.isConnected) {
        card.dataset.a75InteractiveReserve = 'missing';
        return;
      }
      let actions = card.querySelector('.reserve-actions');
      if (!actions) {
        actions = document.createElement('div');
        actions.className = 'reserve-actions';
        card.append(actions);
      }
      const edit = document.createElement('button');
      edit.type = 'button';
      edit.className = 'button primary compact a75-edit-reserve';
      edit.textContent = '✏ Modificar ficha';
      edit.addEventListener('click', () => openEditModal(row, profile));
      actions.prepend(edit);
      card.dataset.a75InteractiveReserve = '1';
    });
  } catch (error) {
    cards.forEach(card => { card.dataset.a75InteractiveReserve = 'error'; });
    console.warn('No se pudo habilitar la edición interactiva de Reservas.', error);
  } finally {
    interactiveLoadRunning = false;
  }
}

function scheduleReservationEnhancements() {
  ensureCreateButton();
  window.clearTimeout(historyTimer);
  historyTimer = window.setTimeout(ensureResolvedHistory, 0);
  window.clearTimeout(interactiveTimer);
  interactiveTimer = window.setTimeout(ensureInteractiveReserveCards, 0);
}

function ensureStyle() {
  if (document.querySelector('#alpha70-reservas-create-style')) return;
  const style = document.createElement('style');
  style.id = 'alpha70-reservas-create-style';
  style.textContent = `
    .a70-reserve-heading-actions{display:flex;align-items:center;justify-content:flex-end;gap:8px;flex-wrap:wrap}
    .a70-reserve-modal{position:fixed;inset:0;z-index:1500;display:grid;place-items:center;padding:18px;background:rgba(15,23,42,.56)}
    .a70-reserve-modal-card{width:min(760px,100%);max-height:92vh;overflow:auto;padding:18px;border-radius:16px;background:#fff;box-shadow:0 24px 70px rgba(15,23,42,.28)}
    .a70-reserve-modal-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.a70-reserve-modal-head h2{margin:.1rem 0}
    .a70-reserve-form{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-top:14px}
    .a70-reserve-field{display:grid;gap:5px;font-weight:700}.a70-reserve-field input,.a70-reserve-field textarea{width:100%;box-sizing:border-box;min-height:44px;padding:9px 10px;border:1px solid #aebdca;border-radius:10px;background:#fff;font:inherit}.a70-reserve-field textarea{min-height:92px;resize:vertical}
    .a70-reserve-form .wide{grid-column:1/-1}.a70-reserve-modal-actions{display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap}.a70-reserve-status.success{color:#166534}
    .a72-resolved-history{margin-top:12px;border-top:1px solid #d8e1ea;padding-top:10px}.a72-resolved-history summary{cursor:pointer;font-weight:800;color:#174f78}.a72-resolved-history-list{display:grid;gap:8px;margin-top:10px}.a72-resolved-history-item{display:grid;gap:2px;padding:9px 10px;border-radius:10px;background:#f1f7fb}.a72-resolved-history-item span{font-size:.9rem;color:#526475}.a72-resolved-history-note{margin:8px 0 0;font-size:.85rem}
    .a75-reserve-edit-note{margin:8px 0 0}.a75-pending-box{display:grid;gap:7px;padding:12px;border:1px solid #b9c9d8;border-radius:12px;background:#f7fbfe}.a75-pending-box>p{margin:0}.a75-pending-list{display:grid;gap:8px}.a75-pending-item{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:9px 10px;border:1px solid #d8e1ea;border-radius:10px;background:#fff}.a75-pending-item>span{font-weight:750}.a75-edit-reserve{margin-right:auto}
    body.a70-reserve-modal-open{overflow:hidden}
    @media(max-width:620px){.a70-reserve-heading-actions,.a70-reserve-heading-actions .button{width:100%}.a70-reserve-form{grid-template-columns:1fr}.a70-reserve-form .wide{grid-column:auto}.a70-reserve-modal-actions .button{width:100%}.a75-pending-item{align-items:stretch;flex-direction:column}.a75-pending-item .button{width:100%}}
  `;
  document.head.append(style);
}

ensureStyle();

if (content) {
  new MutationObserver(scheduleReservationEnhancements).observe(content, { childList: true, subtree: true });
  scheduleReservationEnhancements();
}

supabase.auth.onAuthStateChange(event => {
  if (event === 'SIGNED_OUT' || event === 'SIGNED_IN' || event === 'USER_UPDATED') profilePromise = null;
});
