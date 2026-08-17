import {
  SUPABASE_PUBLISHABLE_KEY,
  SUPABASE_URL
} from './config.js';

const FUNCTION_URL = `${SUPABASE_URL}/functions/v1/bootstrap-admin-r1`;

const dom = {
  view: document.querySelector('#bootstrap-view'),
  account: document.querySelector('#bootstrap-account'),
  code: document.querySelector('#bootstrap-code'),
  password: document.querySelector('#bootstrap-password'),
  confirm: document.querySelector('#bootstrap-password-confirm'),
  button: document.querySelector('#bootstrap-button'),
  message: document.querySelector('#bootstrap-message'),
  loginEmail: document.querySelector('#login-email'),
  loginMessage: document.querySelector('#login-message')
};

function headers(includeJson = false) {
  return {
    apikey: SUPABASE_PUBLISHABLE_KEY,
    Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
    ...(includeJson ? { 'Content-Type': 'application/json' } : {})
  };
}

function setMessage(message = '', success = false) {
  dom.message.textContent = message;
  dom.message.classList.toggle('success', success);
}

async function readStatus() {
  try {
    const response = await fetch(FUNCTION_URL, {
      method: 'GET',
      headers: headers(),
      cache: 'no-store'
    });
    const result = await response.json().catch(() => ({}));

    if (!response.ok || result.open !== true) {
      dom.view.classList.add('hidden');
      return;
    }

    dom.account.textContent = result.account || 'cuenta autorizada';
    dom.view.classList.remove('hidden');

    if (result.locked === true) {
      dom.button.disabled = true;
      setMessage('La activación está temporalmente bloqueada por intentos incorrectos.');
    }
  } catch {
    dom.view.classList.add('hidden');
  }
}

async function createAdministrator() {
  const code = dom.code.value.trim().toUpperCase();
  const password = dom.password.value;
  const confirmation = dom.confirm.value;

  setMessage('');

  if (!code) {
    setMessage('Introduce el código de activación.');
    return;
  }

  if (password.length < 10) {
    setMessage('La contraseña de pruebas debe tener al menos 10 caracteres.');
    return;
  }

  if (password !== confirmation) {
    setMessage('Las dos contraseñas no coinciden.');
    return;
  }

  dom.button.disabled = true;
  setMessage('Creando la cuenta segura de pruebas…');

  try {
    const response = await fetch(FUNCTION_URL, {
      method: 'POST',
      headers: headers(true),
      body: JSON.stringify({ code, password }),
      cache: 'no-store'
    });
    const result = await response.json().catch(() => ({}));

    if (!response.ok) {
      setMessage(result.error || 'No se pudo crear la cuenta de pruebas.');
      return;
    }

    dom.code.value = '';
    dom.password.value = '';
    dom.confirm.value = '';
    setMessage(result.message || 'Administrador de pruebas creado.', true);

    if (result.email) dom.loginEmail.value = result.email;
    if (dom.loginMessage) {
      dom.loginMessage.textContent = 'Cuenta de pruebas creada. Introduce la contraseña y pulsa Entrar.';
      dom.loginMessage.classList.add('success');
    }

    setTimeout(() => dom.view.classList.add('hidden'), 1200);
  } catch {
    setMessage('No se pudo conectar con la activación segura.');
  } finally {
    dom.button.disabled = false;
  }
}

[dom.code, dom.password, dom.confirm].forEach(input => {
  input.addEventListener('keydown', event => {
    if (event.key === 'Enter') event.preventDefault();
  });
});

dom.button.addEventListener('click', createAdministrator);
readStatus();
