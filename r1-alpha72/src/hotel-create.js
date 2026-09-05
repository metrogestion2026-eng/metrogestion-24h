import { element } from '../../r1-alpha17/src/dom.js';
import { supabase } from '../../r1-alpha17/src/supabase.js';
import { renderMainSections } from './hotel-editor-main.js';
import { renderStagesSection, stagesPayloadWithCatalogues } from './hotel-editor-stages.js';
import { fichaPayload, requestId, validate } from '../../r1-alpha17/src/modules/hotel-editor-utils.js';

function alpha72FichaPayload(ficha) {
  return {
    ...fichaPayload(ficha),
    modalidad_operativa: ficha.modalidad_operativa || '',
    fecha_programada_parada: ficha.fecha_programada_parada || '',
    manteniment_fecha_corte: ficha.manteniment_fecha_corte || '',
    manteniment_tancament: ficha.manteniment_tancament || '',
    manteniment_tancament_supervisado: ficha.manteniment_tancament_supervisado === true,
    manteniment_dias_parada_manual: ficha.manteniment_dias_parada_manual ?? '',
    manteniment_km_facturables_manual: ficha.manteniment_km_facturables_manual ?? ''
  };
}

function renderErrors(host, errors) {
  host.replaceChildren();
  host.classList.toggle('hidden', errors.length === 0);
  if (!errors.length) return;
  host.append(element('strong', { text: 'Corrige antes de crear la ficha:' }));
  const list = element('ul');
  errors.forEach(message => list.append(element('li', { text: message })));
  host.append(list);
  host.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function blankDetail() {
  return {
    ficha: {
      numero_parada: '', vehiculo_sustituido: '', matricula_sustituido: '',
      vehiculo_reserva: '', matricula_reserva: '', etiqueta_reserva: '',
      modalidad_operativa: '',
      tipo_unidad: '', marca: '', tipo_motor: '', modelo: '', upc: '', telefono: '',
      prioridad: 5, estado: 'pendiente_taller', lugar: '', fecha_programada_parada: '', fecha_parada: '', fecha_entrada: '',
      tipo_movimiento: '', causa: '', trabajos_reserva: '', incidencia: '', proximo: '', observaciones: '',
      sustitucion_temporal: false, motivo_sustitucion_temporal: '', fecha_limite_sustitucion: '',
      orden: 0, retirado_hotel_activo: false, cancelado: false, motivo_cancelacion: '',
      manteniment_fecha_corte: '', manteniment_tancament: '',
      manteniment_tancament_supervisado: false,
      manteniment_dias_parada_manual: '', manteniment_km_facturables_manual: ''
    },
    etapas: [],
    catalogos: {
      estados: [], estados_etapa: [], tipos_etapa: [], tipos_trabajo: [], modalidades_operativas: [],
      talleres: [], vehiculos: []
    }
  };
}

function mergeWorkshopCentres(workshops, centres) {
  const centresByWorkshop = new Map();
  (centres || []).forEach(centre => {
    const list = centresByWorkshop.get(centre.taller_id) || [];
    list.push(centre);
    centresByWorkshop.set(centre.taller_id, list);
  });
  return (workshops || []).map(workshop => ({
    ...workshop,
    centros: centresByWorkshop.get(workshop.id) || []
  }));
}

export async function openHotelCreate({ onSaved } = {}) {
  let detail = blankDetail();
  let dirty = false;
  let saving = false;

  const overlay = element('div', { className: 'hotel-editor-overlay', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Añadir ficha al Hotel' });
  const panel = element('section', { className: 'hotel-editor-panel' });
  const body = element('div', { className: 'hotel-editor-body' });
  const status = element('div', { className: 'hotel-editor-status', role: 'status', 'aria-live': 'polite' });
  const closeButton = element('button', { className: 'button secondary compact', type: 'button', text: 'Cerrar' });
  const title = element('h2', { text: 'Añadir ficha' });
  const header = element('header', { className: 'hotel-editor-header' }, [
    element('div', {}, [
      element('p', { className: 'eyebrow', text: 'Hotel · nueva ficha auditada' }),
      title
    ]),
    element('div', { className: 'hotel-editor-header-actions' }, [closeButton])
  ]);

  panel.append(header, status, body);
  overlay.append(panel);
  document.body.append(overlay);
  document.body.classList.add('editor-open');

  const markDirty = () => {
    dirty = true;
    status.className = 'hotel-editor-status';
    status.textContent = 'Datos preparados. Nada se crea hasta pulsar “Crear ficha”.';
  };
  const close = (force = false) => {
    if (saving && !force) return;
    if (!force && dirty && !window.confirm('Hay datos sin guardar. ¿Cerrar igualmente?')) return;
    document.removeEventListener('keydown', handleKeydown);
    overlay.remove();
    document.body.classList.remove('editor-open');
  };
  const handleKeydown = event => { if (event.key === 'Escape') close(false); };
  document.addEventListener('keydown', handleKeydown);
  closeButton.addEventListener('click', () => close(false));
  overlay.addEventListener('click', event => { if (event.target === overlay) close(false); });

  status.textContent = 'Cargando estados, T, talleres y maestro de vehículos ALTA…';
  const [
    statesResult, stageStatesResult, stageTypesResult, workTypesResult,
    workshopsResult, centresResult, vehiclesResult, modalitiesResult
  ] = await Promise.all([
    supabase.from('catalogo_estados_hotel').select('codigo,nombre,orden,color_semantico').eq('activo', true).order('orden', { ascending: true }),
    supabase.from('catalogo_estados_etapa_hotel').select('codigo,nombre,estado_operativo,orden').eq('activo', true).order('orden', { ascending: true }),
    supabase.from('catalogo_tipos_etapa_hotel').select('codigo,nombre,orden').eq('activo', true).order('orden', { ascending: true }),
    supabase.from('catalogo_tipos_trabajo').select('codigo,nombre,requiere_expediente,requiere_diagnostico').eq('activo', true).order('codigo', { ascending: true }),
    supabase.from('talleres').select('id,nombre,observaciones').eq('activo', true).order('nombre', { ascending: true }),
    supabase.from('centros_taller').select('id,taller_id,nombre,direccion,poblacion').eq('activo', true).order('nombre', { ascending: true }),
    supabase.from('vehiculos_hotel_autocompletar').select('*').order('dfm', { ascending: true }),
    supabase.from('catalogo_modalidades_operativas_hotel').select('codigo,nombre,comportamiento,orden').eq('activo', true).order('orden', { ascending: true })
  ]);

  const catalogueError = [
    statesResult, stageStatesResult, stageTypesResult, workTypesResult,
    workshopsResult, centresResult, modalitiesResult
  ].find(result => result.error)?.error;
  if (catalogueError) {
    status.className = 'hotel-editor-status error';
    status.textContent = `No se pudieron cargar los catálogos necesarios: ${catalogueError.message}`;
    return;
  }

  detail.catalogos.estados = statesResult.data || [];
  detail.catalogos.estados_etapa = stageStatesResult.data || [];
  detail.catalogos.tipos_etapa = stageTypesResult.data || [];
  detail.catalogos.tipos_trabajo = workTypesResult.data || [];
  detail.catalogos.talleres = mergeWorkshopCentres(workshopsResult.data, centresResult.data);
  detail.catalogos.vehiculos = vehiclesResult.error ? [] : (vehiclesResult.data || []);
  detail.catalogos.modalidades_operativas = modalitiesResult.data || [];

  const form = element('form', { className: 'hotel-editor-form' });
  form.addEventListener('submit', event => event.preventDefault());
  const sections = renderMainSections(detail, markDirty);
  const stagesSection = renderStagesSection(detail, markDirty);
  const errorsHost = element('div', { className: 'editor-errors hidden' });
  const createButton = element('button', { className: 'button primary', type: 'button', text: 'Crear ficha' });
  const cancelButton = element('button', { className: 'button secondary', type: 'button', text: 'Cancelar' });
  cancelButton.addEventListener('click', () => close(false));

  createButton.addEventListener('click', async () => {
    if (saving) return;
    const errors = validate(detail);
    renderErrors(errorsHost, errors);
    if (errors.length) return;

    saving = true;
    createButton.disabled = true;
    cancelButton.disabled = true;
    closeButton.disabled = true;
    status.className = 'hotel-editor-status';
    status.textContent = 'Creando ficha y T, asignando número de parada y registrando auditoría…';

    const saveRequestId = requestId();
    const { data, error } = await supabase.rpc('crear_ficha_hotel_con_etapas_alpha72', {
      p_ficha: alpha72FichaPayload(detail.ficha),
      p_etapas: stagesPayloadWithCatalogues(detail.etapas),
      p_request_id: saveRequestId
    });

    if (error || !data?.ok) {
      status.className = 'hotel-editor-status error';
      status.textContent = error?.message || 'No se pudo crear la ficha.';
      createButton.disabled = false;
      cancelButton.disabled = false;
      closeButton.disabled = false;
      saving = false;
      return;
    }

    dirty = false;
    status.className = 'hotel-editor-status success';
    const stageCount = Number(data.etapas_guardadas || 0);
    const workCount = Number(data.trabajos_guardados || 0);
    status.textContent = `✓ Ficha creada con ${stageCount} T y ${workCount} trabajo${workCount === 1 ? '' : 's'}. Parada ${data.numero_parada || 'asignada'} · referencia ${data.request_id}.`;
    await onSaved?.();
    setTimeout(() => close(true), 1200);
  });

  form.append(
    sections[0],
    sections[1],
    stagesSection,
    element('p', { className: 'muted', text: 'La ficha y todas sus T se crearán juntas en la pizarra actual. El número de parada se asigna siempre automáticamente, aunque la fecha real de parada sea anterior. Al finalizar, la ficha se conserva en Histórico.' }),
    errorsHost,
    element('div', { className: 'editor-footer-actions' }, [createButton, cancelButton])
  );
  body.append(form);

  status.className = vehiclesResult.error ? 'hotel-editor-status' : 'hotel-editor-status success';
  status.textContent = vehiclesResult.error
    ? 'Formulario listo. El maestro ALTA no está disponible; los campos siguen siendo editables manualmente.'
    : `Formulario listo. Maestro ALTA disponible (${detail.catalogos.vehiculos.length} vehículos).`;
}
