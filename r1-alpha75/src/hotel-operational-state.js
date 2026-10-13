const EXCEPTION_STATES = new Set([
  'pendiente_diagnostico',
  'pendiente_autorizacion',
  'pendiente_repuestos',
]);

const PRE_ENTRY_STATES = new Set([
  'planificado',
  'pendiente_taller',
]);

function normalized(value) {
  return String(value || '').trim().toLocaleLowerCase('es-ES');
}

function stageState(stage = {}) {
  if (stage.cancelado) return 'anulada';
  if (stage.fecha_real || stage.fecha_fin_real) return 'realizada';
  if (stage.fecha_inicio_real) return 'en_curso';
  if (stage.fecha_prevista) return 'programada';
  return normalized(stage.estado) || 'pendiente';
}

export function deriveHotelOperationalState(ficha = {}, stages = []) {
  if (ficha.cancelado) return 'anulado';
  if (['recuperado', 'reserva_liberada'].includes(normalized(ficha.estado))) {
    return normalized(ficha.estado);
  }

  const active = (Array.isArray(stages) ? stages : []).filter(stage => !stage?.cancelado);
  if (!active.length) return normalized(ficha.estado) || 'pendiente_taller';

  const stateOf = stage => stageState(stage);
  const typeOf = stage => normalized(stage?.tipo_etapa);
  const actionOf = stage => normalized(stage?.accion_sistema);

  const recovery = active.find(stage =>
    actionOf(stage) === 'recuperar_y_liberar' || typeOf(stage) === 'recuperar_ruta'
  );
  if (recovery && stateOf(recovery) === 'realizada') return 'recuperado';

  const pickups = active.filter(stage => typeOf(stage) === 'recogida_taller');
  if (pickups.some(stage => stateOf(stage) === 'realizada')) return 'recogido_pendiente_ruta';
  if (pickups.some(stage => ['programada', 'en_curso'].includes(stateOf(stage)))) {
    return 'terminado_pendiente_recogida';
  }

  const entries = active.filter(stage => typeOf(stage) === 'entrada_taller');
  if (entries.some(stage => ['en_curso', 'realizada'].includes(stateOf(stage)))) {
    const current = normalized(ficha.estado);
    return EXCEPTION_STATES.has(current) ? current : 'en_taller';
  }
  if (entries.some(stage => stateOf(stage) === 'programada')) {
    return 'entrada_taller_programada';
  }
  if (entries.length) {
    const current = normalized(ficha.estado);
    if (PRE_ENTRY_STATES.has(current) || EXCEPTION_STATES.has(current)) return current;
    return 'pendiente_taller';
  }

  const assistance = active.find(stage => typeOf(stage) === '24h');
  if (assistance && stateOf(assistance) !== 'realizada') return 'asistencia_24h';

  const procedure = active.find(stage => typeOf(stage) === 'trámite');
  if (procedure && stateOf(procedure) !== 'realizada') return 'tramite';

  const management = active.find(stage => typeOf(stage) === 'gestión');
  if (management && stateOf(management) !== 'realizada') return 'gestion';

  if (active.some(stage => stateOf(stage) === 'programada')) return 'planificado';

  return normalized(ficha.estado) || 'pendiente_taller';
}
