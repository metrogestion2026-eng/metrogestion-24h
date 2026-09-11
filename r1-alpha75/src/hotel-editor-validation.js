const OPERATIONAL_STATE_LABELS = Object.freeze({
  pendiente: 'Pendiente',
  programada: 'Programada',
  en_curso: 'En curso',
  realizada: 'Realizada',
  anulada: 'Anulada'
});

function normalise(value) {
  return String(value ?? '').trim().toLocaleLowerCase('es-ES');
}

function catalogueItem(catalogue, value) {
  const key = normalise(value);
  if (!key) return null;
  return (catalogue || []).find(item =>
    normalise(item.codigo) === key || normalise(item.nombre) === key
  ) || null;
}

function stateLabel(value) {
  return OPERATIONAL_STATE_LABELS[value] || String(value || 'sin estado');
}

function stageValidationKey(stage) {
  return `stage:${stage.client_key || stage.id || stage.posicion}:estado`;
}

export function stageStateMismatchIssues(detail) {
  const catalogue = detail?.catalogos?.estados_etapa || [];
  return (detail?.etapas || []).flatMap((stage, index) => {
    if (stage.cancelado) return [];
    const selectedCode = stage.estado_catalogo_codigo || stage.estado;
    const item = catalogueItem(catalogue, selectedCode);
    if (!item) return [];
    const expected = item.estado_operativo || item.codigo;
    if (normalise(expected) === normalise(stage.estado)) return [];
    const visibleName = item.nombre || item.codigo;
    return [{
      key: stageValidationKey(stage),
      message: `${Number(stage.posicion) || index + 1}T · ${stage.nombre || 'Sin nombre'}: abre Estado y vuelve a seleccionar «${visibleName}». Esa opción debe quedar como «${stateLabel(expected)}», pero conserva internamente «${stateLabel(stage.estado)}».`
    }];
  });
}

export function saveErrorIssues(detail, error) {
  const message = String(error?.message || error || '');
  if (!/estado personalizado de la T no corresponde|estado visible de la T no es válido/i.test(message)) return [];
  const mismatches = stageStateMismatchIssues(detail);
  if (mismatches.length) return mismatches;
  return (detail?.etapas || []).filter(stage => !stage.cancelado).map((stage, index) => ({
    key: stageValidationKey(stage),
    message: `${Number(stage.posicion) || index + 1}T · ${stage.nombre || 'Sin nombre'}: revisa el desplegable Estado y vuelve a seleccionar su opción correcta.`
  }));
}
