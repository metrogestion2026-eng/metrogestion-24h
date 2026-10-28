const EXCEPTION_STATES = new Set([
  'pendiente_diagnostico',
  'pendiente_autorizacion',
  'pendiente_repuestos',
]);

const PRE_ENTRY_STATES = new Set([
  'planificado',
  'pendiente_taller',
  'tramite',
  'gestion',
  't_pendientes',
  'realizada',
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

const NO_RECOVERY_MODALITIES = new Set([
  'sin_sustitucion',
  'reparado_en_ruta',
  'reserva_en_reparacion',
]);

function stagePosition(stage = {}) {
  return Number(stage.posicion || 0);
}

function deriveNoRecoveryLegacyState(ficha = {}, active = []) {
  const ordered = active.slice().sort((a, b) => stagePosition(a) - stagePosition(b));
  const stateOf = stage => legacyStageState(stage);
  const typeOf = stage => normalized(stage?.tipo_etapa);

  const orderedEntries = ordered.filter(stage => typeOf(stage) === 'entrada_taller');
  const latestEntry = orderedEntries.at(-1);
  if (latestEntry) {
    const entryState = stateOf(latestEntry);
    if (entryState === 'programada') return 'entrada_taller_programada';
    if (entryState === 'pendiente') {
      const current = normalized(ficha.estado);
      return PRE_ENTRY_STATES.has(current) || EXCEPTION_STATES.has(current)
        ? current
        : 'pendiente_taller';
    }

    if (['en_curso', 'realizada'].includes(entryState)) {
      const pickup = ordered.find(stage =>
        typeOf(stage) === 'recogida_taller'
        && (
          String(stage.etapa_origen_id || '') === String(latestEntry.id || '')
          || stagePosition(stage) === stagePosition(latestEntry) + 1
        )
      );

      if (!pickup || stateOf(pickup) === 'pendiente') {
        const current = normalized(ficha.estado);
        return EXCEPTION_STATES.has(current) ? current : 'en_taller';
      }
      if (['programada', 'en_curso'].includes(stateOf(pickup))) {
        return 'terminado_pendiente_recogida';
      }

      const later = ordered.filter(stage => stagePosition(stage) > stagePosition(pickup));
      const pendingProcedure = later.find(stage =>
        ['trámite', 'tramite'].includes(typeOf(stage))
        && stateOf(stage) !== 'realizada'
      );
      if (pendingProcedure) return 'tramite';
      const pendingManagement = later.find(stage =>
        ['gestión', 'gestion'].includes(typeOf(stage))
        && stateOf(stage) !== 'realizada'
      );
      if (pendingManagement) return 'gestion';
    }
  }

  const assistance = ordered.find(stage => typeOf(stage) === '24h' && stateOf(stage) !== 'realizada');
  if (assistance) return 'asistencia_24h';

  const procedure = ordered.find(stage =>
    ['trámite', 'tramite'].includes(typeOf(stage)) && stateOf(stage) !== 'realizada'
  );
  if (procedure) return 'tramite';

  const management = ordered.find(stage =>
    ['gestión', 'gestion'].includes(typeOf(stage)) && stateOf(stage) !== 'realizada'
  );
  if (management) return 'gestion';

  return normalized(ficha.estado) || 'pendiente_taller';
}

function deriveLegacyHotelOperationalState(ficha = {}, stages = []) {
  const active = (Array.isArray(stages) ? stages : []).filter(stage => !stage?.cancelado);
  if (!active.length) return normalized(ficha.estado) || 'pendiente_taller';

  const stateOf = stage => legacyStageState(stage);
  const typeOf = stage => normalized(stage?.tipo_etapa);
  const actionOf = stage => normalized(stage?.accion_sistema);

  if (NO_RECOVERY_MODALITIES.has(normalized(ficha.modalidad_operativa))) {
    return deriveNoRecoveryLegacyState(ficha, active);
  }

  const recovery = active.find(stage =>
    actionOf(stage) === 'recuperar_y_liberar' || typeOf(stage) === 'recuperar_ruta'
  );
  if (recovery && stateOf(recovery) === 'realizada') return 'recuperado';

  const ordered = active.slice().sort((a, b) => stagePosition(a) - stagePosition(b));
  const entries = ordered.filter(stage => typeOf(stage) === 'entrada_taller');

  const pickupFor = entry => {
    const entryPos = stagePosition(entry);
    return ordered.find(stage =>
      typeOf(stage) === 'recogida_taller'
      && (
        String(stage.etapa_origen_id || '') === String(entry.id || '')
        || stagePosition(stage) === entryPos + 1
      )
    ) || ordered.find(stage =>
      typeOf(stage) === 'recogida_taller'
      && stagePosition(stage) > entryPos
    );
  };

  // Una recuperación ya iniciada es una decisión operativa explícita y manda.
  if (recovery && ['programada', 'en_curso'].includes(stateOf(recovery))) {
    return 'recogido_pendiente_ruta';
  }

  // Después manda la estancia realmente abierta, aunque haya entradas futuras
  // todavía pendientes detrás. Esto corrige R1520 y conserva 2527.
  const openEntries = entries.filter(entry => {
    if (!['en_curso', 'realizada'].includes(stateOf(entry))) return false;
    const pickup = pickupFor(entry);
    return !pickup || stateOf(pickup) !== 'realizada';
  });
  const currentEntry = openEntries.at(-1);
  if (currentEntry) {
    const pickup = pickupFor(currentEntry);
    if (pickup && ['programada', 'en_curso'].includes(stateOf(pickup))) {
      return 'terminado_pendiente_recogida';
    }
    const current = normalized(ficha.estado);
    return EXCEPTION_STATES.has(current) ? current : 'en_taller';
  }

  // Si no hay ninguna estancia abierta, ya puede mandar la siguiente entrada.
  const latestEntry = entries.at(-1);
  if (latestEntry) {
    const entryState = stateOf(latestEntry);
    if (entryState === 'programada') return 'entrada_taller_programada';
    if (entryState === 'pendiente') {
      const current = normalized(ficha.estado);
      if (PRE_ENTRY_STATES.has(current) || EXCEPTION_STATES.has(current)) return current;
      return 'pendiente_taller';
    }
  }

  const pickups = active.filter(stage => typeOf(stage) === 'recogida_taller');
  if (pickups.some(stage => stateOf(stage) === 'realizada')) return 'recogido_pendiente_ruta';
  if (pickups.some(stage => ['programada', 'en_curso'].includes(stateOf(stage)))) {
    return 'terminado_pendiente_recogida';
  }

  const allEntries = active.filter(stage => typeOf(stage) === 'entrada_taller');
  if (allEntries.some(stage => ['en_curso', 'realizada'].includes(stateOf(stage)))) {
    const current = normalized(ficha.estado);
    return EXCEPTION_STATES.has(current) ? current : 'en_taller';
  }
  if (allEntries.some(stage => stateOf(stage) === 'programada')) return 'entrada_taller_programada';
  if (allEntries.length) {
    const current = normalized(ficha.estado);
    if (PRE_ENTRY_STATES.has(current) || EXCEPTION_STATES.has(current)) return current;
    return 'pendiente_taller';
  }

  const assistance = active.find(stage => typeOf(stage) === '24h');
  if (assistance && stateOf(assistance) !== 'realizada') return 'asistencia_24h';

  const procedure = active.find(stage => typeOf(stage) === 'trámite');
  if (procedure && stateOf(procedure) !== 'realizada') return 'tramite';

  const management = active.find(stage => typeOf(stage) === 'gestión');
  if (management) return stateOf(management) === 'realizada' ? 'realizada' : 'gestion';

  if (active.some(stage => stateOf(stage) === 'programada')) return 'planificado';
  return normalized(ficha.estado) || 'pendiente_taller';
}

function isNewFlowEntry(stage = {}) {
  return !stage?.cancelado && normalized(stage.tipo_etapa) === 'entrada_taller';
}

function typeKey(value) {
  return normalized(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

export function isRecovery(stage = {}) {
  return !stage?.cancelado && normalized(stage.estado) !== 'anulada' && (
    normalized(stage.accion_sistema) === 'recuperar_y_liberar'
    || ['recuperar_ruta', 'recuperar'].includes(typeKey(stage.tipo_etapa))
    || /^(recuperar ruta|recuperar vehiculo)/.test(typeKey(stage.nombre))
  );
}

export function recoveryInputSignature(ficha = {}, stages = []) {
  return JSON.stringify([ficha.id, ficha.modalidad_operativa || '', ficha.vehiculo_reserva || '',
    (Array.isArray(stages) ? stages : []).map(stage => [stage.id, stage.tipo_etapa, stage.nombre,
      stage.accion_sistema, stage.estado, stage.cancelado, stage.etapa_origen_id,
      stage.fecha_prevista, stage.fecha_inicio_real, stage.fecha_fin_real, stage.fecha_real])]);
}

export function bindRecoveryPreview(ficha, stages) {
  if (ficha?.rec001?.registro_id === ficha.id) ficha.rec001_base = recoveryInputSignature(ficha, stages);
}

function recoveryPreview(ficha, stages) {
  const common = ficha.rec001;
  if (common?.registro_id === ficha.id && ficha.rec001_base === recoveryInputSignature(ficha, stages)) {
    if (common.conflicto) return { conflict: true };
    if (typeof common.requiere_recuperacion === 'boolean') {
      return { required: common.requiere_recuperacion, complete: common.cierre_confirmable === true };
    }
  }
  // Al cambiar el borrador se descarta el permiso de cierre de la lectura anterior.
  // Solo se anticipa la exclusión explícita; guardar consulta el núcleo otra vez.
  const excluded = NO_RECOVERY_MODALITIES.has(normalized(ficha.modalidad_operativa));
  const substitute = Boolean(String(ficha.vehiculo_reserva || '').trim());
  if (excluded) return substitute ? { conflict: true } : { required: false, complete: false };
  if (substitute) return { required: true, complete: false };
  const tasks = stages.filter(stage => !stage.cancelado && normalized(stage.estado) !== 'anulada' && !isRecovery(stage));
  if (tasks.length && tasks.every(stage => ['tramite', 'gestion'].includes(typeKey(stage.tipo_etapa)))) {
    return { required: false, complete: false };
  }
  return { required: true, complete: false };
}

function nextStageSituation(stage = {}) {
  const type = typeKey(stage.tipo_etapa);
  if (type === 'entrada_taller') {
    if (stage.fecha_inicio_real && stage.fecha_fin_real && stage.fecha_real) return null;
    // Mostrar hitos existentes no permite inventar los que falten ni cerrar.
    if (stage.fecha_real) return null;
    if (stage.fecha_fin_real) return 'terminado_pendiente_recogida';
    if (stage.fecha_inicio_real) return 'en_taller';
    if (stage.fecha_prevista) return 'entrada_taller_programada';
    return 'pendiente_taller';
  }
  if (normalized(stage.estado) === 'realizada') return null;
  if (type === '24h') return 'asistencia_24h';
  if (type === 'recogida_taller') return 'terminado_pendiente_recogida';
  if (type === 'tramite') return 'tramite';
  if (type === 'gestion') return 'gestion';
  return stage.fecha_prevista ? 'planificado' : 't_pendientes';
}

function deriveNewFlowOperationalState(ficha = {}, stages = []) {
  const active = (Array.isArray(stages) ? stages : [])
    .filter(stage => !stage?.cancelado && normalized(stage.estado) !== 'anulada')
    .slice().sort((a, b) => Number(a?.posicion || 0) - Number(b?.posicion || 0));
  const decision = recoveryPreview(ficha, Array.isArray(stages) ? stages : []);
  if (decision.conflict) return normalized(ficha.estado) || 'pendiente_taller';
  if (!active.length) return normalized(ficha.estado) || 'pendiente_taller';
  const tasks = active.filter(stage => !isRecovery(stage));
  const recovery = decision.required ? active.find(isRecovery) : null;
  const hasFacts = hasStageDrivenSituation(ficha, active);

  // Una estancia física abierta conserva prioridad sobre entradas futuras.
  const inWorkshop = tasks.find(stage => isNewFlowEntry(stage) && stage.fecha_inicio_real && !stage.fecha_real);
  if (inWorkshop) {
    if (inWorkshop.fecha_fin_real) return 'terminado_pendiente_recogida';
    const current = normalized(ficha.estado);
    return EXCEPTION_STATES.has(current) ? current : 'en_taller';
  }
  for (const stage of tasks) {
    const situation = nextStageSituation(stage);
    if (!situation) continue;
    if (isNewFlowEntry(stage) && !hasFacts) {
      const current = normalized(ficha.estado);
      return PRE_ENTRY_STATES.has(current) ? current : situation;
    }
    if (['tramite', 'gestion'].includes(situation) && normalized(ficha.estado) === 't_pendientes') return 't_pendientes';
    return situation;
  }
  if (decision.required) {
    if (recovery && (normalized(recovery.estado) === 'realizada' || recovery.fecha_real)) return 'recuperado';
    if (recovery || hasFacts) return 'recogido_pendiente_ruta';
  }
  // La gestión/trámite sin otras actuaciones cierra su propio flujo. Para las
  // actuaciones físicas, solo el núcleo confirma que no falta ningún hecho.
  if (decision.complete || (tasks.length && !decision.required
    && tasks.every(stage => ['tramite', 'gestion'].includes(typeKey(stage.tipo_etapa)) && normalized(stage.estado) === 'realizada'))) return 'realizada';
  return tasks.length ? 't_pendientes' : (normalized(ficha.estado) || 'pendiente_taller');
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
  // Una entrada de taller posterior y físicamente abierta prevalece sobre
  // un estado de recogida/recuperación heredado de una 24H terminada.
  // Solo afecta a la presentación: no cambia los hechos ni los datos manuales.
  const activeWorkshop = (Array.isArray(stages) ? stages : [])
    .filter(stage => !stage?.cancelado && normalized(stage.estado) !== 'anulada')
    .filter(stage => normalized(stage.tipo_etapa) === 'entrada_taller'
      && Boolean(stage.fecha_inicio_real) && !stage.fecha_real)
    .sort((a, b) => stagePosition(a) - stagePosition(b)).at(-1);
  if (activeWorkshop) {
    return activeWorkshop.fecha_fin_real ? 'terminado_pendiente_recogida' : 'en_taller';
  }
  if (['recuperado', 'reserva_liberada'].includes(normalized(ficha.estado))) {
    return normalized(ficha.estado);
  }
  // Las fichas legacy conservan selección manual de Situación operativa.
  // Sus T son histórico/guía y no deben sobreescribir automáticamente la
  // situación elegida por el usuario. Solo entrada_hitos_v1 se deriva por T.
  return ficha.modelo_flujo_taller === 'entrada_hitos_v1'
    ? deriveNewFlowOperationalState(ficha, stages)
    : (normalized(ficha.estado) || 'pendiente_taller');
}
