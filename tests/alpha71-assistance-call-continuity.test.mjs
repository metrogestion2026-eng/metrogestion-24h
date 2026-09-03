import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../r1-alpha71/src/assistance-call-continuity.js', import.meta.url), 'utf8');
const app = await readFile(new URL('../r1-alpha71/src/app.js', import.meta.url), 'utf8');

assert.match(app, /import '\.\/assistance-call-continuity\.js';/, 'Alpha71 debe cargar la protección de la llamada.');
assert.match(source, /sessionStorage\.setItem\(DRAFT_KEY/, 'Los datos deben guardarse antes de abrir el teléfono.');
assert.match(source, /userId: activeUserId/, 'La ficha temporal debe quedar vinculada al usuario autenticado.');
assert.match(source, /draft\.userId !== activeUserId/, 'Otro usuario no puede recuperar la ficha temporal.');
assert.match(source, /onAuthStateChange/, 'La ficha temporal debe eliminarse al cerrar sesión.');
assert.match(source, /link\.target = '_blank'/, 'La llamada no debe sustituir la pantalla de Metrogestión.');
assert.match(source, /event\.stopImmediatePropagation\(\)/, 'Debe bloquearse el manejador heredado que navegaba fuera de la aplicación.');
assert.match(source, /showCallSheet\(draft\);[\s\S]*?openPhoneWithoutReplacingApp\(callPhone\);/, 'La ficha debe quedar preparada antes de iniciar la llamada.');
assert.match(source, /document\.addEventListener\('visibilitychange', restoreCallSheet\)/, 'La ficha debe recuperarse al volver desde Teléfono.');
assert.match(source, /window\.addEventListener\('pageshow', restoreCallSheet\)/, 'La ficha debe recuperarse tras una recarga de la vista.');
assert.match(source, /Finalizar y borrar ficha temporal/, 'El usuario debe poder eliminar los datos temporales.');
assert.doesNotMatch(source, /window\.location\.href\s*=\s*`tel:/, 'Alpha71 no debe reemplazar la aplicación con el esquema tel.');

console.log('Alpha71: continuidad de la llamada 24H verificada.');
