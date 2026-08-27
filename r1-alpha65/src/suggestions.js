import { supabase } from '../../r1-alpha17/src/supabase.js';

const appView = document.querySelector('#app-view');
const sessionActions = document.querySelector('.session-actions');
const logoutButton = document.querySelector('#logout-button');
const nav = document.querySelector('#module-nav');

let profileCache = null;
let suggestionDialog = null;
let syncQueued = false;
let newCount = 0;

function el(tag, text = null, className = '') {
  const node = document.createElement(tag);
  if (text !== null && text !== undefined) node.textContent = String(text);
  if (className) node.className = className;
  return node;
}

function ensureStyle() {
  if (document.querySelector('#alpha65-suggestions-style')) return;
  const style = document.createElement('style');
  style.id = 'alpha65-suggestions-style';
  style.textContent = `
    .a65-suggestion-tabs{display:flex;gap:8px;flex-wrap:wrap;border-bottom:1px solid #dbe5ec;padding-bottom:10px}.a65-suggestion-tabs .active{background:#075985;color:#fff;border-color:#075985}.a65-suggestion-form{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:11px}.a65-suggestion-form label{display:grid;gap:5px;font-weight:750}.a65-suggestion-form input,.a65-suggestion-form select,.a65-suggestion-form textarea{width:100%;box-sizing:border-box;min-height:44px;padding:9px 10px;border:1px solid #aebdca;border-radius:10px;background:#fff;font:inherit}.a65-suggestion-form textarea{min-height:150px;resize:vertical}.a65-suggestion-wide{grid-column:1/-1}.a65-suggestion-context{display:grid;gap:4px;padding:10px 11px;border:1px solid #dbe5ec;border-radius:10px;background:#f8fafc}.a65-suggestion-inbox{display:grid;gap:10px}.a65-suggestion-card{display:grid;gap:9px;padding:12px;border:1px solid #dbe5ec;border-radius:12px;background:#fff}.a65-suggestion-card.new{border-color:#38bdf8;background:#f0f9ff}.a65-suggestion-head{display:flex;justify-content:space-between;gap:10px;align-items:flex-start;flex-wrap:wrap}.a65-suggestion-copy{display:grid;gap:3px;min-width:0}.a65-suggestion-meta{color:#526273;font-size:.86rem;overflow-wrap:anywhere}.a65-suggestion-message{white-space:pre-wrap;overflow-wrap:anywhere;margin:0}.a65-suggestion-card-actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center}.a65-suggestion-card-actions select{min-height:38px;padding:6px 8px;border:1px solid #aebdca;border-radius:9px;background:#fff}.a65-suggestion-badge{display:inline-flex;align-items:center;min-height:27px;padding:3px 8px;border:1px solid #cbd5e1;border-radius:999px;background:#f8fafc;font-size:.77rem;font-weight:800}.a65-suggestion-badge.nueva{border-color:#38bdf8;background:#e0f2fe;color:#075985}.a65-suggestion-badge.resuelta{border-color:#86efac;background:#dcfce7;color:#166534}.a65-suggestion-badge.descartada{border-color:#fecaca;background:#fff1f2;color:#991b1b}.a65-suggestion-email-box{display:grid;gap:10px;padding:13px;border:1px solid #86efac;border-radius:12px;background:#f0fdf4}.a65-suggestion-empty{padding:18px;border:1px dashed #cbd5e1;border-radius:12px;text-align:center;color:#64748b}@media(max-width:700px){.a65-suggestion-form{grid-template-columns:1fr}.a65-suggestion-wide{grid-column:auto}.a65-suggestion-card-actions .button,.a65-suggestion-card-actions select{width:100%}}
  `;
  document.head.append(style);
}

function profileName(profile) {
  return [profile?.nombre, profile?.apellidos].filter(Boolean).join(' ').trim()
    || profile?.correo
    || 'Usuario';
}

function isPrimary(profile) {
  return profile?.activo === true && profile?.tipo_usuario === 'administrador_principal';
}

function dateTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' });
}

function categoryLabel(value) {
  return ({
    sugerencia: 'Sugerencia',
    mejora: 'Mejora',
    incidencia: 'Incidencia de la aplicación',
    pregunta: 'Pregunta',
  })[value] || value || 'Sugerencia';
}

function stateLabel(value) {
  return ({
    nueva: 'Nueva',
    leida: 'Leída',
    en_estudio: 'En estudio',
    resuelta: 'Resuelta',
    descartada: 'Descartada',
  })[value] || value || 'Nueva';
}

function activeModule() {
  const active = nav?.querySelector('button.active');
  return active?.dataset?.module
    || active?.textContent?.trim()
    || 'Sin módulo identificado';
}

function currentVersion() {
  return document.querySelector('#app-version')?.textContent?.trim() || 'r1.0.0-alpha.65';
}

async function currentProfile(force = false) {
  if (!force && profileCache) return profileCache;
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData?.user?.id) return null;
  const { data, error } = await supabase
    .from('usuarios')
    .select('id,nombre,apellidos,correo,tipo_usuario,activo,debe_cambiar_clave')
    .eq('id', authData.user.id)
    .maybeSingle();
  if (error) throw error;
  profileCache = data || null;
  return profileCache;
}

function createDialog(title) {
  const overlay = el('div', null, 'a65-overlay');
  const card = el('section', null, 'a65-dialog');
  const head = el('div', null, 'a65-dialog-head');
  const copy = el('div');
  copy.append(el('p', 'Comunicación interna', 'eyebrow'), el('h2', title));
  const close = el('button', '×', 'a65-dialog-close');
  close.type = 'button';
  close.setAttribute('aria-label', 'Cerrar');
  head.append(copy, close);
  card.append(head);
  overlay.append(card);
  document.body.append(overlay);
  document.body.classList.add('a65-dialog-open');

  const destroy = () => {
    overlay.remove();
    suggestionDialog = null;
    if (!document.querySelector('.a65-overlay')) document.body.classList.remove('a65-dialog-open');
  };
  close.addEventListener('click', destroy);
  overlay.addEventListener('click', event => {
    if (event.target === overlay) destroy();
  });
  return { overlay, card, destroy };
}

async function copyText(value) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const field = document.createElement('textarea');
  field.value = value;
  field.setAttribute('readonly', '');
  field.style.position = 'fixed';
  field.style.opacity = '0';
  document.body.append(field);
  field.select();
  const copied = document.execCommand('copy');
  field.remove();
  if (!copied) throw new Error('No se pudo copiar automáticamente.');
}

function buildSuggestionText({ id, profile, category, subject, message, moduleId, version }) {
  return [
    `Sugerencia Metrogestión · ${id}`,
    '',
    `Tipo: ${categoryLabel(category)}`,
    `Asunto: ${subject}`,
    `Enviada por: ${profileName(profile)} · ${profile.correo || 'sin correo'}`,
    `Módulo: ${moduleId}`,
    `Versión: ${version}`,
    '',
    message,
  ].join('\n');
}

function mailtoUrl(destination, subject, body) {
  return `mailto:${encodeURIComponent(destination)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

async function markEmailPrepared(id) {
  try {
    await supabase.rpc('marcar_sugerencia_correo_preparado', { p_sugerencia_id: id });
  } catch {}
}

function renderSendForm(dialog, profile) {
  const form = el('form', null, 'a65-suggestion-form');
  form.noValidate = true;
  const category = document.createElement('select');
  category.append(
    new Option('Sugerencia', 'sugerencia'),
    new Option('Mejora', 'mejora'),
    new Option('Incidencia de la aplicación', 'incidencia'),
    new Option('Pregunta', 'pregunta')
  );
  const subject = document.createElement('input');
  subject.type = 'text';
  subject.maxLength = 140;
  subject.placeholder = 'Resumen breve';
  const message = document.createElement('textarea');
  message.maxLength = 4000;
  message.placeholder = 'Explica qué propones, qué ha fallado o qué necesitas consultar.';

  const makeField = (labelText, field, wide = false) => {
    const label = el('label');
    if (wide) label.classList.add('a65-suggestion-wide');
    label.append(el('span', labelText), field);
    return label;
  };

  const moduleId = activeModule();
  const version = currentVersion();
  const context = el('div', null, 'a65-suggestion-context a65-suggestion-wide');
  context.append(
    el('strong', `Usuario: ${profileName(profile)}`),
    el('span', `Módulo actual: ${moduleId}`, 'a65-suggestion-meta'),
    el('span', `Versión: ${version}`, 'a65-suggestion-meta')
  );
  const note = el(
    'div',
    'La sugerencia se guarda primero en Metrogestión. Después se abre un correo ya preparado dirigido al administrador; solo tendrás que pulsar Enviar en tu aplicación de correo.',
    'a65-note a65-suggestion-wide'
  );
  const status = el('div', '', 'a65-status a65-suggestion-wide');
  status.hidden = true;
  const actions = el('div', null, 'a65-actions a65-suggestion-wide');
  const cancel = el('button', 'Cancelar', 'button secondary');
  const send = el('button', 'Guardar y preparar correo', 'button primary');
  cancel.type = 'button';
  send.type = 'submit';
  cancel.addEventListener('click', dialog.destroy);
  actions.append(cancel, send);
  form.append(
    makeField('Tipo', category),
    makeField('Asunto', subject),
    makeField('Mensaje', message, true),
    context,
    note,
    status,
    actions
  );

  form.addEventListener('submit', async event => {
    event.preventDefault();
    const subjectValue = subject.value.trim();
    const messageValue = message.value.trim();
    status.hidden = false;
    status.className = 'a65-status a65-suggestion-wide';
    if (subjectValue.length < 3) {
      status.className += ' danger';
      status.textContent = 'Escribe un asunto de al menos tres caracteres.';
      subject.focus();
      return;
    }
    if (messageValue.length < 10) {
      status.className += ' danger';
      status.textContent = 'Explica la sugerencia con al menos diez caracteres.';
      message.focus();
      return;
    }

    send.disabled = true;
    status.textContent = 'Guardando la sugerencia…';
    const { data, error } = await supabase.rpc('registrar_sugerencia', {
      p_categoria: category.value,
      p_asunto: subjectValue,
      p_mensaje: messageValue,
      p_modulo: moduleId,
      p_version_app: version,
      p_pagina_url: window.location.href,
      p_agente: navigator.userAgent,
    });
    if (error) {
      send.disabled = false;
      status.className += ' danger';
      status.textContent = error.message || 'No se pudo guardar la sugerencia.';
      return;
    }

    const result = Array.isArray(data) ? data[0] : data;
    const id = result?.id || 'sin-identificador';
    const destination = result?.correo_destino || 'metrogestion2026@gmail.com';
    const body = buildSuggestionText({
      id,
      profile,
      category: category.value,
      subject: subjectValue,
      message: messageValue,
      moduleId,
      version,
    });
    const subjectMail = `[Metrogestión · ${categoryLabel(category.value)}] ${subjectValue} · ${String(id).slice(0, 8)}`;
    const url = mailtoUrl(destination, subjectMail, body);
    await markEmailPrepared(id);

    form.replaceChildren();
    const success = el('div', null, 'a65-suggestion-email-box a65-suggestion-wide');
    success.append(
      el('strong', 'Sugerencia guardada correctamente'),
      el('div', `Identificador: ${id}`, 'a65-suggestion-meta'),
      el('div', `Correo preparado para: ${destination}`, 'a65-suggestion-meta'),
      el('div', 'Se abrirá tu aplicación de correo. Revisa el mensaje y pulsa Enviar.', 'a65-note')
    );
    const resultStatus = el('div', '', 'a65-status');
    resultStatus.hidden = true;
    const resultActions = el('div', null, 'a65-actions');
    const openMail = el('a', 'Abrir correo preparado', 'button primary');
    openMail.href = url;
    const copy = el('button', 'Copiar mensaje', 'button secondary');
    const close = el('button', 'Cerrar', 'button secondary');
    copy.type = close.type = 'button';
    copy.addEventListener('click', async () => {
      try {
        await copyText(body);
        resultStatus.hidden = false;
        resultStatus.className = 'a65-status success';
        resultStatus.textContent = 'Mensaje copiado.';
      } catch (copyError) {
        resultStatus.hidden = false;
        resultStatus.className = 'a65-status danger';
        resultStatus.textContent = copyError.message;
      }
    });
    close.addEventListener('click', dialog.destroy);
    resultActions.append(openMail, copy, close);
    form.append(success, resultStatus, resultActions);
    refreshNewCount(profile);
    window.location.href = url;
  });

  dialog.card.append(form);
  queueMicrotask(() => subject.focus());
}

async function updateSuggestionState(id, state, statusNode, refresh) {
  statusNode.hidden = false;
  statusNode.className = 'a65-status';
  statusNode.textContent = 'Actualizando sugerencia…';
  const { error } = await supabase.rpc('actualizar_estado_sugerencia', {
    p_sugerencia_id: id,
    p_estado: state,
  });
  if (error) {
    statusNode.className = 'a65-status danger';
    statusNode.textContent = error.message || 'No se pudo actualizar la sugerencia.';
    return;
  }
  statusNode.className = 'a65-status success';
  statusNode.textContent = 'Estado actualizado.';
  await refresh();
}

async function renderInbox(host, profile) {
  host.replaceChildren(el('div', 'Cargando sugerencias…', 'a65-status'));
  const { data, error } = await supabase
    .from('sugerencias')
    .select('id,usuario_id,usuario_nombre,usuario_correo,categoria,asunto,mensaje,modulo,version_app,pagina_url,estado,correo_preparado_en,creado_en,actualizado_en')
    .order('creado_en', { ascending: false })
    .limit(100);
  if (error) {
    host.replaceChildren(el('div', `No se pudieron cargar las sugerencias: ${error.message}`, 'a65-status danger'));
    return;
  }

  const rows = data || [];
  const status = el('div', '', 'a65-status');
  status.hidden = true;
  const list = el('div', null, 'a65-suggestion-inbox');
  if (!rows.length) list.append(el('div', 'Todavía no se ha recibido ninguna sugerencia.', 'a65-suggestion-empty'));

  const refresh = async () => {
    await renderInbox(host, profile);
    await refreshNewCount(profile);
  };

  rows.forEach(row => {
    const card = el('article', null, `a65-suggestion-card${row.estado === 'nueva' ? ' new' : ''}`);
    const head = el('div', null, 'a65-suggestion-head');
    const copy = el('div', null, 'a65-suggestion-copy');
    copy.append(
      el('strong', row.asunto),
      el('div', `${categoryLabel(row.categoria)} · ${row.usuario_nombre || row.usuario_correo} · ${dateTime(row.creado_en)}`, 'a65-suggestion-meta'),
      el('div', `${row.modulo || 'Sin módulo'} · ${row.version_app || 'Sin versión'}${row.correo_preparado_en ? ` · Correo preparado ${dateTime(row.correo_preparado_en)}` : ' · Sin correo preparado'}`, 'a65-suggestion-meta')
    );
    head.append(copy, el('span', stateLabel(row.estado), `a65-suggestion-badge ${row.estado}`));
    const message = el('p', row.mensaje, 'a65-suggestion-message');
    const actions = el('div', null, 'a65-suggestion-card-actions');
    const state = document.createElement('select');
    [
      ['nueva', 'Nueva'],
      ['leida', 'Leída'],
      ['en_estudio', 'En estudio'],
      ['resuelta', 'Resuelta'],
      ['descartada', 'Descartada'],
    ].forEach(([value, label]) => state.append(new Option(label, value)));
    state.value = row.estado;
    const save = el('button', 'Guardar estado', 'button secondary compact');
    save.type = 'button';
    save.addEventListener('click', () => updateSuggestionState(row.id, state.value, status, refresh));
    const reply = el('a', 'Responder por correo', 'button secondary compact');
    reply.href = mailtoUrl(
      row.usuario_correo,
      `Re: ${row.asunto} · Metrogestión`,
      `Hola ${row.usuario_nombre || ''},\n\nEn relación con tu sugerencia ${row.id}:\n\n`
    );
    actions.append(state, save, reply);
    card.append(head, message, actions);
    list.append(card);
  });

  host.replaceChildren(status, list);
  newCount = rows.filter(row => row.estado === 'nueva').length;
  updateButtonLabel(profile);
}

function openSuggestions(profile) {
  suggestionDialog?.destroy?.();
  const dialog = createDialog(isPrimary(profile) ? 'Sugerencias' : 'Enviar una sugerencia');
  suggestionDialog = dialog;

  if (!isPrimary(profile)) {
    renderSendForm(dialog, profile);
    return;
  }

  const tabs = el('div', null, 'a65-suggestion-tabs');
  const inboxTab = el('button', `Recibidas${newCount ? ` · ${newCount} nuevas` : ''}`, 'button secondary compact active');
  const sendTab = el('button', 'Enviar', 'button secondary compact');
  inboxTab.type = sendTab.type = 'button';
  const host = el('div');
  const select = async name => {
    inboxTab.classList.toggle('active', name === 'inbox');
    sendTab.classList.toggle('active', name === 'send');
    host.replaceChildren();
    if (name === 'inbox') await renderInbox(host, profile);
    else renderSendForm({ ...dialog, card: host }, profile);
  };
  inboxTab.addEventListener('click', () => select('inbox'));
  sendTab.addEventListener('click', () => select('send'));
  tabs.append(inboxTab, sendTab);
  dialog.card.append(tabs, host);
  select('inbox');
}

function updateButtonLabel(profile) {
  const button = document.querySelector('#alpha65-suggestions-button');
  if (!button) return;
  button.textContent = isPrimary(profile) && newCount
    ? `💡 Sugerencias · ${newCount}`
    : '💡 Sugerencias';
  button.title = isPrimary(profile)
    ? 'Consultar sugerencias recibidas o enviar una nueva'
    : 'Enviar una sugerencia al administrador';
}

async function refreshNewCount(profile) {
  if (!isPrimary(profile)) {
    newCount = 0;
    updateButtonLabel(profile);
    return;
  }
  const { count, error } = await supabase
    .from('sugerencias')
    .select('id', { count: 'exact', head: true })
    .eq('estado', 'nueva');
  if (!error) newCount = count || 0;
  updateButtonLabel(profile);
}

function ensureSuggestionButton(profile) {
  if (!sessionActions || !profile || appView?.classList.contains('hidden') || profile.debe_cambiar_clave) return;
  let button = document.querySelector('#alpha65-suggestions-button');
  if (!button) {
    button = el('button', '💡 Sugerencias', 'button secondary compact');
    button.id = 'alpha65-suggestions-button';
    button.type = 'button';
    button.addEventListener('click', () => openSuggestions(profileCache || profile));
    const passwordButton = document.querySelector('#alpha65-password-button');
    sessionActions.insertBefore(button, passwordButton || logoutButton || null);
  }
  updateButtonLabel(profile);
}

async function syncSuggestions() {
  syncQueued = false;
  try {
    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData?.session) {
      profileCache = null;
      document.querySelector('#alpha65-suggestions-button')?.remove();
      return;
    }
    const profile = await currentProfile(true);
    if (!profile || profile.activo !== true || profile.debe_cambiar_clave === true) {
      document.querySelector('#alpha65-suggestions-button')?.remove();
      return;
    }
    ensureSuggestionButton(profile);
    await refreshNewCount(profile);
  } catch (error) {
    console.warn('No se pudo sincronizar Sugerencias de Alpha65.', error);
  }
}

function scheduleSync() {
  if (syncQueued) return;
  syncQueued = true;
  queueMicrotask(syncSuggestions);
}

ensureStyle();
if (appView) new MutationObserver(scheduleSync).observe(appView, { attributes: true, attributeFilter: ['class'] });
supabase.auth.onAuthStateChange(() => {
  profileCache = null;
  scheduleSync();
});
scheduleSync();
