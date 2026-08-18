import { clear, detail, element, notice } from '../dom.js';
import { supabase } from '../supabase.js';

const STATE_LABELS = Object.freeze({
  pendiente_taller: 'Pendiente de taller',
  en_taller: 'Realizando trabajos en taller',
  asistencia_24h: 'Asistencia 24H activa',
  reserva_liberada: 'Reserva libre para asignar'
});

const STAGE_STATE_LABELS = Object.freeze({
  realizada: 'Realizada',
  en_curso: 'En curso',
  programada: 'Programada',
  pendiente: 'Pendiente',
  anulada: 'Anulada'
});

const EFFECT_LABELS = Object.freeze({
  reserva_libre_para_asignar: 'Reserva disponible para asignar',
  vehiculo_flota_operativo_sin_reserva: 'Vehículo de flota operativo y de nuevo en ruta, sin sustitución',
  flota_operativa_y_reserva_liberada: 'Vehículo de flota operativo y reserva liberada'
});

function metric(label, value) {
  return element('div', { className: 'metric' }, [
    element('strong', { text: value }),
    element('span', { className: 'muted', text: label })
  ]);
}

function vehicleTitle(row) {
  if (row.flota) {
    const prefix = String(row.flota).startsWith('R') ? 'Semirremolque' : 'DFM';
    return `${prefix} ${row.flota}${row.matricula_flota ? ` · ${row.matricula_flota}` : ''}`;
  }
  return `Reserva ${row.reserva || '—'}${row.matricula_reserva ? ` · ${row.matricula_reserva}` : ''}`;
}

function formatDate(value) {
  if (!value) return '—';
  return new Date(`${value}T12:00:00`).toLocaleDateString('es-ES');
}

function timeForInput(value) {
  if (!value) return '';
  return String(value).slice(0, 5);
}

function requestId() {
  return `review_${crypto.randomUUID().replaceAll('-', '')}`;
}

function stagesFor(row) {
  return Array.isArray(row.etapas_transformadas) ? row.etapas_transformadas.filter(Boolean) : [];
}

function renderStages(row) {
  const host = element('div', { className: 'manual-stage-list' });
  const stages = stagesFor(row);

  if (!stages.length) {
    host.append(element('span', { className: 'muted', text: 'Sin T para revisar.' }));
    return host;
  }

  stages.forEach(stage => {
    const state = stage.estado_propuesto || 'pendiente';
    const text = `${stage.posicion}T · ${stage.nombre_destino || stage.texto_origen} · ${STAGE_STATE_LABELS[state] || state}`;
    const item = element('div', {
      className: `manual-stage manual-stage-${state}`,
      dataset: { final: stage.es_final ? 'true' : 'false' }
    }, [
      element('strong', { text }),
      stage.fecha_propuesta
        ? element('span', { className: 'muted', text: `Fecha propuesta: ${formatDate(stage.fecha_propuesta)}` })
        : null,
      stage.efecto_final
        ? element('span', { className: 'manual-stage-effect', text: EFFECT_LABELS[stage.efecto_final] || stage.efecto_final })
        : null
    ]);
    host.append(item);
  });

  return host;
}

function pendingFields(row) {
  return Array.isArray(row.campos_pendientes) ? row.campos_pendientes.filter(Boolean) : [];
}

function setCardMessage(host, message, kind = '') {
  host.textContent = message;
  host.className = `manual-card-message${kind ? ` ${kind}` : ''}`;
}

function prioritySelect(row) {
  const select = element('select', { name: 'prioridad', 'aria-label': `Prioridad de ${row.numero_parada}` });
  select.append(element('option', { value: '', text: 'Seleccionar prioridad' }));
  for (let value = 0; value <= 5; value += 1) {
    select.append(element('option', { value, text: String(value) }));
  }
  if (row.prioridad_final !== null && row.prioridad_final !== undefined) {
    select.value = String(row.prioridad_final);
  }
  return select;
}

function collectPayload(row, form, validated) {
  const data = new FormData(form);
  return {
    fila_id: row.fila_id,
    version: row.revision_version ?? 0,
    prioridad: String(data.get('prioridad') || ''),
    incidencia: String(data.get('incidencia') || '').trim().toUpperCase(),
    fecha_entrada: String(data.get('fecha_entrada') || ''),
    hora_entrada: String(data.get('hora_entrada') || ''),
    observaciones: String(data.get('observaciones') || '').trim(),
    validada: validated
  };
}

function validatePayload(row, payload) {
  const missing = [];
  if (!payload.prioridad) missing.push('prioridad');
  if (!payload.incidencia) missing.push('INC');
  if (row.estado_destino === 'en_taller') {
    if (!payload.fecha_entrada) missing.push('fecha de entrada');
    if (!payload.hora_entrada) missing.push('hora de entrada');
  }
  return missing;
}

async function saveReview(container, row, form, validated, buttons, messageHost) {
  const payload = collectPayload(row, form, validated);
  if (validated) {
    const missing = validatePayload(row, payload);
    if (missing.length) {
      setCardMessage(messageHost, `Falta completar: ${missing.join(', ')}.`, 'error');
      return;
    }
  }

  buttons.forEach(button => { button.disabled = true; });
  setCardMessage(messageHost, validated ? 'Validando la ficha…' : 'Guardando el borrador…');

  const { data, error } = await supabase.rpc('guardar_revision_importacion_hotel', {
    p_importacion_id: row.importacion_id,
    p_revisiones: [payload],
    p_request_id: requestId()
  });

  if (error) {
    buttons.forEach(button => { button.disabled = false; });
    setCardMessage(messageHost, error.message || 'No se pudo guardar la revisión.', 'error');
    return;
  }

  const action = validated ? 'Ficha validada' : 'Borrador guardado';
  await renderHotelManualReview(container, {
    scrollToRow: row.source_row,
    flash: `${action}. Auditoría: ${data?.eventos_auditoria ?? 0} cambio(s). Referencia: ${data?.request_id || '—'}`
  });
}

function renderReviewCard(container, row) {
  const form = element('form', { className: 'manual-review-form', autocomplete: 'off' });
  const priority = prioritySelect(row);
  const incidence = element('input', {
    name: 'incidencia',
    type: 'text',
    maxlength: 80,
    value: row.incidencia_final || '',
    placeholder: `INC vinculado a ${row.numero_parada}`,
    spellcheck: 'false'
  });
  const observations = element('textarea', {
    name: 'observaciones',
    maxlength: 2000,
    placeholder: 'Observaciones de la revisión manual'
  });
  observations.value = row.observaciones_revision || '';

  const fields = element('div', { className: 'manual-fields-grid' }, [
    element('label', {}, [
      document.createTextNode('Prioridad 0–5'),
      priority,
      row.prioridad_propuesta !== null && row.prioridad_propuesta !== undefined
        ? element('span', { className: 'field-help', text: `Propuesta automática: ${row.prioridad_propuesta}` })
        : element('span', { className: 'field-help', text: 'Debe decidirse manualmente.' })
    ]),
    element('label', {}, [
      document.createTextNode(`INC de la parada ${row.numero_parada}`),
      incidence,
      element('span', { className: 'field-help', text: 'Queda vinculado a este Nº de parada; el número de parada no se modifica aquí.' })
    ])
  ]);

  if (row.estado_destino === 'en_taller') {
    fields.append(
      element('label', {}, [
        document.createTextNode('Fecha de entrada'),
        element('input', {
          name: 'fecha_entrada',
          type: 'date',
          value: row.fecha_entrada_final || ''
        }),
        element('span', { className: 'field-help', text: row.fecha_entrada_propuesta ? 'Fecha recuperada de la hoja; puede corregirse.' : 'Fecha pendiente.' })
      ]),
      element('label', {}, [
        document.createTextNode('Hora de entrada'),
        element('input', {
          name: 'hora_entrada',
          type: 'time',
          value: timeForInput(row.hora_entrada_final)
        }),
        element('span', { className: 'field-help', text: 'La hoja no contenía la hora; no se completa automáticamente.' })
      ])
    );
  }

  fields.append(element('label', { className: 'manual-observations-field' }, [
    document.createTextNode('Observaciones de revisión'),
    observations
  ]));

  form.append(fields);

  const messageHost = element('p', { className: 'manual-card-message', role: 'status', 'aria-live': 'polite' });
  const draftButton = row.validada_efectiva
    ? null
    : element('button', { className: 'button secondary', type: 'button', text: 'Guardar borrador' });
  const validateButton = element('button', {
    className: 'button primary',
    type: 'button',
    text: row.validada_efectiva ? 'Guardar y mantener validada' : 'Validar ficha'
  });
  const reopenButton = row.validada_manual
    ? element('button', { className: 'button secondary', type: 'button', text: 'Reabrir revisión' })
    : null;
  const buttons = [draftButton, validateButton, reopenButton].filter(Boolean);

  form.addEventListener('submit', event => event.preventDefault());
  draftButton?.addEventListener('click', () => saveReview(container, row, form, false, buttons, messageHost));
  validateButton.addEventListener('click', () => saveReview(container, row, form, true, buttons, messageHost));
  reopenButton?.addEventListener('click', () => saveReview(container, row, form, false, buttons, messageHost));

  const pending = pendingFields(row);
  const reviewBadge = row.validada_efectiva
    ? element('span', { className: 'badge manual-status validated', text: '✓ Validada' })
    : row.revision_completa
      ? element('span', { className: 'badge manual-status complete', text: 'Completa, falta validar' })
      : element('span', { className: 'badge manual-status pending', text: `${pending.length} campo(s) pendiente(s)` });

  const card = element('article', {
    className: `card manual-review-card${row.validada_efectiva ? ' is-validated' : ''}`,
    dataset: { sourceRow: row.source_row }
  }, [
    element('div', { className: 'hotel-card-head' }, [
      element('div', {}, [
        element('h3', { text: vehicleTitle(row) }),
        element('div', { className: 'manual-stop-line' }, [
          element('strong', { text: `Parada ${row.numero_parada}` }),
          element('span', { className: 'muted', text: `Fila ${row.source_row}` })
        ])
      ]),
      reviewBadge
    ]),
    element('div', { className: 'manual-context-grid' }, [
      detail('Estado original', row.estado_raw),
      detail('Estado propuesto', row.etiqueta_destino || STATE_LABELS[row.estado_destino] || row.estado_destino),
      detail('Lugar', row.lugar),
      detail('Causa', row.causa),
      detail('Reserva', row.reserva),
      detail('Fecha propuesta', formatDate(row.fecha_entrada_propuesta))
    ]),
    element('div', { className: 'manual-stage-block' }, [
      element('strong', { text: `T transformadas · ${row.t_reconocidas}/${row.total_t_origen}` }),
      renderStages(row)
    ]),
    pending.length
      ? element('div', { className: 'manual-pending-fields' }, [
          element('strong', { text: 'Pendiente:' }),
          ...pending.map(field => element('span', { className: 'badge', text: field }))
        ])
      : notice('Todos los datos obligatorios están completos.', 'success'),
    form,
    element('div', { className: 'manual-card-actions' }, [
      messageHost,
      element('div', { className: 'manual-buttons' }, buttons)
    ])
  ]);

  return card;
}

export async function renderHotelManualReview(container, options = {}) {
  clear(container);

  const heading = element('div', { className: 'module-heading' }, [
    element('div', {}, [
      element('h2', { text: 'Hotel real · Revisión manual' }),
      element('p', { className: 'muted', text: 'Completa prioridad, INC y, cuando corresponda, fecha y hora de entrada antes de importar.' })
    ]),
    element('span', { className: 'badge', text: 'Solo administrador principal' })
  ]);
  const loading = notice('Cargando fichas pendientes de revisión…', 'warning');
  container.append(heading, loading);

  const { data, error } = await supabase
    .from('hotel_importacion_revision_previa')
    .select('*')
    .order('source_row', { ascending: true });

  loading.remove();

  if (error) {
    container.append(notice(`No se pudo cargar la revisión manual: ${error.message}`, 'danger'));
    return;
  }

  const rows = data || [];
  const reviewRows = rows.filter(row => row.revision_requerida);
  const freeRows = rows.filter(row => !row.revision_requerida);
  const validated = reviewRows.filter(row => row.validada_efectiva);
  const completed = reviewRows.filter(row => row.revision_completa && !row.validada_efectiva);
  const pending = reviewRows.filter(row => !row.revision_completa);

  container.append(
    notice('Esta pantalla guarda únicamente la revisión aislada. No modifica Hotel, Reservas, T, Histórico ni producción y no contiene ningún botón de importar.', 'success')
  );
  if (options.flash) container.append(notice(options.flash, 'success'));
  container.append(
    element('div', { className: 'summary-grid' }, [
      metric('Fichas a revisar', reviewRows.length),
      metric('Validadas', validated.length),
      metric('Completas sin validar', completed.length),
      metric('Pendientes', pending.length)
    ]),
    notice(`${freeRows.length} reservas libres quedan resueltas automáticamente y no necesitan INC, prioridad ni hora de entrada.`, 'warning')
  );

  const pendingHost = element('div', { className: 'grid manual-review-list' });
  [...pending, ...completed].forEach(row => pendingHost.append(renderReviewCard(container, row)));

  container.append(element('section', { className: 'manual-review-section' }, [
    element('div', { className: 'import-section-heading' }, [
      element('h3', { text: `Pendientes de validar · ${pending.length + completed.length}` }),
      element('span', { className: 'muted', text: 'Puede guardarse cada ficha como borrador' })
    ]),
    pendingHost
  ]));

  if (validated.length) {
    const validatedHost = element('div', { className: 'grid manual-review-list' });
    validated.forEach(row => validatedHost.append(renderReviewCard(container, row)));
    container.append(element('details', { className: 'manual-validated-details' }, [
      element('summary', { text: `Fichas validadas · ${validated.length}` }),
      validatedHost
    ]));
  }

  container.append(notice('Cuando las 13 fichas estén validadas se preparará una última simulación completa. Todavía no se aplicará nada al Hotel activo.', 'warning'));

  if (options.scrollToRow) {
    requestAnimationFrame(() => {
      container.querySelector(`[data-source-row="${options.scrollToRow}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }
}
