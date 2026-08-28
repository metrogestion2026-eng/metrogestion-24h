import { supabase } from '../../r1-alpha17/src/supabase.js';
import {
  HOTEL_DOCUMENT_BUCKET,
  categoryLabel,
  el,
  formatBytes,
  modal,
} from '../../r1-alpha53/src/document-core.js';

const LINK_SECONDS = 60 * 60;
const LINK_MINUTES = LINK_SECONDS / 60;

function documentName(doc) {
  return doc?.nombre_mostrado || doc?.nombre_original || 'Documento de la T';
}

function originalFilename(doc) {
  return doc?.nombre_original || doc?.nombre_mostrado || 'documento';
}

async function createTemporaryUrl(doc) {
  const bucket = doc?.storage_bucket || HOTEL_DOCUMENT_BUCKET;
  if (!doc?.storage_path) throw new Error('El documento no tiene una ruta de almacenamiento válida.');

  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(doc.storage_path, LINK_SECONDS);

  if (error || !data?.signedUrl) {
    throw new Error(error?.message || 'No se pudo preparar el enlace temporal.');
  }
  return data.signedUrl;
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
  if (!copied) throw new Error('El navegador no permite copiar el enlace automáticamente.');
}

function supportsFileShare(doc) {
  if (!navigator.share || !navigator.canShare || typeof File !== 'function') return false;
  try {
    const probe = new File([''], originalFilename(doc), {
      type: doc?.mime_type || 'application/octet-stream',
    });
    return navigator.canShare({ files: [probe] });
  } catch {
    return false;
  }
}

async function fetchShareFile(doc, url) {
  const response = await fetch(url, { cache: 'no-store', credentials: 'omit' });
  if (!response.ok) throw new Error(`No se pudo preparar el archivo (${response.status}).`);
  const blob = await response.blob();
  return new File([blob], originalFilename(doc), {
    type: doc?.mime_type || blob.type || 'application/octet-stream',
  });
}

async function registerShare(doc, mode, expirationMinutes) {
  const { error } = await supabase.rpc('registrar_comparticion_documento_t', {
    p_documento_id: doc.id,
    p_modo: mode,
    p_caducidad_minutos: expirationMinutes,
  });
  return error?.message || '';
}

function isCancellation(error) {
  return error?.name === 'AbortError' || error?.name === 'NotAllowedError' && /cancel/i.test(error?.message || '');
}

function setButtonsDisabled(buttons, disabled) {
  buttons.forEach(button => { button.disabled = disabled; });
}

export function openDocumentShare(doc) {
  if (!doc?.id) {
    window.alert('No se puede compartir porque el documento no tiene identificador.');
    return;
  }
  if (doc.cancelado) {
    window.alert('Un documento anulado no se puede compartir. Restáuralo primero.');
    return;
  }

  const dialog = modal(`Compartir · ${documentName(doc)}`);
  const intro = el('div', null, 'a53-doc-preview-meta');
  intro.append(
    el('strong', documentName(doc)),
    el('span', `${categoryLabel(doc)} · ${formatBytes(doc.tamano_bytes)}`),
    el('p', 'Puedes enviar el archivo directamente o compartir un enlace privado temporal. El enlace caduca después de 1 hora.')
  );

  const status = el('div', 'Preparando opciones para compartir…', 'a53-doc-status');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');

  const actions = el('div', null, 'a53-modal-actions');
  const shareFile = el('button', 'Compartir archivo', 'button primary');
  const shareLink = el('button', 'Compartir enlace', 'button secondary');
  const copyLink = el('button', 'Copiar enlace', 'button secondary');
  shareFile.type = shareLink.type = copyLink.type = 'button';
  shareFile.hidden = true;
  shareLink.hidden = true;
  copyLink.disabled = true;
  actions.append(shareFile, shareLink, copyLink);
  dialog.card.append(intro, status, actions);

  const buttons = [shareFile, shareLink, copyLink];
  let temporaryUrl = '';
  let shareableFile = null;
  let preparing = true;

  const showResult = async (message, mode, expirationMinutes) => {
    const auditError = await registerShare(doc, mode, expirationMinutes);
    status.className = auditError ? 'a53-doc-status warning' : 'a53-doc-status success';
    status.textContent = auditError
      ? `${message} No se pudo registrar el movimiento en el histórico: ${auditError}`
      : message;
  };

  shareFile.addEventListener('click', async () => {
    if (preparing || !shareableFile) return;
    setButtonsDisabled(buttons, true);
    status.className = 'a53-doc-status';
    status.textContent = 'Abriendo las opciones del dispositivo…';
    try {
      await navigator.share({
        title: documentName(doc),
        text: 'Documento de una T de Metrogestión.',
        files: [shareableFile],
      });
      await showResult('✓ Archivo compartido.', 'archivo', 0);
    } catch (error) {
      if (isCancellation(error)) {
        status.className = 'a53-doc-status';
        status.textContent = 'Compartición cancelada. El documento no se ha enviado.';
      } else {
        status.className = 'a53-doc-status danger';
        status.textContent = error?.message || 'No se pudo compartir el archivo.';
      }
    } finally {
      setButtonsDisabled(buttons, false);
    }
  });

  shareLink.addEventListener('click', async () => {
    if (preparing || !temporaryUrl || !navigator.share) return;
    setButtonsDisabled(buttons, true);
    status.className = 'a53-doc-status';
    status.textContent = 'Abriendo las opciones del dispositivo…';
    try {
      await navigator.share({
        title: documentName(doc),
        text: 'Enlace temporal a un documento de una T de Metrogestión. Caduca en 1 hora.',
        url: temporaryUrl,
      });
      await showResult('✓ Enlace temporal compartido. Caducará en 1 hora.', 'enlace', LINK_MINUTES);
    } catch (error) {
      if (isCancellation(error)) {
        status.className = 'a53-doc-status';
        status.textContent = 'Compartición cancelada. El enlace no se ha enviado.';
      } else {
        status.className = 'a53-doc-status danger';
        status.textContent = error?.message || 'No se pudo compartir el enlace.';
      }
    } finally {
      setButtonsDisabled(buttons, false);
    }
  });

  copyLink.addEventListener('click', async () => {
    if (preparing || !temporaryUrl) return;
    setButtonsDisabled(buttons, true);
    status.className = 'a53-doc-status';
    status.textContent = 'Copiando enlace temporal…';
    try {
      await copyText(temporaryUrl);
      await showResult('✓ Enlace copiado. Puedes pegarlo en WhatsApp, correo u otra aplicación; caduca en 1 hora.', 'copiado', LINK_MINUTES);
    } catch (error) {
      status.className = 'a53-doc-status danger';
      status.textContent = error?.message || 'No se pudo copiar el enlace.';
    } finally {
      setButtonsDisabled(buttons, false);
    }
  });

  (async () => {
    try {
      temporaryUrl = await createTemporaryUrl(doc);
      copyLink.disabled = false;
      shareLink.hidden = !navigator.share;

      if (supportsFileShare(doc)) {
        status.className = 'a53-doc-status';
        status.textContent = 'Preparando el archivo para compartir directamente…';
        try {
          shareableFile = await fetchShareFile(doc, temporaryUrl);
          shareFile.hidden = false;
        } catch (error) {
          shareableFile = null;
          status.className = 'a53-doc-status warning';
          status.textContent = `El archivo directo no está disponible (${error.message}). Puedes compartir o copiar el enlace temporal.`;
        }
      }

      if (!status.classList.contains('warning')) {
        status.className = 'a53-doc-status success';
        status.textContent = shareableFile
          ? 'Documento preparado. Puedes compartir el archivo o utilizar un enlace temporal de 1 hora.'
          : 'Enlace temporal preparado. Caducará después de 1 hora.';
      }
    } catch (error) {
      status.className = 'a53-doc-status danger';
      status.textContent = error?.message || 'No se pudo preparar el documento para compartir.';
      setButtonsDisabled(buttons, true);
    } finally {
      preparing = false;
    }
  })();
}
