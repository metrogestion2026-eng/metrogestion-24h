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
  }
};
