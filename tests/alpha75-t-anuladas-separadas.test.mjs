import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const stages = await readFile('r1-alpha75/src/hotel-editor-stages.js', 'utf8');
const html = await readFile('r1-alpha75/index.html', 'utf8');

test('el editor de Alpha75 oculta las T anuladas por defecto', () => {
  assert.match(stages, /let showingCancelled = false/);
  assert.match(stages, /stage\.cancelado === showingCancelled/);
  assert.match(stages, /Acceder a T anuladas \(\$\{cancelledCount\}\)/);
  assert.match(stages, /No hay T activas en esta ficha/);
});

test('las T anuladas tienen una vista separada y pueden restaurarse', () => {
  assert.match(stages, /← Volver a T activas/);
  assert.match(stages, /Las T anuladas se conservan únicamente como histórico y pueden restaurarse/);
  assert.match(stages, /if \(!checked && showingCancelled\)/);
  assert.match(stages, /showingCancelled = false/);
  assert.match(stages, /detail\.etapas\.push\(restoredStage\)/);
});

test('el guardado conserva el conjunto completo de T y fuerza la caché nueva', () => {
  assert.match(stages, /stagesPayload\(stages\)/);
  assert.match(html, /editor-validation\.css\?v=75\.13/);
  assert.match(html, /hotel-native\.js\?v=75\.13/);
});
