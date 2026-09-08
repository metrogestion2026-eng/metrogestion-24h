import { supabase } from '../../r1-alpha17/src/supabase.js';

const CONFIRM_WINDOW_MS = 5000;
const SECOND_PRESS_DELAY_MS = 650;
const STAGE_SELECT = [
  'id',
  'registro_hotel_id',
  'nombre',
  'posicion',
  'estado',
  'cancelado',
  'version',
  'reabierta_en',
  'reabierta_por',
  'motivo_reapertura',
  'reaperturas',
].join(',');

let primaryAdminPromise = null;

function el(tag, text = null, className = '') {
  const node = document.createElement(tag);
  if (text !== null && text !== undefined) node.textContent = String(text);
  if (className) node.className = className;
  return node;
}

function ensureStyle() {
  if (document.querySelector('#alpha74-stage-reopen-style')) return;
  const style = document.createElement('style');
  style.id = 'alpha74-stage-reopen-style';
  style.textContent = `
    .a74-reopen-host{margin-top:8px}.a74-reopen-disclosure{width:max-content;max-width:100%}.a74-reopen-toggle{display:inline-flex;align-items:center;cursor:pointer;list-style:none}.a74-reopen-toggle::-webkit-details-marker{display:none}.a74-reopen-disclosure[open]{width:100%}.a74-reopen-disclosure[open]>.a74-reopen-toggle{margin-bottom:8px}.a74-reopen-panel{display:grid;gap:8px;padding:10px 11px;border:1px solid #cbd5e1;border-radius:11px;background:#f8fafc}.a74-reopen-reason{width:100%;min-height:64px;resize:vertical}.a74-reopen-button{justify-self:start;min-width:230px}.a74-reopen-button.a74-reopen-armed{border-color:#dc2626;background:#dc2626;color:#fff;font-weight:800}.a74-reopen-button.a74-reopen-saving{border-color:#94a3b8;background:#e2e8f0;color:#334155}.a74-reopen-help{font-size:.86rem;color:#64748b}.a74-reopen-status{padding:8px 9px;border-radius:8px;background:#fff1f2;color:#9f1239;font-size:.88rem}.a74-reopen-status.success{background:#f0fdf4;color:#166534}
    @media(max-width:720px){.a74-reopen-button{width:100%;justify-self:stretch}}
  `;
  document.head.append(style);
}

ensureStyle();

async function isPrimaryAdmin() {
  if (primaryAdminPromise) return primaryAdminPromise;
  primaryAdminPromise = (async () => {
    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError || !authData?.user?.id) return false;
    const { data, error } = await supabase
      .from('usuarios')
      .select('tipo_usuario,activo')
      .eq('id', authData.user.id)
      .maybeSingle();
    return !error && data?.activo === true && data?.tipo_usuario === 'administrador_principal';
  })();
  return primaryAdminPromise;
}

async function loadStage(stageId) {
  const { data, error } = await supabase
    .from('etapas_hotel')
    .select(STAGE_SELECT)
    .eq('id', stageId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

function refreshActiveModule() {
  const active = document.querySelector('#module-nav button.active');
  if (active && !active.disabled) {
    window.setTimeout(() => active.click(), 30);
    return;
  }
  window.location.reload();
}

function renderPanel(root, stage) {
  const disclosure = el('details', null, 'a74-reopen-disclosure');
  const toggle = el('summary', '↶ Deshacer realizada', 'button secondary compact a74-reopen-toggle');
  toggle.title = 'Abre las opciones para devolver esta T a Pendiente';
  const panel = el('section', null, 'a74-reopen-panel');
  const reason = el('textarea', null, 'a74-reopen-reason');
  reason.placeholder = 'Motivo obligatorio: por qué no se pudo realizar…';
  reason.maxLength = 500;
  reason.setAttribute('aria-label', 'Motivo de reapertura de la T');

  const button = el('button', '↶ Preparar reapertura', 'button secondary compact a74-reopen-button');
  button.type = 'button';
  button.title = 'Primera pulsación: preparar. Segunda pulsación intencionada: confirmar.';

  const help = el(
    'div',
    'No se borra la T: vuelve a Pendiente y queda auditado quién la reabrió, cuándo y por qué.',
    'a74-reopen-help'
  );
  const status = el('div', '', 'a74-reopen-status');
  status.hidden = true;
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');

  let armedAt = 0;
  let expiresAt = 0;
  let enableTimer = null;
  let tickTimer = null;
  let saving = false;

  const clearTimers = () => {
    if (enableTimer) window.clearTimeout(enableTimer);
    if (tickTimer) window.clearInterval(tickTimer);
    enableTimer = null;
    tickTimer = null;
  };

  const reset = (keepStatus = false) => {
    clearTimers();
    armedAt = 0;
    expiresAt = 0;
    saving = false;
    button.disabled = false;
    reason.disabled = false;
    button.className = 'button secondary compact a74-reopen-button';
    button.textContent = '↶ Preparar reapertura';
    if (!keepStatus) {
      status.hidden = true;
      status.textContent = '';
    }
  };

  const updateCountdown = () => {
    const remaining = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
    if (!remaining) {
      reset();
      return;
    }
    button.textContent = `Confirmar reapertura · ${remaining} s`;
  };

  const arm = () => {
    const motivo = reason.value.trim();
    if (motivo.length < 5) {
      status.hidden = false;
      status.textContent = 'Escribe primero un motivo de al menos 5 caracteres.';
      reason.focus();
      return;
    }
    clearTimers();
    armedAt = Date.now();
    expiresAt = armedAt + CONFIRM_WINDOW_MS;
    button.className = 'button compact a74-reopen-button a74-reopen-armed';
    button.disabled = true;
    reason.disabled = true;
    status.hidden = false;
    status.textContent = 'Pulsa de nuevo para confirmar. Si hay una T posterior realizada, la operación se bloqueará.';
    updateCountdown();
    enableTimer = window.setTimeout(() => {
      if (armedAt && Date.now() < expiresAt) button.disabled = false;
    }, SECOND_PRESS_DELAY_MS);
    tickTimer = window.setInterval(updateCountdown, 250);
  };

  const confirm = async () => {
    if (saving) return;
    saving = true;
    clearTimers();
    button.disabled = true;
    reason.disabled = true;
    button.className = 'button compact a74-reopen-button a74-reopen-saving';
    button.textContent = 'Reabriendo T…';
    status.hidden = false;
    status.textContent = 'Revirtiendo el realizado y preparando MANTENIMENT…';

    const requestId = `reopen_${crypto.randomUUID().replaceAll('-', '')}`;
    const { data, error } = await supabase.rpc('reabrir_t_realizada_rapida', {
      p_etapa_id: stage.id,
      p_version: Number(stage.version),
      p_motivo: reason.value.trim(),
      p_request_id: requestId,
    });

    if (error || !data?.ok) {
      reset(true);
      status.hidden = false;
      status.textContent = error?.message || 'No se pudo reabrir la T.';
      const fresh = await loadStage(stage.id).catch(() => null);
      if (fresh) stage.version = fresh.version;
      return;
    }

    root.replaceChildren();
    const success = el('div', null, 'a74-reopen-status success');
    success.append(el('strong', '✓ T reabierta'), el('div', data.efecto || 'La T vuelve a Pendiente.'));
    root.append(success);
    window.setTimeout(refreshActiveModule, 900);
  };

  button.addEventListener('click', () => {
    if (saving) return;
    const now = Date.now();
    if (!armedAt || now >= expiresAt) {
      arm();
      return;
    }
    if (now - armedAt < SECOND_PRESS_DELAY_MS) return;
    confirm();
  });

  panel.append(reason, button, help, status);
  disclosure.append(toggle, panel);
  root.append(disclosure);
}

export function createStageReopenControl(stage) {
  const root = el('div', null, 'a74-reopen-host');
  root.hidden = true;
  if (!stage?.id) return root;

  (async () => {
    try {
      const [primaryAdmin, fresh] = await Promise.all([
        isPrimaryAdmin(),
        loadStage(stage.id),
      ]);
      if (!root.isConnected || !primaryAdmin || !fresh) {
        root.remove();
        return;
      }
      if (fresh.cancelado || fresh.estado !== 'realizada') {
        root.remove();
        return;
      }
      root.hidden = false;
      renderPanel(root, fresh);
    } catch (error) {
      console.warn('No se pudo preparar el control de reapertura de la T.', error);
      root.remove();
    }
  })();

  return root;
}

supabase.auth.onAuthStateChange(() => {
  primaryAdminPromise = null;
});
