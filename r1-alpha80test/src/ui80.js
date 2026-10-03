const VERSION = 'r1.0.0-alpha.75.23-hf2-h73-device-candidate-80ui-test1';

document.documentElement.dataset.metrogestionUi = '80-test1';
document.body.classList.add('mg80');
document.title = 'Metrogestión · 75→80 UI test1';

const LABELS = new Map([
  ['Panel', '📊 Panel'],
  ['Activar 24H', '🚨 Activar 24H'],
  ['Hotel · Pizarra', '🏨 Pizarra / Hotel'],
  ['T pendientes', '📄 Necesidades'],
  ['Activos', '🚚 Vehículos'],
  ['Reservas', '🚛 Reservas'],
  ['Histórico', '🗓 Histórico'],
  ['Talleres', '🔧 Talleres']
]);

function cleanLabel(value) {
  return String(value || '')
    .replace(/^[\s\p{Extended_Pictographic}\uFE0F]+/u, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function applyVersion() {
  const node = document.querySelector('#app-version');
  if (node && node.textContent !== VERSION) node.textContent = VERSION;
}

function renameNavigation() {
  const nav = document.querySelector('#module-nav');
  if (!nav) return;
  for (const button of nav.querySelectorAll('button')) {
    if (button.dataset.ui80Renamed === '1') continue;
    const current = cleanLabel(button.textContent);
    const next = LABELS.get(current);
    if (!next) continue;
    button.textContent = next;
    button.dataset.ui80Renamed = '1';
  }
}

function ensureBanner() {
  const content = document.querySelector('#module-content');
  if (!content || content.querySelector('#mg80-lab-banner')) return;
  const banner = document.createElement('div');
  banner.id = 'mg80-lab-banner';
  banner.innerHTML = '<strong>75 → 80 · CANDIDATA DE PRUEBAS</strong><span>Motor y datos vivos de Alpha75 · interfaz 80 · conectado únicamente a metrogestion-pruebas.</span>';
  content.prepend(banner);
}

function findHotelButton() {
  const buttons = [...document.querySelectorAll('#module-nav button')];
  return buttons.find(button => /Pizarra|Hotel/i.test(button.textContent || '')) || null;
}

function findHotelSearch() {
  const inputs = [...document.querySelectorAll('#module-content input')];
  return inputs.find(input => {
    const hint = [input.placeholder, input.getAttribute('aria-label'), input.name, input.id]
      .filter(Boolean)
      .join(' ');
    return /(buscar ficha|dfm|matr[ií]cula|actuaci[oó]n|\bor\b)/i.test(hint);
  }) || null;
}

function pushHotelSearch(query, attempt = 0) {
  const input = findHotelSearch();
  if (input) {
    input.focus();
    input.value = query;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return;
  }
  if (attempt < 15) {
    window.setTimeout(() => pushHotelSearch(query, attempt + 1), 120);
  }
}

function installGlobalSearch() {
  const header = document.querySelector('.app-header');
  if (!header || header.querySelector('#mg80-global-search')) return;

  const form = document.createElement('form');
  form.id = 'mg80-global-search';
  form.setAttribute('role', 'search');
  form.innerHTML = '<input type="search" maxlength="120" autocomplete="off" aria-label="Buscar vehículo, matrícula o actuación" placeholder="Buscar vehículo, matrícula, OR…"><button type="submit">Buscar</button>';

  const version = header.querySelector('.version-box');
  header.insertBefore(form, version || null);

  form.addEventListener('submit', event => {
    event.preventDefault();
    const input = form.querySelector('input');
    const query = String(input?.value || '').trim().slice(0, 120);
    if (!query) return;
    const hotel = findHotelButton();
    if (hotel) hotel.click();
    window.setTimeout(() => pushHotelSearch(query), 80);
  });
}

function bootstrapUi80() {
  applyVersion();
  renameNavigation();
  installGlobalSearch();
  ensureBanner();

  const versionNode = document.querySelector('#app-version');
  if (versionNode && !versionNode.dataset.ui80Watch) {
    versionNode.dataset.ui80Watch = '1';
    new MutationObserver(applyVersion).observe(versionNode, { childList: true, subtree: true, characterData: true });
  }

  const nav = document.querySelector('#module-nav');
  if (nav && !nav.dataset.ui80Watch) {
    nav.dataset.ui80Watch = '1';
    new MutationObserver(renameNavigation).observe(nav, { childList: true, subtree: true });
  }

  const content = document.querySelector('#module-content');
  if (content && !content.dataset.ui80Watch) {
    content.dataset.ui80Watch = '1';
    new MutationObserver(() => {
      queueMicrotask(ensureBanner);
    }).observe(content, { childList: true });
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrapUi80, { once: true });
} else {
  bootstrapUi80();
}

window.addEventListener('load', bootstrapUi80, { once: true });

window.__MG80_UI_TEST__ = Object.freeze({
  version: VERSION,
  base: 'r1.0.0-alpha.75.23-hf2-h73-device-candidate',
  mode: 'live-test-backend-ui80',
  supabaseProject: 'metrogestion-pruebas'
});
