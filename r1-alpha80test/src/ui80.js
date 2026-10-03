const VERSION = 'r1.0.0-alpha.75.23-hf2-h73-device-candidate-80ui-test2';

document.documentElement.dataset.metrogestionUi = '80-test2';
document.body.classList.add('mg80');
document.title = 'Metrogestión · 75→80 UI test2';

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


function mg80Icon(name) {
  const paths = {
    menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
    bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4v-.2a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.6v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z"/>'
  };
  return '<svg viewBox="0 0 24 24" aria-hidden="true">'+(paths[name]||'')+'</svg>';
}

function findSessionAction80(pattern) {
  return [...document.querySelectorAll('.session-bar button')]
    .find(button => pattern.test((button.textContent || '').trim())) || null;
}

function setSessionMenu80(open) {
  const bar = document.querySelector('.session-bar');
  if (!bar) return;
  bar.classList.toggle('mg80-open', open);
  const trigger = document.querySelector('#mg80-user-button');
  trigger?.setAttribute('aria-expanded', open ? 'true' : 'false');
}

function syncUserName80() {
  const target = document.querySelector('#mg80-user-name');
  const source = document.querySelector('#session-name');
  if (!target) return;
  const name = (source?.textContent || '').trim();
  target.textContent = name && name !== '—' ? name.replace(/\s+2026$/,'') : 'Metro';
}

function installPreparedHeader80() {
  const header = document.querySelector('.app-header');
  if (!header || header.dataset.alpha80Prepared === '1') return;
  header.dataset.alpha80Prepared = '1';
  header.classList.add('mg80-prepared-header');

  header.innerHTML = `
    <button class="mg80-mobile-menu" id="mg80-menu-toggle" type="button" aria-label="Abrir navegación">${mg80Icon('menu')}</button>
    <div class="mg80-brand">
      <button class="mg80-brand-button" type="button" aria-label="Metrogestión · Ir al panel">
        <span class="mg80-brand-mark"><img src="../r1-alpha22/icon-metrogestion.svg" alt=""></span>
        <span class="mg80-brand-copy">
          <small>GESTIÓN DE MANTENIMIENTO</small>
          <strong>Metrogestión</strong>
        </span>
      </button>
      <span class="mg80-slogan">FLOTAS EN MOVIMIENTO</span>
    </div>

    <form id="mg80-global-search" role="search">
      <span class="mg80-search-glyph">${mg80Icon('search')}</span>
      <input type="search" maxlength="120" autocomplete="off"
        aria-label="Buscar vehículo, parada o matrícula"
        placeholder="Buscar vehículo, OR, matrícula…">
    </form>

    <div class="mg80-header-controls">
      <button class="mg80-mobile-search" id="mg80-search-toggle" type="button" aria-label="Abrir buscador">${mg80Icon('search')}</button>
      <button class="mg80-icon-button" id="mg80-alert-button" type="button" aria-label="Abrir sugerencias">${mg80Icon('bell')}<span class="mg80-alert-dot"></span></button>
      <button class="mg80-icon-button" id="mg80-settings-button" type="button" aria-label="Información de versión">${mg80Icon('settings')}</button>
      <button class="mg80-user-button" id="mg80-user-button" type="button" aria-label="Abrir menú de usuario" aria-expanded="false">
        <span class="mg80-avatar">MJ</span><span class="mg80-username" id="mg80-user-name">Metro</span>
      </button>
    </div>

    <div class="mg80-version-popover" id="mg80-version-popover" hidden>
      <strong>Metrogestión · 75 → 80</strong>
      <span id="app-version">${VERSION}</span>
      <small>Motor Alpha75 validado · interfaz Alpha80 · metrogestion-pruebas</small>
    </div>
  `;

  const searchForm = header.querySelector('#mg80-global-search');
  searchForm?.addEventListener('submit', event => {
    event.preventDefault();
    const q = String(searchForm.querySelector('input')?.value || '').trim().slice(0,120);
    if (!q) return;
    findHotelButton()?.click();
    window.setTimeout(() => pushHotelSearch(q), 80);
  });

  header.querySelector('.mg80-brand-button')?.addEventListener('click', () => {
    [...document.querySelectorAll('#module-nav button')]
      .find(button => /Panel/i.test(button.textContent || ''))?.click();
  });

  header.querySelector('#mg80-menu-toggle')?.addEventListener('click', () => {
    document.querySelector('#module-nav')?.classList.toggle('mg80-mobile-open');
  });

  header.querySelector('#mg80-search-toggle')?.addEventListener('click', () => {
    searchForm?.classList.toggle('mg80-mobile-open');
    searchForm?.querySelector('input')?.focus();
  });

  header.querySelector('#mg80-alert-button')?.addEventListener('click', () => {
    const suggestions = findSessionAction80(/Sugerencias/i);
    suggestions ? suggestions.click() : setSessionMenu80(true);
  });

  header.querySelector('#mg80-settings-button')?.addEventListener('click', () => {
    const popup = document.querySelector('#mg80-version-popover');
    if (popup) popup.hidden = !popup.hidden;
  });

  header.querySelector('#mg80-user-button')?.addEventListener('click', () => {
    const bar = document.querySelector('.session-bar');
    setSessionMenu80(!bar?.classList.contains('mg80-open'));
  });

  syncUserName80();
  const sessionName = document.querySelector('#session-name');
  if (sessionName && !sessionName.dataset.mg80Observed) {
    sessionName.dataset.mg80Observed = '1';
    new MutationObserver(syncUserName80).observe(sessionName,{childList:true,subtree:true,characterData:true});
  }
}

function bootPrepared80() {
  installPreparedHeader80();
  applyVersion();
  renameNavigation();
  ensureBanner();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootPrepared80, {once:true});
} else {
  queueMicrotask(bootPrepared80);
}
window.addEventListener('load', bootPrepared80, {once:true});

document.addEventListener('click', event => {
  const session = document.querySelector('.session-bar');
  const user = document.querySelector('#mg80-user-button');
  if (session?.classList.contains('mg80-open') && !session.contains(event.target) && !user?.contains(event.target)) {
    setSessionMenu80(false);
  }
  const popup = document.querySelector('#mg80-version-popover');
  const settings = document.querySelector('#mg80-settings-button');
  if (popup && !popup.hidden && !popup.contains(event.target) && !settings?.contains(event.target)) {
    popup.hidden = true;
  }
});

window.__MG80_UI_TEST__ = Object.freeze({
  version: VERSION,
  base: 'r1.0.0-alpha.75.23-hf2-h73-device-candidate',
  mode: 'live-test-backend-ui80-prepared-header',
  supabaseProject: 'metrogestion-pruebas'
});
