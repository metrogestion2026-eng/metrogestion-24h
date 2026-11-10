import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL('../' + path, import.meta.url), 'utf8');

test('Nueva ficha muestra un número reservado antes de editar', async () => {
  const create = await read('r1-alpha75/src/hotel-create.js');
  const lease = await read('r1-alpha75/src/hotel-stop-number.js');

  assert.match(create, /const creationRequestId = requestId\(\)/);
  assert.match(create, /reserveTemporaryStopNumber\(creationRequestId\)/);
  assert.match(create, /detail\.ficha\.numero_parada = lease\.number/);
  assert.match(create, /stopNumberInput\.readOnly = true/);
  assert.match(create, /data-hotel-stop-number/);
  assert.match(create, /Añadir ficha · actuación/);

  assert.match(lease, /reservar_numero_parada_nueva_ficha_alpha75/);
  assert.match(lease, /renovar_numero_parada_nueva_ficha_alpha75/);
  assert.match(lease, /liberar_numero_parada_nueva_ficha_alpha75/);
});

test('guardar confirma exactamente el número visible y cancelar lo libera', async () => {
  const create = await read('r1-alpha75/src/hotel-create.js');

  assert.match(create, /crear_ficha_hotel_con_etapas_alpha75/);
  assert.match(create, /p_request_id:\s*creationRequestId/);
  assert.match(create, /p_numero_token:\s*currentLease\.token/);
  assert.match(create, /releaseTemporaryStopNumber\(stopNumberLease\.token\)/);
  assert.match(create, /reutilizar este número de parada/);
  assert.match(create, /created = true;[\s\S]*stopNumberLease = null;/);

  const saveAt = create.indexOf("supabase.rpc('crear_ficha_hotel_con_etapas_alpha75'");
  const confirmedAt = create.indexOf('created = true;', saveAt);
  assert.ok(saveAt >= 0 && confirmedAt > saveAt,
    'la reserva solo se considera consumida después de la confirmación del servidor');
});

test('la reserva tiene renovación y una salida segura ante respuesta incierta', async () => {
  const create = await read('r1-alpha75/src/hotel-create.js');
  const lease = await read('r1-alpha75/src/hotel-stop-number.js');

  assert.match(lease, /HEARTBEAT_INTERVAL_MS = 5 \* 60 \* 1000/);
  assert.match(lease, /visibilitychange/);
  assert.match(create, /ensureCurrentLease/);
  assert.match(create, /resultUnknown = true/);
  assert.match(create, /No pulses “Crear ficha” otra vez/);
  assert.match(create, /no se liberará el número de forma insegura/);
  assert.match(create, /if \(!stopNumberLease \|\| created \|\| resultUnknown\) return true/);
});

test('la revisión stop-number rompe la caché del alta sin duplicar propietarios', async () => {
  assert.equal((await read('r1-alpha75/VERSION')).trim(), 'r1.0.0-alpha.75.26');
  assert.match(await read('r1-alpha75/src/app.js'), /r1\.0\.0-alpha\.75\.26/);
  assert.match(await read('r1-alpha75/src/version-refresh.js'), /r1\.0\.0-alpha\.75\.26/);
  assert.match(await read('r1-alpha75/index.html'), /boot75\.js\?v=75\.26-movimiento-taller-001/);
  const boot = await read('r1-alpha75/src/boot75.js');
  assert.match(boot, /hotel-create\.js\?v=75\.26-create-documents-001/);
  assert.match(boot, /import\('\.\/app\.js\?v=75\.26'\)/);
});
