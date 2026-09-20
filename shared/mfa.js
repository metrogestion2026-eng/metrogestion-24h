import { supabase } from '../r1-alpha17/src/supabase.js';
import { secondFactorState, verifySecondFactor } from './mfa-state.js';

const mfa = supabase.auth.mfa;
let pendingChallenge = null;
let settingsOpen = false;

function element(tag, text = '') {
  const node = document.createElement(tag);
  node.textContent = text;
  return node;
}

function dialog(title) {
  if (!document.querySelector('#mfa-style')) {
    const style = element('style', '.mfa-dialog{width:min(520px,90vw);box-sizing:border-box;padding:24px;border:1px solid #cbd5e1;border-radius:16px;color:#0f172a;background:white}.mfa-dialog::backdrop{background:#0f172aaa}.mfa-dialog form,.mfa-dialog label{display:grid;gap:12px}.mfa-dialog input,.mfa-dialog select,.mfa-dialog button{font:inherit;min-height:44px;padding:8px;max-width:100%;box-sizing:border-box}.mfa-dialog img{display:block;width:220px;height:220px;max-width:100%;margin:auto}.mfa-dialog .mfa-error{color:#991b1b}.mfa-dialog .mfa-actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:16px}.mfa-dialog output{overflow-wrap:anywhere;user-select:all}');
    style.id = 'mfa-style';
    document.head.append(style);
  }
  const node = element('dialog');
  node.className = 'mfa-dialog';
  const heading = element('h2', title);
  heading.id = 'mfa-dialog-title';
  node.setAttribute('aria-labelledby', heading.id);
  node.append(heading);
  document.body.append(node);
  node.showModal();
  return node;
}

function codeForm(node, getFactor, success, setBusy = () => {}) {
  const form = element('form');
  const label = element('label', 'Código de autenticación');
  const input = element('input');
  input.type = 'text';
  input.inputMode = 'numeric';
  input.autocomplete = 'one-time-code';
  input.pattern = '[0-9]{6}';
  input.maxLength = 6;
  input.required = true;
  label.append(input);
  const status = element('p');
  status.className = 'mfa-error';
  status.setAttribute('role', 'status');
  const submit = element('button', 'Verificar código');
  submit.type = 'submit';
  form.append(label, status, submit);
  node.append(form);
  form.addEventListener('submit', async event => {
    event.preventDefault();
    submit.disabled = true;
    setBusy(true);
    try {
      await verifySecondFactor(mfa, getFactor(), input.value.trim());
      input.value = '';
      await success();
    } catch (error) {
      status.textContent = error.message;
      input.value = '';
      input.focus();
    } finally { submit.disabled = false; setBusy(false); }
  });
  input.focus();
}

export async function ensureSecondFactor() {
  if (pendingChallenge) return pendingChallenge;
  pendingChallenge = (async () => {
    const state = await secondFactorState(mfa);
    if (!state.required) return;
    if (!state.totp.length) throw new Error('Esta cuenta requiere un segundo factor no disponible en esta pantalla. Contacta con el administrador.');
    await new Promise((resolve, reject) => {
      let busy = false;
      const node = dialog('Verifica tu identidad');
      node.append(element('p', 'Introduce el código de tu aplicación de autenticación para acceder a Metrogestión.'));
      const label = element('label', 'Dispositivo de autenticación');
      const select = element('select');
      for (const factor of state.totp) {
        const option = element('option', factor.friendly_name || 'Autenticador');
        option.value = factor.id;
        select.append(option);
      }
      label.append(select);
      node.append(label);
      const cancel = element('button', 'Cancelar acceso');
      cancel.type = 'button';
      codeForm(node, () => select.value, () => { node.remove(); resolve(); }, value => { busy = value; cancel.disabled = value; select.disabled = value; });
      const dismiss = () => { if (busy) return; node.remove(); reject(new Error('Acceso cancelado. No se ha verificado el segundo factor.')); };
      cancel.addEventListener('click', dismiss);
      node.addEventListener('cancel', event => { event.preventDefault(); dismiss(); });
      node.append(element('p', 'Si has perdido el autenticador, contacta con el administrador para recuperar tu acceso.'), cancel);
    });
  })();
  try { await pendingChallenge; } finally { pendingChallenge = null; }
}

async function openSettings() {
  if (settingsOpen) return;
  settingsOpen = true;
  let node;
  let unverifiedId = null;
  let busy = false;
  const close = async () => {
    if (busy) return;
    if (unverifiedId) {
      const { error } = await mfa.unenroll({ factorId: unverifiedId });
      if (error) throw new Error('No se pudo cancelar la vinculación. Vuelve a pulsar Cerrar.');
      unverifiedId = null;
    }
    node?.remove();
    settingsOpen = false;
  };
  try {
    await ensureSecondFactor();
    const state = await secondFactorState(mfa);
    node = dialog('Segundo factor de acceso');
    const status = element('p');
    status.className = 'mfa-error';
    status.setAttribute('role', 'status');
    const body = element('div');
    node.append(body, status);
    const closeButton = element('button', 'Cerrar');
    closeButton.type = 'button';
    const dismiss = async () => { try { await close(); } catch (error) { status.textContent = error.message; } };
    closeButton.addEventListener('click', dismiss);
    node.addEventListener('cancel', event => { event.preventDefault(); void dismiss(); });
    node.append(closeButton);
    body.append(element('p', state.verified.length ? 'Tu cuenta tiene segundo factor activado.' : 'Añade una aplicación de autenticación en tu móvil. Solo se activará cuando confirmes su código.'));
    for (const factor of state.verified) {
      const row = element('p', factor.friendly_name || 'Autenticador');
      const remove = element('button', 'Retirar este autenticador');
      remove.type = 'button';
      remove.addEventListener('click', async () => {
        if (!window.confirm('¿Retirar este autenticador? Si es el último, tu cuenta quedará sin segundo factor.')) return;
        remove.disabled = true;
        try {
          const { error } = await mfa.unenroll({ factorId: factor.id });
          if (error) throw new Error('No se pudo retirar el autenticador.');
          const { error: refreshError } = await supabase.auth.refreshSession();
          if (refreshError) throw new Error('Vuelve a iniciar sesión para actualizar la seguridad.');
          window.location.reload();
        } catch (error) { status.textContent = error.message; remove.disabled = false; }
      });
      row.append(remove);
      body.append(row);
    }
    const add = element('button', 'Vincular autenticador');
    add.type = 'button';
    body.append(add);
    add.addEventListener('click', async () => {
      add.disabled = true;
      busy = true;
      closeButton.disabled = true;
      try {
        const { data, error } = await mfa.enroll({ factorType: 'totp', friendlyName: `Metrogestión ${new Date().toISOString().slice(0, 19)}` });
        if (error || !data?.totp) throw new Error('No se pudo iniciar la vinculación del autenticador.');
        unverifiedId = data.id;
        body.replaceChildren(element('p', 'Escanea este QR con tu aplicación de autenticación. Guarda su copia de seguridad en un lugar seguro antes de continuar. No compartas el QR ni la clave.'));
        const qr = element('img');
        qr.alt = 'Código QR para vincular el autenticador';
        if (!data.totp.qr_code.startsWith('data:image/svg+xml')) throw new Error('Formato de QR no válido.');
        qr.src = data.totp.qr_code;
        const details = element('details');
        details.append(element('summary', 'Introducir la clave manualmente'), element('output', data.totp.secret));
        body.append(qr, details);
        codeForm(body, () => unverifiedId, () => { unverifiedId = null; window.location.reload(); }, value => { busy = value; closeButton.disabled = value; });
      } catch (error) { status.textContent = error.message; add.disabled = false; }
      finally { busy = false; closeButton.disabled = false; }
    });
  } catch (error) {
    node?.remove();
    settingsOpen = false;
    window.alert(error.message);
  }
}

export function ensureMfaButton(profile) {
  const actions = document.querySelector('.session-actions');
  if (!actions || !profile?.activo || document.querySelector('#app-view')?.classList.contains('hidden')) return;
  if (document.querySelector('#mfa-settings-button')) return;
  const button = element('button', 'Segundo factor');
  button.type = 'button';
  button.id = 'mfa-settings-button';
  button.className = 'button secondary compact';
  button.addEventListener('click', openSettings);
  actions.insertBefore(button, document.querySelector('#logout-button'));
}
