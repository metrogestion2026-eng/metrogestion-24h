export class BodyError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

export async function readJsonObject(request: Request, maximum: number): Promise<Record<string, unknown>> {
  if (!(request.headers.get('content-type') || '').toLowerCase().includes('application/json')) {
    throw new BodyError(415, 'Se requiere contenido JSON.');
  }
  const declared = Number(request.headers.get('content-length') || 0);
  if (Number.isFinite(declared) && declared > maximum) throw new BodyError(413, 'Petición demasiado grande.');
  const reader = request.body?.getReader();
  if (!reader) throw new BodyError(400, 'JSON no válido.');
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maximum) {
        await reader.cancel();
        throw new BodyError(413, 'Petición demasiado grande.');
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let body: unknown;
  try { body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw new BodyError(400, 'JSON no válido.'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new BodyError(400, 'Se requiere un objeto JSON.');
  return body as Record<string, unknown>;
}

export function validPassword(value: string) {
  return value.length >= 8 && new TextEncoder().encode(value).byteLength <= 72
    && /[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/.test(value) && /\d/.test(value);
}
