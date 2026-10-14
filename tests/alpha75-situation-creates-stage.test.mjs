import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const main = fs.readFileSync(new URL('../r1-alpha75/src/hotel-editor-main.js', import.meta.url), 'utf8');
const stages = fs.readFileSync(new URL('../r1-alpha75/src/hotel-editor-stages.js', import.meta.url), 'utf8');

test('Gestión y Trámite crean una T automática sin duplicar una existente', () => {
  assert.match(main, /ensureSituationStage/);
  assert.match(main, /wantedType = normalized === 'gestion' \? 'GESTIÓN' : 'TRÁMITE'/);
  assert.match(main, /detail\.onStagesChanged\?\.\(stage\)/);
});

test('la T automática se despliega al crearse', () => {
  assert.match(stages, /detail\.onStagesChanged = \(\) =>/);
  assert.match(stages, /disclosure\.setExpanded\(true\)/);
});
