import { getDeviceLabel } from './device.js';
import { deviceToken, supabase } from './supabase.js';

function normalizeDeviceResult(data) {
  const row = Array.isArray(data) ? data[0] : data;
  return row || { estado: 'desconocido', permitido: false, es_administrador_principal: false };
}

export async function getSecurityContext(session) {
  if (!session?.user?.id) {
    return { allowed: false, reason: 'sin_sesion', profile: null, device: null };
  }

  const { data: profile, error: profileError } = await supabase
    .from('usuarios')
    .select('id,nombre,apellidos,correo,telefono,tipo_usuario,permisos,activo')
    .eq('id', session.user.id)
    .single();

  if (profileError || !profile) {
    throw new Error('No se pudo comprobar el perfil autorizado.');
  }

  if (profile.activo !== true) {
    return { allowed: false, reason: 'usuario_bloqueado', profile, device: null };
  }

  const { data: deviceData, error: deviceError } = await supabase.rpc('comprobar_dispositivo', {
    token_recibido: deviceToken
  });

  if (deviceError) {
    throw new Error('No se pudo comprobar la autorización del dispositivo.');
  }

  let device = normalizeDeviceResult(deviceData);

  if (!device.permitido && device.estado === 'no_registrado') {
    const { data: requestData, error: requestError } = await supabase.rpc('solicitar_dispositivo', {
      token_recibido: deviceToken,
      nombre_recibido: getDeviceLabel(),
      agente_recibido: navigator.userAgent
    });

    if (requestError) {
      throw new Error('No se pudo registrar la solicitud de este dispositivo.');
    }

    const requested = Array.isArray(requestData) ? requestData[0] : requestData;
    device = {
      dispositivo_id: requested?.dispositivo_id || null,
      estado: requested?.estado || 'pendiente',
      permitido: requested?.permitido === true,
      es_administrador_principal: profile.tipo_usuario === 'administrador_principal'
    };
  }

  return {
    allowed: device.permitido === true,
    reason: device.permitido ? 'autorizado' : device.estado,
    profile,
    device
  };
}

export function getModuleAccess(profile, moduleId) {
  if (!profile?.activo) return { view: false, edit: false };
  if (profile.tipo_usuario === 'administrador_principal') return { view: true, edit: true };

  const permission = profile.permisos?.[moduleId] || {};
  const edit = permission.editar === true;
  const view = edit || permission.ver === true || permission.leer === true;
  return { view, edit };
}
