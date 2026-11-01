const NATIVE_OWNERS = new Set(['alpha75', 'alpha76']);

export function claimHotelModule(owner) {
  if (!NATIVE_OWNERS.has(owner)) throw new Error('Propietario de Hotel desconocido.');
  globalThis.__METROGESTION_MODULE_OWNERS__ = Object.freeze({
    ...(globalThis.__METROGESTION_MODULE_OWNERS__ || {}),
    hotel: owner,
  });
}

export function hotelHasNativeOwner() {
  return NATIVE_OWNERS.has(globalThis.__METROGESTION_MODULE_OWNERS__?.hotel);
}

export function hotelModuleBelongsTo(owner) {
  const assigned = globalThis.__METROGESTION_MODULE_OWNERS__?.hotel;
  return !assigned || assigned === owner;
}

// The legacy application is imported through stable URLs in the historical
// graph. Consume its refreshed body before evaluating that graph; awaiting
// fetch alone can leave the previous response in the HTTP cache.
export async function refreshHotelRouter(url, fetcher = globalThis.fetch) {
  const response = await fetcher(url, { cache: 'reload', credentials: 'same-origin' });
  if (!response.ok) throw new Error('No se pudo cargar la actualización de Hotel. Recarga la página.');
  const source = await response.text();
  if (!source.includes('HOTEL_ROUTE_OWNER_V1')) {
    throw new Error('La actualización de Hotel aún no está disponible. Recarga la página.');
  }
}
