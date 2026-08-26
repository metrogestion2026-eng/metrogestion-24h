import { supabase } from '../../r1-alpha17/src/supabase.js';
import {
  HOTEL_DOCUMENT_BUCKET,
  MAX_DOCUMENT_BYTES,
  ALLOWED_MIME,
  DOCUMENT_SELECT,
  el,
  isImage,
  normaliseMime,
  safeFilename,
  randomId,
} from '../../r1-alpha53/src/document-core.js';
import { documentCard } from '../../r1-alpha53/src/document-card.js';

let globalDropGuardInstalled = false;

function hasFilePayload(event) {
  const types = Array.from(event?.dataTransfer?.types || []);
  return types.includes('Files');
}

function installGlobalDropGuard() {
  if (globalDropGuardInstalled) return;
  globalDropGuardInstalled = true;

  const preventFileNavigation = event => {
    if (!hasFilePayload(event)) return;
    event.preventDefault();
  };

  document.addEventListener('dragover', preventFileNavigation, false);
  document.addEventListener('drop', preventFileNavigation, false);
}

installGlobalDropGuard();

async function uploadFiles(stage, files, description, status) {
  const uploaded = [];

  for (const file of files) {
    const mime = normaliseMime(file);
    if (!ALLOWED_MIME.has(mime)) {
      throw new Error(`${file.name}: formato no permitido. Utiliza PDF, JPG, PNG, WEBP, HEIC o HEIF.`);
    }
    if (!file.size || file.size > MAX_DOCUMENT_BYTES) {
      throw new Error(`${file.name}: el archivo debe ocupar como máximo 25 MB.`);
    }

    const path = `etapas/${stage.grupo_documental_id}/${Date.now()}-${randomId()}-${safeFilename(file.name)}`;
    status.textContent = `Subiendo ${file.name}…`;

    const { error: uploadError } = await supabase.storage
      .from(HOTEL_DOCUMENT_BUCKET)
      .upload(path, file, {
        cacheControl: '3600',
        upsert: false,
        contentType: mime,
      });

    if (uploadError) throw new Error(`${file.name}: ${uploadError.message}`);

    const { error: registerError } = await supabase.rpc('registrar_documento_t', {
      p_etapa_id: stage.id,
      p_nombre_original: file.name,
      p_nombre_mostrado: file.name,
      p_storage_path: path,
      p_mime_type: mime,
      p_tamano_bytes: file.size,
      p_descripcion: description,
    });

    if (registerError) {
      await supabase.storage.from(HOTEL_DOCUMENT_BUCKET).remove([path]);
      throw new Error(`${file.name}: ${registerError.message}`);
    }

    uploaded.push(file.name);
  }

  return uploaded;
}

export function createStageDocuments(stage, {
  canEdit = false,
  documents = [],
  context = '',
  onChanged = null,
} = {}) {
  const root = el('details', null, 'a53-stage-documents');
  const summary = el('summary', null, 'a53-stage-doc-summary');
  const body = el('div', null, 'a53-stage-doc-body');
  root.append(summary, body);

  let currentDocuments = Array.isArray(documents) ? documents.slice() : [];
  let loading = false;

  const reload = async () => {
    if (!stage?.grupo_documental_id || loading) return;
    loading = true;

    try {
      const { data, error } = await supabase
        .from('documentos_gestion')
        .select(DOCUMENT_SELECT)
        .eq('grupo_etapa_id', stage.grupo_documental_id)
        .order('creado_en', { ascending: false });

      if (error) throw error;
      currentDocuments = data || [];
      draw();
      if (typeof onChanged === 'function') onChanged(currentDocuments);
    } catch (error) {
      body.replaceChildren(el('div', `No se pudieron cargar los archivos: ${error.message}`, 'a53-doc-status danger'));
    } finally {
      loading = false;
    }
  };

  const draw = () => {
    const active = currentDocuments.filter(doc => !doc.cancelado);
    const cancelled = currentDocuments.filter(doc => doc.cancelado);
    const photos = active.filter(isImage).length;
    const pdfs = active.length - photos;

    summary.replaceChildren(
      el('span', '📎 Documentos de esta T'),
      el(
        'span',
        `${active.length} activo${active.length === 1 ? '' : 's'} · ${photos} foto${photos === 1 ? '' : 's'} · ${pdfs} PDF`,
        'a53-doc-count'
      )
    );

    body.replaceChildren();
    if (context) body.append(el('div', context, 'a53-doc-context'));

    const list = el('div', null, 'a53-doc-list');
    if (!active.length) {
      list.append(el('div', 'Esta T todavía no tiene PDF ni fotografías.', 'a53-empty'));
    }
    active.forEach(doc => list.append(documentCard(doc, canEdit, reload)));
    body.append(list);

    if (canEdit) {
      const uploader = el('section', null, 'a53-uploader a55-uploader');
      const description = document.createElement('input');
      description.type = 'text';
      description.maxLength = 500;
      description.placeholder = 'Descripción opcional para los archivos';

      const fileInput = document.createElement('input');
      fileInput.type = 'file';
      fileInput.accept = 'application/pdf,image/jpeg,image/png,image/webp,image/heic,image/heif,.pdf,.jpg,.jpeg,.png,.webp,.heic,.heif';
      fileInput.multiple = true;
      fileInput.hidden = true;

      const cameraInput = document.createElement('input');
      cameraInput.type = 'file';
      cameraInput.accept = 'image/*';
      cameraInput.capture = 'environment';
      cameraInput.hidden = true;

      const dropZone = el('button', null, 'a55-drop-zone');
      dropZone.type = 'button';
      dropZone.setAttribute('aria-label', 'Arrastrar PDF o fotografías a esta T, o pulsar para seleccionarlos');
      dropZone.append(
        el('span', '⇩', 'a55-drop-icon'),
        el('strong', 'Arrastra aquí PDF o fotos'),
        el('span', 'También puedes hacer clic para seleccionarlos', 'a55-drop-help')
      );

      const choose = el('button', '📎 Añadir PDF o fotos', 'button primary compact');
      const camera = el('button', '📷 Hacer foto', 'button secondary compact');
      choose.type = 'button';
      camera.type = 'button';

      const status = el(
        'div',
        'Máximo 25 MB por archivo. Puedes arrastrar varios archivos a la vez.',
        'a53-doc-status'
      );
      status.setAttribute('aria-live', 'polite');

      const controls = el('div', null, 'a53-upload-actions');
      controls.append(choose, camera, fileInput, cameraInput);
      uploader.append(description, dropZone, controls, status);
      body.append(uploader);

      const setBusy = busy => {
        choose.disabled = busy;
        camera.disabled = busy;
        dropZone.disabled = busy;
        dropZone.classList.toggle('is-uploading', busy);
        dropZone.setAttribute('aria-busy', busy ? 'true' : 'false');
      };

      const resetDragState = () => {
        dropZone.classList.remove('is-dragging');
      };

      const handleFiles = async filesInput => {
        const files = Array.from(filesInput || []).filter(file => file instanceof File);
        if (!files.length) {
          status.className = 'a53-doc-status danger';
          status.textContent = 'No se ha detectado ningún archivo válido.';
          return;
        }

        setBusy(true);
        status.className = 'a53-doc-status';
        status.textContent = `${files.length} archivo${files.length === 1 ? '' : 's'} preparado${files.length === 1 ? '' : 's'} para cargar…`;

        try {
          const uploaded = await uploadFiles(stage, files, description.value.trim(), status);
          status.className = 'a53-doc-status success';
          status.textContent = `${uploaded.length} archivo${uploaded.length === 1 ? '' : 's'} añadido${uploaded.length === 1 ? '' : 's'} correctamente.`;
          description.value = '';
          fileInput.value = '';
          cameraInput.value = '';
          await reload();
          root.open = true;
        } catch (error) {
          status.className = 'a53-doc-status danger';
          status.textContent = error?.message || 'No se pudieron subir los archivos.';
        } finally {
          setBusy(false);
        }
      };

      choose.addEventListener('click', () => fileInput.click());
      camera.addEventListener('click', () => cameraInput.click());
      dropZone.addEventListener('click', () => fileInput.click());
      fileInput.addEventListener('change', () => handleFiles(fileInput.files));
      cameraInput.addEventListener('change', () => handleFiles(cameraInput.files));

      dropZone.addEventListener('dragenter', event => {
        if (!hasFilePayload(event)) return;
        event.preventDefault();
        event.stopPropagation();
        dropZone.classList.add('is-dragging');
      });

      dropZone.addEventListener('dragover', event => {
        if (!hasFilePayload(event)) return;
        event.preventDefault();
        event.stopPropagation();
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
        dropZone.classList.add('is-dragging');
      });

      dropZone.addEventListener('dragleave', event => {
        event.preventDefault();
        event.stopPropagation();
        if (!dropZone.contains(event.relatedTarget)) resetDragState();
      });

      dropZone.addEventListener('drop', event => {
        if (!hasFilePayload(event)) return;
        event.preventDefault();
        event.stopPropagation();
        resetDragState();
        handleFiles(event.dataTransfer?.files || []);
      });
    }

    if (cancelled.length) {
      const old = el('details', null, 'a53-cancelled-documents');
      old.append(el('summary', `Archivos anulados · ${cancelled.length}`));
      const oldList = el('div', null, 'a53-doc-list');
      cancelled.forEach(doc => oldList.append(documentCard(doc, canEdit, reload)));
      old.append(oldList);
      body.append(old);
    }
  };

  if (!stage?.grupo_documental_id) {
    summary.append(
      el('span', '📎 Documentos de esta T'),
      el('span', 'Identidad documental no disponible', 'a53-doc-count')
    );
    body.append(el('div', 'No se puede vincular un archivo porque esta T no tiene identidad documental.', 'a53-doc-status danger'));
    return root;
  }

  draw();
  return root;
}

export function summarizeDocuments(documents) {
  const active = (documents || []).filter(doc => !doc.cancelado);
  return {
    total: active.length,
    photos: active.filter(isImage).length,
    pdfs: active.filter(doc => !isImage(doc)).length,
    cancelled: (documents || []).filter(doc => doc.cancelado).length,
  };
}
