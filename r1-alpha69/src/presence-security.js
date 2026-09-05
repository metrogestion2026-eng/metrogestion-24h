import { deviceToken, supabase } from '../../r1-alpha17/src/supabase.js';

function detectedVersion() {
  const declared = document.querySelector('meta[name="metrogestion-release"]');
  const release = declared && declared.content ? declared.content.trim() : '';
  if (/^r1\.0\.0-alpha\.\d+$/.test(release)) return release;
  const match = location.pathname.match(/\/r1-alpha(\d+)(?:\/|$)/i);
  return match ? 'r1.0.0-alpha.' + Number(match[1]) : 'r1.0.0-alpha.69';
}

const VERSION = detectedVersion();
const HEARTBEAT_MS = 15000;
const ANON_CHECK_MS = 12000;
const ONLINE_SECONDS = 45;

const appView = document.querySelector('#app-view');
const loginView = document.querySelector('#login-view');
const loginEmail = document.querySelector('#login-email');
const loginButton = document.querySelector('#login-button');
const loginMessage = document.querySelector('#login-message');
const nav = document.querySelector('#module-nav');
const content = document.querySelector('#module-content');
const securityIndicator = document.querySelector('#security-indicator');

let heartbeatTimer = null;
let anonymousTimer = null;
let guardChannel = null;
let adminChannel = null;
let activeUserId = null;
let activeProfile = null;
let panelOpen = false;
let panelSequence = 0;
let anonymousBlocked = false;
let anonymousRegistered = false;
let lastLoginFailure = '';
let forcedLogout = false;
let syncQueued = false;

function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== null && text !== undefined) node.textContent = String(text);
  if (className) node.className = className;
  return node;
}

function ensureStyle() {
  if (document.querySelector('#alpha69-presence-style')) return;
  const style = document.createElement('style');
  style.id = 'alpha69-presence-style';
  style.textContent = [
    '.a69-view{display:grid;gap:14px}.a69-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap}',
    '.a69-head h2{margin:.1rem 0 .35rem}.a69-summary{display:grid;grid-template-columns:repeat(auto-fit,minmax(145px,1fr));gap:10px}',
    '.a69-metric{display:grid;gap:4px;padding:12px;border:1px solid #dbe5ec;border-radius:12px;background:#fff}.a69-metric strong{font-size:1.35rem}',
    '.a69-note{padding:12px;border-left:4px solid #075985;border-radius:0 10px 10px 0;background:#eff6ff;color:#1e3a8a}',
    '.a69-status{padding:10px 12px;border-radius:10px;background:#f1f7fa;color:#334155}.a69-status.success{background:#f0fdf4;color:#166534}.a69-status.danger{background:#fff1f2;color:#991b1b}',
    '.a69-section{display:grid;gap:10px;padding:14px;border:1px solid #dbe5ec;border-radius:14px;background:#fff}.a69-list{display:grid;gap:9px}',
    '.a69-card{display:grid;gap:8px;padding:12px;border:1px solid #dbe5ec;border-radius:12px;background:#fff}.a69-card.unknown{border-color:#fdba74;background:#fff7ed}.a69-card.blocked{border-color:#fca5a5;background:#fff1f2}',
    '.a69-card-head{display:flex;justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap}.a69-title{display:grid;gap:3px}.a69-meta{font-size:.84rem;color:#526273;overflow-wrap:anywhere}',
    '.a69-access-stats{display:grid;grid-template-columns:repeat(2,minmax(110px,1fr));gap:8px}.a69-access-stat{display:grid;gap:2px;padding:9px;border:1px solid #dbe5ec;border-radius:10px;background:#f8fafc}.a69-access-stat strong{font-size:1.15rem}',
    '.a69-chips,.a69-actions{display:flex;gap:7px;flex-wrap:wrap}.a69-chip{display:inline-flex;align-items:center;min-height:27px;padding:3px 8px;border:1px solid #cbd5e1;border-radius:999px;background:#f8fafc;font-size:.78rem;font-weight:800}',
    '.a69-chip.online{border-color:#86efac;background:#dcfce7;color:#166534}.a69-chip.warn{border-color:#fcd34d;background:#fffbeb;color:#92400e}.a69-chip.off{border-color:#fecaca;background:#fff1f2;color:#991b1b}',
    '.a69-empty{padding:14px;border:1px dashed #cbd5e1;border-radius:11px;color:#64748b;text-align:center}',
    '.a69-login-block{border:2px solid #ef4444!important;background:#fff1f2!important}.a69-login-warning{padding:11px;border-radius:10px;background:#fee2e2;color:#991b1b;font-weight:800}',
    '@media(max-width:700px){.a69-head .button,.a69-actions .button{width:100%}}'
  ].join('');
  document.head.append(style);
}

function randomUuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, function (byte) { return byte.toString(16).padStart(2, '0'); });
  return hex.slice(0, 4).join('') + '-' + hex.slice(4, 6).join('') + '-' +
    hex.slice(6, 8).join('') + '-' + hex.slice(8, 10).join('') + '-' + hex.slice(10).join('');
}

function instanceId() {
  const key = 'metrogestion.presencia.instancia.v1';
  try {
    const current = sessionStorage.getItem(key);
    if (current && /^[0-9a-f-]{36}$/i.test(current)) return current;
    const created = randomUuid();
    sessionStorage.setItem(key, created);
    return created;
  } catch {
    return randomUuid();
  }
}

const INSTANCE_ID = instanceId();

function roleLabel(role) {
  return ({
    administrador_principal: 'Administrador principal',
    administrador_secundario: 'Administrador secundario',
    usuario: 'Usuario'
  })[role] || role || 'No reconocido';
}

function dateTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'medium' });
}

function timeAgo(value) {
  const date = new Date(value);
  const seconds = Math.max(0, Math.round((Date.now() - date.getTime()) / 1000));
  if (!Number.isFinite(seconds)) return '—';
  if (seconds < 10) return 'ahora';
  if (seconds < 60) return 'hace ' + seconds + ' s';
  const minutes = Math.round(seconds / 60);
  return 'hace ' + minutes + ' min';
}

function currentPage() {
  const active = nav && nav.querySelector('button.active');
  return (active && active.textContent ? active.textContent.trim() : 'Aplicación').slice(0, 160);
}

async function currentProfile(force) {
  if (!force && activeProfile) return activeProfile;
  const userResult = await supabase.auth.getUser();
  const user = userResult.data && userResult.data.user;
  if (userResult.error || !user) return null;
  const result = await supabase.from('usuarios')
    .select('id,nombre,apellidos,correo,tipo_usuario,activo')
    .eq('id', user.id)
    .maybeSingle();
  if (result.error) throw result.error;
  activeProfile = result.data || null;
  activeUserId = user.id;
  return activeProfile;
}

function setSecurityIndicator(message, bad) {
  if (!securityIndicator) return;
  securityIndicator.textContent = message;
  securityIndicator.classList.toggle('danger', Boolean(bad));
}

async function forceLogout(reason) {
  if (forcedLogout) return;
  forcedLogout = true;
  stopPresence();
  try {
    await supabase.auth.signOut({ scope: 'local' });
  } catch {}
  window.setTimeout(function () {
    if (loginMessage) {
      loginMessage.textContent = reason || 'El acceso ha sido bloqueado por el administrador principal.';
    }
    forcedLogout = false;
  }, 80);
}

async function sendHeartbeat() {
  if (!appView || appView.classList.contains('hidden') || forcedLogout) return;
  const result = await supabase.rpc('actualizar_presencia', {
    p_instancia_id: INSTANCE_ID,
    p_pagina: currentPage(),
    p_version: VERSION,
    p_visible: !document.hidden
  });
  if (result.error) {
    setSecurityIndicator('⚠ Verificación temporalmente sin conexión', true);
    return;
  }
  if (!result.data || result.data.permitido !== true) {
    const state = result.data && result.data.estado ? result.data.estado : 'acceso revocado';
    await forceLogout('Acceso cerrado: ' + state + '. Contacta con el administrador principal.');
    return;
  }
  setSecurityIndicator('● En línea · acceso verificado', false);
}

function removeChannel(channel) {
  if (!channel) return;
  try { supabase.removeChannel(channel); } catch {}
}

function subscribeOwnGuard(userId) {
  removeChannel(guardChannel);
  guardChannel = supabase
    .channel('alpha69-guard-' + userId + '-' + INSTANCE_ID)
    .on('postgres_changes', {
      event: 'UPDATE',
      schema: 'public',
      table: 'sesiones_presencia',
      filter: 'usuario_id=eq.' + userId
    }, function (payload) {
      if (payload.new && payload.new.estado === 'bloqueado') {
        forceLogout(payload.new.motivo_bloqueo || 'Acceso bloqueado por el administrador principal.');
      }
    })
    .subscribe();
}

async function startPresence() {
  if (!appView || appView.classList.contains('hidden') || heartbeatTimer) return;
  try {
    const profile = await currentProfile(true);
    if (!profile || profile.activo !== true) return;
    await sendHeartbeat();
    if (forcedLogout) return;
    subscribeOwnGuard(profile.id);
    heartbeatTimer = window.setInterval(function () {
      sendHeartbeat().catch(function () {
        setSecurityIndicator('⚠ No se pudo verificar la sesión', true);
      });
    }, HEARTBEAT_MS);
    syncAdminButton();
  } catch {
    setSecurityIndicator('⚠ No se pudo iniciar la vigilancia', true);
  }
}

function stopPresence() {
  if (heartbeatTimer) window.clearInterval(heartbeatTimer);
  heartbeatTimer = null;
  removeChannel(guardChannel);
  guardChannel = null;
  removeChannel(adminChannel);
  adminChannel = null;
  activeUserId = null;
  activeProfile = null;
  panelOpen = false;
}

async function anonymousGate(eventName, email) {
  if (!loginView || loginView.classList.contains('hidden')) return null;
  const response = await supabase.functions.invoke('acceso-anonimo-r1', {
    body: {
      huella: deviceToken,
      evento: eventName,
      correo: email || '',
      ruta: location.pathname
    }
  });
  if (response.error) return null;
  if (response.data && response.data.bloqueado === true) lockAnonymousAccess();
  return response.data || null;
}

function lockAnonymousAccess() {
  anonymousBlocked = true;
  if (!loginView) return;
  loginView.classList.add('a69-login-block');
  if (loginButton) {
    loginButton.disabled = true;
    loginButton.setAttribute('aria-disabled', 'true');
  }
  let warning = loginView.querySelector('[data-alpha69-login-warning]');
  if (!warning) {
    warning = el('div', '⛔ Acceso bloqueado por el administrador principal. No has entrado en Metrogestión.', 'a69-login-warning');
    warning.dataset.alpha69LoginWarning = '1';
    loginView.insertBefore(warning, loginButton || loginView.lastChild);
  }
}

function startAnonymousWatch() {
  if (!loginView || loginView.classList.contains('hidden')) return;
  if (!anonymousRegistered) {
    anonymousRegistered = true;
    anonymousGate('vista_login', '').catch(function () {});
  }
  if (!anonymousTimer) {
    anonymousTimer = window.setInterval(function () {
      if (!loginView.classList.contains('hidden')) {
        anonymousGate('comprobar_bloqueo', '').catch(function () {});
      }
    }, ANON_CHECK_MS);
  }
}

function stopAnonymousWatch() {
  if (anonymousTimer) window.clearInterval(anonymousTimer);
  anonymousTimer = null;
}

function makeMetric(label, value) {
  const metric = el('div', null, 'a69-metric');
  metric.append(el('strong', value), el('span', label, 'muted'));
  return metric;
}

function makeChip(text, tone) {
  return el('span', text, 'a69-chip' + (tone ? ' ' + tone : ''));
}

function actionStatus(view, message, danger) {
  const node = view.querySelector('[data-alpha69-status]');
  if (!node) return;
  node.textContent = message || '';
  node.className = 'a69-status' + (danger ? ' danger' : ' success');
}

async function blockPresence(view, row, scope) {
  const label = scope === 'usuario' ? 'bloquear toda la cuenta' : 'revocar este dispositivo';
  if (!window.confirm('¿Seguro que quieres ' + label + ' de ' + row.nombre + '?')) return;
  const reason = window.prompt('Motivo obligatorio del bloqueo:');
  if (!reason || reason.trim().length < 3) return;
  actionStatus(view, 'Aplicando el bloqueo…', false);
  const result = await supabase.rpc('bloquear_acceso_presencia', {
    p_presencia_id: row.presencia_id,
    p_alcance: scope,
    p_motivo: reason.trim()
  });
  if (result.error) {
    actionStatus(view, result.error.message || 'No se pudo bloquear el acceso.', true);
    return;
  }
  actionStatus(view, scope === 'usuario' ? 'Cuenta bloqueada y dispositivos revocados.' : 'Dispositivo revocado.', false);
  await loadPanel(view);
}

async function toggleAnonymousBlock(view, row) {
  const next = row.bloqueado !== true;
  let reason = '';
  if (next) {
    reason = window.prompt('Motivo obligatorio para bloquear esta huella:') || '';
    if (reason.trim().length < 3) return;
  } else if (!window.confirm('¿Desbloquear esta huella no reconocida?')) {
    return;
  }
  actionStatus(view, next ? 'Bloqueando huella…' : 'Desbloqueando huella…', false);
  const result = await supabase.rpc('bloquear_intento_acceso', {
    p_intento_id: row.intento_id,
    p_bloquear: next,
    p_motivo: reason.trim()
  });
  if (result.error) {
    actionStatus(view, result.error.message || 'No se pudo cambiar el bloqueo.', true);
    return;
  }
  actionStatus(view, next ? 'Huella bloqueada.' : 'Huella desbloqueada.', false);
  await loadPanel(view);
}

function renderRecognized(view, rows) {
  const section = el('section', null, 'a69-section');
  section.append(el('strong', 'Dentro de la aplicación · reconocidos'));
  const list = el('div', null, 'a69-list');
  if (!rows.length) {
    list.append(el('div', 'No hay ninguna sesión reconocida activa.', 'a69-empty'));
  }
  rows.forEach(function (row) {
    const card = el('article', null, 'a69-card');
    const head = el('div', null, 'a69-card-head');
    const title = el('div', null, 'a69-title');
    title.append(
      el('strong', row.nombre || row.correo || 'Usuario'),
      el('div', (row.correo || '') + ' · ' + (row.dispositivo || 'Dispositivo'), 'a69-meta')
    );
    const chips = el('div', null, 'a69-chips');
    chips.append(
      makeChip('● En línea', 'online'),
      makeChip(roleLabel(row.tipo_usuario), ''),
      makeChip(row.visible ? 'Pantalla activa' : 'En segundo plano', row.visible ? 'online' : 'warn')
    );
    head.append(title, chips);
    const details = el('div',
      'Pantalla: ' + (row.pagina || 'Aplicación') +
      ' · Versión: ' + (row.version_cliente || '—') +
      ' · Conectado: ' + dateTime(row.conectada_en) +
      ' · Actividad: ' + timeAgo(row.ultima_actividad_en),
      'a69-meta'
    );
    card.append(head, details);
    if (row.agente) card.append(el('div', String(row.agente).slice(0, 180), 'a69-meta'));

    if (row.tipo_usuario !== 'administrador_principal') {
      const actions = el('div', null, 'a69-actions');
      if (row.dispositivo_id) {
        const device = el('button', 'Revocar dispositivo', 'button secondary compact');
        device.type = 'button';
        device.addEventListener('click', function () { blockPresence(view, row, 'dispositivo'); });
        actions.append(device);
      }
      const account = el('button', 'Bloquear cuenta', 'button secondary compact');
      account.type = 'button';
      account.addEventListener('click', function () { blockPresence(view, row, 'usuario'); });
      actions.append(account);
      card.append(actions);
    }
    list.append(card);
  });
  section.append(list);
  return section;
}

function renderUserAccess(rows) {
  const section = el('section', null, 'a69-section');
  section.append(
    el('strong', 'Marcador de accesos de usuarios'),
    el('div', 'Cada sesión validada cuenta una sola vez. Las pestañas y las comprobaciones automáticas no aumentan el marcador.', 'a69-meta')
  );
  const list = el('div', null, 'a69-list');
  if (!rows.length) {
    list.append(el('div', 'Todavía no hay usuarios para mostrar.', 'a69-empty'));
  }
  rows.forEach(function (row) {
    const card = el('article', null, 'a69-card');
    const head = el('div', null, 'a69-card-head');
    const title = el('div', null, 'a69-title');
    title.append(
      el('strong', row.nombre || row.correo || 'Usuario'),
      el('div', (row.correo || '') + ' · ' + roleLabel(row.tipo_usuario), 'a69-meta')
    );
    const chips = el('div', null, 'a69-chips');
    chips.append(makeChip(row.ultimo_acceso_en ? 'Último acceso registrado' : 'Sin accesos', row.ultimo_acceso_en ? 'online' : ''));
    head.append(title, chips);

    const stats = el('div', null, 'a69-access-stats');
    const today = el('div', null, 'a69-access-stat');
    today.append(el('strong', Number(row.accesos_hoy || 0)), el('span', 'Accesos de hoy', 'a69-meta'));
    const week = el('div', null, 'a69-access-stat');
    week.append(el('strong', Number(row.accesos_7_dias || 0)), el('span', 'Últimos 7 días', 'a69-meta'));
    stats.append(today, week);

    card.append(head, stats);
    if (row.ultimo_acceso_en) {
      card.append(el('div',
        'Último acceso: ' + dateTime(row.ultimo_acceso_en) +
        ' · Dispositivo: ' + (row.ultimo_dispositivo || 'No localizado') +
        (row.ultima_version_cliente ? ' · Versión: ' + row.ultima_version_cliente : ''),
        'a69-meta'
      ));
    }
    list.append(card);
  });
  section.append(list);
  return section;
}

function renderUnknown(view, rows) {
  const section = el('section', null, 'a69-section');
  section.append(
    el('strong', 'Fuera de la aplicación · accesos sin completar'),
    el('div', 'Una apertura es solo una visita a la pantalla de identificación, no una contraseña fallida. Los dispositivos autorizados y los accesos completados se retiran automáticamente de esta lista.', 'a69-meta')
  );
  const list = el('div', null, 'a69-list');
  if (!rows.length) {
    list.append(el('div', 'No hay accesos pendientes ni contraseñas rechazadas recientes.', 'a69-empty'));
  }
  rows.forEach(function (row) {
    const card = el('article', null, 'a69-card unknown' + (row.bloqueado ? ' blocked' : ''));
    const head = el('div', null, 'a69-card-head');
    const title = el('div', null, 'a69-title');
    const openings = Number.isFinite(Number(row.aperturas_login))
      ? Number(row.aperturas_login)
      : Number(row.repeticiones || 0);
    const rejected = Number(row.credenciales_rechazadas || 0);
    const details = [
      'Último contacto: ' + dateTime(row.ultimo_en),
      'Aperturas: ' + openings
    ];
    if (rejected > 0) details.push('Contraseñas rechazadas: ' + rejected);
    title.append(
      el('strong', row.correo_indicado || (row.clasificacion === 'credenciales_rechazadas'
        ? 'Credenciales no válidas'
        : 'Pantalla de identificación')),
      el('div', details.join(' · '), 'a69-meta')
    );
    const chips = el('div', null, 'a69-chips');
    if (row.en_linea) chips.append(makeChip('● Pantalla abierta', 'warn'));
    if (row.bloqueado) {
      chips.append(makeChip('Bloqueado', 'off'));
    } else if (row.clasificacion === 'credenciales_rechazadas') {
      chips.append(makeChip('Contraseña rechazada', 'warn'));
    } else if (row.estado_dispositivo === 'pendiente') {
      chips.append(makeChip('Dispositivo pendiente', 'warn'));
    } else {
      chips.append(makeChip('Identificación sin completar', 'warn'));
    }
    head.append(title, chips);
    card.append(head);
    if (row.agente) card.append(el('div', String(row.agente).slice(0, 180), 'a69-meta'));
    if (row.motivo_bloqueo) card.append(el('div', 'Motivo: ' + row.motivo_bloqueo, 'a69-meta'));
    const deviceManagedBlock = row.bloqueo_origen === 'dispositivo';
    if (deviceManagedBlock) {
      card.append(el('div', 'El dispositivo ya está revocado. Su autorización se gestiona desde Usuarios.', 'a69-meta'));
    } else {
      const actions = el('div', null, 'a69-actions');
      const toggle = el('button', row.bloqueado ? 'Desbloquear huella' : 'Bloquear huella', 'button secondary compact');
      toggle.type = 'button';
      toggle.addEventListener('click', function () { toggleAnonymousBlock(view, row); });
      actions.append(toggle);
      card.append(actions);
    }
    list.append(card);
  });
  section.append(list);
  return section;
}

async function loadPanel(view) {
  const sequence = ++panelSequence;
  const result = await supabase.rpc('estado_presencia_admin');
  if (sequence !== panelSequence || !view.isConnected || !panelOpen) return;
  if (result.error) {
    actionStatus(view, result.error.message || 'No se pudo consultar la presencia.', true);
    return;
  }
  const status = result.data || {};
  const host = view.querySelector('[data-alpha69-host]');
  if (!host) return;
  host.replaceChildren();

  const summary = el('div', null, 'a69-summary');
  summary.append(
    makeMetric('Reconocidos en línea', status.total_en_linea || 0),
    makeMetric('Accesos válidos hoy', status.total_accesos_hoy || 0),
    makeMetric('En identificación', status.identificaciones_en_linea || status.no_reconocidos_en_linea || 0),
    makeMetric('Con contraseña rechazada', status.rechazos_credenciales || 0),
    makeMetric('Huellas bloqueadas', status.bloqueados || 0),
    makeMetric('Umbral en línea', (status.umbral_segundos || ONLINE_SECONDS) + ' s')
  );
  host.append(
    summary,
    el('div', 'La lista reconocida procede de la sesión, el perfil y el dispositivo comprobados por Supabase. Un nombre o rango no puede ser inventado desde el navegador.', 'a69-note'),
    renderRecognized(view, status.en_linea || []),
    renderUserAccess(status.accesos_usuarios || []),
    renderUnknown(view, status.intentos_no_reconocidos || [])
  );
  actionStatus(view, 'Actualizado ' + dateTime(status.consultado_en), false);
}

function subscribeAdmin(view) {
  removeChannel(adminChannel);
  adminChannel = supabase
    .channel('alpha69-admin-presence-' + INSTANCE_ID)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'sesiones_presencia' }, function () {
      if (panelOpen) window.setTimeout(function () { loadPanel(view); }, 120);
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'intentos_acceso_no_reconocido' }, function () {
      if (panelOpen) window.setTimeout(function () { loadPanel(view); }, 120);
    })
    .subscribe();
}

function renderPanel() {
  if (!content) return;
  panelOpen = true;
  const view = el('section', null, 'a69-view');
  const head = el('div', null, 'a69-head');
  const copy = el('div');
  copy.append(
    el('p', 'Seguridad en tiempo real', 'eyebrow'),
    el('h2', 'Quién está dentro'),
    el('div', 'Visible únicamente para el administrador principal.', 'muted')
  );
  const refresh = el('button', 'Actualizar ahora', 'button secondary compact');
  refresh.type = 'button';
  refresh.addEventListener('click', function () { loadPanel(view); });
  head.append(copy, refresh);
  const status = el('div', 'Consultando presencia…', 'a69-status');
  status.dataset.alpha69Status = '1';
  const host = el('div');
  host.dataset.alpha69Host = '1';
  view.append(head, status, host);
  content.replaceChildren(view);
  loadPanel(view);
  subscribeAdmin(view);
}

function adminButton() {
  return nav && nav.querySelector('[data-alpha69-presence]');
}

async function syncAdminButton() {
  if (!nav || !appView || appView.classList.contains('hidden')) return;
  try {
    const profile = await currentProfile(false);
    if (!profile || profile.tipo_usuario !== 'administrador_principal' || profile.activo !== true) {
      const existing = adminButton();
      if (existing) existing.remove();
      return;
    }
    if (adminButton()) return;
    const button = el('button', '🛡️ En línea', 'button secondary');
    button.type = 'button';
    button.dataset.alpha69Presence = '1';
    button.dataset.module = 'presencia-alpha69';
    button.title = 'Ver quién está dentro y bloquear accesos';
    button.addEventListener('click', function (event) {
      event.preventDefault();
      nav.querySelectorAll('button').forEach(function (node) {
        node.classList.toggle('active', node === button);
      });
      renderPanel();
    });
    nav.append(button);
  } catch {}
}

function scheduleSync() {
  if (syncQueued) return;
  syncQueued = true;
  queueMicrotask(function () {
    syncQueued = false;
    if (appView && !appView.classList.contains('hidden')) {
      stopAnonymousWatch();
      startPresence();
      syncAdminButton();
    } else {
      startAnonymousWatch();
    }
  });
}

ensureStyle();

if (loginButton) {
  loginButton.addEventListener('click', function (event) {
    if (!anonymousBlocked) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    lockAnonymousAccess();
  }, true);
}

if (loginMessage) {
  new MutationObserver(function () {
    const message = loginMessage.textContent || '';
    if (/correo o contraseña incorrectos/i.test(message) && message !== lastLoginFailure) {
      lastLoginFailure = message;
      anonymousGate('credenciales_rechazadas', loginEmail ? loginEmail.value : '').catch(function () {});
    }
  }).observe(loginMessage, { childList: true, subtree: true, characterData: true });
}

if (appView) {
  new MutationObserver(scheduleSync).observe(appView, { attributes: true, attributeFilter: ['class'] });
}
if (loginView) {
  new MutationObserver(scheduleSync).observe(loginView, { attributes: true, attributeFilter: ['class'] });
}
if (nav) {
  new MutationObserver(syncAdminButton).observe(nav, { childList: true });
  nav.addEventListener('click', function (event) {
    const button = event.target.closest('button');
    if (button && !button.matches('[data-alpha69-presence]')) {
      panelOpen = false;
      panelSequence += 1;
      removeChannel(adminChannel);
      adminChannel = null;
      window.setTimeout(function () { sendHeartbeat().catch(function () {}); }, 80);
    }
  });
}

document.addEventListener('visibilitychange', function () {
  if (!document.hidden) sendHeartbeat().catch(function () {});
});

supabase.auth.onAuthStateChange(function (event, session) {
  if (event === 'SIGNED_OUT' || !session) {
    stopPresence();
    anonymousRegistered = false;
    window.setTimeout(startAnonymousWatch, 100);
  } else {
    stopAnonymousWatch();
    window.setTimeout(scheduleSync, 250);
  }
});

scheduleSync();
