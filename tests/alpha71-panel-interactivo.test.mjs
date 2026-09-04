import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const panelSource = await readFile(new URL('../r1-alpha71/src/panel-native.js', import.meta.url), 'utf8');
const panelStyles = await readFile(new URL('../r1-alpha71/panel-native.css', import.meta.url), 'utf8');

assert.match(
  panelSource,
  /import \{ openHotelEditor \} from '.\/hotel-editor\.js'/,
  'El Panel debe reutilizar la ficha completa y auditada de Hotel.',
);
assert.match(
  panelSource,
  /function hotelItem[\s\S]*?module: 'hotel',[\s\S]*?recordId: row\.id,[\s\S]*?actionLabel: 'Abrir ficha completa'/,
  'Cada resumen de Hotel debe conservar el identificador de su ficha.',
);
assert.match(
  panelSource,
  /function stageItem[\s\S]*?recordId: hotel\?\.id \|\| row\.registro_hotel_id,[\s\S]*?actionLabel: 'Abrir T en su ficha'/,
  'Cada T del Panel debe enlazar con su ficha de Hotel.',
);
assert.match(
  panelSource,
  /moduleId === 'hotel' && item\?\.recordId && canEditHotel[\s\S]*?openHotelEditor\(item\.recordId/,
  'El administrador debe abrir directamente la ficha concreta desde el Panel.',
);
assert.match(
  panelSource,
  /const action = el\('button', `→ \$\{actionLabel\}`[\s\S]*?card\.addEventListener\('click'/,
  'Cada resultado debe tener botón visible y permitir pulsar toda la tarjeta.',
);
assert.match(
  panelSource,
  /activos: '\[data-alpha70-activos\]'/,
  'Los vehículos y contratos deben abrir la pestaña Activos.',
);
assert.match(
  panelSource,
  /a71-panel-alert-action/,
  'Los avisos de atención inmediata también deben ser interactivos.',
);
assert.match(
  panelStyles,
  /@media\(max-width:620px\)[\s\S]*?\.a71-panel-item-action\{[^}]*width:100%/,
  'La acción para abrir la ficha debe ocupar todo el ancho en móvil.',
);
assert.match(
  panelStyles,
  /body\.a70-print-detail \.a71-panel-item-action\{display:none!important\}/,
  'Los controles interactivos no deben aparecer en el PDF ni en la impresión.',
);

console.log('Alpha71: resultados y avisos del Panel interactivos verificados.');
