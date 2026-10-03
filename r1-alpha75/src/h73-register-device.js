import { getDeviceLabel } from '../../r1-alpha17/src/device.js';
import { deviceToken, supabase } from '../../r1-alpha17/src/supabase.js';

const enabled = new URLSearchParams(window.location.search).get('h73') === '1';

async function registerAdminDeviceForH73() {
  if (!enabled) return;

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
