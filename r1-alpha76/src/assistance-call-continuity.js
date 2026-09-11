import { supabase } from '../../r1-alpha17/src/supabase.js';

const content = document.querySelector('#module-content');
const appView = document.querySelector('#app-view');
const DRAFT_KEY = 'metrogestion.alpha71.24h.call-draft';
const DRAFT_TTL_MS = 4 * 60 * 60 * 1000;

let autoShownToken = '';
let activeUserId = null;

function cleanPhone(value) {
  return String(value || '').replace(/[^+\d]/g, '');
}

function validPhone(value) {
  return /^\+?\d{6,15}$/.test(cleanPhone(value));
}

function readSummaryRows(mode) {
  const card = mode.closest('.h24-card');
  return [...(card?.querySelectorAll('.h24-summary-row') || [])]
    .map(row => ({
      label: row.firstElementChild?.textContent?.trim() || '',
      value: row.lastElementChild?.textContent?.trim() || '—'
    }))
    .filter(row => row.label);
}

function makeDraft(mode, phone) {
  const service = mode.querySelector('.a70-protocol strong')?.textContent?.trim()
    || mode.querySelector('.a40-call-head .h24-status')?.textContent?.trim()
    || 'Asistencia 24H';
  const rows = readSummaryRows(mode);
  const startedAt = new Date().toISOString();
  return {
    version: 1,
    userId: activeUserId || '',
    startedAt,
    expiresAt: Date.now() + DRAFT_TTL_MS,
    phone: cleanPhone(phone),
    service,
    rows
  };
}

function saveDraft(draft) {
  if (!draft.userId) return;
  try {
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch {
    // La llamada sigue siendo utilizable aunque el navegador bloquee el almacenamiento.
  }
}

function clearDraft() {
  try {
    sessionStorage.removeItem(DRAFT_KEY);
  } catch {
    // Sin acción: sessionStorage puede estar bloqueado por el navegador.
  }
  document.querySelector('#a71-call-sheet')?.remove();
  document.querySelector('#a71-call-draft-button')?.remove();
  autoShownToken = '';
}

function loadDraft() {
  try {
    const draft = JSON.parse(sessionStorage.getItem(DRAFT_KEY) || 'null');
    if (!draft || !Array.isArray(draft.rows) || !validPhone(draft.phone)) return null;
    if (activeUserId === null) return null;
    if (!activeUserId || !draft.userId || draft.userId !== activeUserId) {
      clearDraft();
      return null;
    }
    if (!Number(draft.expiresAt) || Number(draft.expiresAt) <= Date.now()) {
      clearDraft();
      return null;
    }
    return draft;
  } catch {
    clearDraft();
    return null;
  }
}

function openPhoneWithoutReplacingApp(phone) {
  const link = document.createElement('a');
  link.href = `tel:${cleanPhone(phone)}`;
  link.target = '_blank';
  link.rel = 'noopener';
  link.setAttribute('aria-hidden', 'true');
  link.style.display = 'none';
  document.body.append(link);
  link.click();
  link.remove();
}

function callText(draft) {
  const lines = draft.rows.map(row => `${row.label}: ${row.value}`);
  return [`${draft.service} · ${draft.phone}`, ...lines].join('\n');
}

async function copyDraft(draft, status) {
  try {
    await navigator.clipboard.writeText(callText(draft));
    status.textContent = '✓ Datos copiados.';
    status.className = 'h24-status success';
  } catch {
    status.textContent = 'No se pudieron copiar automáticamente. Los datos permanecen visibles en esta ficha.';
    status.className = 'h24-status danger';
  }
}

function ensureDraftButton(draft) {
  if (document.querySelector('#a71-call-draft-button')) return;
  const button = document.createElement('button');
  button.id = 'a71-call-draft-button';
  button.className = 'button primary a71-call-draft-button';
  button.type = 'button';
  button.textContent = '📋 Datos llamada 24H';
  button.addEventListener('click', () => showCallSheet(loadDraft() || draft));
  document.body.append(button);
}

function showCallSheet(draft) {
  if (!draft) return;
  document.querySelector('#a71-call-sheet')?.remove();

  const overlay = document.createElement('div');
  overlay.id = 'a71-call-sheet';
  overlay.className = 'a71-call-sheet-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'Datos para comunicar durante la llamada 24H');

  const panel = document.createElement('section');
  panel.className = 'a71-call-sheet-panel';
  const header = document.createElement('header');
  header.className = 'a71-call-sheet-header';
  const heading = document.createElement('div');
  const eyebrow = document.createElement('p');
  eyebrow.className = 'eyebrow';
  eyebrow.textContent = 'Llamada en curso · ficha temporal protegida';
  const title = document.createElement('h2');
  title.textContent = 'Datos para comunicar al 24H';
  heading.append(eyebrow, title);
  const close = document.createElement('button');
  close.className = 'button secondary compact';
  close.type = 'button';
  close.textContent = 'Continuar en 24H';
  close.addEventListener('click', () => overlay.remove());
  header.append(heading, close);

  const instruction = document.createElement('div');
  instruction.className = 'h24-status success a71-call-instruction';
  instruction.textContent = 'Metrogestión continúa abierta. Durante la llamada, abre las aplicaciones recientes del teléfono y vuelve a Metrogestión: esta ficha seguirá preparada.';

  const service = document.createElement('div');
  service.className = 'a71-call-service';
  const serviceName = document.createElement('strong');
  serviceName.textContent = draft.service;
  const phone = document.createElement('span');
  phone.textContent = draft.phone;
  service.append(serviceName, phone);

  const rows = document.createElement('div');
  rows.className = 'a71-call-sheet-rows';
  draft.rows.forEach(item => {
    const row = document.createElement('div');
    row.className = 'a71-call-sheet-row';
    const label = document.createElement('strong');
    label.textContent = item.label;
    const value = document.createElement('span');
    value.textContent = item.value || '—';
    row.append(label, value);
    rows.append(row);
  });

  const status = document.createElement('div');
  status.className = 'h24-status h24-hidden';
  status.setAttribute('role', 'status');
  const actions = document.createElement('div');
  actions.className = 'a71-call-sheet-actions';
  const callAgain = document.createElement('button');
  callAgain.className = 'button primary';
  callAgain.type = 'button';
  callAgain.textContent = `📞 Volver a llamar · ${draft.phone}`;
  callAgain.addEventListener('click', () => openPhoneWithoutReplacingApp(draft.phone));
  const copy = document.createElement('button');
  copy.className = 'button secondary';
  copy.type = 'button';
  copy.textContent = 'Copiar datos';
  copy.addEventListener('click', () => copyDraft(draft, status));
  const discard = document.createElement('button');
  discard.className = 'button secondary';
  discard.type = 'button';
  discard.textContent = 'Finalizar y borrar ficha temporal';
  discard.addEventListener('click', clearDraft);
  actions.append(callAgain, copy, discard);

  panel.append(header, instruction, service, rows, status, actions);
  overlay.append(panel);
  document.body.append(overlay);
  ensureDraftButton(draft);
  autoShownToken = draft.startedAt;
}

function protectCallButton() {
  const mode = content?.querySelector('#a40-call-mode[data-alpha70-patched="1"]');
  const call = mode?.querySelector('#a40-call-button');
  const phone = mode?.querySelector('#a40-assistance-phone');
  if (!mode || !call || !phone || call.dataset.alpha71Protected === '1') return;

  call.dataset.alpha71Protected = '1';
  const note = mode.querySelector('.a40-call-head .a40-note');
  if (note) {
    note.textContent = 'La llamada se abre sin sustituir Metrogestión. Al volver tendrás esta misma ficha con todos los datos preparados.';
  }
  call.addEventListener('click', event => {
    const callPhone = cleanPhone(phone.value);
    if (!validPhone(callPhone) || call.disabled) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const draft = makeDraft(mode, callPhone);
    saveDraft(draft);
    showCallSheet(draft);
    openPhoneWithoutReplacingApp(callPhone);
  }, true);
}

function appIsReady() {
  return appView && !appView.classList.contains('hidden');
}

function restoreCallSheet() {
  protectCallButton();
  const draft = loadDraft();
  if (!draft || !appIsReady()) return;
  ensureDraftButton(draft);
  if (document.visibilityState === 'visible' && autoShownToken !== draft.startedAt) showCallSheet(draft);
}

function ensureStyle() {
  if (document.querySelector('#alpha71-call-continuity-style')) return;
  const style = document.createElement('style');
  style.id = 'alpha71-call-continuity-style';
  style.textContent = `
    .a71-call-sheet-overlay{position:fixed;z-index:9000;inset:0;display:grid;place-items:start center;padding:16px;background:rgba(15,23,42,.78);overflow:auto}
    .a71-call-sheet-panel{display:grid;gap:13px;width:min(760px,100%);margin:auto;background:#fff;border:2px solid #0ea5e9;border-radius:16px;padding:16px;box-shadow:0 24px 70px rgba(0,0,0,.38)}
    .a71-call-sheet-header{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.a71-call-sheet-header h2,.a71-call-sheet-header p{margin:0}.a71-call-instruction{font-weight:750}
    .a71-call-service{display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;padding:12px;border-radius:11px;background:#075985;color:#fff}.a71-call-service span{font-size:1.15rem;font-weight:900}
    .a71-call-sheet-rows{display:grid;gap:7px}.a71-call-sheet-row{display:grid;grid-template-columns:180px minmax(0,1fr);gap:10px;padding:9px 10px;border:1px solid #dbe5ec;border-radius:9px;background:#f8fafc}.a71-call-sheet-row span{overflow-wrap:anywhere}
    .a71-call-sheet-actions{display:flex;gap:8px;flex-wrap:wrap}.a71-call-sheet-actions .button{flex:1 1 210px}
    .a71-call-draft-button{position:fixed;z-index:8500;right:16px;bottom:16px;box-shadow:0 8px 24px rgba(15,23,42,.28)}
    @media(max-width:640px){.a71-call-sheet-overlay{padding:0}.a71-call-sheet-panel{min-height:100vh;margin:0;border-radius:0;border-width:0;padding:max(14px,env(safe-area-inset-top)) 12px max(14px,env(safe-area-inset-bottom))}.a71-call-sheet-header{flex-direction:column}.a71-call-sheet-header .button{width:100%}.a71-call-sheet-row{grid-template-columns:1fr;gap:3px}.a71-call-draft-button{right:10px;bottom:max(10px,env(safe-area-inset-bottom))}}
  `;
  document.head.append(style);
}

ensureStyle();
const observer = new MutationObserver(restoreCallSheet);
if (content) observer.observe(content, { childList: true, subtree: true });
if (appView) observer.observe(appView, { attributes: true, attributeFilter: ['class'] });
document.addEventListener('visibilitychange', restoreCallSheet);
window.addEventListener('pageshow', restoreCallSheet);
window.addEventListener('focus', restoreCallSheet);
document.querySelector('#logout-button')?.addEventListener('click', clearDraft, true);
supabase.auth.onAuthStateChange((event, session) => {
  activeUserId = session?.user?.id || '';
  if (event === 'SIGNED_OUT' || !activeUserId) clearDraft();
  else restoreCallSheet();
});
supabase.auth.getSession().then(({ data }) => {
  activeUserId = data.session?.user?.id || '';
  if (activeUserId) restoreCallSheet();
});
restoreCallSheet();
