import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const createSource = await readFile(new URL('../r1-alpha71/src/hotel-create.js', import.meta.url), 'utf8');
const editorSource = await readFile(new URL('../r1-alpha71/src/hotel-editor.js', import.meta.url), 'utf8');
const stagesSource = await readFile(new URL('../r1-alpha71/src/hotel-editor-stages.js', import.meta.url), 'utf8');
const migration = await readFile(
  new URL('../supabase/migrations/20260903095728_alpha71_crear_ficha_con_etapas.sql', import.meta.url),
  'utf8',
);
const stopNumberFixMigration = await readFile(
  new URL('../supabase/migrations/20260904140255_alpha71_preservar_numero_parada_al_crear_con_t.sql', import.meta.url),
  'utf8',
);

assert.match(
  createSource,
  /renderStagesSection\(detail, markDirty\)/,
  'Crear ficha debe mostrar el editor completo de T y trabajos.',
);
assert.match(
  createSource,
  /catalogo_estados_etapa_hotel[\s\S]*?catalogo_tipos_etapa_hotel[\s\S]*?catalogo_tipos_trabajo[\s\S]*?talleres[\s\S]*?centros_taller/,
  'Crear ficha debe cargar los mismos catálogos que la edición completa.',
);
assert.match(
  createSource,
  /rpc\('crear_ficha_hotel_con_etapas_alpha71'[\s\S]*?p_etapas: stagesPayloadWithCatalogues\(detail\.etapas\)/,
  'La ficha y sus T deben enviarse juntas al guardado transaccional.',
);
assert.doesNotMatch(
  createSource,
  /Las T se pueden añadir después/,
  'La pantalla de alta no debe indicar que las T solo se añaden después.',
);
assert.match(
  stagesSource,
  /export function stagesPayloadWithCatalogues\(stages\)/,
  'Alta y edición deben compartir la normalización de catálogos de las T.',
);
assert.match(
  editorSource,
  /import \{ renderStagesSection, stagesPayloadWithCatalogues \}/,
  'La edición completa debe conservar el mismo payload compartido.',
);

assert.match(
  migration,
  /create or replace function app_private\.crear_ficha_hotel_con_etapas_alpha71\(/,
  'Debe existir una operación privada y transaccional para ficha y T.',
);
assert.match(
  migration,
  /v_created := app_private\.crear_ficha_hotel_alpha71[\s\S]*?v_saved := app_private\.guardar_ficha_hotel_edicion_alpha71/,
  'La creación debe guardar primero la ficha y después sus T dentro de la misma función.',
);
assert.match(
  migration,
  /auth\.uid\(\) is null[\s\S]*?dispositivo_autorizado\(\)[\s\S]*?puede_editar_modulo\('hotel'\)/,
  'La operación debe validar usuario, dispositivo y permiso de edición.',
);
assert.match(
  migration,
  /revoke all on function public\.crear_ficha_hotel_con_etapas_alpha71\(jsonb, jsonb, text\)[\s\S]*?from public, anon/,
  'La operación pública no puede quedar ejecutable por anónimos.',
);
assert.match(
  migration,
  /grant execute on function public\.crear_ficha_hotel_con_etapas_alpha71\(jsonb, jsonb, text\)[\s\S]*?to authenticated, service_role/,
  'Solo los roles autorizados deben poder invocar el guardado.',
);
assert.match(
  stopNumberFixMigration,
  /v_numero_parada := nullif\(btrim\(v_created->>'numero_parada'\), ''\)/,
  'El guardado debe capturar el número de parada generado por el alta.',
);
assert.match(
  stopNumberFixMigration,
  /v_ficha_guardar := p_ficha \|\| jsonb_build_object\([\s\S]*?'numero_parada', v_numero_parada[\s\S]*?guardar_ficha_hotel_edicion_alpha71\([\s\S]*?v_ficha_guardar/,
  'El segundo guardado debe reutilizar el número generado en vez del campo vacío original.',
);
assert.match(
  stopNumberFixMigration,
  /'numero_parada', v_numero_parada/,
  'La respuesta debe devolver el mismo número de parada conservado.',
);

console.log('Alpha71: creación conjunta de ficha, T y trabajos verificada.');
