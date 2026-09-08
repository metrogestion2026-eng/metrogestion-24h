import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const panel = await readFile('r1-alpha74/src/panel-native.js', 'utf8');

assert.match(panel, /if \(!automatic\) content\.replaceChildren\(\)/);
assert.match(panel, /Actualizando en segundo plano…/);
assert.match(panel, /if \(automatic\) \{[\s\S]*?content\.replaceChildren\(root\);[\s\S]*?\}\s+startAutoRefresh\(\);/);
assert.match(panel, /const detailOpen = content\.querySelector\('\.a52-detail:not\(\[hidden\]\)'\)/);
assert.match(panel, /!document\.querySelector\('\.hotel-editor-overlay'\) && !detailOpen/);
assert.match(panel, /panelOwnsContent\(\) && !detailOpen && Date\.now\(\) - lastLoadedAt > REFRESH_MS/);
assert.match(panel, /No se pudo actualizar · se conserva el Panel/);

console.log('Alpha74: el Panel permanece visible durante el refresco automático.');
