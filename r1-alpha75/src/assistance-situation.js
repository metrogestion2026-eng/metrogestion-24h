import { assistanceWizardExtension, isAssistanceComplete } from './assistance-completion.js?v=75.25-paradas-002';

// Realizada describe la asistencia, no la operatividad ni la recuperación.
export function bindAssistanceSituation(current, result) {
  if (!current || !result || current.dataset.sit24Bound) return;
  current.dataset.sit24Bound = '1';
  if (![...current.options].some(option => option.value === 'realizada')) {
    current.append(new Option('Asistencia 24H finalizada', 'realizada'));
  }
  let synchronizing = false;
  const change = (control, value) => {
    if (control.value === value) return;
    control.value = value;
    control.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const fromResult = () => {
    if (synchronizing) return;
    synchronizing = true;
    if (result.value === 'operativo_reparado') change(current, 'realizada');
    synchronizing = false;
  };
  current.addEventListener('change', () => {
    if (synchronizing) return;
    synchronizing = true;
    if (current.value !== 'realizada' && result.value === 'operativo_reparado') change(result, 'seguimiento_abierto');
    synchronizing = false;
  });
  result.addEventListener('change', fromResult);
  fromResult();
}
export function connectWizard(root = document.querySelector('#module-content')) {
  const current = root?.querySelector('#h24-current-state');
  const result = root?.querySelector('#h24-result');
  if (!current || !result) return;
  const transferred = root.querySelector('#h24-transfer');
  const reflectTransfer = () => {
    if (result.value !== 'trasladado_taller' || !transferred || transferred.checked) return false;
    transferred.checked = true;
    // El handler compartido actualiza también el borrador y vuelve a dibujar.
    transferred.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  };
  if (reflectTransfer()) return;
  bindAssistanceSituation(current, result);
  if (current.dataset.completionBound) return;
  current.dataset.completionBound = '1';
  transferred?.addEventListener('change', reflectTransfer);
  const date = root.querySelector('#h24-repair-end-date');
  const time = root.querySelector('#h24-repair-end');
  const transfer = [...result.options].find(option => option.value === 'trasladado_taller');
  if (transfer) transfer.textContent = 'Trasladado a taller · parada de taller independiente';
  const update = () => {
    const complete = isAssistanceComplete({ estado_seguimiento: current.value, resultado: result.value });
    for (const [control, label] of [[date, 'Fecha de fin de asistencia'], [time, 'Hora de fin de asistencia']]) {
      const holder = control?.closest('label');
      holder?.classList.toggle('h24-hidden', !complete);
      const caption = holder?.querySelector('span');
      if (caption) caption.textContent = label;
    }
    const save = root.querySelector('.h24-nav .button.primary');
    if (save) save.textContent = complete ? 'Guardar asistencia finalizada' : 'Guardar seguimiento';
  };
  current.addEventListener('change', update);
  result.addEventListener('change', update);
  update();
}
const content = typeof document === 'undefined' ? null : document.querySelector('#module-content');
if (content) {
  content.addEventListener('metrogestion:24h-extension', event => {
    const request = event.detail;
    request.value = assistanceWizardExtension(request.action, request);
  });
  new MutationObserver(() => connectWizard(content)).observe(content, { childList: true, subtree: true });
  connectWizard(content);
}
