import '../../r1-alpha60/src/app.js';
import { supabase } from '../../r1-alpha17/src/supabase.js';

const VERSION = 'r1.0.0-alpha.61';
const versionNode = document.querySelector('#app-version');
if (versionNode) versionNode.textContent = VERSION;

const nav = document.querySelector('#module-nav');
const content = document.querySelector('#module-content');

let profilePromise = null;
let enforcementQueued = false;
let enforcing = false;

function profileName(profile) {
  return [profile?.nombre, profile?.apellidos].filter(Boolean).join(' ').trim()
    || profile?.correo
    || 'Usuario';
}

function isPrimaryAdmin(profile) {
  return profile?.activo === true && profile?.tipo_usuario === 'administrador_principal';
}

async function currentProfile(force = false) {
  if (!force && profilePromise) return profilePromise;

  const request = (async () => {
    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError || !authData?.user?.id) return null;

    const { data, error } = await supabase
      .from('usuarios')
      .select('id,nombre,apellidos,correo,tipo_usuario,permisos,activo')
      .eq('id', authData.user.id)
      .maybeSingle();

    if (error) throw error;
    return data || null;
  })();

  profilePromise = request;
  try {
    return await request;
  } catch (error) {
    if (profilePromise === request) profilePromise = null;
    throw error;
  }
}

function ensureStyle() {
  if (document.querySelector('#alpha61-permission-style')) return;

  const style = document.createElement('style');
  style.id = 'alpha61-permission-style';
  style.textContent = `
    body.alpha61-standard-user [data-alpha51-users],
    body.alpha61-standard-user .alpha31-editor,
    body.alpha61-standard-user .alpha31-r-config {
      display: none !important;
    }
  `;
  document.head.append(style);
}

function removeUsersAuthorisationControls() {
  content?.querySelectorAll('button').forEach(button => {
    const label = String(button.textContent || '').trim();
    if (
      /autorizar pestaña usuarios/i.test(label)
      || /retirar acceso a usuarios/i.test(label)
    ) {
      button.remove();
    }
  });

  content?.querySelectorAll('.a51-section .muted, .a51-security-note, .a51-readonly').forEach(node => {
    const text = String(node.textContent || '').trim();

    if (
      text === 'La cuenta se crea sin acceso a la pestaña Usuarios. Esa autorización se concede después y de forma expresa.'
      || text === 'La cuenta se crea con las áreas operativas en modo lectura, Usuarios bloqueado para edición y Activar 24H habilitado para consultar y editar.'
    ) {
      node.textContent = 'La cuenta se crea con las áreas operativas en modo lectura y Activar 24H habilitado para consultar y editar. Usuarios es exclusivo del administrador principal.';
    }

    if (/visible únicamente para el administrador principal y las personas autorizadas expresamente/i.test(text)) {
      node.textContent = 'Usuarios es una pestaña exclusiva del administrador principal.';
    }

    if (/la pestaña no se muestra a quien no tenga permiso/i.test(text)) {
      node.textContent = 'La información de usuarios y dispositivos solo puede consultarla el administrador principal.';
    }
  });
}

function removeUsersPanelSection() {
  content?.querySelectorAll('.a52-section').forEach(section => {
    const title = section.querySelector('h3')?.textContent?.trim();
    if (title === 'Usuarios y accesos') section.remove();
  });
}

function removeManualBillingEditors() {
  content?.querySelectorAll('.alpha31-editor, .alpha31-r-config').forEach(node => node.remove());

  content?.querySelectorAll('button').forEach(button => {
    const label = String(button.textContent || '').trim();
    if (
      /guardar media manual/i.test(label)
      || /volver a automático/i.test(label)
      || /guardar precio r/i.test(label)
    ) {
      button.closest('.alpha31-editor, .alpha31-r-config')?.remove();
      button.remove();
    }
  });
}

function leaveUsersView() {
  const heading = content?.querySelector('.a51-view h2');
  if (heading?.textContent?.trim() !== 'Usuarios') return;

  const fallback =
    nav?.querySelector('[data-module="hotel"]')
    || nav?.querySelector('[data-alpha34-24h]')
    || nav?.querySelector('[data-h47-24h]')
    || [...(nav?.querySelectorAll('button') || [])].find(button => !button.matches('[data-alpha51-users]'));

  if (fallback) {
    queueMicrotask(() => fallback.click());
  } else if (content) {
    content.replaceChildren();
  }
}

async function enforcePermissions() {
  if (enforcing) return;
  enforcing = true;

  try {
    ensureStyle();
    const profile = await currentProfile();
    const admin = isPrimaryAdmin(profile);

    document.body.classList.toggle('alpha61-standard-user', Boolean(profile) && !admin);

    // El administrador conserva Usuarios, pero ya no puede conceder esa pestaña a otras cuentas.
    removeUsersAuthorisationControls();

    if (!profile || admin) return;

    nav?.querySelector('[data-alpha51-users]')?.remove();
    removeUsersPanelSection();
    removeManualBillingEditors();
    leaveUsersView();
  } catch (error) {
    console.warn('No se pudieron aplicar los límites de usuario de Alpha61.', error);
  } finally {
    enforcing = false;
  }
}

function scheduleEnforcement() {
  if (enforcementQueued) return;
  enforcementQueued = true;

  queueMicrotask(async () => {
    enforcementQueued = false;
    await enforcePermissions();
  });
}

if (nav) {
  new MutationObserver(scheduleEnforcement).observe(nav, { childList: true, subtree: true });
}
if (content) {
  new MutationObserver(scheduleEnforcement).observe(content, { childList: true, subtree: true });
}

supabase.auth.onAuthStateChange(event => {
  if (event === 'SIGNED_OUT') {
    profilePromise = null;
    document.body.classList.remove('alpha61-standard-user');
  }
  if (event === 'SIGNED_IN' || event === 'USER_UPDATED' || event === 'TOKEN_REFRESHED') {
    profilePromise = null;
    scheduleEnforcement();
  }
});

scheduleEnforcement();
