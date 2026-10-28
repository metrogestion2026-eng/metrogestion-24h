// El fin de una asistencia no acredita reparación, recuperación ni fin de sustitución.
// Los nombres de fecha/hora se conservan por compatibilidad con la RPC existente.
export function isAssistanceComplete(state = {}) {
  return state.estado_seguimiento === 'realizada' || state.resultado === 'operativo_reparado';
}

function confirmed(value) {
  return value === true || value === 'true';
}

function validDate(value) {
  const parsed = new Date(`${value}T00:00:00Z`);
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(parsed.getTime())
    && parsed.toISOString().slice(0, 10) === value;
}

function validTime(value) {
  return /^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(value);
}

export function assistanceCompletionPayload(state = {}) {
  const complete = isAssistanceComplete(state);
  return {
    estado: complete ? 'cerrada' : 'abierta',
    estado_seguimiento: complete ? 'realizada' : (state.estado_seguimiento || 'en_curso'),
    resultado: state.resultado || 'seguimiento_abierto',
    estado_operativo_confirmado: String(confirmed(state.estado_operativo_confirmado)),
    fecha_fin_reparacion: complete ? (state.fecha_fin_reparacion || '') : '',
    hora_fin_reparacion: complete ? (state.hora_fin_reparacion || '') : '',
  };
}

export function assistanceCompletionError(state = {}) {
  if (!isAssistanceComplete(state)) return '';
  if (!['operativo_reparado', 'trasladado_taller', 'necesita_sustitucion'].includes(state.resultado)) {
    return 'Indica el resultado real de la asistencia antes de finalizarla.';
  }
  if (state.resultado === 'operativo_reparado' && !confirmed(state.estado_operativo_confirmado)) {
    return 'Confirma que el vehículo está operativo y reparado.';
  }
  if (state.resultado === 'trasladado_taller' && !String(state.taller_traslado || '').trim()) {
    return 'Indica el taller al que lo lleva la grúa.';
  }
  const startDate = String(state.fecha_activacion || '').slice(0, 10);
  const startTime = String(state.hora_activacion || '');
  if (!startDate) return 'Indica la fecha real de activación.';
  if (!startTime) return 'Indica la hora real de activación.';
  if (!validDate(startDate) || !validTime(startTime)) return 'La fecha y hora de activación no son válidas.';
  const date = String(state.fecha_fin_reparacion || '');
  const time = String(state.hora_fin_reparacion || '');
  if (!date) return 'Indica la fecha de fin de asistencia.';
  if (!time) return 'Indica la hora de fin de asistencia.';
  if (!validDate(date) || !validTime(time)) {
    return 'La fecha y hora de fin de asistencia no son válidas.';
  }
  if (date < startDate || (date === startDate && time.padEnd(8, ':00') < startTime.padEnd(8, ':00'))) {
    return 'El fin de asistencia no puede ser anterior a la activación.';
  }
  return '';
}

export function assistanceSaveError(data, payload = {}, activationId = null) {
  if (!data || typeof data !== 'object' || data.ok === false || !data.id) {
    return 'El servidor no ha confirmado el guardado de la asistencia. Revisa el resultado antes de reintentarlo.';
  }
  if (activationId && data.id !== activationId) {
    return 'La respuesta del servidor no corresponde a esta asistencia. El cierre no está confirmado.';
  }
  if (payload.estado === 'cerrada' && (data.estado !== 'cerrada'
      || data.estado_seguimiento !== 'realizada' || data.resultado !== payload.resultado)) {
    return 'El servidor no ha confirmado el fin de la asistencia. El formulario conserva los datos para revisarlos.';
  }
  if (payload.estado === 'abierta' && data.estado && data.estado !== 'abierta') {
    return 'El servidor devuelve un estado distinto del seguimiento solicitado. Revisa la asistencia.';
  }
  return '';
}

// Cada apertura del asistente conserva la identidad de un envío no confirmado.
// Los reintentos permiten que el servidor recupere el alta si se perdió la respuesta.
export function createAssistanceSaveGuard(makeRequestId) {
  let request = null;
  let pending = null;
  return {
    get pending() { return pending; },
    run(save) {
      if (pending) return pending;
      if (!request) request = makeRequestId();
      pending = Promise.resolve().then(() => save(request)).then(data => {
        request = null;
        return data;
      }).finally(() => { pending = null; });
      return pending;
    },
  };
}

// Este adaptador se registra únicamente desde los módulos de Alpha75.
// El asistente compartido mantiene sus valores originales si nadie responde.
export function assistanceWizardExtension(action, detail = {}) {
  if (action === 'save-guard') return createAssistanceSaveGuard(detail.requestId);
  if (action === 'states') {
    return [...detail.options, ['realizada', 'Asistencia 24H finalizada']];
  }
  if (action === 'payload') {
    return { ...detail.payload, ...assistanceCompletionPayload(detail.state),
      ...(detail.state?.resultado === 'trasladado_taller' ? { trasladado_taller: 'true' } : {}) };
  }
  if (action === 'validate' && detail.current === 6) return assistanceCompletionError(detail.state);
  if (action === 'saved') return assistanceSaveError(detail.data, detail.payload, detail.activationId);
  return null;
}
