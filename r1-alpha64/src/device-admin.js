import { supabase } from '../../r1-alpha17/src/supabase.js';

const content = document.querySelector('#module-content');
const DEVICE_TYPES = Object.freeze([
  { id: 'movil', label: 'Móvil', icon: '📱' },
  { id: 'ordenador', label: 'Ordenador', icon: '💻' },
]);

let syncQueued = false;
let renderSequence = 0;

function el(tag, text = null, className = '') {
  const node = document.createElement(tag);
  if (text !== null && text !== undefined) node.textContent = String(text);
  if (className) node.className = className;
  return node;
}

function ensureStyle() {
  if (document.querySelector('#alpha64-device-style')) return;
  const style = document.createElement('style');
  style.id = 'alpha64-device-style';
  style.textContent = `
    .a63-device-users{display:grid;gap:12px}.a63-device-user{display:grid;gap:11px;padding:13px;border:1px solid #dbe5ec;border-radius:13px;background:#fff}.a63-device-user.inactive{opacity:.72;background:#f8fafc}.a63-device-user-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap}.a63-device-user-title{display:grid;gap:3px}.a63-device-slots{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.a63-device-slot{display:grid;gap:9px;padding:11px;border:1px solid #dbe5ec;border-radius:11px;background:#f8fafc}.a63-device-slot-head{display:flex;justify-content:space-between;gap:8px;align-items:center}.a63-device-current,.a63-device-request{display:grid;gap:6px;padding:9px;border:1px solid #dbe5ec;border-radius:9px;background:#fff}.a63-device-current{border-color:#86efac;background:#f0fdf4}.a63-device-current strong,.a63-device-request strong{overflow-wrap:anywhere}.a63-device-detail{font-size:.82rem;color:#526273;overflow-wrap:anywhere}.a63-device-actions{display:flex;gap:7px;flex-wrap:wrap}.a63-device-actions .button{min-height:36px}.a63-device-empty{padding:9px;border:1px dashed #cbd5e1;border-radius:9px;color:#64748b;background:#fff}.a63-device-requests{display:grid;gap:7px}.a63-device-history{margin-top:2px}.a63-device-history summary{cursor:pointer;font-weight:700;color:#475569}.a63-device-status{padding:10px 11px;border-radius:9px;background:#eff6ff;color:#1e3a8a}.a63-device-status.success{background:#f0fdf4;color:#166534}.a63-device-status.danger{background:#fff1f2;color:#991b1b}.a63-device-note{padding:11px 12px;border-left:4px solid #075985;border-radius:0 10px 10px 0;background:#eff6ff;color:#1e3a8a}.a63-device-chip{display:inline-flex;align-items:center;min-height:27px;padding:3px 8px;border:1px solid #cbd5e1;border-radius:999px;background:#fff;font-size:.78rem;font-weight:800}.a63-device-chip.ok{border-color:#86efac;background:#dcfce7;color:#166534}.a63-device-chip.warn{border-color:#fcd34d;background:#fffbeb;color:#92400e}.a63-device-chip.off{border-color:#fecaca;background:#fff1f2;color:#991b1b}@media(max-width:760px){.a63-device-slots{grid-template-columns:1fr}.a63-device-actions .button{width:100%}}
  `;
  document.head.append(style);
}

function dateTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' });
}

function profileName(profile) {
  return [profile?.nombre, profile?.apellidos].filter(Boolean).join(' ').trim()
    || profile?.correo
    || 'Usuario';
}

function stateLabel(value) {
  return ({
    autorizado: 'Autorizado',
    pendiente: 'Pendiente',
    bloqueado: 'Rechazado',
    revocado: 'Revocado',
  })[value] || value || 'Desconocido';
}

function typeDefinition(type) {
  return DEVICE_TYPES.find(item => item.id === type) || DEVICE_TYPES[1];
}

function chip(text, tone = '') {
  return el('span', text, `a63-device-chip${tone ? ` ${tone}` : ''}`);
}

function findLegacyDeviceSection() {
  if (!content) return null;
  return [...content.querySelectorAll('.a51-section')].find(section => {
    const heading = [...section.querySelectorAll('strong')]
      .find(node => node.textContent?.trim() === 'Dispositivos solicitados');
    return Boolean(heading);
  }) || null;
}

async function currentProfile() {
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData?.user?.id) return null;
  const { data, error } = await supabase
    .from('usuarios')
    .select('id,tipo_usuario,activo')
    .eq('id', authData.user.id)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

function deviceMeta(device) {
  return [
    device.nombre || 'Dispositivo',
    device.ultimo_acceso_en ? `Último acceso ${dateTime(device.ultimo_acceso_en)}` : '',
    device.solicitado_en ? `Solicitado ${dateTime(device.solicitado_en)}` : '',
  ].filter(Boolean).join(' · ');
}

async function changeDevice(section, device, authorize, status) {
  const definition = typeDefinition(device.tipo_dispositivo);
  let observations = '';

  if (authorize) {
    const accepted = window.confirm(
      `¿Autorizar este ${definition.label.toLocaleLowerCase('es-ES')} para ${device.ownerName}?\n\n` +
      'Cada usuario puede mantener simultáneamente un móvil y un ordenador. Autorizar este dispositivo no revocará el otro tipo.'
    );
    if (!accepted) return;
    observations = `Autorizado como ${definition.label.toLocaleLowerCase('es-ES')} desde Usuarios · Alpha64`;
  } else {
    const action = device.estado === 'pendiente' ? 'rechazar esta solicitud' : 'revocar este dispositivo';
    const reason = window.prompt(`Motivo obligatorio para ${action}:`);
    if (!reason?.trim()) return;
    observations = reason.trim();
  }

  status.className = 'a63-device-status';
  status.textContent = authorize ? 'Autorizando dispositivo…' : 'Actualizando dispositivo…';

  const { error } = await supabase.rpc('autorizar_dispositivo', {
    p_dispositivo_id: device.id,
    p_autorizar: authorize,
    p_observaciones: observations,
  });

  if (error) {
    status.className = 'a63-device-status danger';
    status.textContent = error.message || 'No se pudo actualizar el dispositivo.';
    return;
  }

  status.className = 'a63-device-status success';
  status.textContent = authorize
    ? `${definition.icon} ${definition.label} autorizado correctamente.`
    : 'Estado del dispositivo actualizado.';
  await renderDeviceSection(section, status.textContent);
}

async function recoverRevokedDevice(section, device, status) {
  const definition = typeDefinition(device.tipo_dispositivo);
  const accepted = window.confirm(
    `¿Recuperar este ${definition.label.toLocaleLowerCase('es-ES')} revocado para ${device.ownerName}?\n\n` +
    'Volverá a quedar autorizado inmediatamente y conservará el mismo identificador de dispositivo.'
  );
  if (!accepted) return;

  const reason = window.prompt(
    'Motivo obligatorio de la recuperación:',
    `Recuperación del ${definition.label.toLocaleLowerCase('es-ES')} revocado`
  );
  if (!reason?.trim() || reason.trim().length < 3) return;

  status.className = 'a63-device-status';
  status.textContent = `Recuperando ${definition.label.toLocaleLowerCase('es-ES')}…`;

  const { error } = await supabase.rpc('recuperar_dispositivo_revocado', {
    p_dispositivo_id: device.id,
    p_motivo: reason.trim(),
  });

  if (error) {
    status.className = 'a63-device-status danger';
    status.textContent = error.message || 'No se pudo recuperar el dispositivo.';
    return;
  }

  status.className = 'a63-device-status success';
  status.textContent = `${definition.icon} ${definition.label} recuperado y autorizado correctamente.`;
  await renderDeviceSection(section, status.textContent);
}

function renderDeviceRecord(section, device, { authorizedForType, status, historical = false }) {
  const card = el('article', null, 'a63-device-request');
  const definition = typeDefinition(device.tipo_dispositivo);
  card.append(
    el('strong', `${definition.icon} ${device.nombre || definition.label}`),
    el('div', `${stateLabel(device.estado)} · ${deviceMeta(device)}`, 'a63-device-detail')
  );
  if (device.observaciones) card.append(el('div', device.observaciones, 'a63-device-detail'));

  const actions = el('div', null, 'a63-device-actions');
  if (device.estado !== 'autorizado' && !historical) {
    const approve = el('button', `Autorizar ${definition.label.toLocaleLowerCase('es-ES')}`, 'button primary compact');
    approve.type = 'button';
    approve.disabled = Boolean(authorizedForType);
    approve.title = authorizedForType
      ? `Ya hay un ${definition.label.toLocaleLowerCase('es-ES')} autorizado. Revócalo primero.`
      : `Autorizar como ${definition.label.toLocaleLowerCase('es-ES')}`;
    approve.addEventListener('click', () => changeDevice(section, device, true, status));
    actions.append(approve);

    if (device.estado === 'pendiente') {
      const reject = el('button', 'Rechazar solicitud', 'button secondary compact');
      reject.type = 'button';
      reject.addEventListener('click', () => changeDevice(section, device, false, status));
      actions.append(reject);
    }
  }

  if (historical && device.estado === 'revocado') {
    const recover = el(
      'button',
      `↩ Recuperar ${definition.label.toLocaleLowerCase('es-ES')}`,
      'button primary compact'
    );
    recover.type = 'button';
    recover.disabled = Boolean(authorizedForType);
    recover.title = authorizedForType
      ? `Ya hay un ${definition.label.toLocaleLowerCase('es-ES')} autorizado. Revócalo primero.`
      : `Recuperar y volver a autorizar este ${definition.label.toLocaleLowerCase('es-ES')}`;
    recover.addEventListener('click', () => recoverRevokedDevice(section, device, status));
    actions.append(recover);
  }

  if (actions.childElementCount) card.append(actions);
  return card;
}

function renderSlot(section, definition, devices, status) {
  const slot = el('section', null, 'a63-device-slot');
  const authorized = devices.find(device => device.estado === 'autorizado') || null;
  const candidates = devices.filter(device => !['autorizado', 'bloqueado', 'revocado'].includes(device.estado));
  const historical = devices.filter(device => ['bloqueado', 'revocado'].includes(device.estado));

  const head = el('div', null, 'a63-device-slot-head');
  head.append(
    el('strong', `${definition.icon} ${definition.label}`),
    chip(authorized ? 'Ocupado' : 'Disponible', authorized ? 'ok' : 'warn')
  );
  slot.append(head);

  if (authorized) {
    const current = el('article', null, 'a63-device-current');
    current.append(
      el('strong', authorized.nombre || definition.label),
      el('div', deviceMeta(authorized), 'a63-device-detail')
    );
    if (authorized.observaciones) current.append(el('div', authorized.observaciones, 'a63-device-detail'));
    const actions = el('div', null, 'a63-device-actions');
    const revoke = el('button', `Revocar ${definition.label.toLocaleLowerCase('es-ES')}`, 'button secondary compact');
    revoke.type = 'button';
    revoke.addEventListener('click', () => changeDevice(section, authorized, false, status));
    actions.append(revoke);
    current.append(actions);
    slot.append(current);
  } else {
    slot.append(el('div', `Todavía no hay ningún ${definition.label.toLocaleLowerCase('es-ES')} autorizado.`, 'a63-device-empty'));
  }

  if (candidates.length) {
    const requestList = el('div', null, 'a63-device-requests');
    requestList.append(el('strong', candidates.length === 1 ? 'Solicitud pendiente' : 'Solicitudes pendientes'));
    candidates.forEach(device => requestList.append(renderDeviceRecord(section, device, {
      authorizedForType: authorized,
      status,
    })));
    slot.append(requestList);
  }

  if (historical.length) {
    const history = el('details', null, 'a63-device-history');
    history.append(el('summary', `Revocados o rechazados · ${historical.length}`));
    const historyList = el('div', null, 'a63-device-requests');
    historical.forEach(device => historyList.append(renderDeviceRecord(section, device, {
      authorizedForType: authorized,
      status,
      historical: true,
    })));
    history.append(historyList);
    slot.append(history);
  }

  return slot;
}

async function renderDeviceSection(section, successMessage = '') {
  if (!section?.isConnected) return;
  const sequence = ++renderSequence;
  section.dataset.alpha64DeviceSection = 'loading';

  const heading = el('div', null, 'a51-section-head');
  const copy = el('div');
  copy.append(
    el('strong', 'Dispositivos autorizados'),
    el('div', 'Cada usuario dispone de dos plazas independientes: un móvil y un ordenador. Autorizar uno no desconecta el otro.', 'muted')
  );
  const refresh = el('button', 'Actualizar dispositivos', 'button secondary compact');
  refresh.type = 'button';
  heading.append(copy, refresh);

  const note = el(
    'div',
    'El usuario debe entrar una vez desde cada equipo. Los dispositivos revocados pueden recuperarse directamente mientras su plaza esté libre.',
    'a63-device-note'
  );
  const status = el('div', successMessage || 'Cargando dispositivos…', `a63-device-status${successMessage ? ' success' : ''}`);
  const host = el('div', null, 'a63-device-users');
  section.replaceChildren(heading, note, status, host);

  refresh.addEventListener('click', () => renderDeviceSection(section));

  try {
    const profile = await currentProfile();
    if (profile?.tipo_usuario !== 'administrador_principal' || profile?.activo !== true) {
      section.remove();
      return;
    }

    const [usersResult, devicesResult] = await Promise.all([
      supabase
        .from('usuarios')
        .select('id,nombre,apellidos,correo,tipo_usuario,activo')
        .order('nombre', { ascending: true }),
      supabase
        .from('dispositivos_usuario')
        .select('id,usuario_id,nombre,agente,tipo_dispositivo,estado,solicitado_en,autorizado_en,ultimo_acceso_en,observaciones,actualizado_en')
        .order('solicitado_en', { ascending: false }),
    ]);

    if (sequence !== renderSequence || !section.isConnected) return;
    if (usersResult.error) throw usersResult.error;
    if (devicesResult.error) throw devicesResult.error;

    const devicesByUser = new Map();
    (devicesResult.data || []).forEach(device => {
      const current = devicesByUser.get(device.usuario_id) || [];
      current.push(device);
      devicesByUser.set(device.usuario_id, current);
    });

    const users = (usersResult.data || []).filter(user => user.tipo_usuario !== 'administrador_principal');
    host.replaceChildren();

    if (!users.length) {
      host.append(el('div', 'Todavía no hay usuarios a los que autorizar dispositivos.', 'a51-empty'));
    }

    users.forEach(user => {
      const userDevices = devicesByUser.get(user.id) || [];
      const authorizedCount = userDevices.filter(device => device.estado === 'autorizado').length;
      const pendingCount = userDevices.filter(device => device.estado === 'pendiente').length;
      const revokedCount = userDevices.filter(device => device.estado === 'revocado').length;
      const card = el('article', null, `a63-device-user${user.activo ? '' : ' inactive'}`);
      const userHead = el('div', null, 'a63-device-user-head');
      const title = el('div', null, 'a63-device-user-title');
      title.append(
        el('strong', profileName(user)),
        el('div', user.correo || 'Sin correo', 'a63-device-detail')
      );
      const chips = el('div', null, 'a51-chips');
      chips.append(
        chip(user.activo ? 'Cuenta activa' : 'Cuenta bloqueada', user.activo ? 'ok' : 'off'),
        chip(`${authorizedCount}/2 autorizados`, authorizedCount === 2 ? 'ok' : 'warn')
      );
      if (pendingCount) chips.append(chip(`${pendingCount} pendiente${pendingCount === 1 ? '' : 's'}`, 'warn'));
      if (revokedCount) chips.append(chip(`${revokedCount} revocado${revokedCount === 1 ? '' : 's'} recuperable${revokedCount === 1 ? '' : 's'}`, 'off'));
      userHead.append(title, chips);

      const slots = el('div', null, 'a63-device-slots');
      DEVICE_TYPES.forEach(definition => {
        const devicesOfType = userDevices
          .filter(device => device.tipo_dispositivo === definition.id)
          .map(device => ({ ...device, ownerName: profileName(user) }));
        slots.append(renderSlot(section, definition, devicesOfType, status));
      });

      card.append(userHead, slots);
      host.append(card);
    });

    if (!successMessage) {
      status.className = 'a63-device-status success';
      status.textContent = `${users.length} usuario${users.length === 1 ? '' : 's'} cargado${users.length === 1 ? '' : 's'}.`;
    }
    section.dataset.alpha64DeviceSection = 'ready';
  } catch (error) {
    if (sequence !== renderSequence || !section.isConnected) return;
    status.className = 'a63-device-status danger';
    status.textContent = `No se pudieron cargar los dispositivos: ${error?.message || 'error desconocido'}`;
    section.dataset.alpha64DeviceSection = 'error';
  }
}

function syncDeviceSection() {
  syncQueued = false;
  const section = findLegacyDeviceSection();
  if (!section) return;
  if (section.dataset.alpha64DeviceSection) return;
  renderDeviceSection(section);
}

function scheduleSync() {
  if (syncQueued) return;
  syncQueued = true;
  queueMicrotask(syncDeviceSection);
}

ensureStyle();
if (content) {
  new MutationObserver(scheduleSync).observe(content, { childList: true, subtree: true });
}
scheduleSync();
