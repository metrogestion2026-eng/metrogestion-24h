import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { findCatalogueItem } from '../r1-alpha71/src/editable-catalogue.js';

const helper = await readFile(new URL('../r1-alpha71/src/editable-catalogue.js', import.meta.url), 'utf8');
const mainEditor = await readFile(new URL('../r1-alpha71/src/hotel-editor-main.js', import.meta.url), 'utf8');
const stagesEditor = await readFile(new URL('../r1-alpha71/src/hotel-editor-stages.js', import.meta.url), 'utf8');
const page = await readFile(new URL('../r1-alpha71/index.html', import.meta.url), 'utf8');
const styles = await readFile(new URL('../r1-alpha71/editable-catalogue.css', import.meta.url), 'utf8');

assert.match(helper, /setAttribute\('role', 'combobox'\)/, 'El campo editable debe identificarse como combobox.');
assert.match(helper, /role: 'listbox'/, 'Debe existir un listado explícito de opciones.');
assert.match(helper, /hidden: ''/, 'El listado debe permanecer oculto al abrir la ficha.');
assert.match(helper, /className: 'a71-catalogue-trigger'/, 'Debe haber una flecha visible para abrir el listado.');
assert.match(helper, /trigger\.addEventListener\('click'/, 'El listado solo debe abrirse mediante la flecha.');
assert.match(helper, /input\.addEventListener\('focus', \(\) => setOpen\(false\)\)/, 'Tocar el campo no debe desplegar opciones en el móvil.');
assert.doesNotMatch(helper, /createElement\(['"]datalist|element\(['"]datalist|setAttribute\(['"]list['"]/, 'No debe usarse el desplegable nativo que se abre automáticamente en móviles.');
assert.match(helper, /onChange\?\.\(item, name\)/, 'Elegir una opción debe actualizar el valor guardado.');
assert.match(helper, /input\.addEventListener\('input', update\)/, 'El campo debe seguir admitiendo escritura libre.');
assert.match(helper, /setDisabled\(disabled\)/, 'El campo y su lista deben poder bloquearse juntos.');

assert.match(mainEditor, /createEditableCatalogueField\([\s\S]*?'Estado'/, 'Situación operativa debe usar el catálogo editable.');
assert.match(stagesEditor, /createEditableCatalogueField\('Estado'/, 'El estado de las T debe mostrar el mismo listado.');
assert.match(stagesEditor, /createEditableCatalogueField\('Tipo de T'/, 'El tipo de T debe mostrar el mismo listado.');
assert.match(stagesEditor, /createEditableCatalogueField\('Taller'/, 'Taller debe mostrar el mismo listado.');
assert.match(stagesEditor, /createEditableCatalogueField\('Centro'/, 'Centro debe mostrar el mismo listado.');
assert.match(stagesEditor, /createEditableCatalogueField\('Tipo'/, 'El tipo de trabajo debe mostrar el mismo listado.');

assert.match(page, /href="\.\/editable-catalogue\.css"/, 'Alpha71 debe cargar los estilos del desplegable.');
assert.match(styles, /\.a71-catalogue-listbox/, 'El listado debe tener estilos propios y visibles.');
assert.match(styles, /max-height:/, 'Los catálogos largos deben poder desplazarse sin ocupar toda la pantalla.');

const operationalStates = [
  { codigo: 'pendiente_taller', nombre: 'Pendiente de taller' },
  { codigo: 'en_taller', nombre: 'Realizando trabajos en taller' }
];
assert.equal(findCatalogueItem(operationalStates, 'Pendiente de taller')?.codigo, 'pendiente_taller');
assert.equal(findCatalogueItem(operationalStates, 'EN_TALLER')?.nombre, 'Realizando trabajos en taller');

console.log('Alpha71: catálogos editables y listados visibles verificados.');
