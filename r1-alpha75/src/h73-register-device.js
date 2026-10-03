import { getDeviceLabel } from '../../r1-alpha17/src/device.js';
import { deviceToken, supabase } from '../../r1-alpha17/src/supabase.js';

const enabled = new URLSearchParams(window.location.search).get('h73') === '1';

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

async function showDeviceHash() {
  if (!enabled || !deviceToken) return;
  const hash = await sha256Hex(deviceToken);
  let box = document.querySelector('[data-h77-device-hash]');
  if (!box) {
    box = document.createElement('section');
    box.dataset.h77DeviceHash = '1';
    box.style.cssText = 'max-width:760px;margin:12px auto;padding:12px 14px;border:1px solid #cbd5e1;border-radius:12px;background:#fff;font-size:14px;word-break:break-all';
    document.querySelector('.page-shell')?.prepend(box);
  }
  box.textContent = `H77 · Hash de este dispositivo: ${hash}`;
}

async function registerAdminDeviceForH73() {
  if (!enabled) return;

  await showDeviceHash();

  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  const session = sessionData?.session;
  if (sessionError || !session?.user?.id) return;

  const { data: profile, error: profileError } = await supabase
    .from('usuarios')
    .select('id,tipo_usuario,activo')
    .eq('id', session.user.id)
    .single();

  if (profileError || !profile || profile.activo !== true || profile.tipo_usuario !== 'administrador_principal') {
    return;
  }

  const { data: deviceData, error: deviceError } = await supabase.rpc('comprobar_dispositivo', {
    token_recibido: deviceToken
  });
  if (deviceError) return;

  const row = Array.isArray(deviceData) ? deviceData[0] : deviceData;
  if (row?.dispositivo_id) return;

  await supabase.rpc('solicitar_dispositivo', {
    token_recibido: deviceToken,
    nombre_recibido: getDeviceLabel(),
    agente_recibido: navigator.userAgent
  });
}

void registerAdminDeviceForH73();
