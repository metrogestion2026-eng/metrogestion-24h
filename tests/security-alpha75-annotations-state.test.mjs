// Integridad del borrador y de los reintentos. No verifica permisos del servidor.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../r1-alpha75/src/annotations.js', import.meta.url), 'utf8');
const moduleSource = source.replace("import { element } from '../../r1-alpha17/src/dom.js';", '');
const { manualAnnotationsPayload: payload } = await import(`data:text/javascript;base64,${Buffer.from(moduleSource).toString('base64')}`);
const note = (texto = 'Nota de prueba') => ({ id: 'TEST-NOTE', texto, version: 3, eliminar: false });

test('serializar conserva el array y los objetos del borrador', () => {
  const original = note(); const notes = [original]; const d = { anotaciones_manuales: notes };
  assert.deepEqual(payload(d), [original]);
  assert.strictEqual(d.anotaciones_manuales, notes);
  assert.strictEqual(d.anotaciones_manuales[0], original);
});
test('un reintento recoge una corrección posterior a un envío vacío', () => {
  const bound = note(''); const d = { anotaciones_manuales: [bound] };
  assert.equal(payload(d)[0].texto, '');
  bound.texto = 'Corrección posterior al error';
  assert.equal(payload(d)[0].texto, bound.texto);
  bound.texto = 'Segundo reintento';
  assert.equal(payload(d)[0].texto, 'Segundo reintento');
});
test('una nota existente vacía no desaparece ni se anula implícitamente', () => {
  const result = payload({ anotaciones_manuales: [note('  ')] });
  assert.equal(result.length, 1); assert.equal(result[0].id, 'TEST-NOTE');
  assert.equal(result[0].texto, ''); assert.equal(result[0].eliminar, false);
});
test('quitar y deshacer conservan identidad y versión tras serializar', () => {
  const bound = note(); const d = { anotaciones_manuales: [bound] };
  payload(d); bound.eliminar = true; assert.equal(payload(d)[0].eliminar, true);
  bound.eliminar = false; const result = payload(d)[0];
  assert.deepEqual(result, bound);
});
test('añadir y retirar una nota nueva sigue usando el mismo borrador', () => {
  const notes = [note()]; const d = { anotaciones_manuales: notes }; payload(d);
  notes.push({ texto: '' }); assert.equal(payload(d).length, 1);
  notes[1].texto = 'Nueva nota'; assert.equal(payload(d).length, 2);
  notes.pop(); assert.equal(payload(d).length, 1);
});
test('serializar recorta el envío sin alterar ni siquiera un borrador congelado', () => {
  const n = Object.freeze(note('  Texto con márgenes  '));
  const d = Object.freeze({ anotaciones_manuales: Object.freeze([n]) });
  assert.equal(payload(d)[0].texto, 'Texto con márgenes');
  assert.equal(n.texto, '  Texto con márgenes  ');
});
test('un payload es una instantánea independiente de posteriores cambios', () => {
  const n = note(); const d = { anotaciones_manuales: [n] }; const first = payload(d);
  n.texto = 'Cambio posterior'; assert.equal(first[0].texto, 'Nota de prueba');
  assert.equal(payload(d)[0].texto, 'Cambio posterior');
});
test('sin anotaciones no se crean propiedades ni escrituras', () => {
  const empty = {}; assert.deepEqual(payload(empty), []); assert.deepEqual(empty, {});
  assert.deepEqual(payload(undefined), []);
});
test('no trunca silenciosamente textos por encima del límite', () => {
  const value = 'x'.repeat(4001);
  assert.equal(payload({ anotaciones_manuales: [note(value)] })[0].texto.length, 4001);
});
test('carga explícita de textarea y límite conservado en el componente', () => {
  assert.match(source, /textarea\.value = originalText;/);
  assert.match(source, /textarea\.value = note\.texto;/);
  assert.doesNotMatch(source, /value: (?:originalText|note\.texto),/);
  assert.equal((source.match(/maxLength: 4000/g) || []).length, 3);
});
