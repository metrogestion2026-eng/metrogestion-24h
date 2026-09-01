import '../../r1-alpha69/src/app.js';
import './assistance-protocols.js';
import './listados-export.js';
import './reservas-create.js';
import './history-search.js';
import './activos.js';

const VERSION = 'r1.0.0-alpha.70';
const versionNode = document.querySelector('#app-version');
if (versionNode) versionNode.textContent = VERSION;
