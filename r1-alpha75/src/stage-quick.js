import { supabase } from '../../r1-alpha17/src/supabase.js';
import { openHotelEditor } from './hotel-editor.js?v=75.26-taller-hitos-001';
import { usesWorkshopMilestones, workshopMilestoneAction } from './workshop-milestones.js?v=75.26-taller-hitos-001';

const CONFIRM_WINDOW_MS = 5000;
const SECOND_PRESS_DELAY_MS = 650;
const CONTEXT_BATCH_SIZE = 100;
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
  if (document.querySelector('#alpha75-stage-quick-style')) return;
  const style = document.createElement('style');
  style.id = 'alpha75-stage-quick-style';
  style.textContent = `
    .a75-quick-host{margin-top:10px}.a75-quick-panel,.a75-pending-panel,.a75-quick-success{display:grid;gap:8px;padding:10px 11px;border:1px solid #cbd5e1;border-radius:11px;background:#f8fafc}.a75-quick-panel{border-color:#93c5fd;background:#eff6ff}.a75-pending-panel{grid-template-columns:minmax(0,1fr) auto;align-items:center;border-color:#fbbf24;background:#fffbeb}.a75-pending-readonly{grid-template-columns:1fr}.a75-pending-copy{display:grid;gap:3px;color:#78350f}.a75-pending-copy span{font-size:.88rem}.a75-quick-success{border-color:#86efac;background:#f0fdf4;color:#166534}.a75-quick-success span{font-size:.9rem}.a75-quick-button{justify-self:start;min-width:190px}.a75-quick-button.a75-quick-armed{border-color:#f59e0b;background:#f59e0b;color:#111827;font-weight:800}.a75-quick-button.a75-quick-saving{border-color:#94a3b8;background:#e2e8f0;color:#334155}.a75-quick-help{font-size:.86rem;color:#475569}.a75-quick-status{padding:8px 9px;border-radius:8px;background:#f1f5f9;color:#334155;font-size:.88rem}.a75-quick-status.warning{background:#fff7ed;color:#9a3412}.a75-quick-status.danger{background:#fff1f2;color:#991b1b}.a75-quick-status.success{background:#f0fdf4;color:#166534}.a75-complete-button{white-space:nowrap}.a75-pending-badge{display:inline-flex;align-items:center;width:max-content;min-height:25px;padding:2px 8px;border:1px solid #fbbf24;border-radius:999px;background:#fef3c7;color:#92400e;font-size:.78rem;font-weight:800}
    @media(max-width:720px){.a75-pending-panel{grid-template-columns:1fr}.a75-quick-button,.a75-complete-button{width:100%;justify-self:stretch}}
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

  try {
    const primaryAdmin = await isPrimaryAdmin();
    const stages = [];
    for (let offset = 0; offset < ids.length; offset += CONTEXT_BATCH_SIZE) {
      const batch = ids.slice(offset, offset + CONTEXT_BATCH_SIZE);
      // El modelo pertenece a la ficha, no a etapas_hotel. El contexto obtiene
      // todas las T del lote sin una consulta adicional por cada tarjeta.
      const { data, error } = primaryAdmin
        ? await supabase.rpc('obtener_contexto_taller_t_alpha75', { p_etapa_ids: batch })
        : await supabase.from('etapas_hotel').select(STAGE_SELECT).in('id', batch);
      if (error) throw error;
      if (!Array.isArray(data)) throw new Error('No se pudo leer el contexto de las T.');
      if (primaryAdmin && data.some(stage => !stage.modelo_flujo_taller)) {
        throw new Error('Falta el modelo de taller de la ficha. Revisa la ficha antes de registrar un hito.');
      }
      stages.push(...data);
    }
    const byId = new Map(stages.map(stage => [stage.id, stage]));
    currentQueue.forEach((callbacks, id) => {
      const stage = byId.get(id) || null;
      if (stage) stageCache.set(id, stage);
      callbacks.forEach(({ resolve }) => resolve(stage));
    });
  } catch (error) {
    currentQueue.forEach(callbacks => callbacks.forEach(({ reject }) => reject(error)));
  }
}

function actionConfig(stage) {
  const milestone = workshopMilestoneAction(stage);
  if (milestone?.hito) return { ...milestone, initial: milestone.label };
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

function successPanel(message, title = '✓ Operación registrada') {
  const panel = el('div', null, 'a75-quick-success');
  panel.append(el('strong', title), el('span', message));
  return panel;
}

function pendingCopy(stage) {
  const copy = el('div', null, 'a75-pending-copy');
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
  const panel = el('section', null, 'a75-pending-panel a75-pending-readonly');
  panel.append(pendingCopy(stage));
  return panel;
}

function workshopIssuePanel(stage, message, root, historical = false) {
  const panel = el('section', null, 'a75-pending-panel');
  const copy = el('div', null, 'a75-pending-copy');
  copy.append(el('strong', 'Revisa los hitos de esta T'), el('span', message));
  const edit = el('button', 'Revisar fechas de la T', 'button secondary compact a75-complete-button');
  edit.type = 'button';
  edit.addEventListener('click', async () => {
    edit.disabled = true;
    try {
      await openHotelEditor(stage.registro_hotel_id, {
        onSaved: async () => {
          const fresh = await queueStage(stage.id, true);
          if (root.isConnected && fresh) renderControl(root, fresh, historical);
          if (!historical) refreshActiveModule();
        },
      });
    } catch (error) {
      copy.append(el('span', `No se pudo abrir la ficha: ${error?.message || 'error desconocido'}`));
    } finally {
      edit.disabled = false;
    }
  });
  panel.append(copy);
  if (stage.registro_hotel_id) panel.append(edit);
  return panel;
}

function completionPanel(stage, historical, root) {
  const panel = el('section', null, 'a75-pending-panel');
  const copy = pendingCopy(stage);

  const status = el('div', '', 'a75-quick-status');
  status.hidden = true;
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');

  const complete = el('button', 'Ver ficha y completar datos', 'button primary compact a75-complete-button');
  complete.type = 'button';
  complete.addEventListener('click', async () => {
    complete.disabled = true;
    status.hidden = false;
    status.className = 'a75-quick-status';
    status.textContent = 'Abriendo la ficha completa. El aviso se cerrará cuando guardes desde esta opción.';

    try {
      await openHotelEditor(stage.registro_hotel_id, {
        onSaved: async () => {
          status.hidden = false;
          status.className = 'a75-quick-status';
          status.textContent = 'Ficha guardada. Cerrando el aviso de datos pendientes…';

          const requestId = `quickdata_${crypto.randomUUID().replaceAll('-', '')}`;
          const { data, error } = await supabase.rpc('completar_datos_t_rapida', {
            p_registro_id: stage.registro_hotel_id,
            p_etapa_ids: [stage.id],
            p_request_id: requestId,
          });

          if (error || !data?.ok) {
            complete.disabled = false;
            status.className = 'a75-quick-status danger';
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
    } catch (error) {
      status.className = 'a75-quick-status danger';
      status.textContent = `No se pudo abrir la ficha: ${error?.message || 'error desconocido'}`;
    } finally {
      complete.disabled = false;
    }
  });

  panel.append(copy, complete, status);
  return panel;
}

function quickButtonPanel(stage, root, onMilestoneSaved) {
  const panel = el('section', null, 'a75-quick-panel');
  const config = actionConfig(stage);
  const button = el('button', config.initial, 'button secondary compact a75-quick-button');
  button.type = 'button';
  button.title = 'Primera pulsación: preparar. Segunda pulsación intencionada: confirmar.';

  const note = el(
    'div',
    'Protección activa: son necesarias dos pulsaciones. La segunda se habilita después de un instante y caduca a los 5 segundos.',
    'a75-quick-help'
  );
  const status = el('div', '', 'a75-quick-status');
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
    button.className = 'button secondary compact a75-quick-button';
    button.textContent = config.initial;
    note.textContent = 'Protección activa: son necesarias dos pulsaciones. La segunda se habilita después de un instante y caduca a los 5 segundos.';
    if (!keepStatus) {
      status.hidden = true;
      status.textContent = '';
      status.className = 'a75-quick-status';
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
    button.className = 'button compact a75-quick-button a75-quick-armed';
    button.disabled = true;
    status.hidden = false;
    status.className = 'a75-quick-status warning';
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
    button.className = 'button compact a75-quick-button a75-quick-saving';
    button.textContent = config.hito ? 'Guardando hito…' : 'Guardando realizada…';
    status.hidden = false;
    status.className = 'a75-quick-status';
    status.textContent = 'Registrando la hora real y la trazabilidad…';
    const versionBefore = Number(stage.version);
    const milestoneBefore = config.hito ? stage[config.field] : null;

    try {
      const requestId = `${config.hito ? 'hito75' : 'quick'}_${crypto.randomUUID().replaceAll('-', '')}`;
      const payload = {
        p_etapa_id: stage.id,
        p_version: versionBefore,
        p_request_id: requestId,
      };
      if (config.hito) payload.p_hito = config.hito;
      const { data, error } = await supabase.rpc(
        config.hito ? 'registrar_hito_taller_alpha75' : 'marcar_t_realizada_rapida',
        payload
      );
      if (error) throw error;
      if (!data?.ok) throw new Error(config.hito ? 'No se pudo registrar el hito de taller.' : 'No se pudo marcar la T como realizada.');

      // El servidor conserva los hitos anteriores y fija solo la hora del hecho
      // confirmado. La siguiente T es información para el usuario, no una acción.
      const savedStage = data.etapa || await queueStage(stage.id, true);
      if (!savedStage) throw new Error('La operación se ha enviado, pero no se pudo leer la T. Actualiza la ficha para comprobar el resultado.');
      stageCache.set(stage.id, savedStage);
      const effect = config.hito ? config.success : (data.efecto || 'T marcada como realizada');
      const when = savedStage[config.field || 'fecha_real'];
      const next = config.hito === 'recogido' && data.siguiente_etapa;
      const nextText = next ? ` Siguiente T: ${next.posicion}T · ${next.nombre || 'Sin nombre'}.` : '';
      if (config.hito) {
        const nextAction = workshopMilestoneAction(savedStage);
        const stateLabel = savedStage.estado === 'realizada' ? 'Realizada' : 'En curso';
        const nextMilestone = nextAction?.hito ? ` Próximo hito: ${nextAction.label}.` : '';
        renderControl(root, savedStage, false, onMilestoneSaved, { keepHost: true });
        root.prepend(successPanel(`${effect}. Hora: ${formatDateTime(when)}. Estado de la T: ${stateLabel}.${nextMilestone}${nextText}`));
        root.querySelector('.a75-quick-button')?.focus({ preventScroll: true });
        try {
          await onMilestoneSaved?.({ ...data, etapa: savedStage });
        } catch (renderError) {
          console.warn('El hito se guardó, pero no se pudo actualizar el resumen de la ficha.', renderError);
          if (root.isConnected) root.append(el('div', 'Movimiento guardado; no se pudo actualizar el resumen.', 'a75-quick-status warning'));
        }
      } else {
        root.replaceChildren(successPanel(`${effect}. Hora: ${formatDateTime(when)}.`));
        window.setTimeout(refreshActiveModule, 800);
      }
    } catch (error) {
      reset(true);
      status.hidden = false;
      status.className = 'a75-quick-status danger';
      status.textContent = error?.message || 'No se pudo registrar la operación.';
      const fresh = await queueStage(stage.id, true).catch(() => null);
      if (fresh && root.isConnected) {
        renderControl(root, fresh, false, onMilestoneSaved, { keepHost: true });
        if (config.hito && !milestoneBefore && fresh[config.field]
          && Number(fresh.version) > versionBefore) {
          // Una respuesta de red perdida no deshace el hecho. La relectura
          // acredita la fecha, aunque también pudo registrarla otro actor.
          const nextAction = workshopMilestoneAction(fresh);
          const stateLabel = ({ pendiente: 'Pendiente', programada: 'Programada', en_curso: 'En curso', realizada: 'Realizada', anulada: 'Anulada' })[fresh.estado] || fresh.estado || 'Sin estado';
          const nextMilestone = nextAction?.hito ? ` Próximo hito: ${nextAction.label}.` : '';
          root.prepend(successPanel(`Este hito consta guardado a ${formatDateTime(fresh[config.field])}. Estado de la T: ${stateLabel}.${nextMilestone}`, '✓ Hito comprobado'));
          root.querySelector('.a75-quick-button')?.focus({ preventScroll: true });
          try {
            await onMilestoneSaved?.({ etapa: fresh });
          } catch (renderError) {
            console.warn('El hito consta guardado, pero no se pudo actualizar el resumen de la ficha.', renderError);
            if (root.isConnected) root.append(el('div', 'Movimiento guardado; no se pudo actualizar el resumen.', 'a75-quick-status warning'));
          }
          return;
        }
        root.prepend(status);
      }
    }
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

function renderControl(root, stage, historical, onMilestoneSaved, { keepHost = false } = {}) {
  root.replaceChildren();
  root.hidden = false;

  if (stage.cancelado === true || stage.estado === 'anulada') {
    if (!keepHost) root.remove();
    return;
  }

  const milestone = workshopMilestoneAction(stage);
  if (milestone?.issue) {
    root.append(workshopIssuePanel(stage, milestone.issue, root, historical));
    return;
  }

  if (stage.datos_pendientes === true) {
    root.append(completionPanel(stage, historical, root));
    return;
  }

  if (!historical && (usesWorkshopMilestones(stage) ? milestone?.hito : stage.estado !== 'realizada')) {
    root.append(quickButtonPanel(stage, root, onMilestoneSaved));
    return;
  }

  if (!keepHost) root.remove();
}

export function createQuickStageControl(stage, { historical = false, onMilestoneSaved } = {}) {
  const root = el('div', null, 'a75-quick-host');
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

      renderControl(root, fresh, historical, onMilestoneSaved);
    } catch (error) {
      console.warn('No se pudo preparar el control rápido de la T.', error);
      if (!root.isConnected) return;
      if (await isPrimaryAdmin()) {
        root.hidden = false;
        root.replaceChildren(workshopIssuePanel(stage, error?.message || 'No se pudo leer el contexto de esta T. Actualiza la ficha antes de registrar un hito.', root, historical));
      } else {
        root.remove();
      }
    }
  })();

  return root;
}

supabase.auth.onAuthStateChange(() => {
  primaryAdminPromise = null;
  stageCache.clear();
  stageQueue = new Map();
});
