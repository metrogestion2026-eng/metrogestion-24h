import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL('../' + path, import.meta.url), 'utf8');

test('Nueva ficha permite preparar documentos dentro de cada T', async () => {
  const create = await read('r1-alpha75/src/hotel-create.js');
  const stages = await read('r1-alpha75/src/hotel-editor-stages.js');
  const pending = await read('r1-alpha75/src/editor-pending-documents.js');

  assert.match(create, /collectPendingStageDocuments/);
  assert.match(create, /uploadPendingStageDocuments/);
  assert.match(create, /documentsByGroup:\s*new Map\(\)/);
  assert.match(create, /canEditDocuments:\s*true/);
  assert.match(stages, /createPendingStageDocuments\(stage/);
  assert.match(pending, /Los archivos se subirán al guardar la ficha/);
});

test('los archivos se vinculan después de crear la identidad real de la T', async () => {
  const create = await read('r1-alpha75/src/hotel-create.js');
  const pending = await read('r1-alpha75/src/editor-pending-documents.js');

  const createRpc = create.indexOf("supabase.rpc('crear_ficha_hotel_con_etapas_alpha72'");
  const uploadCall = create.indexOf('uploadPendingStageDocuments(', createRpc);
  assert.ok(createRpc >= 0, 'falta la creación atómica de ficha y T');
  assert.ok(uploadCall > createRpc, 'los documentos no pueden subirse antes de existir la T');
  assert.match(create, /data\.detalle/);
  assert.match(pending, /registrar_documento_t/);
  assert.match(pending, /p_etapa_id:\s*stage\.id/);
});

test('un fallo documental no vuelve a crear la ficha', async () => {
  const create = await read('r1-alpha75/src/hotel-create.js');

  assert.match(create, /pendingDocumentRetry/);
  assert.match(create, /Reintentando únicamente los documentos pendientes/);
  assert.match(create, /no se vuelven a crear/);
  assert.match(create, /No pulses “Crear ficha” otra vez/);

  const retryBlock = create.slice(
    create.indexOf('if (pendingDocumentRetry)'),
    create.indexOf('const errors = validate(detail)')
  );
  assert.doesNotMatch(retryBlock, /crear_ficha_hotel_con_etapas_alpha72/);
  assert.match(retryBlock, /uploadPendingStageDocuments/);
});
