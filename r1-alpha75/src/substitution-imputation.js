// Fechas DATE de imputación: no sustituyen a la parada ni a la recuperación
// físicas. Un tramo cuyo fin precede al inicio tiene legítimamente cero días.
const DAY_MS = 86400000;
const dateOnly = value => String(value || '').match(/^\d{4}-\d{2}-\d{2}/)?.[0] || '';

export function hasSubstitutionContinuity(stop) {
  return Boolean(stop?.continuidad_entrada_id || stop?.continuidad_salida_id);
}

export function substitutionImputationBounds(stop, fallbackStart = '') {
  const linked = hasSubstitutionContinuity(stop);
  if (linked && (!Object.hasOwn(stop, 'fecha_inicio_imputacion')
      || !Object.hasOwn(stop, 'fecha_fin_imputacion') || !dateOnly(stop.fecha_inicio_imputacion))) {
    throw new Error('Faltan los límites de imputación de la continuidad. Actualiza el cálculo de esta PA.');
  }
  const physicalStart = dateOnly(stop?.fecha_inicio_parada) || dateOnly(fallbackStart);
  const physicalEnd = dateOnly(stop?.fecha_fin_parada);
  return {
    linked,
    physicalStart,
    physicalEnd,
    start: Object.hasOwn(stop || {}, 'fecha_inicio_imputacion') ? dateOnly(stop.fecha_inicio_imputacion) : physicalStart,
    end: Object.hasOwn(stop || {}, 'fecha_fin_imputacion') ? dateOnly(stop.fecha_fin_imputacion) : physicalEnd,
  };
}

export function imputableDaysInPeriod(stop, period, referenceDate) {
  if (!period || !dateOnly(referenceDate)) return 0;
  const bounds = substitutionImputationBounds(stop);
  if (!bounds.start) return 0;
  const start = [bounds.start, dateOnly(period.fecha_inicio)].filter(Boolean).sort().at(-1);
  const end = [bounds.end, dateOnly(period.fecha_cierre), dateOnly(referenceDate)].filter(Boolean).sort()[0];
  if (!end || end < start) return 0;
  return Math.floor((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / DAY_MS) + 1;
}

export function needsSubstitutionMean(stop, period, referenceDate) {
  if (stop?.clase_facturacion !== 'DFM' || !stop.sustituto || stop.km_dia != null) return false;
  // Para las PA anteriores sin continuidad se conserva el criterio del Panel.
  // Un origen cortado por continuidad sí necesita media si aporta días al periodo.
  return hasSubstitutionContinuity(stop)
    ? imputableDaysInPeriod(stop, period, referenceDate) > 0
    : stop.fecha_fin_parada == null;
}

export function substitutionOwnershipText(row) {
  if (!row?.sustituto || !Object.hasOwn(row, 'propietario_sustitucion_seguimiento_id')) return '';
  const owner = row.propietario_sustitucion_seguimiento_id;
  if (row.sustitucion_vigente === true && owner && owner === row.seguimiento_id) return 'Sustitución vigente en esta PA';
  return owner
    ? 'Sustituto conservado como referencia · asignación vigente actual en otra PA'
    : 'Sustituto conservado como referencia · sin asignación vigente actual';
}

export function currentSubstitutionOwners(rows) {
  const owners = new Map();
  const ambiguous = new Set();
  for (const row of rows) {
    if (!row?.sustituto || row.sustitucion_vigente !== true
        || !row.seguimiento_id || row.propietario_sustitucion_seguimiento_id !== row.seguimiento_id) continue;
    const code = String(row.sustituto).trim().toUpperCase();
    const previous = owners.get(code);
    if (previous && previous.seguimiento_id !== row.seguimiento_id) ambiguous.add(code);
    else owners.set(code, row);
  }
  // Una proyección contradictoria no se resuelve eligiendo la última tarjeta.
  for (const code of ambiguous) owners.delete(code);
  return owners;
}
