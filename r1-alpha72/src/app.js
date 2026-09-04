import '../../r1-alpha69/src/app.js';
import './assistance-protocols.js';
import './assistance-call-continuity.js';
import './listados-export.js';
import './reservas-create.js';
import './activos.js';

const VERSION = 'r1.0.0-alpha.72';
const versionNode = document.querySelector('#app-version');
if (versionNode) versionNode.textContent = VERSION;
