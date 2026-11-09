import { claimHotelModule, refreshHotelRouter } from '../../shared/hotel-module-owner.js?v=hotel-identidad-001';

claimHotelModule('alpha75');
globalThis.__METROGESTION_MODULE_OWNERS__ = Object.freeze({
  ...(globalThis.__METROGESTION_MODULE_OWNERS__ || {}),
  listados: 'alpha75',
});

try {
  await refreshHotelRouter(new URL('../../r1-alpha26/src/app.js', import.meta.url));
} catch (error) {
  const message = document.querySelector('#login-message');
  if (message) message.textContent = error.message;
  throw error;
}

const preloadFiles = [
  './hotel-editor-stages.js?v=75.26-autocomplete-001',
  './hotel-create.js?v=75.26-create-documents-001',
  '../../r1-alpha29/src/app.js',
  '../../r1-alpha30/src/app.js',
  '../../r1-alpha31/src/app.js',
  '../../r1-alpha34/src/app.js',
  '../../r1-alpha50/src/app.js',
];

await Promise.all(preloadFiles.map(async path => {
  try {
    const url = new URL(path, import.meta.url);
    const response = await fetch(url, { cache: 'reload', credentials: 'same-origin' });
    await response.text();
  } catch {
    // La carga normal de módulos decidirá el estado final si falla el precalentado.
  }
}));

await import('./app.js?v=75.26');
await import('./h73-register-device.js?v=73.3');
await import('./hotel-native.js?v=75.26-autocomplete-001');
await import('./history-native.js?v=75.26-autocomplete-001');
await import('./panel-native-hf23.js?v=75.25-panel-t-actual-001');
