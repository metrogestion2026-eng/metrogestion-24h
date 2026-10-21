// Adaptador de Alpha75: no modifica el asistente compartido por otras versiones.
export function bindAssistanceSituation(current, result) {
  if (!current || !result || current.dataset.sit24Bound) return;
  current.dataset.sit24Bound = '1';
  if (![...current.options].some(option => option.value === 'realizada')) {
    current.append(new Option('Resuelta / realizada · vehículo operativo', 'realizada'));
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
    else if (current.value === 'realizada') change(current, 'en_curso');
    synchronizing = false;
  };
  current.addEventListener('change', () => {
    if (synchronizing) return;
    synchronizing = true;
    if (current.value === 'realizada') change(result, 'operativo_reparado');
    else if (result.value === 'operativo_reparado') change(result, 'seguimiento_abierto');
    synchronizing = false;
  });
  result.addEventListener('change', fromResult);
  fromResult();
}
export function connectWizard(root = document.querySelector('#module-content')) {
  bindAssistanceSituation(root?.querySelector('#h24-current-state'), root?.querySelector('#h24-result'));
}
const content = typeof document === 'undefined' ? null : document.querySelector('#module-content');
if (content) {
  new MutationObserver(() => connectWizard(content)).observe(content, { childList: true, subtree: true });
  connectWizard(content);
}
