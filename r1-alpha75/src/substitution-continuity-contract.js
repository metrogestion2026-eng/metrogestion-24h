// MG75-CONTINUIDAD-SUSTITUCION-ENTRE-PA-001.
// La fecha procede de la T persistida. Esta capa no decide el propietario ni
// calcula una entrada o recuperación a partir de la fecha del navegador.
export const CONTINUITY_RULE = 'MG75-CONTINUIDAD-SUSTITUCION-ENTRE-PA-001';
export const CONTINUITY_PREVIEW_RPC = 'previsualizar_continuidad_sustitucion_alpha75';
export const CONTINUITY_CONFIRM_RPC = 'confirmar_continuidad_sustitucion_alpha75';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isId = value => typeof value === 'string' && UUID.test(value);
const sameId = (a, b) => isId(a) && isId(b) && a.toLowerCase() === b.toLowerCase();
const isVersion = value => Number.isInteger(value) && value >= 0;
const isDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
  && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
const validIdentity = value => value && isId(value.id) && isId(value.seguimiento_id)
  && isVersion(value.version) && typeof value.numero_parada === 'string';
const validOwner = value => value && isId(value.id) && isId(value.seguimiento_id)
  && typeof value.numero_parada === 'string';
const validTranche = value => value && isDate(value.fecha_inicio_imputacion)
  && (value.fecha_fin_imputacion === null || isDate(value.fecha_fin_imputacion))
  && Number.isInteger(value.dias_imputables) && value.dias_imputables >= 0;

export function continuityContextError(data, destinationId) {
  if (data?.ok !== true || data.regla !== CONTINUITY_RULE) {
    return data?.mensaje || 'No se ha recibido un contexto de continuidad válido del servidor.';
  }
  if (!validIdentity(data.destino) || !sameId(data.destino.id, destinationId)) {
    return 'La PA de destino recibida no coincide con la ficha abierta. Vuelve a cargarla.';
  }
  if (!Array.isArray(data.origenes) || !Array.isArray(data.entradas)
      || !Array.isArray(data.bloqueos) || !Array.isArray(data.continuidades)) {
    return 'La respuesta de continuidad está incompleta. No se puede confirmar.';
  }
  return '';
}

export function continuityPreviewError(context, { destinationId, originId, entryId }) {
  const contextError = continuityContextError(context, destinationId);
  if (contextError) return contextError;
  const preview = context.prevision;
  if (context.confirmable !== true || context.bloqueos.length || preview?.bloqueos?.length) {
    return context.bloqueos[0]?.mensaje || preview?.bloqueos?.[0]?.mensaje
      || 'La continuidad no es confirmable. Revisa los bloqueos y los datos de ambas PA.';
  }
  if (!preview || !validIdentity(preview.origen) || !validIdentity(preview.destino)
      || !sameId(preview.origen.id, originId) || !sameId(preview.destino.id, destinationId)
      || !sameId(preview.destino.seguimiento_id, context.destino.seguimiento_id)
      || sameId(originId, destinationId)
      || !sameId(preview.entrada?.id, entryId)
      || !isId(preview.entrada?.seguimiento_id)
      || !sameId(preview.entrada?.registro_hotel_id, preview.destino.id)
      || !sameId(preview.entrada?.seguimiento_parada_id, preview.destino.seguimiento_id)
      || !isVersion(preview.entrada?.version)
      || !preview.entrada?.fecha_inicio_real
      || Number.isNaN(Date.parse(preview.entrada.fecha_inicio_real))
      || !isDate(preview.entrada.dia_entrada)
      || !isDate(preview.fecha_referencia)
      || !validTranche(preview.tramo_origen) || !validTranche(preview.tramo_destino)
      || typeof preview.huella_prevision !== 'string' || !preview.huella_prevision.trim()
      || !Array.isArray(preview.bloqueos)) {
    return 'La previsión recibida no confirma las identidades, la entrada real y el reparto seleccionados. Vuelve a previsualizar.';
  }
  return '';
}

export function continuityConfirmationPayload(context, selection, requestId) {
  const error = continuityPreviewError(context, selection);
  if (error) throw new Error(error);
  if (typeof requestId !== 'string' || !requestId.trim()) throw new Error('Falta la identidad de la petición de continuidad.');
  const preview = context.prevision;
  return Object.freeze({
    p_origen_id: preview.origen.id,
    p_destino_id: preview.destino.id,
    p_etapa_entrada_id: preview.entrada.id,
    p_version_origen: preview.origen.version,
    p_version_destino: preview.destino.version,
    p_version_entrada: preview.entrada.version,
    p_huella_prevision: preview.huella_prevision,
    p_request_id: requestId,
  });
}

export function continuityConfirmationError(data, payload, preview) {
  if (data?.ok !== true || data.regla !== CONTINUITY_RULE
      || typeof data.reutilizada !== 'boolean'
      || data.request_id !== payload.p_request_id || !isId(data.continuidad_id)
      || !sameId(data.origen_id, payload.p_origen_id)
      || !sameId(data.destino_id, payload.p_destino_id)
      || !sameId(data.etapa_entrada_id, payload.p_etapa_entrada_id)
      || !validOwner(data.propietario_al_confirmar)
      || !sameId(data.propietario_al_confirmar.id, payload.p_destino_id)
      || !sameId(data.propietario_al_confirmar.seguimiento_id, preview.destino.seguimiento_id)
      || !(data.propietario_actual === null || validOwner(data.propietario_actual))
      || !isVersion(data.versiones?.origen) || !isVersion(data.versiones?.destino)
      || !isVersion(data.versiones?.entrada)
      || !validTranche(data.tramos?.origen) || !validTranche(data.tramos?.destino)) {
    return 'Continuidad no confirmada: falta la respuesta autoritativa del vínculo solicitado. Reintenta la misma petición para comprobar su resultado.';
  }
  // El propietario actual puede haber cambiado después de una confirmación
  // cuya respuesta se perdió. El vínculo y propietario_al_confirmar son estables.
  return '';
}

function rpcError(result) {
  if (!result?.error) return null;
  const error = new Error(result.error.message || 'No se pudo completar la consulta.');
  // Un SQLSTATE explícito significa que la transacción del RPC fue rechazada.
  // Los fallos de transporte y respuestas incompletas conservan la petición.
  error.rejected = /^[0-9A-Z]{5}$/.test(String(result.error.code || ''));
  return error;
}

export function createContinuityController({ client, destinationId, requestId = () => `continuidad_${crypto.randomUUID()}`, onChange = () => {} }) {
  if (!isId(destinationId)) throw new Error('Falta una identidad válida de PA destino.');
  let state = {
    context: null, originId: '', entryId: '', acknowledged: false,
    reading: false, saving: false, uncertain: false, confirmed: null, error: '',
  };
  let sequence = 0;
  let savePromise = null;
  let frozenRequest = null;
  let frozenPreview = null;
  let disposed = false;
  const selection = () => ({ destinationId, originId: state.originId, entryId: state.entryId });
  const update = values => {
    state = { ...state, ...values };
    if (!disposed) onChange(state);
  };

  async function read(withSelection = false) {
    if (disposed || state.saving || state.uncertain || state.confirmed) return null;
    if (withSelection && (!state.originId || !state.entryId)) {
      update({ error: 'Selecciona expresamente la PA de origen y la entrada real en taller.' });
      return null;
    }
    const token = ++sequence;
    const selected = selection();
    update({ reading: true, acknowledged: false, error: '', ...(!withSelection ? { originId: '', entryId: '' } : {}), context: withSelection && state.context
      ? { ...state.context, prevision: null, confirmable: false } : null });
    try {
      const result = await client.rpc(CONTINUITY_PREVIEW_RPC, {
        p_destino_id: destinationId,
        p_origen_id: withSelection ? selected.originId : null,
        p_etapa_entrada_id: withSelection ? selected.entryId : null,
      });
      if (disposed || token !== sequence) return null;
      const error = rpcError(result);
      if (error) throw error;
      const invalid = continuityContextError(result?.data, destinationId);
      if (invalid) throw new Error(invalid);
      update({ context: result.data, error: withSelection && result.data.confirmable
        ? continuityPreviewError(result.data, selected) : '' });
      return result.data;
    } catch (error) {
      if (!disposed && token === sequence) update({ error: error.message || 'No se pudo leer la continuidad.' });
      return null;
    } finally {
      if (!disposed && token === sequence) update({ reading: false });
    }
  }

  function select({ originId = state.originId, entryId = state.entryId }) {
    if (disposed || state.saving || state.uncertain || state.confirmed) return false;
    sequence += 1;
    update({ originId, entryId, reading: false, acknowledged: false, error: '',
      context: state.context ? { ...state.context, prevision: null, confirmable: false } : null });
    return true;
  }

  function acknowledge(value) {
    if (disposed || state.reading || state.saving || state.uncertain || state.confirmed) return;
    update({ acknowledged: value === true && !continuityPreviewError(state.context, selection()) });
  }

  function confirm() {
    if (savePromise) return savePromise;
    if (disposed || state.confirmed) return Promise.resolve(state.confirmed);
    if (!state.acknowledged) {
      update({ error: 'Confirma que se trata de la entrada real y del mismo sustituto.' });
      return Promise.resolve(null);
    }
    try {
      if (!frozenRequest) {
        frozenRequest = continuityConfirmationPayload(state.context, selection(), requestId());
        frozenPreview = state.context.prevision;
      }
    } catch (error) {
      update({ error: error.message });
      return Promise.resolve(null);
    }
    sequence += 1;
    update({ saving: true, reading: false, error: '' });
    savePromise = Promise.resolve().then(async () => {
      try {
        const result = await client.rpc(CONTINUITY_CONFIRM_RPC, frozenRequest);
        const error = rpcError(result);
        if (error) throw error;
        if (result?.data?.ok === false && result.data.regla === CONTINUITY_RULE) {
          const rejected = new Error(result.data.mensaje || 'El servidor ha rechazado la continuidad. Vuelve a previsualizar.');
          rejected.rejected = true;
          throw rejected;
        }
        const invalid = continuityConfirmationError(result?.data, frozenRequest, frozenPreview);
        if (invalid) throw new Error(invalid);
        update({ confirmed: result.data, uncertain: false, error: '' });
        return result.data;
      } catch (error) {
        if (error.rejected) {
          frozenRequest = frozenPreview = null;
          update({ uncertain: false, acknowledged: false,
            context: state.context ? { ...state.context, prevision: null, confirmable: false } : null,
            error: `${error.message} Vuelve a previsualizar antes de confirmar.` });
        } else {
          update({ uncertain: true, error: `${error.message || 'No ha llegado la respuesta.'} Se conserva la misma petición: reintenta la confirmación para comprobar el resultado.` });
        }
        return null;
      } finally {
        savePromise = null;
        update({ saving: false });
      }
    });
    return savePromise;
  }

  return {
    get state() { return state; },
    load: () => read(false),
    preview: () => read(true),
    select, acknowledge, confirm,
    dispose() { if (state.saving || state.uncertain) return false; disposed = true; sequence += 1; return true; },
  };
}
