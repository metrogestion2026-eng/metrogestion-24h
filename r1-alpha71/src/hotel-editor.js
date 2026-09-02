import { element } from '../../r1-alpha17/src/dom.js';
import { supabase } from '../../r1-alpha17/src/supabase.js';
import { renderMainSections } from './hotel-editor-main.js';
import { renderStagesSection } from './hotel-editor-stages.js';
import {
  displayDateTime, fichaPayload, normalizeDetail, requestId, stagesPayload, validate
} from '../../r1-alpha17/src/modules/hotel-editor-utils.js';

function prepareDetail(raw) {
  const detail = normalizeDetail(raw);
  detail.catalogos.estados_etapa ||= [];
  detail.catalogos.tipos_etapa ||= [];
  return detail;
}

function alpha71FichaPayload(ficha) {
  return {
    ...fichaPayload(ficha),
    fecha_programada_parada: ficha.fecha_programada_parada || '',
    manteniment_fecha_corte: ficha.manteniment_fecha_corte || '',
    manteniment_tancament: ficha.manteniment_tancament || '',
    manteniment_tancament_supervisado: ficha.manteniment_tancament_supervisado === true,
    manteniment_dias_parada_manual: ficha.manteniment_dias_parada_manual ?? '',
    manteniment_km_facturables_manual: ficha.manteniment_km_facturables_manual ?? ''
  };
}

function stagesPayloadWithCatalogues(stages) {
  return stagesPayload(stages).map((payload, index) => ({
    ...payload,
    estado_catalogo_codigo: stages[index]?.estado_catalogo_codigo || payload.estado,
    taller_nombre: stages[index]?.taller_nombre || '',
    centro_nombre: stages[index]?.centro_nombre || ''
  }));
}

function renderErrors(host, errors) {
  host.replaceChildren();
  host.classList.toggle('hidden', errors.length === 0);
  if (!errors.length) return;
  host.append(element('strong', { text: 'Corrige antes de guardar:' }));
  const list = element('ul');
  errors.forEach(message => list.append(element('li', { text: message })));
  host.append(list);
  host.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function savedMessage(saved) {
  const auditEvents = Number(saved?.eventos_auditoria || 0);
  const catalogues = saved?.catalogos_nuevos || {};
  const labels = [['estados','estado de ficha'],['estados_etapa','estado de T'],['tipos_etapa','tipo de T'],['talleres','taller'],['centros','centro'],['tipos_trabajo','tipo de trabajo']];
  const added = labels.map(([key,label]) => [Number(catalogues[key] || 0),label]).filter(([count]) => count > 0).map(([count,label]) => `${count} ${label}${count === 1 ? '' : 's'} nuevo${count === 1 ? '' : 's'}`);
  const parts = [auditEvents ? `${auditEvents} cambio${auditEvents === 1 ? '' : 's'} auditado${auditEvents === 1 ? '' : 's'}` : 'sin cambios adicionales que auditar'];
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
    supabase.rpc('obtener_ficha_hotel_edicion_alpha71', { p_registro_id: registroId }),
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
  const systemInfo = element('div', { className: 'editor-system-info' }, [
    element('span', { text: `ID: ${detail.ficha.id}` }),
    element('span', { text: `Pizarra: ${detail.ficha.pizarra_id}` }),
    element('span', { text: `Última modificación: ${displayDateTime(detail.ficha.actualizado_en)}` })
  ]);
  const [identification, operation, controls] = renderMainSections(detail, markDirty);
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
    const errors = validate(detail);
    renderErrors(errorsHost, errors);
    if (errors.length) return;

    saving = true;
    saveButton.disabled = true;
    discardButton.disabled = true;
    closeButton.disabled = true;
    status.className = 'hotel-editor-status';
    status.textContent = 'Guardando la ficha y actualizando sus listados editables…';

    const saveRequestId = requestId();
    const { data: saved, error: saveError } = await supabase.rpc('guardar_ficha_hotel_edicion_alpha71', {
      p_registro_id: detail.ficha.id,
      p_version: Number(detail.ficha.version),
      p_ficha: alpha71FichaPayload(detail.ficha),
      p_etapas: stagesPayloadWithCatalogues(detail.etapas),
      p_request_id: saveRequestId
    });

    if (saveError || !saved?.ok) {
      status.className = 'hotel-editor-status error';
      status.textContent = saveError?.message || 'No se pudo guardar la ficha.';
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
    identification,
    operation,
    controls,
    stagesSection,
    errorsHost,
    element('div', { className: 'editor-footer-actions' }, [saveButton, discardButton])
  );
  body.append(form);
  status.className = vehiclesResult.error ? 'hotel-editor-status' : 'hotel-editor-status success';
  status.textContent = vehiclesResult.error
    ? 'Ficha cargada. El maestro ALTA no está disponible; los campos siguen siendo editables manualmente.'
    : `Ficha cargada. Los desplegables permiten elegir o escribir valores nuevos. Nada se modifica hasta guardar.`;
}
