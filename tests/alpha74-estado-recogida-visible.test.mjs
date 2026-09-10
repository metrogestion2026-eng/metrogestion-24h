import assert from 'node:assert/strict';
import fs from 'node:fs';

const card = fs.readFileSync(new URL('../r1-alpha74/src/hotel-card.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../r1-alpha74/index.html', import.meta.url), 'utf8');

assert.match(card, /terminado_pendiente_recogida[^\n]+hotel-status-pickup/);
assert.match(html, /\.hotel-card-badges \.hotel-status-pickup\{[^}]*min-height:38px/);
assert.match(html, /\.hotel-card-badges \.hotel-status-pickup\{[^}]*font-size:15px/);
assert.match(html, /@media\(max-width:640px\)[\s\S]*\.hotel-card-badges \.hotel-status-pickup\{[^}]*font-size:16px/);

console.log('Alpha74: Pendiente de recoger destaca como estado operativo principal.');
