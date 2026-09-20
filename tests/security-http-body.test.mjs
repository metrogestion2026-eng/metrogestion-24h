import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
const source = await readFile(new URL('../supabase/functions/_shared/http-security.ts', import.meta.url), 'utf8');
const { readJsonObject, validPassword } = await import('data:text/javascript;base64,' + Buffer.from(stripTypeScriptTypes(source)).toString('base64'));
function request(body, headers = {}) {
  return new Request('https://example.invalid', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body });
}
test('accepts an object at the exact byte limit', async () => {
  assert.deepEqual(await readJsonObject(request('{"a":1}'), 7), { a: 1 });
});
test('rejects oversized actual bytes despite a false content length', async () => {
  await assert.rejects(readJsonObject(request('{"a":123}', { 'content-length': '1' }), 7), { status: 413 });
});
test('counts UTF-8 bytes, not characters', async () => {
  await assert.rejects(readJsonObject(request('{"a":"é"}'), 9), { status: 413 });
});
test('rejects oversized declared length before consuming body', async () => {
  await assert.rejects(readJsonObject(request('{}', { 'content-length': '100' }), 10), { status: 413 });
});
for (const value of ['null', '[]', '"string"', '1', '{bad']) {
  test(`rejects nonobject or malformed JSON: ${value}`, async () => {
    await assert.rejects(readJsonObject(request(value), 30), { status: 400 });
  });
}
test('requires JSON content type', async () => {
  await assert.rejects(readJsonObject(request('{}', { 'content-type': 'text/plain' }), 10), { status: 415 });
});
test('rejects invalid UTF-8', async () => {
  await assert.rejects(readJsonObject(request(new Uint8Array([0xff])), 10), { status: 400 });
});
test('password policy rejects short, numeric-only and oversized UTF-8 values', () => {
  assert.equal(validPassword('Short1'), false);
  assert.equal(validPassword('12345678'), false);
  assert.equal(validPassword('LettersOnly'), false);
  assert.equal(validPassword('é'.repeat(36) + '1'), false);
  assert.equal(validPassword('Example123'), true);
});
