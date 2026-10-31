import { supabase } from '../../r1-alpha17/src/supabase.js';
import { createContinuityController, continuityPreviewError } from './substitution-continuity-contract.js?v=75.25-continuidad-001';

function el(tag, text = null, className = '') {
  const node = document.createElement(tag);
  if (text != null) node.textContent = String(text);
  if (className) node.className = className;
  return node;
}

function ensureStyle() {
  if (document.querySelector('#alpha75-continuity-style')) return;
  const style = el('style');
  style.id = 'alpha75-continuity-style';
  style.textContent = `
    .a75-continuity-overlay{position:fixed;inset:0;z-index:12000;background:#0f172a99;display:flex;align-items:center;justify-content:center;padding:18px;box-sizing:border-box}
    .a75-continuity-dialog{background:#fff;color:#172b3a;border-radius:16px;padding:22px;max-width:850px;width:100%;max-height:92vh;overflow:auto;box-shadow:0 24px 70px #0f172a55}
    .a75-continuity-dialog h2{margin-top:0}.a75-continuity-dialog h3{margin-bottom:8px}
    .a75-continuity-fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin:16px 0}
    .a75-continuity-fields label{display:grid;gap:6px;font-weight:700}.a75-continuity-fields select{width:100%;padding:10px;min-height:44px;font:inherit;box-sizing:border-box}
    .a75-continuity-table{width:100%;border-collapse:collapse;margin:12px 0}.a75-continuity-table th,.a75-continuity-table td{text-align:left;padding:10px 8px;border-bottom:1px solid #dbe5ec;vertical-align:top}
    .a75-continuity-confirm{display:flex;gap:10px;align-items:flex-start;padding:12px 0}.a75-continuity-confirm input{width:20px;height:20px;flex:0 0 auto}
    .a75-continuity-actions{display:flex;justify-content:flex-end;gap:10px;flex-wrap:wrap;margin-top:16px}.a75-continuity-status{margin-top:12px;white-space:pre-line}
    .a75-continuity-identity{padding:10px 12px;background:#f1f5f9;border-radius:9px;margin:8px 0}.a75-continuity-dialog [hidden]{display:none!important}
    @media(max-width:650px){.a75-continuity-fields{grid-template-columns:1fr}.a75-continuity-dialog{padding:16px}.a75-continuity-table{font-size:14px}.a75-continuity-overlay{padding:8px}}
  `;
  document.head.append(style);
}

function formatDate(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : '—';
}

function formatTime(value) {
  if (!value) return 'Sin entrada real acreditada';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Fecha no válida' : date.toLocaleString('es-ES', {
    timeZone: 'Europe/Madrid', dateStyle: 'short', timeStyle: 'short',
  });
}

function paLabel(value) {
  return value?.numero_parada ? `PA ${value.numero_parada}` : 'PA sin número';
}

function identityText(value) {
  return `${paLabel(value)} · ${value?.dfm || 'Vehículo sin identificar'}${value?.matricula ? ` · ${value.matricula}` : ''}`;
}

function substituteText(value) {
  return value?.sustituto
    ? `${value.tipo_sustituto || 'Sustituto'} ${value.sustituto}${value.matricula_sustituto ? ` · ${value.matricula_sustituto}` : ''}`
    : 'Sin sustituto asignado';
}

function option(value, text) {
  const node = el('option', text);
  node.value = value;
  return node;
}

function renderTranches(host, preview) {
  host.replaceChildren();
  if (!preview) return;
  host.append(
    el('h3', 'Reparto previsto'),
    el('div', `Origen: ${identityText(preview.origen)}`, 'a75-continuity-identity'),
    el('div', `Destino: ${identityText(preview.destino)}`, 'a75-continuity-identity'),
    el('p', `Mismo sustituto: ${substituteText(preview.origen)}`),
    el('p', `Entrada real en taller: ${formatTime(preview.entrada?.fecha_inicio_real)} · Día de entrada: ${formatDate(preview.entrada?.dia_entrada)} (Europe/Madrid).`)
  );
  const table = el('table', null, 'a75-continuity-table');
  table.setAttribute('aria-label', 'Reparto de días imputables');
  const head = el('tr');
  ['PA', 'Inicio de imputación', 'Fin de imputación', 'Días imputables'].forEach(text => head.append(el('th', text)));
  const thead = el('thead');
  thead.append(head);
  const body = el('tbody');
  for (const [label, tranche] of [['Origen', preview.tramo_origen], ['Destino', preview.tramo_destino]]) {
    if (!tranche) continue;
    const row = el('tr');
    row.append(
      el('th', label),
      el('td', formatDate(tranche.fecha_inicio_imputacion)),
      el('td', tranche.fecha_fin_imputacion ? formatDate(tranche.fecha_fin_imputacion) : 'Abierto'),
      el('td', tranche.dias_imputables == null ? '—' : String(tranche.dias_imputables))
    );
    body.append(row);
  }
  table.append(thead, body);
  host.append(table, el('p', `Días calculados hasta ${formatDate(preview.fecha_referencia)}${preview.periodo ? ` · Periodo ${typeof preview.periodo === 'object' ? preview.periodo.periodo || '—' : preview.periodo}` : ''}. El tramo destino permanece abierto hasta la recuperación real.`, 'muted'));
  if (preview.tramo_origen?.dias_imputables === 0) {
    host.append(el('p', 'La PA de origen queda con 0 días imputables. El día de entrada pertenece íntegramente a la PA de taller.', 'notice warning'));
  }
}

function renderLinks(host, context) {
  host.replaceChildren();
  const links = context?.continuidades || [];
  host.hidden = !links.length;
  if (!links.length) return;
  host.append(el('h3', 'Continuidades confirmadas'));
  const list = el('ul');
  for (const link of links) {
    list.append(el('li', `PA ${link.origen_numero_parada || '—'} → PA ${link.destino_numero_parada || '—'} · Entrada real: ${formatTime(link.fecha_hora_entrada)} · Día de entrada: ${formatDate(link.dia_entrada)}`));
  }
  host.append(list);
  if (Object.hasOwn(context, 'propietario_actual')) {
    host.append(el('p', context.propietario_actual
      ? `Asignación vigente actual: ${paLabel(context.propietario_actual)}.`
      : 'Asignación vigente actual: sin PA propietaria.'));
  }
}

export function openSubstitutionContinuity(destinationId, { onSaved = async () => {}, readOnly = false } = {}) {
  ensureStyle();
  const previouslyFocused = document.activeElement;
  const overlay = el('div', null, 'a75-continuity-overlay');
  const dialog = el('section', null, 'a75-continuity-dialog');
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-label', 'Continuidad del mismo sustituto');
  dialog.tabIndex = -1;
  overlay.append(dialog);
  const identity = el('div', '', 'a75-continuity-identity');
  const fields = el('div', null, 'a75-continuity-fields');
  const originLabel = el('label', 'PA de origen');
  const origin = el('select');
  origin.setAttribute('aria-label', 'PA de origen');
  originLabel.append(origin);
  const entryLabel = el('label', 'Entrada real en taller');
  const entry = el('select');
  entry.setAttribute('aria-label', 'Entrada real en taller');
  entryLabel.append(entry);
  fields.append(originLabel, entryLabel);
  fields.hidden = readOnly;
  const previewHost = el('section');
  const blockers = el('div');
  const links = el('section');
  const acknowledgement = el('label', null, 'a75-continuity-confirm');
  const acknowledged = el('input');
  acknowledged.type = 'checkbox';
  acknowledged.setAttribute('aria-label', 'Confirmo la entrada real y la continuidad del mismo sustituto');
  acknowledgement.append(acknowledged, el('span', 'Confirmo la entrada real y la continuidad del mismo sustituto entre estas dos PA.'));
  const status = el('div', '', 'a75-continuity-status');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  const actions = el('div', null, 'a75-continuity-actions');
  const reload = el('button', 'Actualizar contexto', 'button secondary');
  const preview = el('button', 'Previsualizar continuidad', 'button secondary');
  const confirm = el('button', 'Confirmar continuidad', 'button primary');
  const close = el('button', 'Cerrar', 'button secondary');
  [reload, preview, confirm, close].forEach(button => { button.type = 'button'; });
  preview.hidden = confirm.hidden = readOnly;
  actions.append(reload, preview, confirm, close);
  dialog.append(
    el('h2', 'Continuidad del mismo sustituto'),
    el('p', 'El día de entrada real pertenece por completo a la PA de taller. La PA de origen termina su imputación el día anterior, aunque resulte en cero días.'),
    identity, fields, blockers, previewHost, links, acknowledgement, status, actions
  );

  let controller;
  let savedNotified = false;
  let refreshError = '';
  function render(state) {
    const context = state.context;
    const locked = state.saving || state.uncertain || Boolean(state.confirmed);
    identity.textContent = context
      ? `${readOnly ? 'PA consultada' : 'PA de destino'}: ${identityText(context.destino)}`
      : (readOnly ? 'Consultando la PA…' : 'Consultando la PA de destino…');
    origin.replaceChildren(option('', 'Selecciona una PA de origen'), ...(context?.origenes || []).map(row => option(row.id, `${identityText(row)} · ${substituteText(row)}`)));
    entry.replaceChildren(option('', 'Selecciona una T de entrada'), ...(context?.entradas || []).map(row => option(row.id, `${row.nombre || 'Entrada en taller'} · ${formatTime(row.fecha_inicio_real)}`)));
    origin.value = state.originId;
    entry.value = state.entryId;
    origin.disabled = entry.disabled = locked || state.reading;
    preview.disabled = locked || state.reading || !state.originId || !state.entryId;
    reload.disabled = locked || state.reading;
    close.disabled = state.saving || state.uncertain;
    acknowledged.checked = state.acknowledged;
    acknowledged.disabled = locked || state.reading;
    acknowledgement.hidden = readOnly || !context?.prevision || Boolean(state.confirmed);
    confirm.disabled = state.saving || state.reading || Boolean(state.confirmed) || !state.acknowledged
      || (!state.uncertain && Boolean(continuityPreviewError(context, { destinationId, originId: state.originId, entryId: state.entryId })));
    confirm.textContent = state.saving ? 'Confirmando…' : state.uncertain ? 'Reintentar confirmación' : 'Confirmar continuidad';
    const issues = [...(context?.bloqueos || []), ...(context?.prevision?.bloqueos || [])];
    blockers.replaceChildren();
    if (!readOnly && issues.length && !state.confirmed) {
      const unique = [...new Map(issues.map(item => [`${item.codigo}|${item.mensaje}`, item])).values()];
      unique.forEach(item => blockers.append(el('p', item.mensaje || item.codigo || 'Revisa los datos de la continuidad.', 'notice warning')));
    }
    renderTranches(previewHost, context?.prevision);
    renderLinks(links, context);
    status.className = `a75-continuity-status${state.error || refreshError ? ' notice warning' : state.confirmed ? ' notice success' : ''}`;
    if (state.confirmed) {
      const owner = state.confirmed.propietario_actual;
      status.textContent = `Continuidad confirmada entre ${paLabel(context.prevision.origen)} y ${paLabel(context.prevision.destino)}.${state.confirmed.reutilizada ? ' Se ha comprobado la misma petición ya registrada.' : ''} ${owner ? `Asignación vigente actual: ${paLabel(owner)}.` : 'Asignación vigente actual: sin PA propietaria.'}${refreshError ? ` ${refreshError}` : ''}`;
    } else status.textContent = state.error || (state.saving ? 'Guardando la continuidad…' : state.reading ? 'Consultando el servidor…' : readOnly && !context?.continuidades?.length ? 'No hay continuidades confirmadas para esta PA.' : '');
  }

  function dismiss() {
    if (!controller.dispose()) return;
    overlay.remove();
    if (previouslyFocused?.isConnected) previouslyFocused.focus();
  }
  controller = createContinuityController({ client: supabase, destinationId, onChange: render });
  origin.addEventListener('change', () => controller.select({ originId: origin.value }));
  entry.addEventListener('change', () => controller.select({ entryId: entry.value }));
  acknowledged.addEventListener('change', () => controller.acknowledge(acknowledged.checked));
  reload.addEventListener('click', () => { void controller.load(); });
  preview.addEventListener('click', () => { void controller.preview(); });
  confirm.addEventListener('click', async () => {
    const result = await controller.confirm();
    if (!result || savedNotified) return;
    savedNotified = true;
    try { await onSaved(result); }
    catch (_) {
      refreshError = 'La continuidad está guardada. Actualiza Hotel para volver a consultar las fichas.';
      render(controller.state);
    }
  });
  close.addEventListener('click', dismiss);
  dialog.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); dismiss(); }
    if (event.key !== 'Tab') return;
    const available = [...dialog.querySelectorAll('button,select,input')].filter(node => !node.disabled && !node.hidden && !node.closest('[hidden]'));
    if (!available.length) { event.preventDefault(); dialog.focus(); return; }
    const first = available[0], last = available.at(-1);
    if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });
  document.body.append(overlay);
  render(controller.state);
  dialog.focus();
  void controller.load();
  return { controller, overlay };
}
