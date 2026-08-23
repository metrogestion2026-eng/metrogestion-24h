import '../../r1-alpha50/src/app.js';
import { supabase } from '../../r1-alpha17/src/supabase.js';

const VERSION = 'r1.0.0-alpha.51';
const versionNode = document.querySelector('#app-version');
if (versionNode) versionNode.textContent = VERSION;

const nav = document.querySelector('#module-nav');
const content = document.querySelector('#module-content');
const appView = document.querySelector('#app-view');

let cachedProfile = null;
let profileRequest = null;
let syncScheduled = false;
let renderSequence = 0;
let flashMessage = null;

function el(tag, text = null, className = '') {
  const node = document.createElement(tag);
  if (text !== null && text !== undefined) node.textContent = String(text);
  if (className) node.className = className;
  return node;
}

function ensureStyle() {
  if (document.querySelector('#alpha51-style')) return;
  const style = document.createElement('style');
  style.id = 'alpha51-style';
  style.textContent = `
    .a51-view{display:grid;gap:14px}.a51-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap}.a51-head h2{margin:.1rem 0 .35rem}.a51-status{padding:11px 12px;border-radius:10px;background:#f1f7fa;color:#334155}.a51-status.success{background:#f0fdf4;color:#166534}.a51-status.danger{background:#fff1f2;color:#991b1b}.a51-summary{display:grid;grid-template-columns:repeat(auto-fit,minmax(145px,1fr));gap:10px}.a51-metric{padding:12px;border:1px solid #dbe5ec;border-radius:12px;background:#fff}.a51-metric strong{display:block;font-size:1.35rem}.a51-section{display:grid;gap:12px;padding:14px;border:1px solid #dbe5ec;border-radius:14px;background:#fff}.a51-section-head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;flex-wrap:wrap}.a51-form{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.a51-form label{display:grid;gap:5px;font-weight:700}.a51-form input,.a51-form select{width:100%;box-sizing:border-box;min-height:43px;padding:8px 9px;border:1px solid #aebdca;border-radius:9px;background:#fff;font:inherit}.a51-form .wide{grid-column:1/-1}.a51-list{display:grid;gap:10px}.a51-user,.a51-device{display:grid;gap:10px;padding:12px;border:1px solid #dbe5ec;border-radius:12px;background:#fff}.a51-user.inactive{background:#f8fafc;opacity:.86}.a51-user-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap}.a51-user-title{display:grid;gap:3px}.a51-meta{color:#526273;font-size:.9rem;overflow-wrap:anywhere}.a51-chips{display:flex;gap:6px;flex-wrap:wrap}.a51-chip{display:inline-flex;align-items:center;min-height:28px;padding:3px 8px;border:1px solid #cbd5e1;border-radius:999px;background:#f8fafc;color:#475569;font-size:.78rem;font-weight:800}.a51-chip.ok{border-color:#86efac;background:#dcfce7;color:#166534}.a51-chip.warn{border-color:#fcd34d;background:#fffbeb;color:#92400e}.a51-chip.off{border-color:#fecaca;background:#fff1f2;color:#991b1b}.a51-actions{display:flex;gap:8px;flex-wrap:wrap}.a51-actions .button{min-height:40px}.a51-empty{padding:16px;border:1px dashed #cbd5e1;border-radius:12px;text-align:center;color:#64748b}.a51-security-note{padding:12px;border-left:4px solid #075985;border-radius:0 10px 10px 0;background:#eff6ff;color:#1e3a8a}.a51-device-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:8px}.a51-device-grid div{display:grid;gap:2px}.a51-device-grid span{font-size:.8rem;color:#64748b}.a51-password-note{font-size:.85rem;color:#526273}.a51-readonly{padding:12px;border:1px solid #bae6fd;border-radius:10px;background:#f0f9ff;color:#075985}@media(max-width:700px){.a51-form{grid-template-columns:1fr}.a51-form .wide{grid-column:auto}.a51-head .button,.a51-section-head .button,.a51-actions .button{width:100%}}
  `;
  document.head.append(style);
}
ensureStyle();

function isPrimaryAdmin(profile) {
  return profile?.activo === true && profile?.tipo_usuario === 'administrador_principal';
}

function hasUsersAccess(profile) {
  if (profile?.activo !== true) return false;
  if (isPrimaryAdmin(profile)) return true;
  const permission = profile?.permisos?.usuarios || {};
  return permission.ver === true || permission.leer === true || permission.editar === true;
}

function profileName(profile) {
  return [profile?.nombre, profile?.apellidos].filter(Boolean).join(' ').trim() || profile?.correo || 'Usuario';
}

function roleLabel(role) {
  return ({
    administrador_principal: 'Administrador principal',
    administrador_secundario: 'Administrador secundario',
    usuario: 'Usuario',
  })[role] || role || 'Usuario';
}

function dateTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' });
}

async function getCurrentProfile(force = false) {
  if (!force && cachedProfile) return cachedProfile;
  if (!force && profileRequest) return profileRequest;

  const request = (async () => {
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData?.user) return null;
    const { data, error } = await supabase
      .from('usuarios')
      .select('id,nombre,apellidos,correo,telefono,tipo_usuario,permisos,activo')
      .eq('id', userData.user.id)
      .maybeSingle();
    if (error) throw error;
    cachedProfile = data || null;
    return cachedProfile;
  })();

  profileRequest = request;
  try {
    return await request;
  } finally {
    if (profileRequest === request) profileRequest = null;
  }
}

function usersButton() {
  return nav?.querySelector('[data-alpha51-users]') || null;
}

function removeUsersButton() {
  usersButton()?.remove();
}

function setUsersButtonActive(button) {
  nav?.querySelectorAll('button').forEach(node => node.classList.toggle('active', node === button));
}

async function syncUsersTab() {
  syncScheduled = false;
  if (!nav || !appView || appView.classList.contains('hidden')) {
    removeUsersButton();
    return;
  }

  try {
    const profile = await getCurrentProfile();
    if (!hasUsersAccess(profile)) {
      removeUsersButton();
      return;
    }

    if (usersButton()) return;
    const button = el('button', '👥 Usuarios', 'button secondary');
    button.type = 'button';
    button.dataset.alpha51Users = '1';
    button.dataset.module = 'usuarios-alpha51';
    button.title = isPrimaryAdmin(profile)
      ? 'Administrar usuarios y autorizaciones'
      : 'Consultar usuarios · acceso autorizado por el administrador principal';
    button.addEventListener('click', async event => {
      event.preventDefault();
      try {
        const freshProfile = await getCurrentProfile(true);
        if (!hasUsersAccess(freshProfile)) {
          removeUsersButton();
          window.alert('Tu autorización para consultar Usuarios ya no está activa.');
          return;
        }
        setUsersButtonActive(button);
        await renderUsers(freshProfile);
      } catch (error) {
        window.alert('No se pudo abrir Usuarios: ' + (error?.message || 'error de conexión.'));
      }
    });
    nav.append(button);
  } catch {
    removeUsersButton();
  }
}

function scheduleSync() {
  if (syncScheduled) return;
  syncScheduled = true;
  queueMicrotask(syncUsersTab);
}

function statusNode(message = '', type = '') {
  const node = el('div', message, 'a51-status' + (type ? ' ' + type : ''));
  node.hidden = !message;
  return node;
}

function setStatus(node, message, type = '') {
  node.textContent = message || '';
  node.className = 'a51-status' + (type ? ' ' + type : '');
  node.hidden = !message;
}

async function invokeUserManager(body) {
  const { data, error } = await supabase.functions.invoke('gestionar-usuarios-r1', { body });
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

async function loadUsers() {
  const { data, error } = await supabase
    .from('usuarios')
    .select('id,nombre,apellidos,correo,telefono,tipo_usuario,permisos,activo,creado_en,actualizado_en')
    .order('nombre', { ascending: true });
  if (error) throw error;
  const priority = { administrador_principal: 0, administrador_secundario: 1, usuario: 2 };
  return (data || []).sort((a, b) => {
    const roleDifference = (priority[a.tipo_usuario] ?? 9) - (priority[b.tipo_usuario] ?? 9);
    return roleDifference || profileName(a).localeCompare(profileName(b), 'es');
  });
}

async function loadDevices() {
  const { data, error } = await supabase
    .from('dispositivos_usuario')
    .select('id,usuario_id,nombre,agente,estado,solicitado_en,autorizado_en,ultimo_acceso_en,observaciones,actualizado_en')
    .order('solicitado_en', { ascending: false });
  if (error) throw error;
  return data || [];
}

function userAccessLabel(user) {
  if (user.tipo_usuario === 'administrador_principal') return 'Acceso total permanente';
  return hasUsersAccess(user) ? 'Acceso autorizado a Usuarios' : 'Sin acceso a Usuarios';
}

function makeChip(text, type = '') {
  return el('span', text, 'a51-chip' + (type ? ' ' + type : ''));
}

function makeMetric(label, value) {
  const metric = el('div', null, 'a51-metric');
  metric.append(el('strong', value), el('span', label, 'muted'));
  return metric;
}

function renderCreateSection(profile, status) {
  const section = el('section', null, 'a51-section');
  const heading = el('div', null, 'a51-section-head');
  const copy = el('div');
  copy.append(
    el('strong', 'Crear usuario'),
    el('div', 'La cuenta se crea sin acceso a la pestaña Usuarios. Esa autorización se concede después y de forma expresa.', 'muted')
  );
  heading.append(copy);

  const form = el('form', null, 'a51-form');
  form.noValidate = true;

  const makeField = (labelText, input) => {
    const label = el('label');
    label.append(el('span', labelText), input);
    return label;
  };

  const name = document.createElement('input');
  name.type = 'text';
  name.autocomplete = 'name';
  name.placeholder = 'Nombre y apellidos';

  const phone = document.createElement('input');
  phone.type = 'tel';
  phone.inputMode = 'tel';
  phone.autocomplete = 'tel';
  phone.placeholder = 'Teléfono vinculado';

  const email = document.createElement('input');
  email.type = 'email';
  email.autocomplete = 'email';
  email.placeholder = 'correo@empresa.com';

  const password = document.createElement('input');
  password.type = 'password';
  password.autocomplete = 'new-password';
  password.minLength = 6;
  password.maxLength = 72;
  password.placeholder = 'Mínimo 6 caracteres';

  const role = document.createElement('select');
  role.append(
    new Option('Usuario', 'usuario'),
    new Option('Administrador secundario', 'administrador_secundario')
  );

  const nameLabel = makeField('Nombre y apellidos', name);
  nameLabel.className = 'wide';
  form.append(
    nameLabel,
    makeField('Teléfono', phone),
    makeField('Correo', email),
    makeField('Contraseña o PIN inicial', password),
    makeField('Tipo de cuenta', role)
  );

  const note = el('div', 'La contraseña se guarda únicamente en Supabase Auth y no se muestra en la aplicación.', 'a51-password-note wide');
  const submit = el('button', '+ Crear cuenta', 'button primary');
  submit.type = 'submit';
  submit.classList.add('wide');
  form.append(note, submit);

  form.addEventListener('submit', async event => {
    event.preventDefault();
    const fullName = name.value.trim();
    const phoneValue = phone.value.trim();
    const emailValue = email.value.trim().toLowerCase();
    const passwordValue = password.value;
    if (!fullName || phoneValue.replace(/\D/g, '').length < 9 || !emailValue || !email.validity.valid || passwordValue.length < 6) {
      setStatus(status, 'Completa nombre, teléfono, correo válido y una contraseña de al menos 6 caracteres.', 'danger');
      return;
    }

    submit.disabled = true;
    setStatus(status, 'Creando la cuenta segura…');
    try {
      await invokeUserManager({
        accion: 'crear_usuario',
        nombreCompleto: fullName,
        telefono: phoneValue,
        correo: emailValue,
        clave: passwordValue,
        rol: role.value,
      });
      flashMessage = { text: 'Cuenta creada correctamente. El dispositivo del nuevo usuario deberá ser autorizado cuando solicite acceso.', type: 'success' };
      await renderUsers(profile);
    } catch (error) {
      submit.disabled = false;
      setStatus(status, error?.message || 'No se pudo crear la cuenta.', 'danger');
    }
  });

  section.append(heading, form);
  return section;
}

function renderUserCard(user, profile, status) {
  const primary = isPrimaryAdmin(profile);
  const card = el('article', null, 'a51-user' + (user.activo ? '' : ' inactive'));
  const head = el('div', null, 'a51-user-head');
  const title = el('div', null, 'a51-user-title');
  title.append(
    el('strong', profileName(user)),
    el('div', [user.correo, user.telefono].filter(Boolean).join(' · ') || 'Sin datos de contacto', 'a51-meta')
  );

  const chips = el('div', null, 'a51-chips');
  chips.append(
    makeChip(roleLabel(user.tipo_usuario)),
    makeChip(user.activo ? 'Cuenta activa' : 'Cuenta bloqueada', user.activo ? 'ok' : 'off'),
    makeChip(userAccessLabel(user), hasUsersAccess(user) ? 'ok' : 'warn')
  );
  head.append(title, chips);
  card.append(head);

  const dates = el('div', 'Alta: ' + dateTime(user.creado_en) + ' · Último cambio: ' + dateTime(user.actualizado_en), 'a51-meta');
  card.append(dates);

  if (primary && user.tipo_usuario !== 'administrador_principal') {
    const actions = el('div', null, 'a51-actions');
    const currentlyAuthorized = hasUsersAccess(user);
    const permissionButton = el(
      'button',
      currentlyAuthorized ? 'Retirar acceso a Usuarios' : 'Autorizar pestaña Usuarios',
      'button ' + (currentlyAuthorized ? 'secondary' : 'primary')
    );
    permissionButton.type = 'button';
    permissionButton.addEventListener('click', async () => {
      if (currentlyAuthorized && !window.confirm('¿Retirar a ' + profileName(user) + ' el acceso a la pestaña Usuarios?')) return;
      actions.querySelectorAll('button').forEach(button => { button.disabled = true; });
      setStatus(status, 'Guardando la autorización de ' + profileName(user) + '…');
      try {
        await invokeUserManager({
          accion: 'establecer_acceso_usuarios',
          usuarioId: user.id,
          autorizado: !currentlyAuthorized,
        });
        flashMessage = {
          text: currentlyAuthorized
            ? 'Acceso a Usuarios retirado a ' + profileName(user) + '.'
            : 'Acceso a Usuarios autorizado para ' + profileName(user) + '.',
          type: 'success',
        };
        await renderUsers(profile);
      } catch (error) {
        actions.querySelectorAll('button').forEach(button => { button.disabled = false; });
        setStatus(status, error?.message || 'No se pudo cambiar la autorización.', 'danger');
      }
    });

    const activeButton = el(
      'button',
      user.activo ? 'Bloquear cuenta' : 'Reactivar cuenta',
      'button secondary'
    );
    activeButton.type = 'button';
    activeButton.addEventListener('click', async () => {
      const actionText = user.activo ? 'bloquear' : 'reactivar';
      if (!window.confirm('¿' + actionText.charAt(0).toUpperCase() + actionText.slice(1) + ' la cuenta de ' + profileName(user) + '?')) return;
      actions.querySelectorAll('button').forEach(button => { button.disabled = true; });
      setStatus(status, (user.activo ? 'Bloqueando' : 'Reactivando') + ' la cuenta…');
      try {
        await invokeUserManager({
          accion: 'establecer_activo',
          usuarioId: user.id,
          activo: !user.activo,
        });
        flashMessage = {
          text: 'Cuenta de ' + profileName(user) + (user.activo ? ' bloqueada.' : ' reactivada.'),
          type: 'success',
        };
        await renderUsers(profile);
      } catch (error) {
        actions.querySelectorAll('button').forEach(button => { button.disabled = false; });
        setStatus(status, error?.message || 'No se pudo cambiar el estado de la cuenta.', 'danger');
      }
    });

    actions.append(permissionButton, activeButton);
    card.append(actions);
  }

  return card;
}

function deviceStateLabel(state) {
  return ({
    autorizado: 'Autorizado',
    pendiente: 'Pendiente',
    bloqueado: 'Bloqueado',
    revocado: 'Revocado',
  })[state] || state || 'Desconocido';
}

function renderDeviceCard(device, userMap, profile, status) {
  const user = userMap.get(device.usuario_id);
  const card = el('article', null, 'a51-device');
  const head = el('div', null, 'a51-user-head');
  const title = el('div', null, 'a51-user-title');
  title.append(
    el('strong', (user ? profileName(user) : 'Usuario no localizado') + ' · ' + (device.nombre || 'Dispositivo')),
    el('div', user?.correo || device.usuario_id || '—', 'a51-meta')
  );
  const stateType = device.estado === 'autorizado' ? 'ok' : device.estado === 'pendiente' ? 'warn' : 'off';
  head.append(title, makeChip(deviceStateLabel(device.estado), stateType));

  const grid = el('div', null, 'a51-device-grid');
  const addDatum = (label, value) => {
    const box = el('div');
    box.append(el('span', label), el('strong', value || '—'));
    grid.append(box);
  };
  addDatum('Solicitud', dateTime(device.solicitado_en));
  addDatum('Autorización', dateTime(device.autorizado_en));
  addDatum('Último acceso', dateTime(device.ultimo_acceso_en));
  addDatum('Último cambio', dateTime(device.actualizado_en));
  if (device.observaciones) addDatum('Observaciones', device.observaciones);

  const actions = el('div', null, 'a51-actions');
  if (device.estado !== 'autorizado') {
    const approve = el('button', 'Autorizar este dispositivo', 'button primary');
    approve.type = 'button';
    approve.addEventListener('click', async () => {
      if (!window.confirm('¿Autorizar este dispositivo? Si el usuario tenía otro autorizado, quedará revocado.')) return;
      actions.querySelectorAll('button').forEach(button => { button.disabled = true; });
      setStatus(status, 'Autorizando dispositivo…');
      const { error } = await supabase.rpc('autorizar_dispositivo', {
        p_dispositivo_id: device.id,
        p_autorizar: true,
        p_observaciones: 'Autorizado desde Usuarios · Alpha51',
      });
      if (error) {
        actions.querySelectorAll('button').forEach(button => { button.disabled = false; });
        setStatus(status, 'No se pudo autorizar el dispositivo: ' + error.message, 'danger');
        return;
      }
      flashMessage = { text: 'Dispositivo autorizado correctamente.', type: 'success' };
      await renderUsers(profile);
    });
    actions.append(approve);
  }

  if (device.estado === 'autorizado' || device.estado === 'pendiente') {
    const block = el('button', device.estado === 'autorizado' ? 'Revocar dispositivo' : 'Rechazar solicitud', 'button secondary');
    block.type = 'button';
    block.addEventListener('click', async () => {
      const reason = window.prompt('Motivo obligatorio:');
      if (!reason?.trim()) return;
      actions.querySelectorAll('button').forEach(button => { button.disabled = true; });
      setStatus(status, 'Actualizando dispositivo…');
      const { error } = await supabase.rpc('autorizar_dispositivo', {
        p_dispositivo_id: device.id,
        p_autorizar: false,
        p_observaciones: reason.trim(),
      });
      if (error) {
        actions.querySelectorAll('button').forEach(button => { button.disabled = false; });
        setStatus(status, 'No se pudo actualizar el dispositivo: ' + error.message, 'danger');
        return;
      }
      flashMessage = { text: 'Estado del dispositivo actualizado.', type: 'success' };
      await renderUsers(profile);
    });
    actions.append(block);
  }

  card.append(head, grid);
  if (actions.childElementCount) card.append(actions);
  return card;
}

async function renderUsers(profile) {
  if (!content || !nav) return;
  const sequence = ++renderSequence;
  const primary = isPrimaryAdmin(profile);
  const view = el('section', null, 'a51-view');
  const head = el('div', null, 'a51-head');
  const copy = el('div');
  copy.append(
    el('p', 'Pestaña principal', 'eyebrow'),
    el('h2', 'Usuarios'),
    el(
      'div',
      primary
        ? 'Visible únicamente para el administrador principal y las personas autorizadas expresamente.'
        : 'Acceso de consulta autorizado por el administrador principal. No puedes crear, bloquear ni modificar permisos.',
      'muted'
    )
  );
  const refresh = el('button', 'Actualizar', 'button secondary compact');
  refresh.type = 'button';
  refresh.addEventListener('click', async () => {
    refresh.disabled = true;
    try {
      const fresh = await getCurrentProfile(true);
      if (!hasUsersAccess(fresh)) {
        removeUsersButton();
        window.alert('Tu autorización para Usuarios ya no está activa.');
        return;
      }
      await renderUsers(fresh);
    } catch (error) {
      refresh.disabled = false;
      setStatus(status, 'No se pudo actualizar Usuarios: ' + (error?.message || 'error de conexión.'), 'danger');
    }
  });
  head.append(copy, refresh);

  const status = statusNode('Cargando usuarios…');
  view.append(head, status);
  content.replaceChildren(view);

  try {
    const [users, devices] = await Promise.all([
      loadUsers(),
      primary ? loadDevices() : Promise.resolve([]),
    ]);
    if (sequence !== renderSequence || !usersButton()?.classList.contains('active')) return;

    const activeCount = users.filter(user => user.activo).length;
    const adminCount = users.filter(user => user.tipo_usuario !== 'usuario').length;
    const authorizedCount = users.filter(hasUsersAccess).length;
    const summary = el('div', null, 'a51-summary');
    summary.append(
      makeMetric('Cuentas totales', users.length),
      makeMetric('Cuentas activas', activeCount),
      makeMetric('Administradores', adminCount),
      makeMetric('Con acceso a Usuarios', authorizedCount)
    );
    view.append(summary);

    const securityNote = el(
      'div',
      'La pestaña no se muestra a quien no tenga permiso. Además, Supabase impide consultar la lista aunque alguien intente acceder fuera de la interfaz.',
      'a51-security-note'
    );
    view.append(securityNote);

    if (!primary) {
      view.append(el('div', 'Modo de solo lectura. Los cambios quedan reservados al administrador principal.', 'a51-readonly'));
    } else {
      view.append(renderCreateSection(profile, status));
    }

    const userSection = el('section', null, 'a51-section');
    const userHeading = el('div', null, 'a51-section-head');
    userHeading.append(el('div'));
    userHeading.firstElementChild.append(
      el('strong', 'Cuentas registradas'),
      el('div', primary ? 'Autoriza la pestaña Usuarios de forma individual.' : 'Consulta de cuentas autorizada.', 'muted')
    );
    const userList = el('div', null, 'a51-list');
    if (!users.length) {
      userList.append(el('div', 'No hay cuentas registradas.', 'a51-empty'));
    } else {
      users.forEach(user => userList.append(renderUserCard(user, profile, status)));
    }
    userSection.append(userHeading, userList);
    view.append(userSection);

    if (primary) {
      const deviceSection = el('section', null, 'a51-section');
      const deviceHeading = el('div', null, 'a51-section-head');
      const deviceCopy = el('div');
      deviceCopy.append(
        el('strong', 'Dispositivos solicitados'),
        el('div', 'Autoriza únicamente el dispositivo que reconozcas. Un usuario solo puede mantener un dispositivo autorizado.', 'muted')
      );
      deviceHeading.append(deviceCopy);
      const deviceList = el('div', null, 'a51-list');
      const userMap = new Map(users.map(user => [user.id, user]));
      if (!devices.length) {
        deviceList.append(el('div', 'Todavía no hay solicitudes de dispositivos.', 'a51-empty'));
      } else {
        devices.forEach(device => deviceList.append(renderDeviceCard(device, userMap, profile, status)));
      }
      deviceSection.append(deviceHeading, deviceList);
      view.append(deviceSection);
    }

    if (flashMessage) {
      setStatus(status, flashMessage.text, flashMessage.type);
      flashMessage = null;
    } else {
      setStatus(status, users.length + ' cuenta(s) cargada(s).', 'success');
    }
  } catch (error) {
    if (sequence !== renderSequence) return;
    setStatus(status, 'No se pudo cargar Usuarios: ' + (error?.message || 'error de conexión.'), 'danger');
  }
}

if (nav) {
  const navObserver = new MutationObserver(scheduleSync);
  navObserver.observe(nav, { childList: true });
  nav.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (button && !button.matches('[data-alpha51-users]')) renderSequence += 1;
  });
}

if (appView) {
  const appObserver = new MutationObserver(scheduleSync);
  appObserver.observe(appView, { attributes: true, attributeFilter: ['class'] });
}

supabase.auth.onAuthStateChange((event) => {
  cachedProfile = null;
  profileRequest = null;
  if (event === 'SIGNED_OUT') {
    removeUsersButton();
    renderSequence += 1;
  }
  scheduleSync();
});

scheduleSync();
