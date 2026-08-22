import '../../r1-alpha26/src/app.js';

const VERSION = 'r1.0.0-alpha.28';
const versionNode = document.querySelector('#app-version');
if (versionNode) versionNode.textContent = VERSION;

const moduleContent = document.querySelector('#module-content');
const FILTERS = Object.freeze([
  { key: 'all', label: 'Fichas activas', states: null, title: 'Mostrar todas las fichas activas' },
  { key: 'workshop', label: 'En taller', states: new Set(['en_taller','pendiente_diagnostico','pendiente_autorizacion','pendiente_repuestos']), title: 'Mostrar solo vehículos en taller' },
  { key: 'pickup', label: 'Pendientes de recoger', states: new Set(['terminado_pendiente_recogida']), title: 'Mostrar solo pendientes de recoger' },
  { key: 'recover', label: 'Pendientes de recuperar', states: new Set(['recogido_pendiente_ruta']), title: 'Mostrar solo pendientes de recuperar' }
]);
let activeFilter = 'all';
let currentGrid = null;

function ensureStyle() {
  if (document.querySelector('#alpha28-filter-style')) return;
  const style = document.createElement('style');
  style.id = 'alpha28-filter-style';
  style.textContent = `
    .hotel-filter-metric{cursor:pointer;transition:transform .12s ease,box-shadow .12s ease,outline-color .12s ease;user-select:none}
    .hotel-filter-metric:hover{transform:translateY(-1px);box-shadow:0 6px 18px rgba(15,23,42,.08)}
    .hotel-filter-metric:focus{outline:3px solid rgba(7,89,133,.24);outline-offset:3px}
    .hotel-filter-metric.is-active{outline:3px solid #075985;outline-offset:2px;background:#f0f9ff}
    .hotel-card.hotel-filter-hidden{display:none!important}
  `;
  document.head.append(style);
}

function filterFromMetric(metric) {
  const label = metric?.querySelector('span')?.textContent?.trim() || '';
  return FILTERS.find(item => item.label === label) || null;
}

function findMetricsGrid() {
  if (!moduleContent) return null;
  return [...moduleContent.querySelectorAll('.summary-grid')].find(grid => {
    const labels = [...grid.querySelectorAll('.metric span')].map(node => node.textContent.trim());
    return FILTERS.every(item => labels.includes(item.label));
  }) || null;
}

function prepareGrid(grid) {
  [...grid.querySelectorAll('.metric')].forEach(metric => {
    const filter = filterFromMetric(metric);
    if (!filter) return;
    metric.classList.add('hotel-filter-metric');
    metric.dataset.hotelFilter = filter.key;
    metric.setAttribute('role', 'button');
    metric.setAttribute('tabindex', '0');
    metric.setAttribute('aria-label', filter.title);
    metric.title = filter.title;
  });
}

function applyFilter() {
  const grid = findMetricsGrid();
  if (!grid) return;
  if (grid !== currentGrid) {
    currentGrid = grid;
    activeFilter = 'all';
  }
  prepareGrid(grid);
  const selected = FILTERS.find(item => item.key === activeFilter) || FILTERS[0];
  [...moduleContent.querySelectorAll('.hotel-card')].forEach(card => {
    const state = card.dataset.state || '';
    const hide = Boolean(selected.states && !selected.states.has(state));
    card.classList.toggle('hotel-filter-hidden', hide);
  });
  [...grid.querySelectorAll('.hotel-filter-metric')].forEach(metric => {
    const active = metric.dataset.hotelFilter === selected.key;
    metric.classList.toggle('is-active', active);
    metric.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
}

function activate(metric) {
  const filter = filterFromMetric(metric);
  if (!filter) return;
  activeFilter = filter.key;
  applyFilter();
}

ensureStyle();
moduleContent?.addEventListener('click', event => {
  const metric = event.target.closest?.('.summary-grid .metric');
  if (metric && filterFromMetric(metric)) activate(metric);
});
moduleContent?.addEventListener('keydown', event => {
  const metric = event.target.closest?.('.summary-grid .metric');
  if (!metric || !filterFromMetric(metric) || !['Enter', ' '].includes(event.key)) return;
  event.preventDefault();
  activate(metric);
});
if (moduleContent) {
  const observer = new MutationObserver(() => queueMicrotask(applyFilter));
  observer.observe(moduleContent, { childList: true, subtree: true });
}
requestAnimationFrame(applyFilter);
