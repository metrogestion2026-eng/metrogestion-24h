import assert from 'node:assert/strict';
import fs from 'node:fs';

const card = fs.readFileSync(new URL('../r1-alpha74/src/hotel-card.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../r1-alpha74/index.html', import.meta.url), 'utf8');

assert.match(card, /className: 'badge hotel-status-badge'/);
assert.doesNotMatch(card, /hotel-status-pickup/);
assert.match(html, /\.hotel-card-badges \.hotel-status-badge\{[^}]*min-height:38px/);
assert.match(html, /\.hotel-card-badges \.hotel-status-badge\{[^}]*font-size:15px/);
assert.match(html, /@media\(max-width:640px\)[\s\S]*\.hotel-card-badges \.hotel-status-badge\{[^}]*font-size:16px/);

console.log('Alpha74: todos los estados superiores destacan como estado operativo principal.');
