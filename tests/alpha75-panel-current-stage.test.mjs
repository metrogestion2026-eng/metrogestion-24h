import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL('../' + path, import.meta.url), 'utf8');

for (const path of ['r1-alpha75/src/panel-native-hf23.js', 'r1-alpha76/src/panel-native.js']) {
  test(path + ' prioriza la T operativa vigente', async () => {
    const src = await read(path);
    assert.match(src, /function currentOperationalStages/);
    assert.match(src, /state === 'en_curso' \? 0/);
    assert.match(src, /T actual:/);
    assert.match(src, /hotelItem\(row, latestCompletedByHotel, currentOperationalByHotel\)/);
  });
}
