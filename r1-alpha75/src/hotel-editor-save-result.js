function isDefinitiveRejection(result) {
  const code = result?.error?.code;
  if (result?.status === 0 || result?.data != null || typeof code !== 'string') return false;
  // Connection failures and an explicitly unknown transaction outcome do not
  // establish that the database rolled back, even if a code is present.
  if (code.startsWith('08') || code === '40003' || code === '00000') return false;
  return /^(?:[0-9A-Z]{5}|PGRST[0-9]{3})$/.test(code);
}

/** PostgREST normally resolves transport errors as {data:null,error,status:0}.
 * Only a matching receipt confirms a write; an unidentified outcome requires
 * reopening the record before any new request is allowed.
 */
export function classifyHotelEditorSave(result, { requestId, version, identity }) {
  if (isDefinitiveRejection(result)) return { state: 'rejected', error: result.error };
  if (!result || result.error != null || result.status === 0) return { state: 'uncertain' };
  const saved = result.data;
  const ficha = saved?.detalle?.ficha;
  if (saved?.ok !== true || saved.request_id !== requestId || saved.identidad_validada !== true
      || !Number.isSafeInteger(saved.version) || saved.version < version
      || ficha?.id !== identity.registro_id
      || ficha.seguimiento_id !== identity.seguimiento_id || ficha.pizarra_id !== identity.pizarra_id
      || ficha.version !== saved.version || !Array.isArray(saved.detalle.etapas)) {
    return { state: 'uncertain' };
  }
  return { state: 'confirmed', saved };
}
