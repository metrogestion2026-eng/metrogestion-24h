import '../../r1-alpha69/src/app.js';
import './assistance-protocols.js';
import './assistance-call-continuity.js';
import './listados-export.js';
import './reservas-create.js?v=75.23-hf14';
import './activos.js?v=75.23-hf10';
import './pending-stages.js?v=75.23-hf16';
import './assistance-followup.js?v=75.23-hf25';

const VERSION = 'r1.0.0-alpha.75.23-hf27';
const versionNode = document.querySelector('#app-version');
if (versionNode) versionNode.textContent = VERSION;
