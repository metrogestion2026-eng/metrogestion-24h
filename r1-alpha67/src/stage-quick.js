import { supabase } from '../../r1-alpha17/src/supabase.js';
import { openHotelEditor } from './hotel-editor.js';

const CONFIRM_WINDOW_MS = 5000;
const SECOND_PRESS_DELAY_MS = 650;
const STAGE_SELECT = [
  'id',
  'registro_hotel_id',
  'seguimiento_id',
  'nombre',
  'posicion',
  'estado',
  'tipo_etapa',
  'accion_sistema',
  'fecha_prevista',
  'fecha_inicio_real',
  'fecha_fin_real',
  'fecha_real',
  'cancelado',
  'version',
  'marcado_rapido',
  'marcado_rapido_en',
  'marcado_rapido_por',
  'datos_pendientes',
  'datos_completados_en',
  'datos_completados_por',
].join(',');

let primaryAdminPromise = null;
const stageCache = new Map();
let stageQueue = new Map();
let stageQueueScheduled = false;

function el(tag, text = null, className = '') {
  const node = document.createElement(tag);
  if (text !== null && text !== undefined) node.textContent = String(text);
  if (className) node.className = className;
  return node;
}

function ensureStyle() {
  if (document.querySelector('#alpha67-stage-quick-style')) return;
  const style = document.createElement('style');
  style.id = 'alpha67-stage-quick-style';
  style.textContent = `
    .a67-quick-host{margin-top:10px}.a67-quick-panel,.a67-pending-panel,.a67-quick-success{display:grid;gap:8px;padding:10px 11px;border:1px solid #cbd5e1;border-radius:11px;background:#f8fafc}.a67-quick-panel{border-color:#93c5fd;background:#eff6ff}.a67-pending-panel{grid-template-columns:minmax(0,1fr) auto;align-items:center;border-color:#fbbf24;background:#fffbeb}.a67-pending-readonly{grid-template-columns:1fr}.a67-pending-copy{display:grid;gap:3px;color:#78350f}.a67-pending-copy span{font-size:.88rem}.a67-quick-success{border-color:#86efac;background:#f0fdf4;color:#166534}.a67-quick-success span{font-size:.9rem}.a67-quick-button{justify-self:start;min-width:190px}.a67-quick-button.a67-quick-armed{border-color:#f59e0b;background:#f59e0b;color:#111827;font-weight:800}.a67-quick-button.a67-quick-saving{border-color:#94a3b8;background:#e2e8f0;color:#334155}.a67-quick-help{font-size:.86rem;color:#475569}.a67-quick-status{padding:8px 9px;border-radius:8px;background:#f1f5f9;color:#334155;font-size:.88rem}.a67-quick-status.warning{background:#fff7ed;color:#9a3412}.a67-quick-status.danger{background:#fff1f2;color:#991b1b}.a67-quick-status.success{background:#f0fdf4;color:#166534}.a67-complete-button{white-space:nowrap}.a67-pending-badge{display:inline-flex;align-items:center;width:max-content;min-height:25px;padding:2px 8px;border:1px solid #fbbf24;border-radius:999px;background:#fef3c7;color:#92400e;font-size:.78rem;font-weight:800}
    @media(max-width:720px){.a67-pending-panel{grid-template-columns:1fr}.a67-quick-button,.a67-complete-button{width:100%;justify-self:stretch}}
  `;
  document.head.append(style);
}

ensureStyle();

function formatDateTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? String(value)
    : date.toLocaleString('es-ES', {
        timeZone: 'Europe/Madrid',
        dateStyle: 'short',
        timeStyle: 'short',
      });
}

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

    if (error) return false;
    return data?.activo === true && data?.tipo_usuario === 'administrador_principal';
  })();
  return primaryAdminPromise;
}

function queueStage(stageId, force = false) {
  if (!stageId) return Promise.resolve(null);
  if (!force && stageCache.has(stageId)) return Promise.resolve(stageCache.get(stageId));
  if (force) stageCache.delete(stageId);

  return new Promise((resolve, reject) => {
    const callbacks = stageQueue.get(stageId) || [];
    callbacks.push({ resolve, reject });
    stageQueue.set(stageId, callbacks);

    if (!stageQueueScheduled) {
      stageQueueScheduled = true;
      queueMicrotask(flushStageQueue);
    }
  });
}

async function flushStageQueue() {
  stageQueueScheduled = false;
  const currentQueue = stageQueue;
  stageQueue = new Map();
  const ids = [...currentQueue.keys()];
  if (!ids.length) return;

  const { data, error } = await supabase
    .from('etapas_hotel')
    .select(STAGE_SELECT)
    .in('id', ids);

  if (error) {
    currentQueue.forEach(callbacks => callbacks.forEach(({ reject }) => reject(error)));
    return;
  }

  const byId = new Map((data || []).map(stage => [stage.id, stage]));
  currentQueue.forEach((callbacks, id) => {
    const stage = byId.get(id) || null;
    if (stage) stageCache.set(id, stage);
    callbacks.forEach(({ resolve }) => resolve(stage));
  });
}

function actionConfig(stage) {
  if (stage.accion_sistema === 'recuperar_y_liberar') {
    return {
      initial: '✓ Marcar recuperación realizada',
      confirm: '¿Confirmar recuperación y liberación?',
      warning: 'Registrará la hora, pondrá la ficha como recuperada y liberará el sustituto.',
    };
  }
  if (stage.accion_sistema === 'liberar_reserva') {
    return {
      initial: '✓ Marcar liberación realizada',
      confirm: '¿Confirmar liberación de reserva?',
      warning: 'Registrará la hora y dejará la reserva disponible según sus pendientes.',
    };
  }
  if (stage.tipo_etapa === 'recogida_taller') {
    return {
      initial: '✓ Registrar recogida realizada',
      confirm: '¿Confirmar recogida?',
      warning: 'Registrará esta hora como fecha real de salida del taller.',
    };
  }
  return {
    initial: '✓ Marcar realizada',
    confirm: '¿Confirmar realizada?',
    warning: 'Registrará la hora real y dejará un aviso para completar después los datos de la T.',
  };
}

function refreshActiveModule() {
  const active = document.querySelector('#module-nav button.active');
  if (active && !active.disabled) {
    window.setTimeout(() => active.click(), 30);
    return;
  }
  window.location.reload();
}

function successPanel(message) {
  const panel = el('div', null, 'a67-quick-success');
  panel.append(el('strong', '✓ Operación registrada'), el('span', message));
  return panel;
}

function pendingCopy(stage) {
  const copy = el('div', null, 'a67-pending-copy');
  copy.append(
    el('strong', '⚠ Datos pendientes de completar'),
    el(
      'span',
      `Marcada rápidamente el ${formatDateTime(stage.marcado_rapido_en || stage.fecha_real)}. La hora real ya está guardada.`
    )
  );
  return copy;
}

function readOnlyCompletionPanel(stage) {
  const panel = el('section', null, 'a67-pending-panel a67-pending-readonly');
  panel.append(pendingCopy(stage));
  return panel;
}

function completionPanel(stage, historical, root) {
  const panel = el('section', null, 'a67-pending-panel');
  const copy = pendingCopy(stage);

  const status = el('div', '', 'a67-quick-status');
  status.hidden = true;
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');

  const complete = el('button', 'Ver ficha y completar datos', 'button primary compact a67-complete-button');
  complete.type = 'button';
  complete.addEventListener('click', () => {
    complete.disabled = true;
    status.hidden = false;
    status.className = 'a67-quick-status';
    status.textContent = 'Abriendo la ficha completa. El aviso se cerrará cuando guardes desde esta opción.';

    openHotelEditor(stage.registro_hotel_id, {
      onSaved: async () => {
        status.hidden = false;
        status.className = 'a67-quick-status';
        status.textContent = 'Ficha guardada. Cerrando el aviso de datos pendientes…';

        const requestId = `quickdata_${crypto.randomUUID().replaceAll('-', '')}`;
        const { data, error } = await supabase.rpc('completar_datos_t_rapida', {
          p_registro_id: stage.registro_hotel_id,
          p_etapa_ids: [stage.id],
          p_request_id: requestId,
        });

        if (error || !data?.ok) {
          complete.disabled = false;
          status.className = 'a67-quick-status danger';
          status.textContent = `La ficha se ha guardado, pero no se pudo cerrar el aviso: ${error?.message || 'error desconocido'}`;
          window.alert(status.textContent);
          return;
        }

        const updated = Array.isArray(data?.detalle?.etapas)
          ? data.detalle.etapas.find(item => item.id === stage.id)
          : null;
        if (updated) stageCache.set(stage.id, updated);
        else stageCache.delete(stage.id);

        root.replaceChildren(successPanel('Datos completados y aviso cerrado.'));
        if (!historical) refreshActiveModule();
      },
    });

    window.setTimeout(() => {
      if (root.isConnected && !document.querySelector('.hotel-editor-overlay')) {
        complete.disabled = false;
      }
    }, 300);
  });

  panel.append(copy, complete, status);
  return panel;
}

function quickButtonPanel(stage, root) {
  const panel = el('section', null, 'a67-quick-panel');
  const config = actionConfig(stage);
  const button = el('button', config.initial, 'button secondary compact a67-quick-button');
  button.type = 'button';
  button.title = 'Primera pulsación: preparar. Segunda pulsación intencionada: confirmar.';

  const note = el(
    'div',
    'Protección activa: son necesarias dos pulsaciones. La segunda se habilita después de un instante y caduca a los 5 segundos.',
    'a67-quick-help'
  );
  const status = el('div', '', 'a67-quick-status');
  status.hidden = true;
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');

  let armedAt = 0;
  let expiresAt = 0;
  let tickTimer = null;
  let enableTimer = null;
  let saving = false;

  const clearTimers = () => {
    if (tickTimer) window.clearInterval(tickTimer);
    if (enableTimer) window.clearTimeout(enableTimer);
    tickTimer = null;
    enableTimer = null;
  };

  const reset = (keepStatus = false) => {
    clearTimers();
    armedAt = 0;
    expiresAt = 0;
    saving = false;
    button.disabled = false;
    button.className = 'button secondary compact a67-quick-button';
    button.textContent = config.initial;
    note.textContent = 'Protección activa: son necesarias dos pulsaciones. La segunda se habilita después de un instante y caduca a los 5 segundos.';
    if (!keepStatus) {
      status.hidden = true;
      status.textContent = '';
      status.className = 'a67-quick-status';
    }
  };

  const updateCountdown = () => {
    const remaining = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
    if (!remaining) {
      reset();
      return;
    }
    button.textContent = `${config.confirm} · ${remaining} s`;
  };

  const arm = () => {
    clearTimers();
    armedAt = Date.now();
    expiresAt = armedAt + CONFIRM_WINDOW_MS;
    button.className = 'button compact a67-quick-button a67-quick-armed';
    button.disabled = true;
    status.hidden = false;
    status.className = 'a67-quick-status warning';
    status.textContent = config.warning;
    note.textContent = 'Pulsa de nuevo el mismo botón para confirmar. Si no lo haces, se cancelará automáticamente.';
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
    button.className = 'button compact a67-quick-button a67-quick-saving';
    button.textContent = 'Guardando realizada…';
    status.hidden = false;
    status.className = 'a67-quick-status';
    status.textContent = 'Registrando la hora real y la trazabilidad…';

    const requestId = `quick_${crypto.randomUUID().replaceAll('-', '')}`;
    const { data, error } = await supabase.rpc('marcar_t_realizada_rapida', {
      p_etapa_id: stage.id,
      p_version: Number(stage.version),
      p_request_id: requestId,
    });

    if (error || !data?.ok) {
      reset(true);
      status.hidden = false;
      status.className = 'a67-quick-status danger';
      status.textContent = error?.message || 'No se pudo marcar la T como realizada.';
      const fresh = await queueStage(stage.id, true).catch(() => null);
      if (fresh) stage.version = fresh.version;
      return;
    }

    const savedStage = data.etapa || { ...stage, estado: 'realizada', datos_pendientes: true };
    stageCache.set(stage.id, savedStage);
    root.replaceChildren(successPanel(`${data.efecto || 'T marcada como realizada'}. Hora: ${formatDateTime(savedStage.fecha_real)}.`));
    window.setTimeout(refreshActiveModule, 800);
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

  panel.append(button, note, status);
  return panel;
}

function renderControl(root, stage, historical) {
  root.replaceChildren();
  root.hidden = false;

  if (stage.cancelado === true || stage.estado === 'anulada') {
    root.remove();
    return;
  }

  if (stage.datos_pendientes === true) {
    root.append(completionPanel(stage, historical, root));
    return;
  }

  if (!historical && stage.estado !== 'realizada') {
    root.append(quickButtonPanel(stage, root));
    return;
  }

  root.remove();
}

export function createQuickStageControl(stage, { historical = false } = {}) {
  const root = el('div', null, 'a67-quick-host');
  root.hidden = true;
  root.dataset.stageQuickId = stage?.id || '';

  if (!stage?.id) return root;

  (async () => {
    try {
      const primaryAdmin = await isPrimaryAdmin();
      const fresh = await queueStage(stage.id, true);
      if (!root.isConnected || !fresh) return;

      if (!primaryAdmin) {
        if (
          fresh.cancelado !== true
          && fresh.estado !== 'anulada'
          && fresh.datos_pendientes === true
        ) {
          root.hidden = false;
          root.replaceChildren(readOnlyCompletionPanel(fresh));
        } else {
          root.remove();
        }
        return;
      }

      renderControl(root, fresh, historical);
    } catch (error) {
      console.warn('No se pudo preparar el control rápido de la T.', error);
      root.remove();
    }
  })();

  return root;
}

supabase.auth.onAuthStateChange(() => {
  primaryAdminPromise = null;
  stageCache.clear();
  stageQueue = new Map();
});
