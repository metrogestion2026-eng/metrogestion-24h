import { supabase } from '../../r1-alpha17/src/supabase.js';

const appView = document.querySelector('#app-view');
const sessionActions = document.querySelector('.session-actions');
const logoutButton = document.querySelector('#logout-button');

let profileCache = null;
let statusCache = null;
let dialog = null;
let syncQueued = false;
let refreshTimer = null;

function el(tag, text = null, className = '') {
  const node = document.createElement(tag);
  if (text !== null && text !== undefined) node.textContent = String(text);
  if (className) node.className = className;
  return node;
}

function ensureStyle() {
  if (document.querySelector('#alpha68-manteniment-sync-style')) return;
  const style = document.createElement('style');
  style.id = 'alpha68-manteniment-sync-style';
  style.textContent = `
    .a68-sync-button.ok{border-color:#86efac;background:#f0fdf4;color:#166534}.a68-sync-button.warn{border-color:#fdba74;background:#fff7ed;color:#9a3412}.a68-sync-button.bad{border-color:#fca5a5;background:#fff1f2;color:#991b1b}.a68-sync-overlay{position:fixed;inset:0;z-index:1600;display:grid;place-items:center;padding:18px;background:rgba(15,23,42,.58)}.a68-sync-dialog{width:min(760px,100%);max-height:calc(100vh - 36px);overflow:auto;display:grid;gap:14px;padding:18px;border-radius:18px;background:#fff;box-shadow:0 24px 80px rgba(15,23,42,.35)}.a68-sync-head{display:flex;justify-content:space-between;align-items:flex-start;gap:14px}.a68-sync-head h2{margin:2px 0 0}.a68-sync-close{width:42px;height:42px;border:0;border-radius:50%;background:#e2e8f0;font-size:1.5rem;cursor:pointer}.a68-sync-state{display:grid;gap:5px;padding:13px;border:1px solid #cbd5e1;border-radius:13px;background:#f8fafc}.a68-sync-state.ok{border-color:#86efac;background:#f0fdf4}.a68-sync-state.warn{border-color:#fdba74;background:#fff7ed}.a68-sync-state.bad{border-color:#fca5a5;background:#fff1f2}.a68-sync-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.a68-sync-metric{display:grid;gap:4px;padding:11px;border:1px solid #dbe5ec;border-radius:12px;background:#fff}.a68-sync-metric span{font-size:.78rem;color:#64748b}.a68-sync-metric strong{font-size:1.15rem}.a68-sync-actions{display:flex;gap:8px;flex-wrap:wrap}.a68-sync-note{padding:11px;border-radius:11px;background:#eef6fb;color:#334155}.a68-sync-status{padding:10px;border-radius:10px;background:#f8fafc}.a68-sync-status.danger{background:#fff1f2;color:#991b1b}.a68-sync-status.success{background:#f0fdf4;color:#166534}.a68-sync-token{display:grid;gap:9px;padding:12px;border:1px solid #fdba74;border-radius:12px;background:#fff7ed}.a68-sync-token code{display:block;overflow-wrap:anywhere;padding:9px;border-radius:8px;background:#0f172a;color:#f8fafc}.a68-sync-details{display:grid;gap:6px}.a68-sync-details summary{cursor:pointer;font-weight:750}.a68-sync-details ul{margin:0;padding-left:20px}.a68-sync-link{color:#075985;font-weight:750}@media(max-width:700px){.a68-sync-grid{grid-template-columns:1fr}.a68-sync-actions .button{width:100%}.a68-sync-dialog{padding:14px}}
  `;
  document.head.append(style);
}

function dateTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' });
}

function hoursLabel(value) {
  const hours = Number(value);
  if (!Number.isFinite(hours)) return 'sin actualización';
  if (hours < 1) return 'hace menos de 1 h';
  if (hours < 24) return `hace ${Math.round(hours)} h`;
  const days = Math.floor(hours / 24);
  return `hace ${days} ${days === 1 ? 'día' : 'días'}`;
}

function isPrimary(profile) {
  return profile?.activo === true && profile?.tipo_usuario === 'administrador_principal';
}

async function currentProfile(force = false) {
  if (!force && profileCache) return profileCache;
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData?.user?.id) return null;
  const { data, error } = await supabase
    .from('usuarios')
    .select('id,tipo_usuario,activo,debe_cambiar_clave')
    .eq('id', authData.user.id)
    .maybeSingle();
  if (error) throw error;
  profileCache = data || null;
  return profileCache;
}

async function readStatus() {
  const { data, error } = await supabase.rpc('estado_sync_manteniment');
  if (error) throw error;
  statusCache = Array.isArray(data) ? data[0] : data;
  return statusCache || {};
}

function stateKind(status) {
  if (!status?.ultima_correcta) return 'bad';
  if (!status?.token_activo) return 'warn';
  return status?.desactualizada ? 'bad' : 'ok';
}

function stateCopy(status) {
  if (!status?.ultima_correcta) return ['Sin carga inicial', 'Metrogestión todavía no dispone de un maestro ALTA válido.'];
  if (!status?.token_activo) return ['Carga inicial realizada · conexión pendiente', `Última carga correcta ${hoursLabel(status.horas_desde_ultima_correcta)}. Falta activar el envío automático desde Google.`];
  if (status?.desactualizada) return ['Flota desactualizada', `La última carga correcta fue ${hoursLabel(status.horas_desde_ultima_correcta)}.`];
  return ['Flota actualizada', `Última carga correcta ${hoursLabel(status.horas_desde_ultima_correcta)}.`];
}

function updateButton(status = statusCache) {
  const button = document.querySelector('#alpha68-manteniment-sync-button');
  if (!button) return;
  const kind = stateKind(status);
  button.className = `button secondary compact a68-sync-button ${kind}`;
  if (!status?.ultima_correcta) button.textContent = '🔴 Flota · sin sincronizar';
  else if (!status?.token_activo) button.textContent = '🟠 Flota · falta conexión';
  else if (status?.desactualizada) button.textContent = '🔴 Flota · desactualizada';
  else button.textContent = '🟢 Flota · actualizada';
  button.title = status?.ultima_correcta
    ? `Última actualización: ${dateTime(status.ultima_correcta.fin_en || status.ultima_correcta.inicio_en)}`
    : 'Consultar la actualización de MANTENIMIENTOS';
}

function destroyDialog() {
  dialog?.remove();
  dialog = null;
  document.body.classList.remove('a68-sync-open');
}

function createMetric(label, value) {
  const card = el('div', null, 'a68-sync-metric');
  card.append(el('span', label), el('strong', value));
  return card;
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

function renderDialogStatus(host, status) {
  host.replaceChildren();
  const kind = stateKind(status);
  const [title, copy] = stateCopy(status);
  const state = el('section', null, `a68-sync-state ${kind}`);
  state.append(el('strong', title), el('span', copy));
  const last = status?.ultima_correcta;
  const grid = el('section', null, 'a68-sync-grid');
  grid.append(
    createMetric('Última actualización', last ? dateTime(last.fin_en || last.inicio_en) : '—'),
    createMetric('Altas en MANTENIMENT', status?.snapshot_altas ?? '—'),
    createMetric('Vehículos activos', (Number(status?.vehiculos_fuente_activos || 0) + Number(status?.vehiculos_manuales_activos || 0)) || '—'),
    createMetric('Desde MANTENIMENT', status?.vehiculos_fuente_activos ?? '—'),
    createMetric('Altas manuales conservadas', status?.vehiculos_manuales_activos ?? '—'),
    createMetric('Filas con datos pendientes', last?.filas_con_avisos ?? '—')
  );
  const connection = el('div', status?.token_activo
    ? 'La clave de conexión está activa. El estado será correcto cuando Google tenga instalado el disparador y realice los envíos.'
    : 'La clave de conexión aún no está activa. La carga inicial existe, pero Google no puede actualizarla automáticamente.', 'a68-sync-note');
  const actions = el('div', null, 'a68-sync-actions');
  const refresh = el('button', 'Actualizar estado', 'button secondary');
  const activate = el('button', status?.token_activo ? 'Generar una clave nueva' : 'Preparar conexión con Google', 'button primary');
  refresh.type = activate.type = 'button';
  const actionStatus = el('div', '', 'a68-sync-status');
  actionStatus.hidden = true;

  refresh.addEventListener('click', async () => {
    refresh.disabled = true;
    actionStatus.hidden = false;
    actionStatus.className = 'a68-sync-status';
    actionStatus.textContent = 'Consultando la base de datos…';
    try {
      const next = await readStatus();
      updateButton(next);
      renderDialogStatus(host, next);
    } catch (error) {
      actionStatus.className = 'a68-sync-status danger';
      actionStatus.textContent = error?.message || 'No se pudo consultar la sincronización.';
      refresh.disabled = false;
    }
  });

  activate.addEventListener('click', async () => {
    activate.disabled = true;
    actionStatus.hidden = false;
    actionStatus.className = 'a68-sync-status';
    actionStatus.textContent = 'Generando una clave protegida…';
    const { data, error } = await supabase.rpc('generar_clave_sync_manteniment');
    if (error) {
      activate.disabled = false;
      actionStatus.className = 'a68-sync-status danger';
      actionStatus.textContent = error.message || 'No se pudo preparar la conexión.';
      return;
    }
    const result = Array.isArray(data) ? data[0] : data;
    const token = result?.token;
    if (!token) {
      activate.disabled = false;
      actionStatus.className = 'a68-sync-status danger';
      actionStatus.textContent = 'La base de datos no devolvió la clave de conexión.';
      return;
    }
    actionStatus.hidden = true;
    const tokenBox = el('section', null, 'a68-sync-token');
    tokenBox.append(
      el('strong', 'Clave creada · se muestra una sola vez'),
      el('span', 'Cópiala ahora y guárdala únicamente en las Propiedades del script de Google.'),
      el('code', token)
    );
    const tokenActions = el('div', null, 'a68-sync-actions');
    const copyButton = el('button', 'Copiar clave', 'button primary');
    const scriptLink = el('a', 'Abrir script para Google', 'button secondary');
    copyButton.type = 'button';
    scriptLink.href = 'https://github.com/metrogestion2026-eng/metrogestion-24h/blob/main/r1-alpha68/google-apps-script/sincronizar_manteniment.gs';
    scriptLink.target = '_blank';
    scriptLink.rel = 'noopener';
    const copyStatus = el('span', '');
    copyButton.addEventListener('click', async () => {
      try {
        await copyText(token);
        copyStatus.textContent = 'Clave copiada.';
      } catch (copyError) {
        copyStatus.textContent = copyError.message;
      }
    });
    tokenActions.append(copyButton, scriptLink, copyStatus);
    tokenBox.append(tokenActions);
    actions.replaceWith(tokenBox);
    readStatus().then(updateButton).catch(() => {});
  });

  actions.append(refresh, activate);
  const details = el('details', null, 'a68-sync-details');
  details.append(el('summary', 'Qué se actualiza y qué se protege'));
  const list = el('ul');
  [
    'Solo se aceptan filas cuyo campo MANTENIMENT sea exactamente ALTA.',
    'Se actualizan DFM y R; los registros manuales de Metrogestión se conservan.',
    'Las filas que desaparecen del maestro ALTA se desactivan, nunca se borran.',
    'Una caída anormal del número de altas bloquea la actualización para evitar bajas masivas.',
    'La clave no se guarda en GitHub ni se muestra a usuarios normales.'
  ].forEach(item => list.append(el('li', item)));
  details.append(list);
  host.append(state, grid, connection, actions, actionStatus, details);
}

async function openDialog() {
  destroyDialog();
  const overlay = el('div', null, 'a68-sync-overlay');
  const card = el('section', null, 'a68-sync-dialog');
  const head = el('div', null, 'a68-sync-head');
  const copy = el('div');
  copy.append(el('p', 'Control diario de flota', 'eyebrow'), el('h2', 'MANTENIMIENTOS → Metrogestión'));
  const close = el('button', '×', 'a68-sync-close');
  close.type = 'button';
  close.setAttribute('aria-label', 'Cerrar');
  head.append(copy, close);
  const host = el('div', 'Cargando estado…', 'a68-sync-status');
  card.append(head, host);
  overlay.append(card);
  document.body.append(overlay);
  document.body.classList.add('a68-sync-open');
  dialog = overlay;
  close.addEventListener('click', destroyDialog);
  overlay.addEventListener('click', event => { if (event.target === overlay) destroyDialog(); });
  try {
    const status = await readStatus();
    updateButton(status);
    renderDialogStatus(host, status);
  } catch (error) {
    host.className = 'a68-sync-status danger';
    host.textContent = error?.message || 'No se pudo cargar la sincronización.';
  }
}

function ensureButton(profile) {
  if (!sessionActions || !isPrimary(profile) || appView?.classList.contains('hidden') || profile?.debe_cambiar_clave) {
    document.querySelector('#alpha68-manteniment-sync-button')?.remove();
    return;
  }
  let button = document.querySelector('#alpha68-manteniment-sync-button');
  if (!button) {
    button = el('button', '🟠 Flota · comprobando', 'button secondary compact a68-sync-button warn');
    button.id = 'alpha68-manteniment-sync-button';
    button.type = 'button';
    button.addEventListener('click', openDialog);
    const suggestionsButton = document.querySelector('#alpha65-suggestions-button');
    sessionActions.insertBefore(button, suggestionsButton || logoutButton || null);
  }
  updateButton();
}

async function syncControl() {
  syncQueued = false;
  clearTimeout(refreshTimer);
  try {
    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData?.session) {
      profileCache = statusCache = null;
      document.querySelector('#alpha68-manteniment-sync-button')?.remove();
      return;
    }
    const profile = await currentProfile(true);
    ensureButton(profile);
    if (!isPrimary(profile)) return;
    const status = await readStatus();
    updateButton(status);
    refreshTimer = setTimeout(scheduleSync, 5 * 60 * 1000);
  } catch (error) {
    console.warn('No se pudo comprobar MANTENIMIENTOS en Alpha68.', error);
    updateButton();
  }
}

function scheduleSync() {
  if (syncQueued) return;
  syncQueued = true;
  queueMicrotask(syncControl);
}

ensureStyle();
if (appView) new MutationObserver(scheduleSync).observe(appView, { attributes: true, attributeFilter: ['class'] });
supabase.auth.onAuthStateChange(() => {
  profileCache = statusCache = null;
  scheduleSync();
});
scheduleSync();
