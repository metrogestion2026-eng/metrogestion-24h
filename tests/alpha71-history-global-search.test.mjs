import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const historySource = await readFile(
  new URL('../r1-alpha71/src/history-native.js', import.meta.url),
  'utf8',
);
const appSource = await readFile(new URL('../r1-alpha71/src/app.js', import.meta.url), 'utf8');

assert.doesNotMatch(
  appSource,
  /import ['"]\.\/history-search\.js['"];/,
  'Alpha71 no debe cargar el filtro antiguo limitado a la pizarra seleccionada.',
);
assert.match(
  historySource,
  /async function searchAllHistory\(/,
  'Histórico debe disponer de una búsqueda independiente de la fecha.',
);
assert.match(
  historySource,
  /\.from\('hotel_por_dia'\)[\s\S]*?\.or\(ilikeAny\(RECORD_SEARCH_COLUMNS, searchTerm\)\)/,
  'La búsqueda global debe consultar las fichas históricas en Supabase.',
);
assert.match(
  historySource,
  /\.from\('etapas_hotel'\)[\s\S]*?\.or\(ilikeAny\(STAGE_SEARCH_COLUMNS, searchTerm\)\)/,
  'La búsqueda global debe incluir los datos de las T.',
);
assert.match(
  historySource,
  /\.from\('documentos_gestion'\)[\s\S]*?\.or\(ilikeAny\(DOCUMENT_SEARCH_COLUMNS, searchTerm\)\)/,
  'La búsqueda global debe incluir los nombres y descripciones de documentos.',
);
assert.match(
  historySource,
  /const key = row\.seguimiento_id \|\| row\.id;/,
  'Una ficha debe aparecer una sola vez aunque exista en varias pizarras diarias.',
);
assert.match(
  historySource,
  /text: 'Buscar en todo el Histórico'/,
  'El botón debe explicar que la búsqueda abarca todas las fechas.',
);
assert.match(
  historySource,
  /searchInput\.addEventListener\('keydown'[\s\S]*?event\.key !== 'Enter'[\s\S]*?searchAllHistory/,
  'La tecla Entrar del móvil o teclado debe lanzar la búsqueda global.',
);
assert.match(
  historySource,
  /dayButton\.addEventListener\('click'[\s\S]*?loadDay/,
  'Buscar día debe conservarse como consulta independiente por fecha.',
);

console.log('Alpha71: búsqueda global del Histórico verificada.');
