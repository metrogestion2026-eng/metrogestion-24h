import { element } from '../dom.js';

const MADRID_TIME_ZONE = 'Europe/Madrid';
export const STAGE_STATES = Object.freeze([
  ['pendiente', 'Pendiente'],
  ['programada', 'Programada'],
  ['en_curso', 'En curso'],
  ['realizada', 'Realizada']
]);
export const STAGE_TYPES = Object.freeze([
  ['entrada_taller', 'Entrada en taller'],
  ['recogida_taller', 'Recogida de taller'],
  ['otro', 'Otro movimiento o trabajo']
]);

function madridDateTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 16);
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: MADRID_TIME_ZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(date).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

export function displayDateTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString('es-ES', { timeZone: MADRID_TIME_ZONE });
}

export function normalizeDetail(raw) {
  const detail = structuredClone(raw || {});
  detail.ficha ||= {};
  detail.catalogos ||= {};
  detail.catalogos.estados ||= [];
  detail.catalogos.tipos_trabajo ||= [];
  detail.catalogos.talleres ||= [];
  detail.etapas = Array.isArray(detail.etapas) ? detail.etapas : [];

  detail.ficha.fecha_entrada = madridDateTime(detail.ficha.fecha_entrada);
  detail.ficha.fecha_limite_sustitucion = madridDateTime(detail.ficha.fecha_limite_sustitucion);
  detail.ficha.cancelado = detail.ficha.cancelado === true;
  detail.ficha.retirado_hotel_activo = detail.ficha.retirado_hotel_activo === true;
  detail.ficha.sustitucion_temporal = detail.ficha.sustitucion_temporal === true;

  detail.etapas = detail.etapas.map((stage, index) => ({
    ...stage,
    client_key: stage.id || `new-stage-${crypto.randomUUID()}`,
    posicion: Number(stage.posicion || index + 1),
    version: stage.version == null ? null : Number(stage.version),
    cancelado: stage.cancelado === true,
    fecha_prevista: madridDateTime(stage.fecha_prevista),
    fecha_inicio_real: madridDateTime(stage.fecha_inicio_real),
    fecha_fin_real: madridDateTime(stage.fecha_fin_real),
    fecha_real: madridDateTime(stage.fecha_real),
    trabajos: (Array.isArray(stage.trabajos) ? stage.trabajos : []).map(work => ({
      ...work,
      client_key: work.id || `new-work-${crypto.randomUUID()}`,
      version: work.version == null ? null : Number(work.version),
      cancelado: work.cancelado === true
    }))
  }));
  return detail;
}

export function fieldLabel(text, control, className = '') {
  return element('label', { className: `editor-field ${className}`.trim() }, [
    element('span', { text }), control
  ]);
}

export function createInput({ type = 'text', value = '', placeholder = '', min, max, step, disabled = false } = {}) {
  const input = element('input', { type });
  input.value = value ?? '';
  if (placeholder) input.placeholder = placeholder;
  if (min !== undefined) input.min = String(min);
  if (max !== undefined) input.max = String(max);
  if (step !== undefined) input.step = String(step);
  input.disabled = disabled;
  return input;
}

export function createTextarea(value = '', placeholder = '') {
  const textarea = element('textarea');
  textarea.value = value ?? '';
  textarea.placeholder = placeholder;
  return textarea;
}

export function createSelect(options, value = '') {
  const select = element('select');
  for (const [optionValue, optionLabel] of options) {
    const option = element('option', { value: optionValue, text: optionLabel });
    if (String(optionValue) === String(value ?? '')) option.selected = true;
    select.append(option);
  }
  return select;
}

export function createCheckbox(labelText, checked = false) {
  const input = element('input', { type: 'checkbox' });
  input.checked = checked === true;
  return {
    input,
    label: element('label', { className: 'editor-checkbox' }, [input, element('span', { text: labelText })])
  };
}

export function bindText(control, object, key, markDirty, transform = value => value) {
  const update = () => {
    object[key] = transform(control.value);
    markDirty();
  };
  control.addEventListener('input', update);
  control.addEventListener('change', update);
}

export function bindCheckbox(control, object, key, markDirty, afterChange) {
  control.addEventListener('change', () => {
    object[key] = control.checked;
    markDirty();
    afterChange?.(control.checked);
  });
}

export function makeNewStage(stages) {
  return {
    id: null,
    client_key: `new-stage-${crypto.randomUUID()}`,
    version: null,
    nombre: 'Nueva T',
    posicion: Math.max(0, ...stages.map(stage => Number(stage.posicion) || 0)) + 1,
    estado: 'pendiente', tipo_etapa: 'otro', taller_id: null, centro_taller_id: null,
    lugar: '', fecha_prevista: '', fecha_inicio_real: '', fecha_fin_real: '', fecha_real: '',
    observaciones: '', cancelado: false, motivo_cancelacion: '', trabajos: []
  };
}

export function makeNewWork(defaultType = 'AV') {
  return {
    id: null,
    client_key: `new-work-${crypto.randomUUID()}`,
    version: null,
    tipo_trabajo: defaultType,
    categoria_tecnica: '', motivo_entrada: '', diagnostico_real: '', km_averia: '',
    expediente: '', descripcion: '', peritaje_estado: '', observaciones: '',
    cancelado: false, motivo_cancelacion: ''
  };
}

export function requestId() {
  return `r1_${crypto.randomUUID().replaceAll('-', '')}`;
}

export function validate(detail) {
  const ficha = detail.ficha;
  const errors = [];
  if (!String(ficha.vehiculo_sustituido || '').trim() && !String(ficha.vehiculo_reserva || '').trim()) {
    errors.push('La ficha debe identificar un vehículo o una reserva.');
  }
  const priority = Number(ficha.prioridad);
  if (!Number.isInteger(priority) || priority < 0 || priority > 5) errors.push('La prioridad debe estar entre 0 y 5.');
  if (ficha.cancelado && !String(ficha.motivo_cancelacion || '').trim()) errors.push('Indica el motivo de cancelación de la ficha.');
  if (ficha.sustitucion_temporal) {
    if (!String(ficha.motivo_sustitucion_temporal || '').trim()) errors.push('Indica el motivo de la sustitución temporal.');
    if (!ficha.fecha_limite_sustitucion) errors.push('Indica hasta cuándo estará activa la sustitución temporal.');
  }

  const activePositions = new Set();
  detail.etapas.forEach((stage, stageIndex) => {
    const label = `${stageIndex + 1}T`;
    const position = Number(stage.posicion);
    if (!String(stage.nombre || '').trim()) errors.push(`${label}: el nombre es obligatorio.`);
    if (!Number.isInteger(position) || position < 1 || position > 99) errors.push(`${label}: posición no válida.`);
    if (!stage.cancelado) {
      if (activePositions.has(position)) errors.push(`Hay dos T activas en la posición ${position}.`);
      activePositions.add(position);
    }
    if (stage.cancelado && !String(stage.motivo_cancelacion || '').trim()) errors.push(`${label}: indica el motivo de anulación.`);

    stage.trabajos.forEach((work, workIndex) => {
      const workLabel = `${label}, trabajo ${workIndex + 1}`;
      if (!work.tipo_trabajo) errors.push(`${workLabel}: selecciona el tipo de trabajo.`);
      if (work.cancelado && !String(work.motivo_cancelacion || '').trim()) errors.push(`${workLabel}: indica el motivo de cancelación.`);
      if (!work.cancelado && work.tipo_trabajo === 'AV') {
        if (!String(work.categoria_tecnica || '').trim()) errors.push(`${workLabel}: indica la categoría técnica de la avería.`);
        if (!String(work.motivo_entrada || '').trim()) errors.push(`${workLabel}: indica el motivo de entrada o primer diagnóstico.`);
      }
      if (!work.cancelado && ['GP', 'GC'].includes(work.tipo_trabajo) && !String(work.expediente || '').trim()) {
        errors.push(`${workLabel}: indica el expediente del golpe.`);
      }
      if (work.km_averia !== '' && Number(work.km_averia) < 0) errors.push(`${workLabel}: los kilómetros no pueden ser negativos.`);
    });
  });
  return [...new Set(errors)];
}

export function fichaPayload(ficha) {
  return {
    numero_parada: ficha.numero_parada || '', vehiculo_sustituido: ficha.vehiculo_sustituido || '',
    matricula_sustituido: ficha.matricula_sustituido || '', vehiculo_reserva: ficha.vehiculo_reserva || '',
    matricula_reserva: ficha.matricula_reserva || '', etiqueta_reserva: ficha.etiqueta_reserva || '',
    tipo_unidad: ficha.tipo_unidad || '', marca: ficha.marca || '', tipo_motor: ficha.tipo_motor || '',
    modelo: ficha.modelo || '', upc: ficha.upc || '', telefono: ficha.telefono || '',
    prioridad: Number(ficha.prioridad), estado: ficha.cancelado ? 'anulado' : (ficha.estado || 'pendiente_taller'),
    lugar: ficha.lugar || '', fecha_parada: ficha.fecha_parada || '', fecha_entrada: ficha.fecha_entrada || '',
    tipo_movimiento: ficha.tipo_movimiento || '', causa: ficha.causa || '', trabajos_reserva: ficha.trabajos_reserva || '',
    incidencia: ficha.incidencia || '', proximo: ficha.proximo || '', observaciones: ficha.observaciones || '',
    sustitucion_temporal: ficha.sustitucion_temporal === true,
    motivo_sustitucion_temporal: ficha.motivo_sustitucion_temporal || '',
    fecha_limite_sustitucion: ficha.fecha_limite_sustitucion || '', orden: Number(ficha.orden || 0),
    retirado_hotel_activo: ficha.retirado_hotel_activo === true,
    cancelado: ficha.cancelado === true, motivo_cancelacion: ficha.motivo_cancelacion || ''
  };
}

export function stagesPayload(stages) {
  return stages.map(stage => ({
    id: stage.id || '', version: stage.version ?? '', nombre: stage.nombre || '', posicion: Number(stage.posicion),
    estado: stage.cancelado ? 'anulada' : (stage.estado === 'anulada' ? 'pendiente' : stage.estado || 'pendiente'),
    tipo_etapa: stage.tipo_etapa || 'otro', taller_id: stage.taller_id || '', centro_taller_id: stage.centro_taller_id || '',
    lugar: stage.lugar || '', fecha_prevista: stage.fecha_prevista || '', fecha_inicio_real: stage.fecha_inicio_real || '',
    fecha_fin_real: stage.fecha_fin_real || '', fecha_real: stage.fecha_real || '', observaciones: stage.observaciones || '',
    cancelado: stage.cancelado === true, motivo_cancelacion: stage.motivo_cancelacion || '',
    trabajos: stage.trabajos.map(work => ({
      id: work.id || '', version: work.version ?? '', tipo_trabajo: work.tipo_trabajo || '',
      categoria_tecnica: work.categoria_tecnica || '', motivo_entrada: work.motivo_entrada || '',
      diagnostico_real: work.diagnostico_real || '', km_averia: work.km_averia ?? '', expediente: work.expediente || '',
      descripcion: work.descripcion || '', peritaje_estado: work.peritaje_estado || '', observaciones: work.observaciones || '',
      cancelado: work.cancelado === true, motivo_cancelacion: work.motivo_cancelacion || ''
    }))
  }));
}
