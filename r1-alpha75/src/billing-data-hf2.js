// 75.23-hf2: bounded, identity-scoped reads. The server still enforces RLS.
// Only concurrent requests are shared; completed financial data is not cached.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STOP_FIELDS = 'seguimiento_id,numero_parada,unidad,matricula,sustituto,matricula_sustituto,tipo_sustituto,fecha_inicio_parada,fecha_fin_parada,dias_parada_total,clase_facturacion,km_dia_automatico,km_dia_manual,km_dia,km_dia_fuente,ajuste_observaciones,km_sustitucion_total';

export function createBillingReader(client, { concurrency = 3 } = {}) {
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 4) {
    throw new TypeError('La concurrencia debe estar entre 1 y 4.');
  }
  const pending = new Map();
  const queue = [];
  let active = 0;
  let generation = 0;

  function cancelled() {
    return new Error('La consulta ha quedado desactualizada. Vuelve a abrir la ficha.');
  }

  async function fetchData(task) {
    const signal = task.controller.signal;
    const [stopResult, periodsResult, priceResult] = await Promise.all([
      client.from('paradas_sustitucion_resumen').select(STOP_FIELDS)
        .eq('seguimiento_id', task.id).abortSignal(signal).maybeSingle(),
      client.from('cierres_facturacion').select('periodo,fecha_inicio,fecha_cierre')
        .order('fecha_inicio', { ascending: true }).abortSignal(signal),
      client.from('config_facturacion_sustituciones').select('precio_r_unidad')
        .eq('id', 1).abortSignal(signal).maybeSingle(),
    ]);
    if (signal.aborted || task.generation !== generation) throw cancelled();
    if (stopResult.error) throw new Error(`No se pudieron calcular los días de sustitución: ${stopResult.error.message}`);
    if (periodsResult.error) throw new Error(`No se pudo identificar el periodo de facturación: ${periodsResult.error.message}`);
    if (priceResult.error) throw new Error(`No se pudo leer el precio de sustitución R: ${priceResult.error.message}`);
    const stop = stopResult.data;
    // A zero-row RLS response is not a zero-day stop. Never fall back to all rows.
    if (!stop || String(stop.seguimiento_id).toLowerCase() !== task.id) {
      throw new Error('No hay un cálculo accesible para esta parada. Actualiza la ficha o revisa tus permisos.');
    }
    return { stop, periods: periodsResult.data || [], rPrice: priceResult.data?.precio_r_unidad ?? null };
  }

  function pump() {
    while (active < concurrency && queue.length) {
      const task = queue.shift();
      if (task.controller.signal.aborted || task.generation !== generation) {
        task.reject(cancelled());
        if (pending.get(task.id) === task) pending.delete(task.id);
        continue;
      }
      active += 1;
      const finish = (error, data) => {
        active -= 1;
        if (pending.get(task.id) === task) pending.delete(task.id);
        if (error) task.reject(error);
        else task.resolve(data);
        pump();
      };
      void fetchData(task).then(data => finish(null, data), error => finish(error));
    }
  }

  function read(trackingId) {
    const id = String(trackingId || '').trim().toLowerCase();
    if (!UUID.test(id)) {
      return Promise.reject(new Error('Falta una identidad válida de parada. Vuelve a abrir la ficha; no se ha solicitado el listado completo.'));
    }
    const existing = pending.get(id);
    if (existing) return existing.promise;
    const task = { id, generation, controller: new AbortController() };
    task.promise = new Promise((resolve, reject) => { task.resolve = resolve; task.reject = reject; });
    pending.set(id, task);
    queue.push(task);
    pump();
    return task.promise;
  }

  function invalidate(trackingId) {
    const id = String(trackingId || '').trim().toLowerCase();
    const task = pending.get(id);
    if (task) {
      task.controller.abort();
      task.reject(cancelled());
      pending.delete(id);
    }
  }

  function reset() {
    generation += 1;
    for (const task of pending.values()) {
      task.controller.abort();
      task.reject(cancelled());
    }
    pending.clear();
    queue.length = 0;
  }

  return { read, invalidate, reset, get generation() { return generation; } };
}
