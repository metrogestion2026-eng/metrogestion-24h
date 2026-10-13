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

function legacyStageState(stage = {}) {
  if (stage.cancelado) return 'anulada';
  if (stage.fecha_real || stage.fecha_fin_real) return 'realizada';
  if (stage.fecha_inicio_real) return 'en_curso';
  if (stage.fecha_prevista) return 'programada';
  return normalized(stage.estado) || 'pendiente';
}

function deriveLegacyHotelOperationalState(ficha = {}, stages = []) {
  const active = (Array.isArray(stages) ? stages : []).filter(stage => !stage?.cancelado);
  if (!active.length) return normalized(ficha.estado) || 'pendiente_taller';

  const stateOf = stage => legacyStageState(stage);
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
  if (entries.some(stage => stateOf(stage) === 'programada')) return 'entrada_taller_programada';
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

function isNewFlowEntry(stage = {}) {
  return !stage?.cancelado && normalized(stage.tipo_etapa) === 'entrada_taller';
}

function isRecovery(stage = {}) {
  return !stage?.cancelado && (
    normalized(stage.accion_sistema) === 'recuperar_y_liberar'
    || normalized(stage.tipo_etapa) === 'recuperar_ruta'
  );
}

function nextStageSituation(stage = {}) {
  const type = normalized(stage.tipo_etapa);
  if (isRecovery(stage)) return stage.fecha_real || normalized(stage.estado) === 'realizada'
    ? 'recuperado'
    : 'recogido_pendiente_ruta';
  if (type === 'entrada_taller') {
    if (stage.fecha_real) return null;
    if (stage.fecha_fin_real) return 'terminado_pendiente_recogida';
    if (stage.fecha_inicio_real) return 'en_taller';
    if (stage.fecha_prevista) return 'entrada_taller_programada';
    return 'pendiente_taller';
  }
  if (type === '24h') return normalized(stage.estado) === 'realizada' ? null : 'asistencia_24h';
  if (type === 'trámite') return normalized(stage.estado) === 'realizada' ? null : 'tramite';
  if (type === 'gestión') return normalized(stage.estado) === 'realizada' ? null : 'gestion';
  if (normalized(stage.estado) === 'realizada' || stage.fecha_real) return null;
  if (stage.fecha_prevista) return 'planificado';
  return null;
}

function deriveNewFlowOperationalState(ficha = {}, stages = []) {
  const active = (Array.isArray(stages) ? stages : [])
    .filter(stage => !stage?.cancelado && normalized(stage.tipo_etapa) !== 'recogida_taller')
    .slice()
    .sort((a, b) => Number(a?.posicion || 0) - Number(b?.posicion || 0));

  if (!active.length) return normalized(ficha.estado) || 'pendiente_taller';

  const firstEntryIndex = active.findIndex(stage =>
    isNewFlowEntry(stage)
    && Boolean(stage.fecha_prevista || stage.fecha_inicio_real || stage.fecha_fin_real || stage.fecha_real)
  );

  if (firstEntryIndex < 0) {
    const current = normalized(ficha.estado);
    return PRE_ENTRY_STATES.has(current) ? current : 'pendiente_taller';
  }

  for (let index = firstEntryIndex; index < active.length; index += 1) {
    const situation = nextStageSituation(active[index]);
    if (situation) return situation;
  }

  return 'recogido_pendiente_ruta';
}

export function hasStageDrivenSituation(ficha = {}, stages = []) {
  if (ficha.modelo_flujo_taller !== 'entrada_hitos_v1') return false;
  return (Array.isArray(stages) ? stages : []).some(stage =>
    isNewFlowEntry(stage)
    && Boolean(stage.fecha_prevista || stage.fecha_inicio_real || stage.fecha_fin_real || stage.fecha_real)
  );
}

export function deriveHotelOperationalState(ficha = {}, stages = []) {
  if (ficha.cancelado) return 'anulado';
  if (['recuperado', 'reserva_liberada'].includes(normalized(ficha.estado))) {
    return normalized(ficha.estado);
  }
  return ficha.modelo_flujo_taller === 'entrada_hitos_v1'
    ? deriveNewFlowOperationalState(ficha, stages)
    : deriveLegacyHotelOperationalState(ficha, stages);
}
