import { getModuleAccess } from '../../r1-alpha17/src/security.js';
import { supabase } from '../../r1-alpha17/src/supabase.js';

const READER_CLASS = 'a76-reader';
const HIDDEN_CLASS = 'a76-reader-hidden';
const SEARCH_KEY = 'alpha76HotelSearch';
const nav = document.querySelector('#module-nav');
const content = document.querySelector('#module-content');
const appView = document.querySelector('#app-view');
const sessionRole = document.querySelector('#session-role');

let readerProfile = null;
let configuredUserId = '';
let checking = false;

function hasAnyEditPermission(profile) {
  if (profile?.tipo_usuario === 'administrador_principal') return true;
  return Object.values(profile?.permisos || {}).some(permission => permission?.editar === true);
}

function eligibleReader(profile) {
  if (!profile?.activo || hasAnyEditPermission(profile)) return false;
  return getModuleAccess(profile, 'hotel').view || getModuleAccess(profile, 'resumen').view;
}

function readerAccess(profile) {
  return {
    hotel: getModuleAccess(profile, 'hotel').view,
    panel: getModuleAccess(profile, 'resumen').view,
  };
}

function openModule(moduleId) {
  nav?.querySelector(`button[data-module="${moduleId}"]`)?.click();
}

function saveHotelSearch(query) {
  sessionStorage.setItem(SEARCH_KEY, query.trim());
  openModule('hotel');
}

function legendItem(tone, title, detail) {
  const item = document.createElement('li');
  item.className = 'a76-legend-item';
  item.innerHTML = `<span class="a76-swatch ${tone}" aria-hidden="true"></span><span><strong>${title}</strong><small>${detail}</small></span>`;
  return item;
}

function markActive(button) {
  nav?.querySelectorAll('button').forEach(node => node.classList.toggle('active', node === button));
}

function renderConsulta(button) {
  if (!readerProfile || !content) return;
  const access = readerAccess(readerProfile);
  markActive(button);
  content.dataset.alpha76Consulta = '1';
  content.replaceChildren();

  const page = document.createElement('div');
  page.className = 'a76-consulta';
  page.innerHTML = `
    <header class="a76-consulta-head">
      <div><p class="eyebrow">Alpha76 · acceso simplificado</p><h2>Consulta de flota</h2><p>Busca un vehículo o entra en las vistas generales. Esta sesión no permite modificar datos.</p></div>
      <span class="a76-readonly-badge">Solo lectura</span>
    </header>
    <section class="a76-search-card" aria-labelledby="a76-search-title">
      <div><h3 id="a76-search-title">Buscar un vehículo</h3><p>Introduce DFM, matrícula o número de actuación.</p></div>
      <form class="a76-search-form">
        <label for="a76-vehicle-search">Dato del vehículo</label>
        <div><input id="a76-vehicle-search" type="search" autocomplete="off" placeholder="Ej.: 2500, matrícula o PA-…"><button class="button primary" type="submit">Buscar en Hotel</button></div>
        <p class="a76-form-message" aria-live="polite"></p>
      </form>
    </section>
    <section class="a76-entry-grid" aria-label="Vistas de consulta">
      <button class="a76-entry-card" type="button" data-open="hotel"><span class="a76-entry-icon" aria-hidden="true">🏨</span><span><strong>Abrir Hotel</strong><small>Consulta las fichas activas y su situación.</small></span></button>
      <button class="a76-entry-card" type="button" data-open="resumen"><span class="a76-entry-icon" aria-hidden="true">📊</span><span><strong>Abrir Panel</strong><small>Consulta el resumen y los avisos operativos.</small></span></button>
    </section>
    <section class="a76-guide-grid">
      <div class="a76-guide-card"><h3>Cómo consultar</h3><ol><li>Busca por DFM, matrícula o actuación.</li><li>Abre la ficha para ver su resumen y sus T.</li><li>Usa los bloques de colores para filtrar Hotel.</li><li>Vuelve a <strong>Consulta</strong> desde el menú.</li></ol></div>
      <div class="a76-guide-card"><h3>Qué significa cada color</h3><ul class="a76-legend"></ul><p class="a76-outline-note"><span aria-hidden="true"></span><strong>Borde marrón:</strong> vehículo parado sin sustituto.</p></div>
    </section>`;

  const legend = page.querySelector('.a76-legend');
  [
    ['yellow', 'Amarillo', 'Pendiente de parar'],
    ['white', 'Blanco', 'Taller, trámites, gestiones o 24H'],
    ['lilac', 'Lila', 'En taller'],
    ['blue', 'Azul', 'Pendiente de recoger'],
    ['orange', 'Calabaza', 'Pendiente de recuperar'],
    ['brown', 'Marrón', 'Sustitución momentánea'],
    ['lightblue', 'Azul claro', 'Conjunto de fichas activas'],
  ].forEach(item => legend.append(legendItem(...item)));

  const form = page.querySelector('.a76-search-form');
  const input = page.querySelector('#a76-vehicle-search');
  const message = page.querySelector('.a76-form-message');
  const submit = form.querySelector('button');
  submit.disabled = !access.hotel;
  if (!access.hotel) message.textContent = 'Tu perfil no tiene acceso a Hotel.';
  form.addEventListener('submit', event => {
    event.preventDefault();
    const query = input.value.trim();
    if (!query) {
      message.textContent = 'Escribe un DFM, una matrícula o un número de actuación.';
      input.focus();
      return;
    }
    message.textContent = '';
    saveHotelSearch(query);
  });
  page.querySelectorAll('[data-open]').forEach(entry => {
    const moduleId = entry.dataset.open;
    const allowed = moduleId === 'hotel' ? access.hotel : access.panel;
    entry.disabled = !allowed;
    entry.addEventListener('click', () => openModule(moduleId));
  });
  content.append(page);
}

function syncReaderNavigation() {
  if (!readerProfile || !nav) return;
  nav.querySelectorAll('button').forEach(button => {
    const keep = button.dataset.alpha76Consulta === '1' || ['hotel', 'resumen'].includes(button.dataset.module);
    button.classList.toggle(HIDDEN_CLASS, !keep);
    button.setAttribute('aria-hidden', keep ? 'false' : 'true');
    if (!keep) button.tabIndex = -1;
  });
}

function enableReaderMode(profile) {
  readerProfile = profile;
  document.body.classList.add(READER_CLASS);
  let button = nav.querySelector('[data-alpha76-consulta]');
  if (!button) {
    button = document.createElement('button');
    button.type = 'button';
    button.className = 'button secondary';
    button.dataset.alpha76Consulta = '1';
    button.innerHTML = '<span aria-hidden="true">🔎</span> Consulta';
    button.addEventListener('click', event => {
      event.preventDefault();
      event.stopImmediatePropagation();
      renderConsulta(button);
    }, true);
    nav.prepend(button);
  }
  syncReaderNavigation();
  if (sessionRole && !sessionRole.querySelector('.a76-session-tag')) {
    const tag = document.createElement('span');
    tag.className = 'a76-session-tag';
    tag.textContent = ' · Solo lectura';
    sessionRole.append(tag);
  }
  window.setTimeout(() => renderConsulta(button), 350);
}

function disableReaderMode() {
  readerProfile = null;
  configuredUserId = '';
  document.body.classList.remove(READER_CLASS);
  nav?.querySelector('[data-alpha76-consulta]')?.remove();
  nav?.querySelectorAll(`.${HIDDEN_CLASS}`).forEach(button => {
    button.classList.remove(HIDDEN_CLASS);
    button.removeAttribute('aria-hidden');
    button.removeAttribute('tabindex');
  });
  sessionRole?.querySelector('.a76-session-tag')?.remove();
}

async function checkSession() {
  if (checking || appView?.classList.contains('hidden') || !nav?.children.length) return;
  checking = true;
  try {
    const { data: authData } = await supabase.auth.getUser();
    const userId = authData?.user?.id;
    if (!userId || configuredUserId === userId) return;
    const { data: profile, error } = await supabase
      .from('usuarios')
      .select('id,tipo_usuario,permisos,activo')
      .eq('id', userId)
      .single();
    if (error || !eligibleReader(profile)) {
      disableReaderMode();
      configuredUserId = userId || '';
      return;
    }
    configuredUserId = userId;
    enableReaderMode(profile);
  } finally {
    checking = false;
  }
}

new MutationObserver(() => {
  if (readerProfile) syncReaderNavigation();
  void checkSession();
}).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });

new MutationObserver(() => {
  const button = nav?.querySelector('[data-alpha76-consulta].active');
  if (button && !content?.querySelector('.a76-consulta')) renderConsulta(button);
}).observe(content, { childList: true });

supabase.auth.onAuthStateChange(event => {
  if (event === 'SIGNED_OUT') disableReaderMode();
  else window.setTimeout(() => void checkSession(), 0);
});

void checkSession();
