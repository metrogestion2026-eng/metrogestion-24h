import { supabase } from '../../r1-alpha17/src/supabase.js';

const appView = document.querySelector('#app-view');
const pendingView = document.querySelector('#pending-device-view');
const sessionActions = document.querySelector('.session-actions');
const logoutButton = document.querySelector('#logout-button');
const content = document.querySelector('#module-content');

let profileCache = null;
let profileLoadedAt = 0;
let syncQueued = false;
let forcedDialog = null;
let adminRenderSequence = 0;

function el(tag, text = null, className = '') {
  const node = document.createElement(tag);
  if (text !== null && text !== undefined) node.textContent = String(text);
  if (className) node.className = className;
  return node;
}

function ensureStyle() {
  if (document.querySelector('#alpha65-security-style')) return;
  const style = document.createElement('style');
  style.id = 'alpha65-security-style';
  style.textContent = `
    body.a65-dialog-open{overflow:hidden}.a65-overlay{position:fixed;inset:0;z-index:30000;display:grid;place-items:center;padding:18px;background:rgba(15,23,42,.66);backdrop-filter:blur(3px)}.a65-dialog{width:min(100%,620px);max-height:calc(100vh - 36px);overflow:auto;display:grid;gap:14px;padding:18px;border-radius:16px;background:#fff;box-shadow:0 24px 70px rgba(15,23,42,.35)}.a65-dialog-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}.a65-dialog-head h2{margin:.15rem 0}.a65-dialog-close{border:0;background:#eef2f7;border-radius:999px;width:38px;height:38px;font-size:1.25rem;cursor:pointer}.a65-form{display:grid;gap:12px}.a65-form label{display:grid;gap:5px;font-weight:750}.a65-form input,.a65-form select,.a65-form textarea{width:100%;box-sizing:border-box;min-height:44px;padding:9px 10px;border:1px solid #aebdca;border-radius:10px;background:#fff;font:inherit}.a65-password-row{display:grid;grid-template-columns:1fr auto;gap:8px}.a65-password-row button{min-width:92px}.a65-note{padding:11px 12px;border-left:4px solid #075985;border-radius:0 10px 10px 0;background:#eff6ff;color:#1e3a8a}.a65-note.warning{border-color:#f59e0b;background:#fffbeb;color:#92400e}.a65-status{padding:10px 11px;border-radius:10px;background:#f1f5f9;color:#334155}.a65-status.success{background:#f0fdf4;color:#166534}.a65-status.danger{background:#fff1f2;color:#991b1b}.a65-actions{display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap}.a65-admin-passwords{display:grid;gap:11px}.a65-password-user{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;align-items:center;padding:12px;border:1px solid #dbe5ec;border-radius:12px;background:#fff}.a65-password-user-copy{display:grid;gap:4px;min-width:0}.a65-password-user-copy strong,.a65-temporary-value{overflow-wrap:anywhere}.a65-password-meta{font-size:.86rem;color:#526273}.a65-temp-card{display:grid;gap:11px;padding:14px;border:2px solid #075985;border-radius:13px;background:#eff6ff}.a65-temporary-value{padding:12px;border:1px dashed #075985;border-radius:10px;background:#fff;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:1.2rem;font-weight:800;text-align:center;user-select:all}.a65-chip{display:inline-flex;align-items:center;width:max-content;min-height:27px;padding:3px 8px;border:1px solid #cbd5e1;border-radius:999px;background:#f8fafc;font-size:.78rem;font-weight:800}.a65-chip.warn{border-color:#fcd34d;background:#fffbeb;color:#92400e}.a65-chip.ok{border-color:#86efac;background:#dcfce7;color:#166534}@media(max-width:700px){.a65-password-user{grid-template-columns:1fr}.a65-password-user .button,.a65-actions .button{width:100%}.a65-password-row{grid-template-columns:1fr}.a65-password-row button{width:100%}}
  `;
  document.head.append(style);
}

function profileName(profile) {
  return [profile?.nombre, profile?.apellidos].filter(Boolean).join(' ').trim()
    || profile?.correo
    || 'Usuario';
}

function isPrimary(profile) {
  return profile?.activo === true && profile?.tipo_usuario === 'administrador_principal';
}

function dateTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' });
}

async function currentProfile(force = false) {
  if (!force && profileCache && Date.now() - profileLoadedAt < 5000) return profileCache;
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData?.user?.id) return null;
  const { data, error } = await supabase
    .from('usuarios')
    .select('id,nombre,apellidos,correo,tipo_usuario,activo,debe_cambiar_clave,clave_temporal_emitida_en,ultimo_cambio_clave_en')
    .eq('id', authData.user.id)
    .maybeSingle();
  if (error) throw error;
  profileCache = data || null;
  profileLoadedAt = Date.now();
  return profileCache;
}

async function invokePasswordManager(body) {
  const { data, error } = await supabase.functions.invoke('gestionar-claves-r1', { body });
  if (error) {
    let message = error.message || 'No se pudo completar la operación.';
    const response = error.context;
    if (response && typeof response.json === 'function') {
      try {
        const payload = await response.json();
        message = payload?.error || payload?.message || message;
      } catch {}
    }
    throw new Error(message);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

function createDialog(title, { locked = false } = {}) {
  const overlay = el('div', null, 'a65-overlay');
  const card = el('section', null, 'a65-dialog');
  const head = el('div', null, 'a65-dialog-head');
  const copy = el('div');
  copy.append(el('p', locked ? 'Cambio obligatorio' : 'Seguridad de la cuenta', 'eyebrow'), el('h2', title));
  head.append(copy);
  let closeButton = null;
  if (!locked) {
    closeButton = el('button', '×', 'a65-dialog-close');
    closeButton.type = 'button';
    closeButton.setAttribute('aria-label', 'Cerrar');
    head.append(closeButton);
  }
  card.append(head);
  overlay.append(card);
  document.body.append(overlay);
  document.body.classList.add('a65-dialog-open');

  let destroyed = false;
  const destroy = () => {
    if (destroyed || locked) return;
    destroyed = true;
    overlay.remove();
    if (!document.querySelector('.a65-overlay')) document.body.classList.remove('a65-dialog-open');
  };
  closeButton?.addEventListener('click', destroy);
  overlay.addEventListener('click', event => {
    if (!locked && event.target === overlay) destroy();
  });
  return { overlay, card, destroy, locked };
}

function passwordControl(labelText, autocomplete) {
  const label = el('label');
  const row = el('div', null, 'a65-password-row');
  const input = document.createElement('input');
  input.type = 'password';
  input.autocomplete = autocomplete;
  input.minLength = 8;
  input.maxLength = 72;
  const reveal = el('button', 'Mostrar', 'button secondary compact');
  reveal.type = 'button';
  reveal.addEventListener('click', () => {
    const showing = input.type === 'text';
    input.type = showing ? 'password' : 'text';
    reveal.textContent = showing ? 'Mostrar' : 'Ocultar';
  });
  row.append(input, reveal);
  label.append(el('span', labelText), row);
  return { label, input };
}

async function signOutAfterPasswordChange(status) {
  status.className = 'a65-status success';
  status.textContent = 'Contraseña cambiada correctamente. Cerrando las sesiones para entrar con la nueva contraseña…';
  await new Promise(resolve => setTimeout(resolve, 900));
  const { error } = await supabase.auth.signOut({ scope: 'global' });
  if (error) await supabase.auth.signOut({ scope: 'local' });
  window.location.reload();
}

function openPasswordDialog(profile, { forced = false } = {}) {
  if (forced && forcedDialog?.overlay?.isConnected) return forcedDialog;
  const dialog = createDialog(forced ? 'Cambia la contraseña temporal' : 'Cambiar mi contraseña', { locked: forced });
  if (forced) forcedDialog = dialog;

  const note = el(
    'div',
    forced
      ? 'El administrador te ha facilitado una contraseña temporal. Antes de consultar Metrogestión debes sustituirla por una contraseña propia.'
      : 'El cambio se aplica a tu cuenta completa. Al finalizar se cerrarán las sesiones abiertas y tendrás que entrar de nuevo.',
    `a65-note${forced ? ' warning' : ''}`
  );
  const form = el('form', null, 'a65-form');
  form.noValidate = true;
  const current = passwordControl(forced ? 'Contraseña temporal' : 'Contraseña actual', 'current-password');
  const next = passwordControl('Nueva contraseña', 'new-password');
  const confirm = passwordControl('Repite la nueva contraseña', 'new-password');
  const policy = el('div', 'Entre 8 y 72 caracteres, con al menos una letra y un número.', 'a65-note');
  const status = el('div', '', 'a65-status');
  status.hidden = true;
  const actions = el('div', null, 'a65-actions');
  if (!forced) {
    const cancel = el('button', 'Cancelar', 'button secondary');
    cancel.type = 'button';
    cancel.addEventListener('click', dialog.destroy);
    actions.append(cancel);
  }
  const save = el('button', forced ? 'Cambiar y continuar' : 'Guardar nueva contraseña', 'button primary');
  save.type = 'submit';
  actions.append(save);
  form.append(current.label, next.label, confirm.label, policy, status, actions);
  dialog.card.append(note, form);

  form.addEventListener('submit', async event => {
    event.preventDefault();
    status.hidden = false;
    status.className = 'a65-status';
    const currentValue = current.input.value;
    const nextValue = next.input.value;
    if (!currentValue) {
      status.className = 'a65-status danger';
      status.textContent = forced ? 'Introduce la contraseña temporal.' : 'Introduce la contraseña actual.';
      current.input.focus();
      return;
    }
    if (nextValue.length < 8 || nextValue.length > 72 || !/[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/.test(nextValue) || !/\d/.test(nextValue)) {
      status.className = 'a65-status danger';
      status.textContent = 'La nueva contraseña debe tener entre 8 y 72 caracteres, al menos una letra y un número.';
      next.input.focus();
      return;
    }
    if (nextValue !== confirm.input.value) {
      status.className = 'a65-status danger';
      status.textContent = 'Las dos contraseñas nuevas no coinciden.';
      confirm.input.focus();
      return;
    }
    if (nextValue === currentValue) {
      status.className = 'a65-status danger';
      status.textContent = 'La nueva contraseña debe ser distinta de la actual.';
      next.input.focus();
      return;
    }

    save.disabled = true;
    status.textContent = 'Actualizando la contraseña segura…';
    try {
      await invokePasswordManager({
        accion: 'cambiar_clave_propia',
        claveActual: currentValue,
        claveNueva: nextValue,
      });
      profileCache = null;
      await signOutAfterPasswordChange(status);
    } catch (error) {
      save.disabled = false;
      status.className = 'a65-status danger';
      status.textContent = error?.message || 'No se pudo cambiar la contraseña.';
    }
  });

  queueMicrotask(() => current.input.focus());
  return dialog;
}

async function copyText(value) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const field = document.createElement('textarea');
  field.value = value;
  field.setAttribute('readonly', '');
  field.style.position = 'fixed';
  field.style.opacity = '0';
  document.body.append(field);
  field.select();
  const copied = document.execCommand('copy');
  field.remove();
  if (!copied) throw new Error('No se pudo copiar automáticamente.');
}

function showTemporaryPassword(result) {
  const dialog = createDialog('Contraseña temporal creada');
  const card = el('div', null, 'a65-temp-card');
  card.append(
    el('strong', result.usuario || result.correo || 'Usuario'),
    el('div', result.correo || '', 'a65-password-meta'),
    el('div', result.clave_temporal, 'a65-temporary-value'),
    el('div', 'Se muestra una sola vez. El usuario deberá cambiarla al entrar y no podrá consultar la aplicación hasta hacerlo.', 'a65-note warning')
  );
  const status = el('div', '', 'a65-status');
  status.hidden = true;
  const actions = el('div', null, 'a65-actions');
  const copyPassword = el('button', 'Copiar contraseña', 'button primary');
  const copyMessage = el('button', 'Copiar mensaje para enviar', 'button secondary');
  const close = el('button', 'Cerrar', 'button secondary');
  [copyPassword, copyMessage, close].forEach(button => { button.type = 'button'; });
  copyPassword.addEventListener('click', async () => {
    try {
      await copyText(result.clave_temporal);
      status.hidden = false;
      status.className = 'a65-status success';
      status.textContent = 'Contraseña temporal copiada.';
    } catch (error) {
      status.hidden = false;
      status.className = 'a65-status danger';
      status.textContent = error.message;
    }
  });
  copyMessage.addEventListener('click', async () => {
    const link = new URL('../r1-alpha65/', window.location.href).href;
    const message = `Acceso temporal a Metrogestión\n\nEnlace: ${link}\nUsuario: ${result.correo}\nContraseña temporal: ${result.clave_temporal}\n\nAl entrar tendrás que crear una contraseña propia antes de continuar.`;
    try {
      await copyText(message);
      status.hidden = false;
      status.className = 'a65-status success';
      status.textContent = 'Mensaje completo copiado.';
    } catch (error) {
      status.hidden = false;
      status.className = 'a65-status danger';
      status.textContent = error.message;
    }
  });
  close.addEventListener('click', dialog.destroy);
  actions.append(copyPassword, copyMessage, close);
  dialog.card.append(card, status, actions);
}

function findUsersView() {
  const view = content?.querySelector('.a51-view');
  if (!view || view.querySelector('h2')?.textContent?.trim() !== 'Usuarios') return null;
  return view;
}

function findDeviceSection(view) {
  return [...view.querySelectorAll('.a51-section')].find(section => {
    const title = [...section.querySelectorAll('strong')].map(node => node.textContent?.trim());
    return title.includes('Dispositivos autorizados') || title.includes('Dispositivos solicitados');
  }) || null;
}

async function renderAdminPasswordSection(profile) {
  const view = findUsersView();
  if (!view || !isPrimary(profile) || view.querySelector('[data-alpha65-password-admin]')) return;
  const sequence = ++adminRenderSequence;
  const section = el('section', null, 'a51-section');
  section.dataset.alpha65PasswordAdmin = 'loading';
  const head = el('div', null, 'a51-section-head');
  const copy = el('div');
  copy.append(
    el('strong', 'Contraseñas y recuperación'),
    el('div', 'Genera una contraseña temporal cuando un usuario haya olvidado la suya. La anterior queda anulada y el cambio posterior es obligatorio.', 'muted')
  );
  const refresh = el('button', 'Actualizar', 'button secondary compact');
  refresh.type = 'button';
  head.append(copy, refresh);
  const status = el('div', 'Cargando cuentas…', 'a65-status');
  const list = el('div', null, 'a65-admin-passwords');
  section.append(head, status, list);
  const deviceSection = findDeviceSection(view);
  if (deviceSection) deviceSection.before(section);
  else view.append(section);

  refresh.addEventListener('click', () => {
    section.remove();
    renderAdminPasswordSection(profile);
  });

  try {
    const { data, error } = await supabase
      .from('usuarios')
      .select('id,nombre,apellidos,correo,tipo_usuario,activo,debe_cambiar_clave,clave_temporal_emitida_en,ultimo_cambio_clave_en')
      .neq('tipo_usuario', 'administrador_principal')
      .order('nombre', { ascending: true });
    if (error) throw error;
    if (sequence !== adminRenderSequence || !section.isConnected) return;

    const users = data || [];
    list.replaceChildren();
    if (!users.length) list.append(el('div', 'No hay usuarios registrados.', 'a51-empty'));

    users.forEach(user => {
      const row = el('article', null, 'a65-password-user');
      const userCopy = el('div', null, 'a65-password-user-copy');
      userCopy.append(el('strong', profileName(user)), el('div', user.correo || 'Sin correo', 'a65-password-meta'));
      const meta = [];
      if (!user.activo) meta.push('Cuenta bloqueada');
      if (user.debe_cambiar_clave) meta.push(`Cambio obligatorio desde ${dateTime(user.clave_temporal_emitida_en)}`);
      else if (user.ultimo_cambio_clave_en) meta.push(`Último cambio ${dateTime(user.ultimo_cambio_clave_en)}`);
      if (meta.length) userCopy.append(el('div', meta.join(' · '), 'a65-password-meta'));
      if (user.debe_cambiar_clave) userCopy.append(el('span', 'Contraseña temporal pendiente', 'a65-chip warn'));
      else userCopy.append(el('span', 'Contraseña propia', 'a65-chip ok'));

      const button = el(
        'button',
        user.debe_cambiar_clave ? 'Sustituir contraseña temporal' : 'Crear contraseña temporal',
        'button primary compact'
      );
      button.type = 'button';
      button.addEventListener('click', async () => {
        const question = user.debe_cambiar_clave
          ? `¿Sustituir la contraseña temporal pendiente de ${profileName(user)}? La anterior dejará de funcionar.`
          : `¿Crear una contraseña temporal para ${profileName(user)}? Sus sesiones actuales quedarán bloqueadas.`;
        if (!window.confirm(question)) return;
        button.disabled = true;
        status.className = 'a65-status';
        status.textContent = 'Generando contraseña temporal segura…';
        try {
          const result = await invokePasswordManager({
            accion: 'crear_clave_temporal',
            usuarioId: user.id,
          });
          status.className = 'a65-status success';
          status.textContent = `Contraseña temporal creada para ${profileName(user)}.`;
          showTemporaryPassword(result);
          section.remove();
          await renderAdminPasswordSection(profile);
        } catch (error) {
          button.disabled = false;
          status.className = 'a65-status danger';
          status.textContent = error?.message || 'No se pudo crear la contraseña temporal.';
        }
      });
      row.append(userCopy, button);
      list.append(row);
    });

    status.className = 'a65-status success';
    status.textContent = `${users.length} cuenta${users.length === 1 ? '' : 's'} disponible${users.length === 1 ? '' : 's'} para recuperación.`;
    section.dataset.alpha65PasswordAdmin = 'ready';
  } catch (error) {
    if (!section.isConnected) return;
    status.className = 'a65-status danger';
    status.textContent = `No se pudieron cargar las cuentas: ${error?.message || 'error desconocido'}`;
    section.dataset.alpha65PasswordAdmin = 'error';
  }
}

function ensurePasswordButton(profile) {
  if (!sessionActions || !profile || appView?.classList.contains('hidden')) return;
  let button = document.querySelector('#alpha65-password-button');
  if (!button) {
    button = el('button', '🔑 Contraseña', 'button secondary compact');
    button.id = 'alpha65-password-button';
    button.type = 'button';
    button.title = 'Cambiar mi contraseña';
    button.addEventListener('click', () => openPasswordDialog(profileCache || profile));
    sessionActions.insertBefore(button, logoutButton || null);
  }
}

function removeForcedDialog() {
  if (!forcedDialog?.overlay?.isConnected) {
    forcedDialog = null;
    return;
  }
  forcedDialog.overlay.remove();
  forcedDialog = null;
  if (!document.querySelector('.a65-overlay')) document.body.classList.remove('a65-dialog-open');
}

async function syncSecurity() {
  syncQueued = false;
  try {
    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData?.session) {
      profileCache = null;
      document.querySelector('#alpha65-password-button')?.remove();
      removeForcedDialog();
      return;
    }

    const profile = await currentProfile(true);
    if (!profile) return;
    ensurePasswordButton(profile);

    if (profile.debe_cambiar_clave === true) {
      openPasswordDialog(profile, { forced: true });
    } else {
      removeForcedDialog();
    }

    if (isPrimary(profile)) await renderAdminPasswordSection(profile);
  } catch (error) {
    console.warn('No se pudo sincronizar la seguridad de cuenta de Alpha65.', error);
  }
}

function scheduleSync() {
  if (syncQueued) return;
  syncQueued = true;
  queueMicrotask(syncSecurity);
}

ensureStyle();
if (appView) new MutationObserver(scheduleSync).observe(appView, { attributes: true, attributeFilter: ['class'] });
if (pendingView) new MutationObserver(scheduleSync).observe(pendingView, { attributes: true, attributeFilter: ['class'] });
if (content) new MutationObserver(scheduleSync).observe(content, { childList: true, subtree: true });

supabase.auth.onAuthStateChange(() => {
  profileCache = null;
  profileLoadedAt = 0;
  scheduleSync();
});

scheduleSync();
