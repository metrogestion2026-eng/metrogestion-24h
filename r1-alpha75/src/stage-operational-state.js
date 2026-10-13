export function deriveStageOperationalState(stage = {}, model = 'legacy') {
  if (stage.cancelado) return 'anulada';
  const isWorkshopEntry = String(stage.tipo_etapa || '').trim().toLocaleLowerCase('es-ES') === 'entrada_taller';
  if (model === 'entrada_hitos_v1' && isWorkshopEntry) {
    if (stage.fecha_real) return 'realizada';
    if (stage.fecha_fin_real || stage.fecha_inicio_real) return 'en_curso';
    if (stage.fecha_prevista) return 'programada';
    return 'pendiente';
  }
  if (stage.fecha_real || stage.fecha_fin_real) return 'realizada';
  if (stage.fecha_inicio_real) return 'en_curso';
  if (stage.fecha_prevista) return 'programada';
  return 'pendiente';
}

export function catalogueCodeForOperationalState(catalogue = [], operationalState = '') {
  const wanted = String(operationalState || '').trim().toLocaleLowerCase('es-ES');
  const item = (Array.isArray(catalogue) ? catalogue : []).find(entry =>
    String(entry?.estado_operativo || entry?.codigo || '')
      .trim()
      .toLocaleLowerCase('es-ES') === wanted
  );
  return item?.codigo || operationalState || 'pendiente';
}
