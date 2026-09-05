import { element } from '../../r1-alpha17/src/dom.js';
import { supabase } from '../../r1-alpha17/src/supabase.js';
import { renderMainSections } from './hotel-editor-main.js';
import { renderStagesSection, stagesPayloadWithCatalogues } from './hotel-editor-stages.js';
import { manualAnnotationsPayload, renderManualAnnotationsEditor } from './annotations.js';
import { saveErrorIssues, stageStateMismatchIssues } from './hotel-editor-validation.js';
import {
  displayDateTime, fichaPayload, normalizeDetail, requestId, validate
} from '../../r1-alpha17/src/modules/hotel-editor-utils.js';

function prepareDetail(raw) {
  const detail = normalizeDetail(raw);
  detail.catalogos.estados_etapa ||= [];
  detail.catalogos.tipos_etapa ||= [];
  detail.catalogos.modalidades_operativas ||= [];
  detail.anotaciones_manuales ||= [];
  return detail;
}

function alpha72FichaPayload(ficha, detail) {
  return {
    ...fichaPayload(ficha),
    modalidad_operativa: ficha.modalidad_operativa || '',
    fecha_programada_parada: ficha.fecha_programada_parada || '',
    manteniment_fecha_corte: ficha.manteniment_fecha_corte || '',
    manteniment_tancament: ficha.manteniment_tancament || '',
    manteniment_tancament_supervisado: ficha.manteniment_tancament_supervisado === true,
    manteniment_dias_parada_manual: ficha.manteniment_dias_parada_manual ?? '',
    manteniment_km_facturables_manual: ficha.manteniment_km_facturables_manual ?? '',
    anotaciones_manuales: manualAnnotationsPayload(detail)
  };
}

function clearValidationMarks(form) {
  form.querySelectorAll('.editor-field-needs-attention').forEach(field => {
    field.classList.remove('editor-field-needs-attention');
    field.querySelectorAll('[aria-invalid="true"]').forEach(control => control.removeAttribute('aria-invalid'));
  });
  form.querySelectorAll('.editor-field-error').forEach(message => message.remove());
  form.querySelectorAll('.editor-stage-card.has-validation-error').forEach(card => card.classList.remove('has-validation-error'));
}

function showValidationIssues(form, issues) {
  clearValidationMarks(form);
  let firstField = null;
  issues.forEach(issue => {
    if (!issue?.key) return;
    const field = [...form.querySelectorAll('[data-validation-key]')]
      .find(candidate => candidate.dataset.validationKey === issue.key);
    if (!field) return;
    field.classList.add('editor-field-needs-attention');
    field.closest('.editor-stage-card')?.classList.add('has-validation-error');
    const control = field.querySelector('input,select,textarea,button');
    control?.setAttribute('aria-invalid', 'true');
    field.append(element('small', {
      className: 'editor-field-error',
      text: `⚠ Modifica esta casilla: ${issue.message}`
    }));
    firstField ||= field;
  });
  if (!firstField) return false;
  firstField.scrollIntoView({ behavior: 'smooth', block: 'center' });
  window.setTimeout(() => firstField.querySelector('input,select,textarea,button')?.focus({ preventScroll: true }), 350);
  return true;
}

function renderErrors(host, errors) {
  host.replaceChildren();
  host.classList.toggle('hidden', errors.length === 0);
  if (!errors.length) return;
  host.append(element('strong', { text: 'Corrige antes de guardar:' }));
  const list = element('ul');
  errors.forEach(error => list.append(element('li', { text: error?.message || error })));
  host.append(list);
}

function savedMessage(saved) {
  const auditEvents = Number(saved?.eventos_auditoria || 0);
  const catalogues = saved?.catalogos_nuevos || {};
  const labels = [['estados','estado de ficha'],['estados_etapa','estado de T'],['tipos_etapa','tipo de T'],['talleres','taller'],['centros','centro'],['tipos_trabajo','tipo de trabajo']];
  const added = labels.map(([key,label]) => [Number(catalogues[key] || 0),label]).filter(([count]) => count > 0).map(([count,label]) => `${count} ${label}${count === 1 ? '' : 's'} nuevo${count === 1 ? '' : 's'}`);
  const parts = [auditEvents ? `${auditEvents} cambio${auditEvents === 1 ? '' : 's'} auditado${auditEvents === 1 ? '' : 's'}` : 'sin cambios adicionales que auditar'];
  if (saved?.reactivacion_coherente) parts.unshift('reactivación completa: ficha, T final y reserva sincronizadas');
  if (added.length) parts.push(`listados actualizados: ${added.join(', ')}`);
  return `✓ Ficha guardada: ${parts.join(' · ')}. Referencia ${saved?.request_id || '—'}.`;
}

export async function openHotelEditor(registroId, { onSaved } = {}) {
  let detail;
  let dirty = false;
  let saving = false;

  const overlay = element('div', {
    className: 'hotel-editor-overlay',
    role: 'dialog',
    'aria-modal': 'true',
    'aria-label': 'Edición completa de Hotel'
  });
  const panel = element('section', { className: 'hotel-editor-panel' });
  const body = element('div', { className: 'hotel-editor-body' });
  const status = element('div', {
    className: 'hotel-editor-status',
    role: 'status',
    'aria-live': 'polite'
  });
  const closeButton = element('button', {
    className: 'button secondary compact',
    type: 'button',
    text: 'Cerrar'
  });
  const versionBadge = element('span', { className: 'badge', text: 'Cargando…' });
  const title = element('h2', { text: 'Edición completa de Hotel' });

  const header = element('header', { className: 'hotel-editor-header' }, [
    element('div', {}, [
      element('p', { className: 'eyebrow', text: 'Hotel · guardado único y auditado' }),
      title
    ]),
    element('div', { className: 'hotel-editor-header-actions' }, [versionBadge, closeButton])
  ]);
  panel.append(header, status, body);
  overlay.append(panel);
  document.body.append(overlay);
  document.body.classList.add('editor-open');

  const markDirty = () => {
    dirty = true;
    status.className = 'hotel-editor-status';
    status.textContent = 'Cambios pendientes de guardar.';
  };
  const close = (force = false) => {
    if (saving && !force) return;
    if (!force && dirty && !window.confirm('Hay cambios sin guardar. ¿Cerrar igualmente?')) return;
    document.removeEventListener('keydown', handleKeydown);
    overlay.remove();
    document.body.classList.remove('editor-open');
  };
  const handleKeydown = event => {
    if (event.key === 'Escape') close(false);
  };
  document.addEventListener('keydown', handleKeydown);
  closeButton.addEventListener('click', () => close(false));
  overlay.addEventListener('click', event => {
    if (event.target === overlay) close(false);
  });

  status.textContent = 'Cargando ficha, T, trabajos y listado de tipos…';
  const [detailResult, vehiclesResult] = await Promise.all([
    supabase.rpc('obtener_ficha_hotel_edicion_alpha72', { p_registro_id: registroId }),
    supabase.from('vehiculos_hotel_autocompletar').select('*').order('dfm', { ascending: true })
  ]);
  if (detailResult.error || !detailResult.data) {
    status.className = 'hotel-editor-status error';
    status.textContent = detailResult.error?.message || 'No se pudo cargar la ficha de edición.';
    return;
  }

  detail = prepareDetail(detailResult.data);
  detail.catalogos.vehiculos = vehiclesResult.error ? [] : (vehiclesResult.data || []);
  title.textContent = `Edición completa · ${detail.ficha.vehiculo_sustituido || detail.ficha.vehiculo_reserva || 'Hotel'}`;
  versionBadge.textContent = `Versión ${detail.ficha.version}`;

  const form = element('form', { className: 'hotel-editor-form' });
  form.addEventListener('submit', event => event.preventDefault());
  form.addEventListener('input', event => {
    const field = event.target.closest?.('.editor-field-needs-attention');
    if (!field) return;
    field.classList.remove('editor-field-needs-attention');
    field.querySelector('.editor-field-error')?.remove();
    event.target.removeAttribute?.('aria-invalid');
    if (!field.closest('.editor-stage-card')?.querySelector('.editor-field-needs-attention')) {
      field.closest('.editor-stage-card')?.classList.remove('has-validation-error');
    }
  });
  const systemInfo = element('div', { className: 'editor-system-info' }, [
    element('span', { text: `ID: ${detail.ficha.id}` }),
    element('span', { text: `Pizarra: ${detail.ficha.pizarra_id}` }),
    element('span', { text: `Última modificación: ${displayDateTime(detail.ficha.actualizado_en)}` })
  ]);
  const [identification, operation, controls] = renderMainSections(detail, markDirty);
  const annotationsSection = renderManualAnnotationsEditor(detail, markDirty);
  const stagesSection = renderStagesSection(detail, markDirty);
  const errorsHost = element('div', { className: 'editor-errors hidden' });
  const saveButton = element('button', {
    className: 'button primary',
    type: 'button',
    text: 'Guardar ficha completa'
  });
  const discardButton = element('button', {
    className: 'button secondary',
    type: 'button',
    text: 'Cerrar sin guardar'
  });
  discardButton.addEventListener('click', () => close(false));

  saveButton.addEventListener('click', async () => {
    if (saving) return;
    clearValidationMarks(form);
    const fieldIssues = stageStateMismatchIssues(detail);
    const errors = [...validate(detail), ...fieldIssues];
    renderErrors(errorsHost, errors);
    if (errors.length) {
      const focused = showValidationIssues(form, fieldIssues);
      status.className = 'hotel-editor-status error';
      status.textContent = focused
        ? 'No se ha guardado. Te he llevado a la casilla marcada en rojo; corrígela y vuelve a guardar.'
        : 'No se ha guardado. Revisa la lista de campos obligatorios.';
      if (!focused) errorsHost.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }

    saving = true;
    saveButton.disabled = true;
    discardButton.disabled = true;
    closeButton.disabled = true;
    status.className = 'hotel-editor-status';
    status.textContent = 'Guardando la ficha y actualizando sus listados editables…';

    const saveRequestId = requestId();
    const { data: saved, error: saveError } = await supabase.rpc('guardar_ficha_hotel_edicion_alpha72', {
      p_registro_id: detail.ficha.id,
      p_version: Number(detail.ficha.version),
      p_ficha: alpha72FichaPayload(detail.ficha, detail),
      p_etapas: stagesPayloadWithCatalogues(detail.etapas),
      p_request_id: saveRequestId
    });

    if (saveError || !saved?.ok) {
      const fieldIssues = saveErrorIssues(detail, saveError);
      renderErrors(errorsHost, fieldIssues.length ? fieldIssues : [saveError?.message || 'No se pudo guardar la ficha.']);
      const focused = showValidationIssues(form, fieldIssues);
      status.className = 'hotel-editor-status error';
      status.textContent = focused
        ? 'No se ha guardado. Te he llevado a la casilla marcada en rojo; corrígela y vuelve a guardar.'
        : (saveError?.message || 'No se pudo guardar la ficha.');
      if (!focused) errorsHost.scrollIntoView({ behavior: 'smooth', block: 'center' });
      saveButton.disabled = false;
      discardButton.disabled = false;
      closeButton.disabled = false;
      saving = false;
      return;
    }

    dirty = false;
    detail = prepareDetail(saved.detalle);
    versionBadge.textContent = `Versión ${saved.version}`;
    status.className = 'hotel-editor-status success';
    status.textContent = savedMessage(saved);
    await onSaved?.();
    const cataloguesAdded = Object.values(saved?.catalogos_nuevos || {}).reduce((total, value) => total + Number(value || 0), 0);
    saveButton.textContent = cataloguesAdded ? 'Guardado · listados actualizados' : 'Guardado correctamente';
    setTimeout(() => close(true), 1900);
  });

  form.append(
    systemInfo,
    errorsHost,
    identification,
    operation,
    annotationsSection,
    controls,
    stagesSection,
    element('div', { className: 'editor-footer-actions' }, [saveButton, discardButton])
  );
  body.append(form);
  status.className = vehiclesResult.error ? 'hotel-editor-status' : 'hotel-editor-status success';
  status.textContent = vehiclesResult.error
    ? 'Ficha cargada. El maestro ALTA no está disponible; los campos siguen siendo editables manualmente.'
    : `Ficha cargada. Los desplegables permiten elegir o escribir valores nuevos. Nada se modifica hasta guardar.`;
}
