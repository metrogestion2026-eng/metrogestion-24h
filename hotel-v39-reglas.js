// Metrogestion Hotel v39 - reglas de dominio aisladas para validar antes de integrar.
// NO se carga en producción v36.

export const hotelV39 = {
  isStagePending(stage) {
    return Boolean(stage) && stage.status !== 'realizada' && stage.status !== 'anulada';
  },

  isActiveHotelUnit(unit) {
    return Boolean(unit) && unit.retiredFromActive !== true;
  },

  canReadHotel(account) {
    if (!account) return false;
    if (['primary', 'admin_principal'].includes(account.role)) return true;
    return account?.permissions?.hotel?.ver === true || account?.permissions?.hotel?.editar === true;
  },

  canEditHotel(account) {
    if (!account) return false;
    if (['primary', 'admin_principal'].includes(account.role)) return true;
    return account?.permissions?.hotel?.editar === true;
  },

  programmedStages(units = []) {
    const result = [];
    for (const unit of units) {
      for (const [index, stage] of (unit.stages || []).entries()) {
        if (!this.isStagePending(stage)) continue;
        // Una T pendiente se conserva aunque el vehículo haya sido recuperado.
        result.push({
          unitId: unit.id,
          fleet: unit.fleet || '',
          stopNumber: unit.stopNumber || '',
          recovered: unit.retiredFromActive === true,
          stageIndex: index,
          stage
        });
      }
    }
    return result;
  },

  activeHotelUnits(units = []) {
    // Recuperado = fuera de Hotel activo. No elimina histórico ni T.
    return units.filter(unit => this.isActiveHotelUnit(unit));
  },

  occupiedReserveCodes(units = []) {
    const occupied = new Set();
    for (const unit of units) {
      // Solo una sustitución ACTIVA puede ocupar una reserva.
      if (!this.isActiveHotelUnit(unit)) continue;
      const fleet = String(unit.fleet || '').trim();
      const code = String(unit.reserve || '').trim();
      if (fleet && code) occupied.add(code);
    }
    return occupied;
  },

  reserveOwnWorkCodes(units = []) {
    const blocked = new Set();
    for (const unit of units) {
      if (!this.isActiveHotelUnit(unit)) continue;
      const fleet = String(unit.fleet || '').trim();
      const code = String(unit.reserve || '').trim();
      const activeState = !['reserva_liberada', 'anulado', 'libre'].includes(String(unit.dbState || '').trim());
      const hasPendingStage = (unit.stages || []).some(stage => this.isStagePending(stage));
      // Una reserva con trabajos propios no se considera disponible para asignar.
      if (!fleet && code && (activeState || hasPendingStage)) blocked.add(code);
    }
    return blocked;
  },

  freeReserves(allReserves = [], units = []) {
    const occupied = this.occupiedReserveCodes(units);
    return allReserves.filter(reserve => {
      const code = String(reserve.code || reserve.codigo || reserve.reserve || '').trim();
      return code && !occupied.has(code);
    });
  },

  availableReserves(allReserves = [], units = []) {
    const ownWork = this.reserveOwnWorkCodes(units);
    return this.freeReserves(allReserves, units).filter(reserve => {
      const code = String(reserve.code || reserve.codigo || reserve.reserve || '').trim();
      return code && !ownWork.has(code);
    });
  },

  freeReserveCard(reserve = {}) {
    // La ficha operativa de una reserva libre nace del catálogo de reservas, no de una parada antigua.
    return {
      code: String(reserve.code || reserve.codigo || reserve.reserve || '').trim(),
      plate: String(reserve.plate || reserve.matricula || '').trim(),
      label: String(reserve.label || reserve.etiqueta || reserve.tipo || 'RESERVA').trim(),
      stopNumber: '',
      stages: [],
      historicalStopLinked: false
    };
  },

  reserveConflicts(allReserves = [], units = []) {
    const activeUse = new Map();
    const conflicts = [];
    for (const unit of units) {
      const code = String(unit.reserve || '').trim();
      if (!code) continue;
      if (unit.retiredFromActive === true) {
        conflicts.push({type:'recovered_still_linked', reserve:code, unitId:unit.id, fleet:unit.fleet || ''});
        continue;
      }
      if (!String(unit.fleet || '').trim()) continue;
      if (activeUse.has(code)) {
        conflicts.push({type:'reserve_double_assignment', reserve:code, unitId:unit.id, otherUnitId:activeUse.get(code)});
      } else {
        activeUse.set(code, unit.id);
      }
    }
    return conflicts;
  },

  stopHeading(unit) {
    const number = String(unit?.stopNumber || '').trim();
    return number ? `PARADA Nº ${number}` : '';
  },

  stageReadModel(unit = {}, stageIndex = 0) {
    const stage = (unit.stages || [])[stageIndex];
    if (!stage) return null;
    const documents = Array.isArray(stage.documents) ? stage.documents : Array.isArray(stage.documentos) ? stage.documentos : [];
    const photos = Array.isArray(stage.photos) ? stage.photos : Array.isArray(stage.fotos) ? stage.fotos : [];
    const works = Array.isArray(stage.works) ? stage.works : Array.isArray(stage.trabajos) ? stage.trabajos : [];
    const emails = Array.isArray(stage.emails) ? stage.emails : Array.isArray(stage.correos) ? stage.correos : [];
    const history = Array.isArray(stage.history) ? stage.history : Array.isArray(stage.historial) ? stage.historial : [];

    return {
      unitId: unit.id || '',
      stopNumber: String(unit.stopNumber || ''),
      fleet: String(unit.fleet || ''),
      fleetPlate: String(unit.fleetPlate || unit.matricula_sustituido || ''),
      reserve: String(unit.reserve || ''),
      reservePlate: String(unit.reservePlate || unit.matricula_reserva || ''),
      position: Number(stage.position || stage.posicion || stageIndex + 1),
      name: String(stage.name || stage.nombre || ''),
      code: String(stage.code || stage.codigo || ''),
      status: String(stage.status || stage.estado || 'pendiente'),
      provider: String(stage.provider || stage.proveedor || stage.workshopProvider || ''),
      center: String(stage.center || stage.centro || stage.location || stage.lugar || ''),
      plannedAt: stage.plannedAt || stage.fecha_programada || null,
      startedAt: stage.startedAt || stage.fecha_inicio || stage.fecha_entrada || null,
      completedAt: stage.completedAt || stage.fecha_real || null,
      orderNumber: String(stage.orderNumber || stage.numero_pedido || ''),
      workshopOrderNumber: String(stage.workshopOrderNumber || stage.numero_or || stage.hoja_taller || ''),
      kilometers: stage.kilometers ?? stage.km ?? null,
      diagnosis: String(stage.diagnosis || stage.diagnostico || ''),
      notes: String(stage.notes || stage.observaciones || ''),
      works,
      documents,
      photos,
      emails,
      history,
      source: String(stage.source || stage.origen || '')
    };
  },

  stageDossierForReader(unit = {}, stageIndex = 0, account = null) {
    if (!this.canReadHotel(account)) return {allowed:false, dossier:null};
    return {allowed:true, dossier:this.stageReadModel(unit, stageIndex)};
  },

  // Convierte los pendientes reales importados desde MANTENIMENT en T iniciales
  // cuando se crea una sustitución. El resultado es una propuesta editable.
  stagesFromMaintenancePendings(pendings = [], existingStages = []) {
    const normalize = value => String(value || '').trim().toUpperCase();
    const existingKeys = new Set((existingStages || []).map(stage => normalize(stage.sourceKey || stage.code || stage.name)));
    const created = [];

    for (const pending of pendings || []) {
      if (!pending) continue;
      if (pending.active === false || pending.completed === true || pending.status === 'realizada' || pending.status === 'anulada') continue;

      const code = normalize(pending.code || pending.codigo || pending.type || pending.tipo || pending.name || pending.nombre);
      if (!code) continue;
      const sourceKey = normalize(pending.sourceKey || pending.id || code);
      if (existingKeys.has(sourceKey) || existingKeys.has(code)) continue;

      created.push({
        name: String(pending.label || pending.nombre || pending.name || code).trim(),
        code,
        sourceKey,
        status: 'pendiente',
        position: (existingStages?.length || 0) + created.length + 1,
        plannedAt: pending.plannedAt || pending.fecha || pending.dueDate || null,
        workshop: pending.workshop || pending.taller || null,
        notes: pending.notes || pending.observaciones || '',
        source: 'MANTENIMENT',
        autoCreated: true,
        editable: true
      });
    }
    return created;
  },

  // Al crear una sustitución, conserva las T manuales existentes y añade solo
  // los pendientes de MANTENIMENT que todavía no estén representados.
  mergeSubstitutionStages(existingStages = [], maintenancePendings = []) {
    return [...(existingStages || []), ...this.stagesFromMaintenancePendings(maintenancePendings, existingStages)];
  }
};
