export const EDITOR_TIMESTAMP_CONTRACT = 'MG75-EDITOR-FECHAS-001';

const FICHA_TIMESTAMPS = ['fecha_entrada', 'fecha_limite_sustitucion'];
const STAGE_TIMESTAMPS = ['fecha_prevista', 'fecha_inicio_real', 'fecha_fin_real', 'fecha_real'];

function uniqueRowsById(rows = []) {
  const unique = new Map();
  const repeated = new Set();
  for (const row of Array.isArray(rows) ? rows : []) {
    const id = row?.id;
    if (typeof id !== 'string' || !id) continue;
    if (unique.has(id) || repeated.has(id)) {
      unique.delete(id);
      repeated.add(id);
    } else unique.set(id, row);
  }
  return unique;
}

function captureFields(raw, displayed, fields) {
  const captured = new Map();
  for (const field of fields) {
    const original = raw?.[field];
    const initial = displayed?.[field];
    if (typeof original === 'string' && original && typeof initial === 'string') {
      captured.set(field, { original, initial });
    }
  }
  return captured;
}

function restoreFields(payload, current, captured) {
  const result = { ...payload };
  for (const [field, { original, initial }] of captured) {
    if (Object.hasOwn(payload, field) && current?.[field] === initial) {
      // Keep the server's exact string, including microseconds and UTC offset.
      // A Date round trip would lose precision and cannot disambiguate a fold.
      result[field] = original;
    }
  }
  return result;
}

/** Capture before rendering can modify the draft. Existing datetime-local
 * controls keep their current format; only unedited timestamps regain the
 * exact server value when serializing. The paired SQL contract accepts offsets
 * and retains the legacy Madrid interpretation for explicitly edited values.
 */
export function createEditorTimestampRestorer(rawDetail = {}, initialDetail = {}) {
  const fichaId = typeof rawDetail.ficha?.id === 'string' ? rawDetail.ficha.id : '';
  const fichaFields = fichaId && initialDetail.ficha?.id === fichaId
    ? captureFields(rawDetail.ficha, initialDetail.ficha, FICHA_TIMESTAMPS)
    : new Map();
  const initialStages = uniqueRowsById(initialDetail.etapas);
  const stageFields = new Map();
  for (const [id, raw] of uniqueRowsById(rawDetail.etapas)) {
    const displayed = initialStages.get(id);
    if (displayed) stageFields.set(id, captureFields(raw, displayed, STAGE_TIMESTAMPS));
  }

  return function restoreUneditedTimestamps(currentDetail, fichaPayload, stagesPayload) {
    const sameFicha = fichaId && currentDetail?.ficha?.id === fichaId;
    const stages = uniqueRowsById(currentDetail?.etapas);
    return {
      ficha: sameFicha ? restoreFields(fichaPayload, currentDetail.ficha, fichaFields) : { ...fichaPayload },
      etapas: stagesPayload.map(payload => {
        const captured = sameFicha && stageFields.get(payload.id);
        const current = stages.get(payload.id);
        return captured && current ? restoreFields(payload, current, captured) : { ...payload };
      }),
    };
  };
}
