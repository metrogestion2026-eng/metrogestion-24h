const DEVICE_TOKEN_KEY = 'metrogestion.clean.device-token.v1';

function bytesToHex(bytes) {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

export function getOrCreateDeviceToken() {
  const existing = localStorage.getItem(DEVICE_TOKEN_KEY);
  if (existing && existing.length >= 64) return existing;

  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const token = bytesToHex(bytes);
  localStorage.setItem(DEVICE_TOKEN_KEY, token);
  return token;
}

export function getDeviceLabel() {
  const platform = navigator.userAgentData?.platform || navigator.platform || 'Dispositivo';
  const mobile = navigator.userAgentData?.mobile ? 'móvil' : 'equipo';
  return `${platform} · ${mobile}`.slice(0, 120);
}
