import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const code = readFileSync(
  new URL('../r1-alpha75/google-apps-script/sincro14_preflight_solo_lectura.gs', import.meta.url),
  'utf8');

test('S14 preflight es JavaScript válido y no ejecuta nada al cargar el archivo', () => {
  const script = new vm.Script(code);
  let sideEffects = 0;
  const context = vm.createContext({SpreadsheetApp:new Proxy({}, {
    get() {sideEffects++; throw Error('no ejecutar Google al cargar');}
  })});
  script.runInContext(context);
  assert.equal(typeof context.metroSincro14PreflightSoloLectura, 'function');
  assert.equal(sideEffects, 0);
});

test('S14 diagnóstico no contiene mutadores de hoja, activadores o red', () => {
  assert.doesNotMatch(code, /\b(?:UrlFetchApp|fetch\s*\(|DriveApp|\.setValues?\s*\(|\.setNotes?\s*\(|\.clear(?:Content)?\s*\(|\.appendRow\s*\(|\.insertRows?\w*\s*\(|\.deleteRows?\w*\s*\(|\.newTrigger\s*\(|\.deleteTrigger\s*\(|\.setProperty\s*\(|\.batchUpdate\s*\()/);
  assert.match(code, /modo:\s*'SOLO_LECTURA_SIN_SINCRO'/);
  assert.match(code, /sincronizacionAutorizada:\s*false/);
  assert.match(code, /escrituraMantenimentAutorizada:\s*false/);
});

test('S14 preflight prueba unicidad, ausencias, registro y cuenta creadora', () => {
  for (const token of [
    'registroDuplicado','registroInvalido','ausentes','sinId','repetidos',
    'ultimoIdEmitido','Session.getEffectiveUser','getProjectTriggers',
    'getProtections','metrogestionAuditarIdentidadFilas_','metrogestionVigilarIdentidadSoloLectura'
  ]) assert.ok(code.includes(token), 'Falta '+token);
  assert.match(code,/own\.every\(t => t\.cantidad === 1\)/);
});

test('S14 preflight no incluye marcas de éxito sin los activadores', () => {
  assert.match(code,/preflightCorrecto: limpio && protectedT\.some/);
  assert.match(code,/typeof metrogestionAuditarIdentidadFilas_ === 'function'/);
  assert.match(code,/typeof metrogestionVigilarIdentidadSoloLectura === 'function'/);
});
