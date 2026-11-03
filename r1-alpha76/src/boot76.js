import { claimHotelModule, refreshHotelRouter } from '../../shared/hotel-module-owner.js?v=hotel-identidad-001';

claimHotelModule('alpha76');
try {
  await refreshHotelRouter(new URL('../../r1-alpha26/src/app.js', import.meta.url));
} catch (error) {
  const message = document.querySelector('#login-message');
  if (message) message.textContent = error.message;
  throw error;
}

await import('./app.js?v=76.10-hf3');
await import('./hotel-native.js?v=76.10-doc-resumen-001');
await import('./history-native.js?v=76.10');
await import('./panel-native.js?v=76.10-panel-t-actual-001');
await import('./read-only-mode.js?v=76.2');
