import { element } from '../../r1-alpha17/src/dom.js';

function formatDateTime(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? String(value)
    : date.toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' });
}

function wasEdited(note) {
  const created = new Date(note.creado_en || '').getTime();
  const updated = new Date(note.actualizado_en || '').getTime();
  return Number.isFinite(created) && Number.isFinite(updated) && updated - created > 1000;
}

function completedStages(stages) {
  const unique = new Map();
  (stages || [])
    .filter(stage => !stage.cancelado && stage.estado === 'realizada')
    .forEach(stage => {
      const key = stage.seguimiento_id || stage.id;
      const previous = unique.get(key);
      if (!previous || String(stage.actualizado_en || '') > String(previous.actualizado_en || '')) {
        unique.set(key, stage);
      }
    });
  return [...unique.values()];
}

function chronologyEvents(stages, notes, legacyText, generatedCancellations = []) {
  const cancelledStageTrackings = new Set((generatedCancellations || [])
    .map(item => item.etapa_seguimiento_id)
    .filter(Boolean));
  const automatic = completedStages(stages)
    .filter(stage => !cancelledStageTrackings.has(stage.seguimiento_id || stage.id))
    .map(stage => ({
    id: `stage-${stage.seguimiento_id || stage.id}`,
    type: 'automatic',
    stage,
    date: stage.fecha_real || stage.fecha_fin_real || stage.fecha_inicio_real || stage.actualizado_en,
    position: Number(stage.posicion || 0),
    title: `${stage.posicion ?? '—'}T · ${stage.nombre || 'T sin nombre'}`,
    meta: [
      formatDateTime(stage.fecha_real || stage.fecha_fin_real || stage.fecha_inicio_real || stage.actualizado_en),
      stage.lugar,
      'Paso realizado',
    ].filter(Boolean).join(' · '),
    text: stage.observaciones || '',
    }));

  let manual = (notes || []).filter(note => !note.cancelada).map(note => ({
    id: `note-${note.id}`,
    type: 'manual',
    note,
    date: note.fecha_evento || note.creado_en || note.actualizado_en,
    position: Number.MAX_SAFE_INTEGER,
    title: note.origen === 'importada' ? 'Anotación anterior' : 'Anotación manual',
    meta: [
      formatDateTime(note.fecha_evento || note.creado_en || note.actualizado_en),
      note.autor_nombre,
      wasEdited(note)
        ? `Editada por ${note.modificador_nombre || note.autor_nombre || 'usuario'}`
        : '',
    ].filter(Boolean).join(' · '),
    text: note.texto || '',
  }));

  if (!manual.length && String(legacyText || '').trim()) {
    manual = String(legacyText)
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(line => line && line !== '-')
      .map((text, index) => ({
        id: `legacy-${index}`,
        type: 'manual',
        date: '',
        position: Number.MAX_SAFE_INTEGER,
        title: 'Anotación anterior',
        meta: 'Pendiente de importar al registro editable',
        text,
      }));
  }

  return [...automatic, ...manual].sort((a, b) => {
    const dateOrder = String(a.date || '').localeCompare(String(b.date || ''));
    return dateOrder || a.position - b.position || a.id.localeCompare(b.id);
  });
}

function renderAnnotationActions(note, { onEdit, onDelete }) {
  const originalText = String(note.texto || '');
  const textarea = element('textarea', {
    className: 'a74-note-manage-text',
    rows: 3,
    maxLength: 4000,
    value: originalText,
    'aria-label': 'Modificar anotación',
  });
  const status = element('small', { className: 'a74-note-manage-status', text: '' });
  status.setAttribute('aria-live', 'polite');

  const editButton = element('button', {
    className: 'button secondary compact',
    type: 'button',
    text: 'Modificar',
  });
  const deleteButton = element('button', {
    className: 'button secondary compact danger',
    type: 'button',
    text: 'Anular',
    title: 'Anular la anotación conservándola en auditoría',
  });
  const saveButton = element('button', {
    className: 'button primary compact',
    type: 'button',
    text: 'Guardar cambio',
  });
  saveButton.disabled = true;
  const cancelButton = element('button', {
    className: 'button secondary compact',
    type: 'button',
    text: 'Cancelar',
  });

  const actions = element('div', { className: 'a74-note-manage-actions' }, [editButton, deleteButton]);
  const form = element('div', { className: 'a74-note-manage-form' }, [
    textarea,
    element('div', { className: 'a74-note-manage-actions' }, [saveButton, cancelButton]),
  ]);
  form.hidden = true;

  const showError = error => {
    status.textContent = error?.message || 'No se pudo modificar la anotación.';
    status.className = 'a74-note-manage-status is-error';
  };
  const closeEditor = () => {
    textarea.value = originalText;
    form.hidden = true;
    actions.hidden = false;
    status.textContent = '';
    status.className = 'a74-note-manage-status';
    saveButton.disabled = true;
  };

  editButton.addEventListener('click', () => {
    actions.hidden = true;
    form.hidden = false;
    textarea.focus();
    textarea.select();
  });
  cancelButton.addEventListener('click', closeEditor);
  textarea.addEventListener('input', () => {
    const nextText = textarea.value.trim();
    saveButton.disabled = !nextText || nextText === originalText.trim();
    status.textContent = '';
    status.className = 'a74-note-manage-status';
  });
  textarea.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    closeEditor();
  });
  saveButton.addEventListener('click', async () => {
    const nextText = textarea.value.trim();
    if (!nextText || saveButton.disabled) return;
    saveButton.disabled = true;
    cancelButton.disabled = true;
    textarea.disabled = true;
    status.textContent = 'Guardando cambio…';
    try {
      await onEdit({ id: note.id, version: Number(note.version || 1), text: nextText });
    } catch (error) {
      showError(error);
      saveButton.disabled = false;
    } finally {
      cancelButton.disabled = false;
      textarea.disabled = false;
    }
  });
  deleteButton.addEventListener('click', async () => {
    const confirmed = window.confirm(
      '¿Anular esta anotación? Dejará de mostrarse, pero seguirá conservada en la auditoría.'
    );
    if (!confirmed) return;
    editButton.disabled = true;
    deleteButton.disabled = true;
    try {
      await onDelete({ id: note.id, version: Number(note.version || 1) });
    } catch (error) {
      showError(error);
      editButton.disabled = false;
      deleteButton.disabled = false;
    }
  });

  return element('div', { className: 'a74-note-manage' }, [actions, form, status]);
}

function renderGeneratedAnnotationAction(stage, onAnnulGenerated) {
  const status = element('small', { className: 'a74-note-manage-status', text: '' });
  status.setAttribute('aria-live', 'polite');
  const button = element('button', {
    className: 'button secondary compact danger',
    type: 'button',
    text: 'Anular anotación generada',
    title: 'Oculta esta línea automática sin cancelar ni modificar la T',
  });
  button.addEventListener('click', async () => {
    const confirmed = window.confirm(
      '¿Anular esta anotación generada? La T realizada seguirá intacta y la anulación quedará registrada.'
    );
    if (!confirmed) return;
    button.disabled = true;
    status.textContent = 'Anulando anotación…';
    try {
      await onAnnulGenerated({ id: stage.id, seguimiento_id: stage.seguimiento_id });
    } catch (error) {
      status.textContent = error?.message || 'No se pudo anular la anotación generada.';
      status.className = 'a74-note-manage-status is-error';
      button.disabled = false;
    }
  });
  return element('div', { className: 'a74-note-manage' }, [
    element('div', { className: 'a74-note-manage-actions' }, [button]),
    status,
  ]);
}

export function renderAnnotationsChronology(stages, notes, legacyText = '', options = {}) {
  const events = chronologyEvents(stages, notes, legacyText, options.generatedCancellations);
  if (!events.length) return null;

  const list = element('ol', { className: 'a72-chronology-list' });
  events.forEach(event => {
    list.append(element('li', {
      className: `a72-chronology-item a72-chronology-${event.type}`,
    }, [
      element('div', { className: 'a72-chronology-marker', text: event.type === 'manual' ? '✎' : '✓' }),
      element('div', { className: 'a72-chronology-content' }, [
        element('strong', { text: event.title }),
        event.meta ? element('small', { text: event.meta }) : null,
        event.text ? element('p', { text: event.text }) : null,
        event.type === 'manual'
          && event.note?.id
          && typeof options.onEdit === 'function'
          && typeof options.onDelete === 'function'
          ? renderAnnotationActions(event.note, options)
          : null,
        event.type === 'automatic'
          && event.stage?.id
          && typeof options.onAnnulGenerated === 'function'
          ? renderGeneratedAnnotationAction(event.stage, options.onAnnulGenerated)
          : null,
      ]),
    ]));
  });

  return element('section', { className: 'a72-chronology' }, [
    element('div', { className: 'a72-chronology-heading' }, [
      element('h4', { text: 'Anotaciones y pasos realizados' }),
      element('span', { className: 'badge', text: `${events.length} línea${events.length === 1 ? '' : 's'}` }),
    ]),
    list,
  ]);
}

export function renderQuickAnnotationComposer(onSave) {
  const textarea = element('textarea', {
    className: 'a73-quick-note-text',
    rows: 3,
    maxLength: 4000,
    placeholder: 'Escribe una anotación…',
    'aria-label': 'Nueva anotación de la ficha',
  });
  const status = element('small', {
    className: 'a73-quick-note-status',
    text: '',
  });
  status.setAttribute('aria-live', 'polite');

  const saveButton = element('button', {
    className: 'button primary compact',
    type: 'button',
    text: 'Guardar anotación',
  });
  saveButton.disabled = true;

  const cancelButton = element('button', {
    className: 'button secondary compact',
    type: 'button',
    text: 'Cancelar',
  });
  const form = element('div', { className: 'a73-quick-note-form' }, [
    textarea,
    element('div', { className: 'a73-quick-note-actions' }, [saveButton, cancelButton]),
    status,
  ]);
  form.hidden = true;

  const openButton = element('button', {
    className: 'button secondary a73-open-quick-note',
    type: 'button',
    text: '✎ Añadir anotación',
    title: 'Añadir una anotación sin abrir la edición completa',
  });

  const setOpen = open => {
    form.hidden = !open;
    openButton.hidden = open;
    if (open) textarea.focus();
  };
  const reset = () => {
    textarea.value = '';
    status.textContent = '';
    status.className = 'a73-quick-note-status';
    saveButton.disabled = true;
    setOpen(false);
  };

  openButton.addEventListener('click', () => setOpen(true));
  cancelButton.addEventListener('click', reset);
  textarea.addEventListener('input', () => {
    saveButton.disabled = !textarea.value.trim();
    status.textContent = '';
    status.className = 'a73-quick-note-status';
  });
  textarea.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    reset();
  });
  saveButton.addEventListener('click', async () => {
    const text = textarea.value.trim();
    if (!text || saveButton.disabled) return;

    saveButton.disabled = true;
    cancelButton.disabled = true;
    textarea.disabled = true;
    status.textContent = 'Guardando anotación…';
    status.className = 'a73-quick-note-status';
    try {
      await onSave(text);
      reset();
    } catch (error) {
      status.textContent = error?.message || 'No se pudo guardar la anotación.';
      status.className = 'a73-quick-note-status is-error';
      saveButton.disabled = false;
    } finally {
      cancelButton.disabled = false;
      textarea.disabled = false;
    }
  });

  return element('section', { className: 'a73-quick-note' }, [openButton, form]);
}

function normaliseEditorNotes(detail) {
  if (!Array.isArray(detail.anotaciones_manuales)) detail.anotaciones_manuales = [];
  detail.anotaciones_manuales = detail.anotaciones_manuales.map(note => ({
    id: note.id || '',
    texto: note.texto || '',
    version: Number(note.version || 1),
    origen: note.origen || 'manual',
    autor_nombre: note.autor_nombre || '',
    modificador_nombre: note.modificador_nombre || '',
    creado_en: note.creado_en || '',
    actualizado_en: note.actualizado_en || '',
    fecha_evento: note.fecha_evento || '',
    eliminar: note.eliminar === true,
  }));
  return detail.anotaciones_manuales;
}

export function manualAnnotationsPayload(detail) {
  return normaliseEditorNotes(detail)
    .filter(note => note.id || String(note.texto || '').trim())
    .map(note => ({
      id: note.id || '',
      texto: String(note.texto || '').trim(),
      version: Number(note.version || 1),
      eliminar: note.eliminar === true,
    }));
}

export function renderManualAnnotationsEditor(detail, markDirty) {
  const notes = normaliseEditorNotes(detail);
  const section = element('section', { className: 'editor-section a72-note-editor' }, [
    element('h3', { text: 'Anotaciones manuales' }),
    element('p', {
      className: 'muted',
      text: 'Cada anotación se guarda como una línea independiente con fecha y autor. Las T realizadas se incorporan automáticamente a la cronología.',
    }),
  ]);
  const list = element('div', { className: 'a72-note-editor-list' });

  const render = () => {
    list.replaceChildren();
    if (!notes.length) {
      list.append(element('p', { className: 'muted', text: 'Todavía no hay anotaciones manuales.' }));
      return;
    }
    notes.forEach((note, index) => {
      const textarea = element('textarea', {
        className: 'a72-manual-note-text',
        rows: 3,
        maxLength: 4000,
        value: note.texto,
        placeholder: 'Escribe una anotación…',
        'aria-label': `Anotación manual ${index + 1}`,
      });
      // `disabled` es un atributo booleano: disabled="false" también bloquea
      // el control. Solo se activa cuando la anotación está marcada para quitar.
      textarea.disabled = note.eliminar;
      textarea.addEventListener('input', () => {
        note.texto = textarea.value;
        markDirty();
      });

      const removeButton = element('button', {
        className: 'button secondary compact',
        type: 'button',
        text: note.eliminar ? 'Deshacer' : 'Quitar',
      });
      removeButton.addEventListener('click', () => {
        if (!note.id) notes.splice(index, 1);
        else note.eliminar = !note.eliminar;
        markDirty();
        render();
      });

      const meta = note.id
        ? [formatDateTime(note.fecha_evento || note.creado_en), note.autor_nombre].filter(Boolean).join(' · ')
        : 'Nueva · se fechará y firmará al guardar';
      list.append(element('article', {
        className: `a72-note-editor-row${note.eliminar ? ' is-removed' : ''}`,
      }, [
        element('div', { className: 'a72-note-editor-meta' }, [
          element('span', { text: meta }),
          removeButton,
        ]),
        textarea,
        note.eliminar
          ? element('small', { className: 'muted', text: 'Esta línea se retirará de la cronología al guardar; seguirá en auditoría.' })
          : null,
      ]));
    });
  };

  const addButton = element('button', {
    className: 'button secondary',
    type: 'button',
    text: '＋ Añadir anotación',
  });
  addButton.addEventListener('click', () => {
    notes.push({ id: '', texto: '', version: 1, origen: 'manual', eliminar: false });
    markDirty();
    render();
    const textareas = list.querySelectorAll('textarea');
    textareas[textareas.length - 1]?.focus();
  });

  render();
  section.append(list, addButton);
  return section;
}
