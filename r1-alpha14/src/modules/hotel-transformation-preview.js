import { clear, detail, element, notice } from '../dom.js';
import { supabase } from '../supabase.js';

const CLASS_LABELS = Object.freeze({
  movimiento_con_reserva: 'Movimiento con reserva',
  movimiento_sin_reserva: 'Movimiento sin reserva',
  reserva_libre: 'Reserva libre',
  reserva_sin_sustitucion_activa: 'Reserva en taller / sin flota asignada',
  fila_incompleta: 'Fila incompleta'
});

const STAGE_STATE_LABELS = Object.freeze({
  realizada: 'Realizada',
  en_curso: 'En curso',
  programada: 'Programada',
  pendiente: 'Pendiente',
  anulada: 'Anulada'
});

const EFFECT_LABELS = Object.freeze({
  movimiento_activo: 'Movimiento activo en Hotel',
  reserva_disponible: 'Reserva disponible para asignar',
  reserva_libre_para_asignar: 'La reserva queda libre para asignar a otra unidad',
  vehiculo_flota_operativo_sin_reserva: 'El vehículo de flota vuelve directamente a su ruta; no hubo sustitución',
  flota_operativa_y_reserva_liberada: 'El vehículo de flota vuelve a ruta y la reserva queda libre'
});

function metric(label, value) {
  return element('div', { className: 'metric' }, [
    element('strong', { text: value }),
    element('span', { className: 'muted', text: label })
  ]);
}

function formatDate(value) {
  if (!value) return '—';
  return new Date(`${value}T12:00:00`).toLocaleDateString('es-ES');
}

function valueOrDash(value) {
  return value === null || value === undefined || String(value).trim() === '' ? '—' : String(value);
}

function vehicleTitle(row) {
  if (row.flota) {
    const prefix = String(row.flota).startsWith('R') ? 'Semirremolque' : 'DFM';
    return `${prefix} ${row.flota}${row.matricula_flota ? ` · ${row.matricula_flota}` : ''}`;
  }
  return `Reserva ${row.reserva || '—'}${row.matricula_reserva ? ` · ${row.matricula_reserva}` : ''}`;
}

function renderOriginalStages(row) {
  const stages = Array.isArray(row.etapas_raw) ? row.etapas_raw.filter(Boolean) : [];
  const host = element('div', { className: 'transform-original-stages' });
  if (!stages.length) {
    host.append(element('span', { className: 'muted', text: 'Sin T anotadas.' }));
    return host;
  }
  stages.forEach(stage => {
    host.append(element('span', {
      className: 'import-stage-chip',
      text: `${stage.posicion}T · ${stage.texto}`
    }));
  });
  return host;
}

function renderProposedStages(row) {
  const stages = Array.isArray(row.etapas_transformadas) ? row.etapas_transformadas.filter(Boolean) : [];
  const host = element('div', { className: 'transform-stage-list' });

  if (!stages.length) {
    host.append(element('span', { className: 'muted', text: 'No necesita T para quedar como reserva libre.' }));
    return host;
  }

  stages.forEach(stage => {
    const state = stage.estado_propuesto || 'pendiente';
    const card = element('div', {
      className: `transform-stage transform-stage-${state}`,
      dataset: { final: stage.es_final ? 'true' : 'false' }
    }, [
      element('div', { className: 'transform-stage-head' }, [
        element('strong', { text: `${stage.posicion}T · ${stage.nombre_destino || stage.texto_origen}` }),
        element('span', { className: 'badge', text: STAGE_STATE_LABELS[state] || state })
      ]),
      element('div', { className: 'transform-stage-meta' }, [
        element('span', { text: `Origen: ${stage.texto_origen}` }),
        element('span', { text: `Tipo: ${stage.tipo_etapa_destino || 'pendiente'}` }),
        stage.taller_destino ? element('span', { text: `Taller: ${stage.taller_destino}` }) : null,
        stage.fecha_propuesta ? element('span', { text: `Fecha propuesta: ${formatDate(stage.fecha_propuesta)}` }) : null
      ])
    ]);

    if (stage.es_final && stage.efecto_final) {
      card.append(element('div', {
        className: 'transform-final-effect',
        text: `Resultado final: ${EFFECT_LABELS[stage.efecto_final] || stage.efecto_final}`
      }));
    }

    host.append(card);
  });
  return host;
}

function renderDecisionList(row) {
  const decisions = Array.isArray(row.decisiones_pendientes) ? row.decisiones_pendientes.filter(Boolean) : [];
  if (!decisions.length) {
    return notice('✓ Transformación directa: no requiere decisiones adicionales.', 'success');
  }

  const list = element('ul', { className: 'transform-decision-list' });
  decisions.forEach(message => list.append(element('li', { text: message })));
  return element('div', { className: 'notice warning' }, [
    element('strong', { text: 'Pendiente antes de importar:' }),
    list
  ]);
}

function renderTransformationRow(row) {
  const badges = element('div', { className: 'import-card-badges' }, [
    element('span', {
      className: `badge import-class ${row.clasificacion || ''}`,
      text: CLASS_LABELS[row.clasificacion] || row.clasificacion || 'Sin clasificar'
    }),
    element('span', {
      className: `badge transform-complete ${row.transformacion_completa ? 'complete' : 'incomplete'}`,
      text: row.transformacion_completa ? 'Reglas completas' : 'Reglas incompletas'
    }),
    element('span', { className: 'badge', text: `Fila ${row.source_row}` })
  ]);

  const header = element('div', { className: 'hotel-card-head' }, [
    element('div', {}, [
      element('h3', { text: vehicleTitle(row) }),
      element('div', { className: 'muted', text: row.numero_parada ? `Parada ${row.numero_parada}` : 'Sin nº de parada' })
    ]),
    badges
  ]);

  const original = element('section', { className: 'transform-side transform-original' }, [
    element('h4', { text: 'Dato original de la hoja' }),
    element('div', { className: 'detail-grid transform-detail-grid' }, [
      detail('Estado original', row.estado_raw),
      detail('Lugar', row.lugar),
      detail('Causa', row.causa),
      detail('Reserva', row.reserva),
      detail('Pendientes de reserva', row.pendientes_reserva),
      detail('INC', row.incidencia_manual || 'Sin rellenar')
    ]),
    element('div', { className: 'transform-stage-block' }, [
      element('strong', { text: 'T originales' }),
      renderOriginalStages(row)
    ])
  ]);

  const priorityLabel = row.clasificacion === 'reserva_libre'
    ? 'No aplica'
    : row.prioridad_propuesta ?? 'Pendiente manual';

  const proposed = element('section', { className: 'transform-side transform-proposed' }, [
    element('h4', { text: 'Resultado propuesto en Metrogestión' }),
    element('div', { className: 'detail-grid transform-detail-grid' }, [
      detail('Estado propuesto', row.etiqueta_destino),
      detail('Código interno', row.estado_destino),
      detail('Fecha de entrada propuesta', formatDate(row.fecha_entrada_propuesta)),
      detail('Prioridad', priorityLabel),
      detail('Resultado de entidad', EFFECT_LABELS[row.efecto_entidad] || row.efecto_entidad),
      detail('INC', row.incidencia_manual || 'Pendiente manual vinculado a la parada')
    ]),
    element('div', { className: 'transform-stage-block' }, [
      element('strong', { text: `T transformadas · ${row.t_reconocidas}/${row.total_t_origen} reconocidas` }),
      renderProposedStages(row)
    ])
  ]);

  return element('article', { className: 'card transform-card' }, [
    header,
    element('div', { className: 'transform-compare-grid' }, [original, proposed]),
    renderDecisionList(row)
  ]);
}

function renderRuleSummary() {
  return element('div', { className: 'transform-rule-grid' }, [
    element('div', { className: 'transform-rule' }, [
      element('strong', { text: 'LIBRE / LLIURE' }),
      element('span', { text: 'Solo reservas: quedan disponibles para asignar y poder parar otra unidad de flota.' })
    ]),
    element('div', { className: 'transform-rule' }, [
      element('strong', { text: 'OPERATIVO' }),
      element('span', { text: 'Vehículo de flota sin sustitución: vuelve directamente a su ruta.' })
    ]),
    element('div', { className: 'transform-rule' }, [
      element('strong', { text: 'RECUPERAR' }),
      element('span', { text: 'Final de sustitución: la flota vuelve a ruta y la reserva queda libre.' })
    ]),
    element('div', { className: 'transform-rule' }, [
      element('strong', { text: '24H' }),
      element('span', { text: 'Asistencia activa; se propone prioridad 1. La salida final decide si vuelve con o sin reserva.' })
    ])
  ]);
}

export async function renderHotelTransformationPreview(container) {
  clear(container);

  const heading = element('div', { className: 'module-heading' }, [
    element('div', {}, [
      element('h2', { text: 'Hotel real · Transformación previa' }),
      element('p', { className: 'muted', text: 'Compara cada dato original con el resultado propuesto, sin aplicar todavía ninguna importación.' })
    ]),
    element('span', { className: 'badge', text: 'Solo lectura · administrador principal' })
  ]);

  const loading = notice('Calculando estados, T y efectos finales…', 'warning');
  container.append(heading, loading);

  const { data, error } = await supabase
    .from('hotel_importacion_transformacion_previa')
    .select('*')
    .order('source_row', { ascending: true });

  loading.remove();

  if (error) {
    container.append(notice(`No se pudo cargar la transformación previa: ${error.message}`, 'danger'));
    return;
  }

  const rows = data || [];
  const complete = rows.filter(row => row.transformacion_completa).length;
  const totalStages = rows.reduce((sum, row) => sum + Number(row.total_t_origen || 0), 0);
  const recognizedStages = rows.reduce((sum, row) => sum + Number(row.t_reconocidas || 0), 0);
  const priorityPending = rows.filter(row => row.clasificacion !== 'reserva_libre' && row.prioridad_propuesta === null).length;
  const incPending = rows.filter(row => row.clasificacion !== 'reserva_libre' && !row.incidencia_manual).length;
  const dates = rows.filter(row => row.fecha_entrada_propuesta).length;

  container.append(
    notice('Nada de esta pantalla modifica Hotel, Reservas, Histórico ni producción. No existe botón de aplicar.', 'success'),
    renderRuleSummary(),
    element('div', { className: 'summary-grid' }, [
      metric('Filas con reglas completas', `${complete} de ${rows.length}`),
      metric('T reconocidas', `${recognizedStages} de ${totalStages}`),
      metric('Fechas extraídas', dates),
      metric('Prioridades pendientes', priorityPending)
    ]),
    element('div', { className: 'summary-grid transform-secondary-summary' }, [
      metric('INC pendientes', incPending),
      metric('Final RECUPERAR', rows.filter(row => Number(row.finales_recuperar || 0) > 0).length),
      metric('Final reserva LIBRE', rows.filter(row => Number(row.finales_reserva_libre || 0) > 0).length),
      metric('Final OPERATIVO', rows.filter(row => Number(row.finales_operativo || 0) > 0).length)
    ])
  );

  const movementRows = rows.filter(row => row.clasificacion !== 'reserva_libre');
  const freeRows = rows.filter(row => row.clasificacion === 'reserva_libre');

  const movementHost = element('div', { className: 'grid transform-list' });
  movementRows.forEach(row => movementHost.append(renderTransformationRow(row)));

  const freeHost = element('div', { className: 'grid transform-list' });
  freeRows.forEach(row => freeHost.append(renderTransformationRow(row)));

  container.append(
    element('section', { className: 'transform-section' }, [
      element('div', { className: 'import-section-heading' }, [
        element('h3', { text: `Movimientos · ${movementRows.length}` }),
        element('span', { className: 'muted', text: 'Original frente a propuesta' })
      ]),
      movementHost
    ]),
    element('section', { className: 'transform-section' }, [
      element('div', { className: 'import-section-heading' }, [
        element('h3', { text: `Reservas libres · ${freeRows.length}` }),
        element('span', { className: 'muted', text: 'Sin convertirlas en movimientos de taller' })
      ]),
      freeHost
    ]),
    notice('Siguiente decisión: revisar prioridades, horas de entrada, INC y estados de cada T. Hasta esa validación no se generará ninguna importación.', 'warning')
  );
}
