import '../../r1-alpha59/src/app.js';
import { supabase } from '../../r1-alpha17/src/supabase.js';

const VERSION = 'r1.0.0-alpha.60';
const versionNode = document.querySelector('#app-version');
if (versionNode) versionNode.textContent = VERSION;

const nav = document.querySelector('#module-nav');
const content = document.querySelector('#module-content');

let profilePromise = null;
let syncQueued = false;

function permissionView(permission = {}) {
  return permission.ver === true || permission.leer === true || permission.editar === true;
}

async function getCurrentProfile() {
  if (profilePromise) return profilePromise;
  profilePromise = (async () => {
    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError || !authData?.user) return null;
    const { data, error } = await supabase
      .from('usuarios')
      .select('id,tipo_usuario,permisos,activo')
      .eq('id', authData.user.id)
      .maybeSingle();
    if (error) throw error;
    return data || null;
  })();
  return profilePromise;
}

function patchCreateUserExplanation() {
  const oldText = 'La cuenta se crea sin acceso a la pestaña Usuarios. Esa autorización se concede después y de forma expresa.';
  const newText = 'La cuenta se crea con las áreas operativas en modo lectura, Usuarios bloqueado para edición y Activar 24H habilitado para consultar y editar.';
  content?.querySelectorAll('.a51-section .muted').forEach(node => {
    if (node.textContent?.trim() === oldText) node.textContent = newText;
  });
}

async function patchPermissionInterface() {
  try {
    const profile = await getCurrentProfile();
    if (!profile?.activo) return;

    const primary = profile.tipo_usuario === 'administrador_principal';
    const usersPermission = profile.permisos?.usuarios || {};
    const usersButton = nav?.querySelector('[data-alpha51-users]');

    if (usersButton) {
      const usersReadOnly = !primary && permissionView(usersPermission) && usersPermission.editar !== true;
      const nextLabel = usersReadOnly ? '🔒 Usuarios' : '👥 Usuarios';
      if (usersButton.textContent !== nextLabel) usersButton.textContent = nextLabel;
      usersButton.dataset.alpha60UsersLocked = usersReadOnly ? 'true' : 'false';
      usersButton.title = usersReadOnly
        ? 'Usuarios · solo lectura. Crear cuentas, bloquear y cambiar permisos está reservado al administrador principal.'
        : 'Administrar usuarios y autorizaciones';
      usersButton.setAttribute(
        'aria-label',
        usersReadOnly ? 'Usuarios, solo lectura' : 'Usuarios y autorizaciones'
      );
    }

    nav?.querySelectorAll('button[data-module]').forEach(button => {
      const moduleId = button.dataset.module;
      if (!moduleId || moduleId === 'usuarios-alpha51' || primary) return;
      const permission = profile.permisos?.[moduleId] || {};
      if (!permissionView(permission)) return;
      const readOnly = permission.editar !== true;
      button.dataset.alpha60ReadOnly = readOnly ? 'true' : 'false';
      if (readOnly && !button.title?.toLocaleLowerCase('es-ES').includes('solo lectura')) {
        button.title = 'Solo lectura';
      }
    });

    patchCreateUserExplanation();
  } catch (error) {
    console.warn('No se pudieron actualizar los indicadores de permisos de Alpha60.', error);
  }
}

function schedulePermissionSync() {
  if (syncQueued) return;
  syncQueued = true;
  queueMicrotask(async () => {
    syncQueued = false;
    await patchPermissionInterface();
  });
}

if (nav) {
  new MutationObserver(schedulePermissionSync).observe(nav, { childList: true, subtree: true });
}
if (content) {
  new MutationObserver(schedulePermissionSync).observe(content, { childList: true, subtree: true });
}

supabase.auth.onAuthStateChange(event => {
  if (event === 'SIGNED_OUT') profilePromise = null;
  if (event === 'SIGNED_IN' || event === 'USER_UPDATED') {
    profilePromise = null;
    schedulePermissionSync();
  }
});

schedulePermissionSync();
