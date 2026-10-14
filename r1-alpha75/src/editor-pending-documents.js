import { element } from '../../r1-alpha17/src/dom.js';
import { supabase } from '../../r1-alpha17/src/supabase.js';
import {
  ALLOWED_MIME,
  HOTEL_DOCUMENT_BUCKET,
  MAX_DOCUMENT_BYTES,
  normaliseMime,
  randomId,
  safeFilename,
} from '../../r1-alpha53/src/document-core.js';

function filesFrom(input) {
  return Array.from(input || []).filter(file => file instanceof File);
}

function fileSignature(file) {
  return [file.name, file.size, file.lastModified || 0].join('|');
}

function formatSize(bytes) {
  const value = Number(bytes || 0);
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toLocaleString('es-ES', { maximumFractionDigits: 1 })} KB`;
  return `${(value / 1024 ** 2).toLocaleString('es-ES', { maximumFractionDigits: 1 })} MB`;
}

function validateFile(file) {
  const mime = normaliseMime(file);
  if (!ALLOWED_MIME.has(mime)) {
    throw new Error(`${file.name}: formato no permitido. Utiliza PDF, JPG, PNG, WEBP, HEIC o HEIF.`);
  }
  if (!file.size || file.size > MAX_DOCUMENT_BYTES) {
    throw new Error(`${file.name}: el archivo debe ocupar como máximo 25 MB.`);
  }
  return mime;
}

function normalise(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLocaleLowerCase('es-ES');
}

export function createPendingStageDocuments(stage, { markDirty } = {}) {
  if (!Array.isArray(stage._pendingDocuments)) stage._pendingDocuments = [];

  const root = element('details', { className: 'a53-stage-documents', open: true });
  const summary = element('summary', { className: 'a53-stage-doc-summary' });
  const body = element('div', { className: 'a53-stage-doc-body' });
  root.append(summary, body);

  const draw = () => {
    const pending = stage._pendingDocuments;
    summary.replaceChildren(
      element('span', { text: '📎 Documentos de esta T' }),
      element('span', {
        className: 'a53-doc-count',
        text: `${pending.length} preparado${pending.length === 1 ? '' : 's'} para guardar`
      })
    );

    body.replaceChildren();
    body.append(element('div', {
      className: 'a53-doc-context',
      text: 'Esta T todavía es nueva. Puedes añadir ahora los documentos: se conservarán en esta pantalla y se vincularán automáticamente a la T en cuanto pulses “Guardar ficha completa”.'
    }));

    const list = element('div', { className: 'a53-doc-list' });
    if (!pending.length) {
      list.append(element('div', {
        className: 'a53-empty',
        text: 'Todavía no has preparado ningún PDF ni fotografía.'
      }));
    } else {
      pending.forEach((item, index) => {
        const remove = element('button', {
          className: 'button secondary compact',
          type: 'button',
          text: 'Quitar',
          title: 'Quitar este archivo antes de guardar'
        });
        remove.addEventListener('click', () => {
          stage._pendingDocuments.splice(index, 1);
          markDirty?.();
          draw();
          root.open = true;
        });
        list.append(element('div', { className: 'a53-doc-card' }, [
          element('div', { className: 'a53-doc-main' }, [
            element('strong', { text: item.file.name }),
            element('span', {
              className: 'muted',
              text: `${formatSize(item.file.size)} · pendiente de guardar`
            }),
            item.description
              ? element('span', { className: 'muted', text: item.description })
              : null
          ]),
          remove
        ]));
      });
    }
    body.append(list);

    const uploader = element('section', { className: 'a53-uploader a55-uploader' });
    const description = element('input', {
      type: 'text',
      placeholder: 'Descripción opcional para los archivos'
    });
    description.maxLength = 500;

    const fileInput = element('input', { type: 'file' });
    fileInput.accept = 'application/pdf,image/jpeg,image/png,image/webp,image/heic,image/heif,.pdf,.jpg,.jpeg,.png,.webp,.heic,.heif';
    fileInput.multiple = true;
    fileInput.hidden = true;

    const cameraInput = element('input', { type: 'file' });
    cameraInput.accept = 'image/*';
    cameraInput.setAttribute('capture', 'environment');
    cameraInput.hidden = true;

    const dropZone = element('button', {
      className: 'a55-drop-zone',
      type: 'button',
      'aria-label': 'Arrastrar PDF o fotografías a esta T nueva, o pulsar para seleccionarlos'
    }, [
      element('span', { className: 'a55-drop-icon', text: '⇩' }),
      element('strong', { text: 'Arrastra aquí PDF o fotos' }),
      element('span', { className: 'a55-drop-help', text: 'También puedes hacer clic para seleccionarlos' })
    ]);

    const choose = element('button', {
      className: 'button primary compact',
      type: 'button',
      text: '📎 Añadir PDF o fotos'
    });
    const camera = element('button', {
      className: 'button secondary compact',
      type: 'button',
      text: '📷 Hacer foto'
    });
    const status = element('div', {
      className: 'a53-doc-status',
      text: 'Los archivos se subirán al guardar la ficha. Máximo 25 MB por archivo.'
    });
    status.setAttribute('aria-live', 'polite');

    const queue = filesInput => {
      try {
        const files = filesFrom(filesInput);
        if (!files.length) throw new Error('No se ha detectado ningún archivo válido.');
        const existing = new Set(stage._pendingDocuments.map(item => fileSignature(item.file)));
        let added = 0;
        files.forEach(file => {
          const mime = validateFile(file);
          const signature = fileSignature(file);
          if (existing.has(signature)) return;
          existing.add(signature);
          stage._pendingDocuments.push({
            file,
            mime,
            description: String(description.value || '').trim()
          });
          added += 1;
        });
        if (!added) throw new Error('Esos archivos ya están preparados en esta T.');
        markDirty?.();
        draw();
        root.open = true;
      } catch (error) {
        status.className = 'a53-doc-status danger';
        status.textContent = error?.message || 'No se pudieron preparar los archivos.';
      }
    };

    choose.addEventListener('click', () => fileInput.click());
    camera.addEventListener('click', () => cameraInput.click());
    dropZone.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => queue(fileInput.files));
    cameraInput.addEventListener('change', () => queue(cameraInput.files));

    const hasFiles = event => Array.from(event?.dataTransfer?.types || []).includes('Files');
    dropZone.addEventListener('dragenter', event => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      event.stopPropagation();
      dropZone.classList.add('is-dragging');
    });
    dropZone.addEventListener('dragover', event => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
      dropZone.classList.add('is-dragging');
    });
    dropZone.addEventListener('dragleave', event => {
      event.preventDefault();
      event.stopPropagation();
      if (!dropZone.contains(event.relatedTarget)) dropZone.classList.remove('is-dragging');
    });
    dropZone.addEventListener('drop', event => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      event.stopPropagation();
      dropZone.classList.remove('is-dragging');
      queue(event.dataTransfer?.files || []);
    });

    const actions = element('div', { className: 'a53-upload-actions' }, [
      choose,
      camera,
      fileInput,
      cameraInput
    ]);
    uploader.append(description, dropZone, actions, status);
    body.append(uploader);
  };

  draw();
  return root;
}

export function collectPendingStageDocuments(stages) {
  const existingIds = (stages || [])
    .map(stage => stage?.id)
    .filter(Boolean)
    .map(String);

  const entries = (stages || [])
    .filter(stage => !stage?.id && Array.isArray(stage?._pendingDocuments) && stage._pendingDocuments.length)
    .map(stage => ({
      clientKey: stage.client_key || '',
      position: Number(stage.posicion || 0),
      name: normalise(stage.nombre),
      type: normalise(stage.tipo_etapa),
      workshopId: String(stage.taller_id || ''),
      centreId: String(stage.centro_taller_id || ''),
      place: normalise(stage.lugar),
      documents: stage._pendingDocuments.slice()
    }));

  return { existingIds, entries };
}

function resolveCreatedStage(entry, savedStages, existingIds, usedIds) {
  const candidates = (savedStages || []).filter(stage => {
    const id = String(stage?.id || '');
    return id && !existingIds.has(id) && !usedIds.has(id) && stage.cancelado !== true;
  });

  const exact = candidates.filter(stage =>
    Number(stage.posicion || 0) === entry.position
    && normalise(stage.nombre) === entry.name
    && normalise(stage.tipo_etapa) === entry.type
  );
  if (exact.length === 1) return exact[0];

  const semantic = candidates.filter(stage =>
    normalise(stage.nombre) === entry.name
    && normalise(stage.tipo_etapa) === entry.type
    && String(stage.taller_id || '') === entry.workshopId
    && String(stage.centro_taller_id || '') === entry.centreId
    && normalise(stage.lugar) === entry.place
  );
  if (semantic.length === 1) return semantic[0];

  if (candidates.length === 1) return candidates[0];

  throw new Error(
    `No se ha podido identificar de forma inequívoca la T recién creada (${entry.position}T). Los documentos no se han vinculado a ninguna otra T.`
  );
}

async function ensureDocumentIdentity(stage) {
  if (stage?.id && stage?.grupo_documental_id) return stage;
  if (!stage?.id) throw new Error('La T guardada no dispone de identidad.');

  const { data, error } = await supabase
    .from('etapas_hotel')
    .select('id,grupo_documental_id')
    .eq('id', stage.id)
    .maybeSingle();

  if (error || !data?.grupo_documental_id) {
    throw new Error(error?.message || 'La T guardada no dispone todavía de identidad documental.');
  }
  return { ...stage, grupo_documental_id: data.grupo_documental_id };
}

async function uploadOne(stage, item) {
  const mime = item.mime || validateFile(item.file);
  const path = `etapas/${stage.grupo_documental_id}/${Date.now()}-${randomId()}-${safeFilename(item.file.name)}`;

  const { error: uploadError } = await supabase.storage
    .from(HOTEL_DOCUMENT_BUCKET)
    .upload(path, item.file, {
      cacheControl: '3600',
      upsert: false,
      contentType: mime
    });
  if (uploadError) throw new Error(`${item.file.name}: ${uploadError.message}`);

  const { error: registerError } = await supabase.rpc('registrar_documento_t', {
    p_etapa_id: stage.id,
    p_nombre_original: item.file.name,
    p_nombre_mostrado: item.file.name,
    p_storage_path: path,
    p_mime_type: mime,
    p_tamano_bytes: item.file.size,
    p_descripcion: item.description || ''
  });

  if (registerError) {
    await supabase.storage.from(HOTEL_DOCUMENT_BUCKET).remove([path]);
    throw new Error(`${item.file.name}: ${registerError.message}`);
  }
}

export async function uploadPendingStageDocuments(pending, savedDetail, { onProgress } = {}) {
  const entries = pending?.entries || [];
  if (!entries.length) return { uploaded: 0, stages: 0 };

  const existingIds = new Set((pending?.existingIds || []).map(String));
  const usedIds = new Set();
  const savedStages = Array.isArray(savedDetail?.etapas) ? savedDetail.etapas : [];
  let uploaded = 0;

  for (const entry of entries) {
    const resolved = resolveCreatedStage(entry, savedStages, existingIds, usedIds);
    usedIds.add(String(resolved.id));
    const stage = await ensureDocumentIdentity(resolved);

    for (const item of entry.documents) {
      onProgress?.(`Guardando documento ${uploaded + 1}: ${item.file.name}…`);
      await uploadOne(stage, item);
      uploaded += 1;
    }
  }

  return { uploaded, stages: entries.length };
}
