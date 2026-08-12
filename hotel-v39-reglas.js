// Metrogestion Hotel v39 - reglas de dominio aisladas para validar antes de integrar.
// NO se carga en producción v36.

export const hotelV39 = {
  isStagePending(stage) {
    return Boolean(stage) && stage.status !== 'realizada' && stage.status !== 'anulada';
  },

  isActiveHotelUnit(unit) {
    return Boolean(unit) && unit.retiredFromActive !== true;
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
      const code = String(unit.reserve || '').trim();
      if (code) occupied.add(code);
    }
    return occupied;
  },

  freeReserves(allReserves = [], units = []) {
    const occupied = this.occupiedReserveCodes(units);
    return allReserves.filter(reserve => {
      const code = String(reserve.code || reserve.codigo || reserve.reserve || '').trim();
      return code && !occupied.has(code);
    });
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
