import '../../r1-alpha69/src/app.js';
import './assistance-protocols.js';
import './assistance-call-continuity.js';
import './listados-export.js';
import './reservas-create.js';
import './activos.js';
import './pending-stages.js';
import './assistance-followup.js';

const VERSION = 'r1.0.0-alpha.74.13';
const versionNode = document.querySelector('#app-version');
if (versionNode) versionNode.textContent = VERSION;
