import { element } from '../../r1-alpha17/src/dom.js';
import { revealStagesFor } from './stages-collapse.js?v=75.18';
import { supabase } from '../../r1-alpha17/src/supabase.js';
import { renderMainSections } from './hotel-editor-main.js?v=75.26-dropdown-open-003';
import { renderStagesSection, stagesPayloadWithCatalogues } from './hotel-editor-stages.js?v=75.26-dropdown-open-003';
import { newStageTypeIssues } from './hotel-editor-validation.js?v=75.26-dropdown-open-003';
import {
  collectPendingStageDocuments,
  uploadPendingStageDocuments,
} from './editor-pending-documents.js?v=75.25-create-documents-001';
import {
  keepTemporaryStopNumberAlive,
  releaseTemporaryStopNumber,
  renewTemporaryStopNumber,
  reserveTemporaryStopNumber,
} from './hotel-stop-number.js?v=75.27-stop-number-001';
import { manualAnnotationsPayload, renderManualAnnotationsEditor } from './annotations.js';
import { fichaPayload, requestId, validate } from '../../r1-alpha17/src/modules/hotel-editor-utils.js';

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
      modelo_flujo_taller: 'entrada_hitos_v1',
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
    anotaciones_manuales: [],
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

function pendingDocumentCount(pending) {
  return (pending?.entries || []).reduce(
    (total, entry) => total + Number(entry?.documents?.length || 0),
    0
  );
}

export async function openHotelCreate({ onSaved } = {}) {
  const creationRequestId = requestId();
  let detail = blankDetail();
  let dirty = false;
  let saving = false;
  let closing = false;
  let closed = false;
  let created = false;
  let resultUnknown = false;
  let pendingDocumentRetry = null;
  let stopNumberLease = null;
  let stopNumberKeeper = null;
  let stopNumberInput = null;

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
    status.textContent = `Datos preparados para la actuación ${detail.ficha.numero_parada || 'reservada'}. Nada se crea hasta pulsar “Crear ficha”.`;
  };

  const stopHeartbeat = () => {
    stopNumberKeeper?.stop();
    stopNumberKeeper = null;
  };

  const startHeartbeat = () => {
    stopHeartbeat();
    if (!stopNumberLease || created || resultUnknown || closed) return;
    stopNumberKeeper = keepTemporaryStopNumberAlive(stopNumberLease, {
      onWarning: error => {
        if (closed || created || resultUnknown) return;
        status.className = 'hotel-editor-status error';
        status.textContent = `No se ha podido renovar todavía la reserva de la actuación ${detail.ficha.numero_parada}: ${error.message}. No cierres la ficha; se volverá a intentar.`;
      },
    });
  };

  const applyLease = lease => {
    stopNumberLease = lease;
    detail.ficha.numero_parada = lease.number;
    if (stopNumberInput) stopNumberInput.value = lease.number;
    title.textContent = `Añadir ficha · actuación ${lease.number}`;
    startHeartbeat();
  };

  const releaseLeaseBeforeClose = async () => {
    if (!stopNumberLease || created || resultUnknown) return true;
    closeButton.disabled = true;
    status.className = 'hotel-editor-status';
    status.textContent = `Liberando la actuación ${stopNumberLease.number} para que pueda reutilizarse…`;
    stopHeartbeat();
    try {
      await releaseTemporaryStopNumber(stopNumberLease.token);
      stopNumberLease = null;
      return true;
    } catch (error) {
      startHeartbeat();
      closeButton.disabled = false;
      status.className = 'hotel-editor-status error';
      status.textContent = `No se pudo liberar la actuación provisional: ${error.message}. Reintenta cerrar cuando vuelva la conexión.`;
      return false;
    }
  };

  const close = async (force = false) => {
    if (closed || closing || (saving && !force)) return;
    if (!force && resultUnknown) {
      if (!window.confirm(
        `No se ha podido confirmar si la actuación ${detail.ficha.numero_parada || ''} se creó. Al cerrar no se liberará el número de forma insegura; si no existe ninguna ficha, volverá a estar disponible al caducar la reserva. ¿Cerrar igualmente?`
      )) return;
    } else if (!force && pendingDocumentRetry) {
      const remaining = pendingDocumentCount(pendingDocumentRetry.pending);
      if (!window.confirm(
        `La ficha ya está creada, pero quedan ${remaining} archivo${remaining === 1 ? '' : 's'} sin subir. ¿Cerrar y descartarlos?`
      )) return;
      void onSaved?.();
    } else if (!force && dirty && !window.confirm('Hay datos sin guardar. ¿Cerrar igualmente y reutilizar este número de parada?')) {
      return;
    }

    closing = true;
    if (!force && !(await releaseLeaseBeforeClose())) {
      closing = false;
      return;
    }

    closed = true;
    stopHeartbeat();
    document.removeEventListener('keydown', handleKeydown);
    overlay.remove();
    document.body.classList.remove('editor-open');
  };

  const handleKeydown = event => {
    if (event.key === 'Escape') void close(false);
  };
  document.addEventListener('keydown', handleKeydown);
  closeButton.addEventListener('click', () => { void close(false); });
  overlay.addEventListener('click', event => {
    if (event.target === overlay) void close(false);
  });

  status.textContent = 'Reservando número de parada y cargando los datos necesarios…';

  const cataloguePromise = Promise.all([
    supabase.from('catalogo_estados_hotel').select('codigo,nombre,orden,color_semantico').eq('activo', true).order('orden', { ascending: true }),
    supabase.from('catalogo_estados_etapa_hotel').select('codigo,nombre,estado_operativo,orden').eq('activo', true).order('orden', { ascending: true }),
    supabase.from('catalogo_tipos_etapa_hotel').select('codigo,nombre,orden').eq('activo', true).order('orden', { ascending: true }),
    supabase.from('catalogo_tipos_trabajo').select('codigo,nombre,requiere_expediente,requiere_diagnostico').eq('activo', true).order('codigo', { ascending: true }),
    supabase.from('talleres').select('id,nombre,observaciones').eq('activo', true).order('nombre', { ascending: true }),
    supabase.from('centros_taller').select('id,taller_id,nombre,direccion,poblacion').eq('activo', true).order('nombre', { ascending: true }),
    supabase.from('vehiculos_hotel_autocompletar').select('*').order('dfm', { ascending: true }),
    supabase.from('catalogo_modalidades_operativas_hotel').select('codigo,nombre,comportamiento,orden').eq('activo', true).order('orden', { ascending: true })
  ]);

  let reservation;
  try {
    reservation = await reserveTemporaryStopNumber(creationRequestId);
  } catch (error) {
    await cataloguePromise.catch(() => {});
    if (!closed) {
      status.className = 'hotel-editor-status error';
      status.textContent = `No se pudo abrir una nueva ficha con número reservado: ${error.message}`;
    }
    return;
  }

  if (closed) {
    await releaseTemporaryStopNumber(reservation.token).catch(() => {});
    return;
  }

  applyLease(reservation);
  status.className = 'hotel-editor-status success';
  status.textContent = `Actuación ${reservation.number} reservada. Cargando el resto del formulario…`;

  let catalogueResults;
  try {
    catalogueResults = await cataloguePromise;
  } catch (error) {
    await releaseTemporaryStopNumber(reservation.token).catch(() => {});
    stopNumberLease = null;
    stopHeartbeat();
    if (!closed) {
      status.className = 'hotel-editor-status error';
      status.textContent = `No se pudieron cargar los datos necesarios: ${error.message}`;
    }
    return;
  }

  if (closed) return;

  const [
    statesResult, stageStatesResult, stageTypesResult, workTypesResult,
    workshopsResult, centresResult, vehiclesResult, modalitiesResult
  ] = catalogueResults;

  const catalogueError = [
    statesResult, stageStatesResult, stageTypesResult, workTypesResult,
    workshopsResult, centresResult, modalitiesResult
  ].find(result => result.error)?.error;
  if (catalogueError) {
    await releaseTemporaryStopNumber(stopNumberLease.token).catch(() => {});
    stopNumberLease = null;
    stopHeartbeat();
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
  stopNumberInput = sections[0].querySelector('.editor-grid input');
  stopNumberInput?.setAttribute('data-hotel-stop-number', '1');
  if (stopNumberInput) {
    stopNumberInput.readOnly = true;
    stopNumberInput.value = detail.ficha.numero_parada;
    stopNumberInput.title = 'Número reservado para esta nueva ficha. Se confirma al crearla y se libera al cancelar.';
  }
  const annotationsSection = renderManualAnnotationsEditor(detail, markDirty);
  const stagesSection = renderStagesSection(detail, markDirty, undefined, {
    documentsByGroup: new Map(),
    canEditDocuments: true,
  });
  const errorsHost = element('div', { className: 'editor-errors hidden' });
  const createButton = element('button', { className: 'button primary', type: 'button', text: 'Crear ficha' });
  const cancelButton = element('button', { className: 'button secondary', type: 'button', text: 'Cancelar' });
  cancelButton.addEventListener('click', () => { void close(false); });

  const lockCreatedForm = () => {
    form.querySelectorAll('input, textarea, select, button').forEach(control => {
      if (control === createButton || control === cancelButton) return;
      control.disabled = true;
    });
    cancelButton.textContent = 'Cerrar';
  };

  const ensureCurrentLease = async () => {
    if (!stopNumberLease?.token) {
      const replacement = await reserveTemporaryStopNumber(creationRequestId);
      applyLease(replacement);
      return replacement;
    }

    try {
      const renewed = await renewTemporaryStopNumber(stopNumberLease.token);
      if (renewed.number && renewed.number !== stopNumberLease.number) {
        stopNumberLease.number = renewed.number;
        detail.ficha.numero_parada = renewed.number;
        if (stopNumberInput) stopNumberInput.value = renewed.number;
      }
      stopNumberLease.expiresAt = renewed.expiresAt;
      return stopNumberLease;
    } catch {
      const previousNumber = stopNumberLease.number;
      stopHeartbeat();
      const replacement = await reserveTemporaryStopNumber(creationRequestId);
      applyLease(replacement);
      if (replacement.number !== previousNumber) {
        status.className = 'hotel-editor-status';
        status.textContent = `La reserva anterior había caducado. La ficha continúa con la actuación ${replacement.number}, visible en el formulario.`;
      }
      return replacement;
    }
  };

  createButton.addEventListener('click', async () => {
    if (saving) return;

    if (pendingDocumentRetry) {
      saving = true;
      createButton.disabled = true;
      cancelButton.disabled = true;
      closeButton.disabled = true;
      status.className = 'hotel-editor-status';
      status.textContent = 'Reintentando únicamente los documentos pendientes; la ficha y las T no se vuelven a crear…';

      try {
        const documentResult = await uploadPendingStageDocuments(
          pendingDocumentRetry.pending,
          pendingDocumentRetry.savedDetail,
          {
            originalStages: detail.etapas,
            onProgress: message => { status.textContent = message; },
          }
        );
        pendingDocumentRetry = null;
        dirty = false;
        status.className = 'hotel-editor-status success';
        status.textContent = `✓ Documentos guardados correctamente (${documentResult.uploaded}). La ficha y las T conservan su identidad.`;
        createButton.textContent = 'Documentos guardados';
        await onSaved?.();
        setTimeout(() => { void close(true); }, 1400);
      } catch (error) {
        const remaining = pendingDocumentCount(pendingDocumentRetry.pending);
        status.className = 'hotel-editor-status error';
        status.textContent = `La ficha y las T ya están creadas, pero quedan ${remaining} archivo${remaining === 1 ? '' : 's'} pendiente${remaining === 1 ? '' : 's'}: ${error?.message || 'error desconocido'}. Pulsa “Reintentar documentos”; no se duplicará la ficha.`;
        createButton.textContent = 'Reintentar documentos';
        createButton.disabled = false;
        cancelButton.disabled = false;
        closeButton.disabled = false;
        saving = false;
      }
      return;
    }

    const errors = validate(detail);
    errors.push(...newStageTypeIssues(detail).map(issue => issue.message));
    renderErrors(errorsHost, errors);
    if (errors.length) {
      revealStagesFor(form.querySelector('.editor-stages'));
      return;
    }

    const pendingDocuments = collectPendingStageDocuments(detail.etapas);

    saving = true;
    createButton.disabled = true;
    cancelButton.disabled = true;
    closeButton.disabled = true;
    status.className = 'hotel-editor-status';

    let currentLease;
    try {
      currentLease = await ensureCurrentLease();
    } catch (error) {
      status.className = 'hotel-editor-status error';
      status.textContent = `No se puede confirmar el número de parada: ${error.message}`;
      createButton.disabled = false;
      cancelButton.disabled = false;
      closeButton.disabled = false;
      saving = false;
      return;
    }

    status.textContent = `Creando la actuación ${currentLease.number}, su ficha y todas sus T…`;

    let data;
    let error;
    try {
      ({ data, error } = await supabase.rpc('crear_ficha_hotel_con_etapas_alpha75', {
        p_ficha: alpha72FichaPayload(detail.ficha, detail),
        p_etapas: stagesPayloadWithCatalogues(detail.etapas),
        p_request_id: creationRequestId,
        p_numero_token: currentLease.token,
      }));
    } catch (transportError) {
      resultUnknown = true;
      stopHeartbeat();
      status.className = 'hotel-editor-status error';
      status.textContent = `No se ha podido confirmar si la actuación ${currentLease.number} llegó a crearse. No pulses “Crear ficha” otra vez. Cierra, actualiza Hotel y comprueba la actuación. Referencia ${creationRequestId}.`;
      createButton.textContent = 'Resultado sin confirmar';
      createButton.disabled = true;
      cancelButton.disabled = false;
      closeButton.disabled = false;
      saving = false;
      return;
    }

    if (error || !data?.ok) {
      status.className = 'hotel-editor-status error';
      status.textContent = error?.message || 'No se pudo crear la ficha.';
      createButton.disabled = false;
      cancelButton.disabled = false;
      closeButton.disabled = false;
      saving = false;
      return;
    }

    created = true;
    stopHeartbeat();
    stopNumberLease = null;
    lockCreatedForm();

    const stageCount = Number(data.etapas_guardadas || 0);
    const workCount = Number(data.trabajos_guardados || 0);
    const baseMessage = `✓ Ficha creada con ${stageCount} T y ${workCount} trabajo${workCount === 1 ? '' : 's'}. Actuación ${data.numero_parada || detail.ficha.numero_parada} confirmada · referencia ${data.request_id}.`;

    if (pendingDocuments.entries.length) {
      status.className = 'hotel-editor-status';
      status.textContent = 'Ficha y T creadas. Vinculando ahora los documentos preparados a la T correcta…';
      try {
        const documentResult = await uploadPendingStageDocuments(
          pendingDocuments,
          data.detalle,
          {
            originalStages: detail.etapas,
            onProgress: message => { status.textContent = message; },
          }
        );
        dirty = false;
        status.className = 'hotel-editor-status success';
        status.textContent = `${baseMessage} ${documentResult.uploaded} documento${documentResult.uploaded === 1 ? '' : 's'} adjunto${documentResult.uploaded === 1 ? '' : 's'}.`;
        createButton.textContent = 'Creada correctamente';
        await onSaved?.();
        setTimeout(() => { void close(true); }, 1400);
      } catch (documentError) {
        pendingDocumentRetry = {
          pending: pendingDocuments,
          savedDetail: data.detalle,
        };
        const remaining = pendingDocumentCount(pendingDocuments);
        status.className = 'hotel-editor-status error';
        status.textContent = `${baseMessage} La ficha ya existe, pero quedan ${remaining} archivo${remaining === 1 ? '' : 's'} pendiente${remaining === 1 ? '' : 's'}: ${documentError?.message || 'error desconocido'}. Pulsa “Reintentar documentos”; no se volverá a crear la ficha.`;
        createButton.textContent = 'Reintentar documentos';
        createButton.disabled = false;
        cancelButton.disabled = false;
        closeButton.disabled = false;
        saving = false;
      }
      return;
    }

    dirty = false;
    status.className = 'hotel-editor-status success';
    status.textContent = baseMessage;
    createButton.textContent = 'Creada correctamente';
    await onSaved?.();
    setTimeout(() => { void close(true); }, 1200);
  });

  form.append(
    sections[0],
    sections[1],
    annotationsSection,
    stagesSection,
    element('p', {
      className: 'muted',
      text: `La actuación ${detail.ficha.numero_parada} queda reservada mientras editas. Si creas la ficha conservará ese número; si cancelas, se libera para otra ficha. Puedes preparar PDF o fotografías dentro de cada T antes de crearla.`
    }),
    errorsHost,
    element('div', { className: 'editor-footer-actions' }, [createButton, cancelButton])
  );
  body.append(form);

  status.className = vehiclesResult.error ? 'hotel-editor-status' : 'hotel-editor-status success';
  status.textContent = vehiclesResult.error
    ? `Actuación ${detail.ficha.numero_parada} reservada. El Registro maestro no está disponible; revisa la conexión antes de crear la ficha.`
    : `Actuación ${detail.ficha.numero_parada} reservada. Formulario listo con ${detail.catalogos.vehiculos.length} vehículos del Registro maestro.`;
}
