globalThis.__METROGESTION_MODULE_OWNERS__ = Object.freeze({
  ...(globalThis.__METROGESTION_MODULE_OWNERS__ || {}),
  listados: 'alpha75',
});

const legacyFiles = [
  '../../r1-alpha29/src/app.js',
  '../../r1-alpha30/src/app.js',
  '../../r1-alpha31/src/app.js',
  '../../r1-alpha50/src/app.js',
];

await Promise.all(legacyFiles.map(async path => {
  try {
    const url = new URL(path, import.meta.url);
    await fetch(url, { cache: 'reload', credentials: 'same-origin' });
  } catch {
    // La carga normal de módulos decidirá el estado final si falla el precalentado.
  }
}));

await import('./app.js?v=75.25');
await import('./h73-register-device.js?v=73.3');
await import('./hotel-native.js?v=75.25');
await import('./history-native.js?v=75.25');
await import('./panel-native-hf23.js?v=75.25');
