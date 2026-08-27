const nav = document.querySelector('#module-nav');
const content = document.querySelector('#module-content');

const PANEL_MODULE = 'resumen';
const PANEL_FLAG = 'alpha52Panel';
const PANEL_ROOT_SELECTOR = '.a52-panel';
const RECOVERY_DELAY_MS = 24;
const RECOVERY_COOLDOWN_MS = 140;

let intendedModule = '';
let recoveryTimer = null;
let lastRecoveryAt = 0;
let reconciling = false;

function moduleFromButton(button) {
  if (!button) return '';
  if (button.matches('[data-module="resumen"]')) return PANEL_MODULE;
  if (button.dataset.module) return button.dataset.module;
  if (button.matches('[data-alpha29-listados]')) return 'listados';
  if (button.matches('[data-alpha34-24h], [data-h47-24h]')) return 'activar24h';
  if (button.matches('[data-alpha51-users]')) return 'usuarios';

  const label = String(button.textContent || '').toLocaleLowerCase('es-ES');
  if (label.includes('panel')) return PANEL_MODULE;
  if (label.includes('hotel')) return 'hotel';
  if (label.includes('reservas')) return 'reservas';
  if (label.includes('histórico') || label.includes('historico')) return 'historico';
  if (label.includes('t programadas')) return 't_programadas';
  if (label.includes('talleres')) return 'talleres';
  if (label.includes('listados')) return 'listados';
  if (label.includes('24h')) return 'activar24h';
  return '';
}

function buttonForModule(moduleId) {
  if (!nav || !moduleId) return null;
  const selectors = {
    resumen: '[data-module="resumen"]',
    hotel: '[data-module="hotel"]',
    reservas: '[data-module="reservas"]',
    historico: '[data-module="historico"]',
    t_programadas: '[data-module="t_programadas"]',
    talleres: '[data-module="talleres"]',
    listados: '[data-alpha29-listados]',
    activar24h: '[data-alpha34-24h], [data-h47-24h]',
    usuarios: '[data-alpha51-users]',
  };
  return nav.querySelector(selectors[moduleId] || `[data-module="${CSS.escape(moduleId)}"]`);
}

function markActive(moduleId) {
  const target = buttonForModule(moduleId);
  if (!target) return;
  nav.querySelectorAll('button').forEach(button => {
    button.classList.toggle('active', button === target);
  });
}

function clearPanelOwnership() {
  if (!content) return;
  delete content.dataset[PANEL_FLAG];
  delete content.dataset.alpha62PanelOwned;
}

function setIntent(moduleId) {
  if (!moduleId) return;
  intendedModule = moduleId;
  if (nav) nav.dataset.alpha62IntendedModule = moduleId;
  if (moduleId !== PANEL_MODULE) {
    clearPanelOwnership();
    content?.classList.remove('alpha62-navigation-recovering');
  }
}

function scheduleRecovery(moduleId) {
  if (!moduleId || recoveryTimer) return;
  const targetModule = moduleId;
  recoveryTimer = window.setTimeout(() => {
    recoveryTimer = null;
    if (intendedModule !== targetModule) return;

    const now = Date.now();
    if (now - lastRecoveryAt < RECOVERY_COOLDOWN_MS) {
      scheduleRecovery(targetModule);
      return;
    }

    const target = buttonForModule(targetModule);
    if (!target || target.disabled) return;
    lastRecoveryAt = now;
    target.click();
  }, RECOVERY_DELAY_MS);
}

function reconcileNavigation() {
  if (reconciling || !nav || !content) return;
  reconciling = true;
  try {
    if (!intendedModule) {
      const active = nav.querySelector('button.active');
      const detected = moduleFromButton(active) || (nav.querySelector('[data-module="hotel"]') ? 'hotel' : '');
      if (detected) setIntent(detected);
      return;
    }

    const panelPresent = Boolean(content.querySelector(PANEL_ROOT_SELECTOR));
    const panelOwnsContent = content.childElementCount === 1
      && content.firstElementChild?.matches?.(PANEL_ROOT_SELECTOR);

    if (intendedModule === PANEL_MODULE) {
      if (panelOwnsContent) {
        content.dataset[PANEL_FLAG] = '1';
        content.dataset.alpha62PanelOwned = '1';
        content.classList.remove('alpha62-navigation-recovering');
        markActive(PANEL_MODULE);
      } else {
        content.classList.add('alpha62-navigation-recovering');
        scheduleRecovery(PANEL_MODULE);
      }
      return;
    }

    clearPanelOwnership();
    if (panelPresent) {
      content.classList.add('alpha62-navigation-recovering');
      scheduleRecovery(intendedModule);
    } else {
      content.classList.remove('alpha62-navigation-recovering');
    }
  } finally {
    reconciling = false;
  }
}

function captureNavigationIntent(event) {
  const button = event.target?.closest?.('button');
  if (!button || !nav?.contains(button)) return;
  const moduleId = moduleFromButton(button);
  if (!moduleId) return;
  setIntent(moduleId);
  if (moduleId === PANEL_MODULE) {
    content?.classList.add('alpha62-navigation-recovering');
  }
}

function ensureStyle() {
  if (document.querySelector('#alpha62-navigation-style')) return;
  const style = document.createElement('style');
  style.id = 'alpha62-navigation-style';
  style.textContent = `
    #module-content.alpha62-navigation-recovering {
      visibility: hidden;
    }
  `;
  document.head.append(style);
}

ensureStyle();

if (nav) {
  nav.addEventListener('pointerdown', captureNavigationIntent, true);
  nav.addEventListener('click', captureNavigationIntent, true);
  new MutationObserver(() => {
    if (!intendedModule) reconcileNavigation();
  }).observe(nav, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
}

if (content) {
  new MutationObserver(reconcileNavigation).observe(content, {
    childList: true,
    subtree: true,
  });
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && intendedModule !== PANEL_MODULE) clearPanelOwnership();
}, true);

window.addEventListener('pageshow', reconcileNavigation);
queueMicrotask(reconcileNavigation);
