import { element } from '../dom.js';
import { supabase } from '../supabase.js';
import { renderMainSections } from './hotel-editor-main.js';
import { renderStagesSection } from './hotel-editor-stages.js';
import {
  displayDateTime, fichaPayload, normalizeDetail, requestId, stagesPayload, validate
} from './hotel-editor-utils.js';

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

export async function openHotelEditor(registroId, { onSaved } = {}) {
  let detail;
  let dirty = false;
  let saving = false;

  const overlay = element('div', { className: 'hotel-editor-overlay', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Edición completa de Hotel' });
  const panel = element('section', { className: 'hotel-editor-panel' });
  const body = element('div', { className: 'hotel-editor-body' });
  const status = element('div', { className: 'hotel-editor-status', role: 'status', 'aria-live': 'polite' });
  const closeButton = element('button', { className: 'button secondary compact', type: 'button', text: 'Cerrar' });
  const versionBadge = element('span', { className: 'badge', text: 'Cargando…' });
  const title = element('h2', { text: 'Edición completa de Hotel' });

  const header = element('header', { className: 'hotel-editor-header' }, [
    element('div', {}, [element('p', { className: 'eyebrow', text: 'Hotel · guardado único y auditado' }), title]),
    element('div', { className: 'hotel-editor-header-actions' }, [versionBadge, closeButton])
  ]);
  panel.append(header, status, body); overlay.append(panel); document.body.append(overlay); document.body.classList.add('editor-open');

  const markDirty = () => { dirty = true; status.className = 'hotel-editor-status'; status.textContent = 'Cambios pendientes de guardar.'; };
  const close = (force = false) => {
    if (saving && !force) return;
    if (!force && dirty && !window.confirm('Hay cambios sin guardar. ¿Cerrar igualmente?')) return;
    document.removeEventListener('keydown', handleKeydown); overlay.remove(); document.body.classList.remove('editor-open');
  };
  const handleKeydown = event => { if (event.key === 'Escape') close(false); };
  document.addEventListener('keydown', handleKeydown); closeButton.addEventListener('click', () => close(false));
  overlay.addEventListener('click', event => { if (event.target === overlay) close(false); });

  status.textContent = 'Cargando ficha, T, trabajos y maestro de vehículos ALTA…';
  const [detailResult, vehiclesResult] = await Promise.all([
    supabase.rpc('obtener_ficha_hotel_edicion', { p_registro_id: registroId }),
    supabase.from('vehiculos_hotel_autocompletar').select('*').order('dfm', { ascending: true })
  ]);
  if (detailResult.error || !detailResult.data) {
    status.className = 'hotel-editor-status error';
    status.textContent = detailResult.error?.message || 'No se pudo cargar la ficha de edición.';
    return;
  }

  detail = normalizeDetail(detailResult.data);
  detail.catalogos.vehiculos = vehiclesResult.error ? [] : (vehiclesResult.data || []);
  title.textContent = `Edición completa · ${detail.ficha.vehiculo_sustituido || detail.ficha.vehiculo_reserva || 'Hotel'}`;
  versionBadge.textContent = `Versión ${detail.ficha.version}`;

  const form = element('form', { className: 'hotel-editor-form' }); form.addEventListener('submit', event => event.preventDefault());
  const systemInfo = element('div', { className: 'editor-system-info' }, [
    element('span', { text: `ID: ${detail.ficha.id}` }), element('span', { text: `Pizarra: ${detail.ficha.pizarra_id}` }),
    element('span', { text: `Última modificación: ${displayDateTime(detail.ficha.actualizado_en)}` })
  ]);
  const [identification, operation, controls] = renderMainSections(detail, markDirty);
  const stagesSection = renderStagesSection(detail, markDirty);
  const errorsHost = element('div', { className: 'editor-errors hidden' });
  const saveButton = element('button', { className: 'button primary', type: 'button', text: 'Guardar ficha completa' });
  const discardButton = element('button', { className: 'button secondary', type: 'button', text: 'Cerrar sin guardar' });
  discardButton.addEventListener('click', () => close(false));

  saveButton.addEventListener('click', async () => {
    if (saving) return;
    const errors = validate(detail); renderErrors(errorsHost, errors); if (errors.length) return;
    saving = true; saveButton.disabled = true; discardButton.disabled = true; closeButton.disabled = true;
    status.className = 'hotel-editor-status'; status.textContent = 'Guardando toda la ficha en una única transacción y registrando la auditoría…';
    const saveRequestId = requestId();
    const { data: saved, error: saveError } = await supabase.rpc('guardar_ficha_hotel_edicion', {
      p_registro_id: detail.ficha.id, p_version: Number(detail.ficha.version), p_ficha: fichaPayload(detail.ficha),
      p_etapas: stagesPayload(detail.etapas), p_request_id: saveRequestId
    });
    if (saveError || !saved?.ok) {
      status.className = 'hotel-editor-status error'; status.textContent = saveError?.message || 'No se pudo guardar la ficha.';
      saveButton.disabled = false; discardButton.disabled = false; closeButton.disabled = false; saving = false; return;
    }
    dirty = false; detail = normalizeDetail(saved.detalle); versionBadge.textContent = `Versión ${saved.version}`;
    status.className = 'hotel-editor-status success';
    status.textContent = Number(saved.eventos_auditoria) === 0 ? '✓ No había cambios reales. No se creó ningún registro de auditoría.' : `✓ Ficha guardada. ${saved.eventos_auditoria} cambio(s) registrados con la referencia ${saved.request_id}.`;
    await onSaved?.(); saveButton.textContent = 'Guardado correctamente'; setTimeout(() => close(true), 1500);
  });

  form.append(systemInfo, identification, operation, controls, stagesSection, errorsHost,
    element('div', { className: 'editor-footer-actions' }, [saveButton, discardButton]));
  body.append(form);
  status.className = vehiclesResult.error ? 'hotel-editor-status' : 'hotel-editor-status success';
  status.textContent = vehiclesResult.error
    ? 'Ficha cargada. El maestro ALTA no está disponible; los campos siguen siendo editables manualmente.'
    : `Ficha cargada. Maestro ALTA disponible (${detail.catalogos.vehiculos.length} vehículos). Nada se modifica hasta guardar.`;
}
