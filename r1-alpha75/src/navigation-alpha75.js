const nav = document.querySelector('#module-nav');

export const LEGACY_ALPHA75_MODULE_IDS = Object.freeze([
  'importacion_hotel',
  'transformacion_hotel',
  'revision_hotel',
  'presentacion_hotel',
]);

const legacySet = new Set(LEGACY_ALPHA75_MODULE_IDS);
let cleanupQueued = false;

function ensureLegacyNavStyle() {
  if (document.querySelector('#alpha75-current-navigation-style')) return;
  const style = document.createElement('style');
  style.id = 'alpha75-current-navigation-style';
  style.textContent = LEGACY_ALPHA75_MODULE_IDS
    .map(id => `#module-nav button[data-module="${id}"]{display:none!important}`)
    .join('');
  document.head.append(style);
}

export function pruneAlpha75LegacyNavigation() {
  if (!nav) return 0;
  let removed = 0;
  nav.querySelectorAll('button[data-module]').forEach(button => {
    if (!legacySet.has(button.dataset.module)) return;
    button.remove();
    removed += 1;
  });
  return removed;
}

function scheduleCleanup() {
  if (cleanupQueued) return;
  cleanupQueued = true;
  queueMicrotask(() => {
    cleanupQueued = false;
    pruneAlpha75LegacyNavigation();
  });
}

ensureLegacyNavStyle();
pruneAlpha75LegacyNavigation();

if (nav) {
  new MutationObserver(scheduleCleanup).observe(nav, { childList: true });
}
