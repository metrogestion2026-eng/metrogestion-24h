import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const reopen = await readFile('r1-alpha74/src/stage-reopen.js', 'utf8');

assert.match(reopen, /el\('details', null, 'a74-reopen-disclosure'\)/);
assert.match(reopen, /el\('summary', '↶ Deshacer realizada', 'button secondary compact a74-reopen-toggle'\)/);
assert.match(reopen, /disclosure\.append\(toggle, panel\)/);
assert.doesNotMatch(reopen, /Reabrir T \(deshacer realizada\)/);
assert.match(reopen, /\.a74-reopen-panel\{[^}]*border:1px solid #cbd5e1[^}]*background:#f8fafc/);
assert.match(reopen, /a74-reopen-armed[^}]*background:#dc2626/);

console.log('Alpha74: la reapertura permanece compacta hasta que el usuario la despliega.');
