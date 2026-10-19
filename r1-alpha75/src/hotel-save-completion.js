// Un refresco de la vista no es otra escritura ni parte de la confirmación SQL.
// Programar el cierre ANTES de esperar al listado evita retener el editor.
export async function refreshConfirmedHotelSave({ refresh, close, schedule, onRefreshError }) {
  if (close) schedule(close, 350);
  try {
    await refresh?.();
    return true;
  } catch (error) {
    onRefreshError?.(error);
    return false;
  }
}
