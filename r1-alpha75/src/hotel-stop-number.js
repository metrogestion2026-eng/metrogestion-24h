import { supabase } from '../../r1-alpha17/src/supabase.js';

const HEARTBEAT_INTERVAL_MS = 5 * 60 * 1000;

function reservationError(error, fallback) {
  return new Error(error?.message || fallback);
}

export async function reserveTemporaryStopNumber(requestId) {
  const { data, error } = await supabase.rpc(
    'reservar_numero_parada_nueva_ficha_alpha75',
    { p_request_id: requestId }
  );
  if (error || !data?.ok || !data?.token || !data?.numero_parada) {
    throw reservationError(error, 'No se pudo reservar un número de parada para la nueva ficha.');
  }
  return {
    token: data.token,
    number: String(data.numero_parada),
    expiresAt: data.expira_en || '',
  };
}

export async function renewTemporaryStopNumber(token) {
  const { data, error } = await supabase.rpc(
    'renovar_numero_parada_nueva_ficha_alpha75',
    { p_token: token }
  );
  if (error || !data?.ok) {
    throw reservationError(error, 'No se pudo renovar el número provisional de parada.');
  }
  return {
    token: data.token || token,
    number: String(data.numero_parada || ''),
    expiresAt: data.expira_en || '',
  };
}

export async function releaseTemporaryStopNumber(token) {
  if (!token) return { ok: true, released: false };
  const { data, error } = await supabase.rpc(
    'liberar_numero_parada_nueva_ficha_alpha75',
    { p_token: token }
  );
  if (error || !data?.ok) {
    throw reservationError(error, 'No se pudo liberar el número provisional de parada.');
  }
  return {
    ok: true,
    released: data.liberado === true,
    number: data.numero_parada ? String(data.numero_parada) : '',
  };
}

export function keepTemporaryStopNumberAlive(lease, { onWarning } = {}) {
  let stopped = false;
  let renewing = false;

  const renew = async () => {
    if (stopped || renewing || !lease?.token) return;
    renewing = true;
    try {
      const next = await renewTemporaryStopNumber(lease.token);
      if (next.number) lease.number = next.number;
      lease.expiresAt = next.expiresAt;
    } catch (error) {
      onWarning?.(error);
    } finally {
      renewing = false;
    }
  };

  const interval = setInterval(() => { void renew(); }, HEARTBEAT_INTERVAL_MS);
  const onVisibility = () => {
    if (document.visibilityState === 'visible') void renew();
  };
  document.addEventListener('visibilitychange', onVisibility);

  return {
    renew,
    stop() {
      if (stopped) return;
      stopped = true;
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibility);
    },
  };
}
