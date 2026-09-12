import '../../r1-alpha69/src/app.js';
import './assistance-protocols.js';
import './assistance-call-continuity.js';
import './listados-export.js';
import './reservas-create.js?v=75.12';
import './activos.js';
import './pending-stages.js?v=75.12';
import './assistance-followup.js';

const VERSION = 'r1.0.0-alpha.75.12';
const versionNode = document.querySelector('#app-version');
if (versionNode) versionNode.textContent = VERSION;
