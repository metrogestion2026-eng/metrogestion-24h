import { supabase } from '../../r1-alpha17/src/supabase.js';

const nav = document.querySelector('#module-nav');
const content = document.querySelector('#module-content');
let profilePromise = null;

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
  if (error?.code === '42501') return 'Tu usuario o dispositivo no tiene permiso para crear reservas.';
  return error?.message || 'No se pudo crear la reserva.';
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
    body.a70-reserve-modal-open{overflow:hidden}
    @media(max-width:620px){.a70-reserve-heading-actions,.a70-reserve-heading-actions .button{width:100%}.a70-reserve-form{grid-template-columns:1fr}.a70-reserve-form .wide{grid-column:auto}.a70-reserve-modal-actions .button{width:100%}}
  `;
  document.head.append(style);
}

ensureStyle();

if (content) {
  new MutationObserver(ensureCreateButton).observe(content, { childList: true, subtree: true });
  ensureCreateButton();
}

supabase.auth.onAuthStateChange(event => {
  if (event === 'SIGNED_OUT' || event === 'SIGNED_IN' || event === 'USER_UPDATED') profilePromise = null;
});
