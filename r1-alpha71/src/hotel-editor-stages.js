import { element } from '../../r1-alpha17/src/dom.js';
import {
  STAGE_STATES, STAGE_TYPES, bindCheckbox, bindText, createCheckbox,
  createInput, createSelect, createTextarea, fieldLabel, makeNewStage, makeNewWork
} from '../../r1-alpha17/src/modules/hotel-editor-utils.js';

function renumberStages(stages) {
  stages.forEach((stage, index) => {
    stage.posicion = index + 1;
  });
}

function normaliseType(value) {
  return String(value ?? '').trim().toLocaleLowerCase('es-ES');
}

function findType(catalogue, value) {
  const key = normaliseType(value);
  if (!key) return null;
  return (catalogue || []).find(item =>
    normaliseType(item.codigo) === key || normaliseType(item.nombre) === key
  ) || null;
}

function displayType(catalogue, value) {
  const item = findType(catalogue, value);
  return item?.nombre || String(value || '');
}

function createEditableWorkType(detail, work, markDirty, onLabelChanged) {
  const catalogue = detail.catalogos.tipos_trabajo || [];
  const listId = `a57-work-types-${crypto.randomUUID()}`;
  const input = createInput({
    value: displayType(catalogue, work.tipo_trabajo),
    placeholder: 'Elige un tipo o escribe uno nuevo'
  });
  input.setAttribute('list', listId);
  input.setAttribute('autocomplete', 'off');
  input.setAttribute('spellcheck', 'false');

  const datalist = element('datalist', { id: listId });
  catalogue
    .slice()
    .sort((a, b) => String(a.nombre || '').localeCompare(String(b.nombre || ''), 'es'))
    .forEach(item => {
      datalist.append(element('option', {
        value: item.nombre || item.codigo,
        label: item.codigo || ''
      }));
    });

  const update = () => {
    const typed = input.value.trim();
    const existing = findType(catalogue, typed);
    work.tipo_trabajo = existing?.codigo || typed;
    onLabelChanged(displayType(catalogue, work.tipo_trabajo) || 'Trabajo');
    markDirty();
  };
  input.addEventListener('input', update);
  input.addEventListener('change', update);

  const field = fieldLabel('Tipo', input);
  field.append(
    datalist,
    element('small', {
      className: 'muted',
      text: 'Puedes elegir uno existente o escribir uno nuevo. Al guardar, el nuevo tipo quedará añadido al listado.'
    })
  );
  return field;
}


function normaliseCatalogueValue(value) {
  return String(value ?? '').trim().toLocaleLowerCase('es-ES');
}

function findCatalogueItem(catalogue, value) {
  const key = normaliseCatalogueValue(value);
  if (!key) return null;
  return (catalogue || []).find(item =>
    normaliseCatalogueValue(item.codigo ?? item.id) === key
    || normaliseCatalogueValue(item.nombre) === key
  ) || null;
}

function createEditableCatalogueField(labelText, catalogue, value, {
  placeholder = 'Elige una opción o escribe una nueva',
  hint = 'Puedes elegir un valor existente o escribir uno nuevo. Se añadirá al listado al guardar.',
  onChange,
} = {}) {
  let items = Array.isArray(catalogue) ? catalogue : [];
  const selected = findCatalogueItem(items, value);
  const input = createInput({ value: selected?.nombre || value || '', placeholder });
  const listId = `a70-catalogue-${crypto.randomUUID()}`;
  const list = element('datalist', { id: listId });
  input.setAttribute('list', listId);
  input.setAttribute('autocomplete', 'off');
  input.setAttribute('spellcheck', 'false');

  const rebuild = (nextItems = items, nextValue, replaceValue = false) => {
    items = Array.isArray(nextItems) ? nextItems : [];
    list.replaceChildren();
    items
      .slice()
      .sort((a, b) => String(a.nombre || '').localeCompare(String(b.nombre || ''), 'es'))
      .forEach(item => list.append(element('option', {
        value: item.nombre || item.codigo || item.id,
        label: item.codigo && item.codigo !== item.nombre ? item.codigo : ''
      })));
    if (replaceValue) {
      const next = findCatalogueItem(items, nextValue);
      input.value = next?.nombre || nextValue || '';
    }
  };

  const update = () => {
    const typed = input.value.trim();
    onChange?.(findCatalogueItem(items, typed), typed);
  };
  input.addEventListener('input', update);
  input.addEventListener('change', update);
  rebuild(items, value, false);

  const field = fieldLabel(labelText, input);
  field.append(list, element('small', { className: 'muted', text: hint }));
  return { input, field, rebuild };
}

function createWorkshopEditor(detail, stage, markDirty, onWorkshopChanged) {
  return createEditableCatalogueField('Taller', detail.catalogos.talleres || [], stage.taller_id || stage.taller_nombre || '', {
    placeholder: 'Elige un taller o escribe uno nuevo',
    hint: 'Un taller nuevo se incorporará al listado al guardar la ficha.',
    onChange: (item, typed) => {
      const previous = `${stage.taller_id || ''}|${stage.taller_nombre || ''}`;
      stage.taller_id = item?.id || null;
      stage.taller_nombre = item ? '' : typed;
      const current = `${stage.taller_id || ''}|${stage.taller_nombre || ''}`;
      if (previous !== current) {
        stage.centro_taller_id = null;
        stage.centro_nombre = '';
        onWorkshopChanged?.();
      }
      markDirty();
    }
  });
}

function centresForStage(detail, stage) {
  return (detail.catalogos.talleres || []).find(item => item.id === stage.taller_id)?.centros || [];
}

function createCenterEditor(detail, stage, markDirty) {
  const editor = createEditableCatalogueField('Centro', centresForStage(detail, stage), stage.centro_taller_id || stage.centro_nombre || '', {
    placeholder: 'Elige un centro o escribe uno nuevo',
    hint: 'El centro se guarda dentro del taller elegido y aparecerá en su listado.',
    onChange: (item, typed) => {
      stage.centro_taller_id = item?.id || null;
      stage.centro_nombre = item ? '' : typed;
      markDirty();
    }
  });
  return { ...editor, rebuildForWorkshop() { editor.rebuild(centresForStage(detail, stage), '', true); } };
}

function renderWorks(detail, stage, worksHost, markDirty) {
  worksHost.replaceChildren();

  if (!stage.trabajos.length) {
    worksHost.append(element('p', { className: 'muted', text: 'Sin trabajos detallados.' }));
  }

  stage.trabajos.forEach((work, workIndex) => {
    const workCard = element('article', {
      className: `editor-work-card${work.cancelado ? ' cancelled' : ''}`
    });
    const workTitle = element('strong', {
      text: `${workIndex + 1}. ${displayType(detail.catalogos.tipos_trabajo, work.tipo_trabajo) || 'Trabajo'}`
    });
    const typeField = createEditableWorkType(
      detail,
      work,
      markDirty,
      label => { workTitle.textContent = `${workIndex + 1}. ${label}`; }
    );

    const category = createInput({ value: work.categoria_tecnica || '' });
    bindText(category, work, 'categoria_tecnica', markDirty);
    const km = createInput({ type: 'number', min: 0, step: 1, value: work.km_averia ?? '' });
    bindText(km, work, 'km_averia', markDirty, value => value === '' ? '' : Number(value));
    const expediente = createInput({ value: work.expediente || '' });
    bindText(expediente, work, 'expediente', markDirty);
    const reason = createTextarea(work.motivo_entrada || '');
    bindText(reason, work, 'motivo_entrada', markDirty);
    const diagnosis = createTextarea(work.diagnostico_real || '');
    bindText(diagnosis, work, 'diagnostico_real', markDirty);
    const description = createTextarea(work.descripcion || '');
    bindText(description, work, 'descripcion', markDirty);
    const appraisal = createTextarea(work.peritaje_estado || '');
    bindText(appraisal, work, 'peritaje_estado', markDirty);
    const observations = createTextarea(work.observaciones || '');
    bindText(observations, work, 'observaciones', markDirty);

    const cancelled = createCheckbox(
      work.id ? 'Cancelar o restaurar trabajo, conservando el histórico' : 'Descartar trabajo nuevo',
      work.cancelado
    );
    const cancelReason = createTextarea(work.motivo_cancelacion || '');
    bindText(cancelReason, work, 'motivo_cancelacion', markDirty);
    const cancelBox = element('div', { className: 'editor-conditional' }, [
      fieldLabel('Motivo obligatorio', cancelReason)
    ]);

    const refreshCancellation = () => {
      cancelBox.classList.toggle('hidden', !work.cancelado || !work.id);
      workCard.classList.toggle('cancelled', work.cancelado);
    };

    bindCheckbox(cancelled.input, work, 'cancelado', markDirty, checked => {
      if (!work.id && checked) {
        stage.trabajos.splice(workIndex, 1);
        renderWorks(detail, stage, worksHost, markDirty);
        return;
      }
      refreshCancellation();
    });
    refreshCancellation();

    workCard.append(
      element('div', { className: 'editor-work-header' }, [
        workTitle,
        element('span', { className: 'badge', text: work.id ? `Versión ${work.version}` : 'Nuevo' })
      ]),
      element('div', { className: 'editor-grid' }, [
        typeField,
        fieldLabel('Categoría técnica', category),
        fieldLabel('Kilómetros', km),
        fieldLabel('Expediente', expediente)
      ]),
      element('div', { className: 'editor-grid editor-grid-two' }, [
        fieldLabel('Motivo de entrada / primer diagnóstico', reason),
        fieldLabel('Diagnóstico real', diagnosis),
        fieldLabel('Descripción', description),
        fieldLabel('Peritaje / estado', appraisal),
        fieldLabel('Observaciones', observations)
      ]),
      cancelled.label,
      cancelBox
    );
    worksHost.append(workCard);
  });
}

export function renderStagesSection(detail, markDirty) {
  const section = element('section', { className: 'editor-section editor-stages-section' }, [
    element('div', { className: 'editor-section-heading' }, [
      element('div', {}, [
        element('h3', { text: '4. T y trabajos asociados' }),
        element('p', {
          className: 'muted',
          text: 'Las flechas cambian el orden. Todos los catálogos permiten elegir o escribir; las T y trabajos no se borran.'
        })
      ])
    ])
  ]);
  const stagesHost = element('div', { className: 'editor-stages' });
  const addStageButton = element('button', { className: 'button secondary', type: 'button', text: '+ Añadir T' });

  const renderStages = () => {
    stagesHost.replaceChildren();

    if (!detail.etapas.length) {
      stagesHost.append(element('p', { className: 'muted', text: 'No hay T en esta ficha.' }));
    }

    detail.etapas.forEach((stage, stageIndex) => {
      const stageCard = element('article', {
        className: `editor-stage-card${stage.cancelado ? ' cancelled' : ''}`
      });

      const up = element('button', { className: 'button secondary compact', type: 'button', text: '↑', title: 'Subir T' });
      const down = element('button', { className: 'button secondary compact', type: 'button', text: '↓', title: 'Bajar T' });
      up.disabled = stageIndex === 0;
      down.disabled = stageIndex === detail.etapas.length - 1;
      up.addEventListener('click', () => {
        [detail.etapas[stageIndex - 1], detail.etapas[stageIndex]] = [detail.etapas[stageIndex], detail.etapas[stageIndex - 1]];
        renumberStages(detail.etapas);
        markDirty();
        renderStages();
      });
      down.addEventListener('click', () => {
        [detail.etapas[stageIndex + 1], detail.etapas[stageIndex]] = [detail.etapas[stageIndex], detail.etapas[stageIndex + 1]];
        renumberStages(detail.etapas);
        markDirty();
        renderStages();
      });

      const stageHeader = element('div', { className: 'editor-stage-header' }, [
        element('div', {}, [
          element('strong', { text: `${stage.posicion}T · ${stage.nombre || 'Sin nombre'}` }),
          element('div', { className: 'muted', text: stage.id ? `Versión ${stage.version}` : 'Nueva T sin guardar' })
        ]),
        element('div', { className: 'editor-row-actions' }, [up, down])
      ]);

      const name = createInput({ value: stage.nombre || '' });
      bindText(name, stage, 'nombre', markDirty);
      const position = createInput({ type: 'number', min: 1, max: 99, step: 1, value: stage.posicion });
      bindText(position, stage, 'posicion', markDirty, Number);
      const stageStateEditor = createEditableCatalogueField('Estado', detail.catalogos.estados_etapa || [], stage.estado_catalogo_codigo || (stage.estado === 'anulada' ? 'pendiente' : stage.estado), {
        placeholder: 'Elige un estado o escribe uno nuevo',
        hint: 'La etiqueta nueva se añadirá al listado sin alterar el estado operativo interno.',
        onChange: (item, typed) => {
          if (item) {
            stage.estado = item.estado_operativo || item.codigo;
            stage.estado_catalogo_codigo = item.codigo;
          } else if (typed) {
            stage.estado_catalogo_codigo = typed;
            if (!['pendiente', 'programada', 'en_curso', 'realizada'].includes(stage.estado)) stage.estado = 'pendiente';
          } else {
            stage.estado = 'pendiente';
            stage.estado_catalogo_codigo = 'pendiente';
          }
          markDirty();
        }
      });
      const stageState = stageStateEditor.input;
      const stageTypeEditor = createEditableCatalogueField('Tipo de T', detail.catalogos.tipos_etapa || [], stage.tipo_etapa || 'otro', {
        placeholder: 'Elige un tipo de T o escribe uno nuevo',
        hint: 'Los tipos especiales conservan sus movimientos; un tipo nuevo se trata como informativo.',
        onChange: (item, typed) => {
          stage.tipo_etapa = item?.codigo || typed || 'otro';
          markDirty();
        }
      });
      const stageType = stageTypeEditor.input;
      let centerEditor;
      const workshopEditor = createWorkshopEditor(detail, stage, markDirty, () => centerEditor?.rebuildForWorkshop());
      centerEditor = createCenterEditor(detail, stage, markDirty);
      const workshop = workshopEditor.input;
      const center = centerEditor.input;

      const stagePlace = createInput({ value: stage.lugar || '' });
      bindText(stagePlace, stage, 'lugar', markDirty);
      const planned = createInput({ type: 'datetime-local', value: stage.fecha_prevista || '' });
      bindText(planned, stage, 'fecha_prevista', markDirty);
      const started = createInput({ type: 'datetime-local', value: stage.fecha_inicio_real || '' });
      bindText(started, stage, 'fecha_inicio_real', markDirty);
      const finished = createInput({ type: 'datetime-local', value: stage.fecha_fin_real || '' });
      bindText(finished, stage, 'fecha_fin_real', markDirty);
      const realized = createInput({ type: 'datetime-local', value: stage.fecha_real || '' });
      bindText(realized, stage, 'fecha_real', markDirty);

      const grid = element('div', { className: 'editor-grid' }, [
        fieldLabel('Nombre de la T', name),
        fieldLabel('Posición', position),
        stageStateEditor.field,
        stageTypeEditor.field,
        workshopEditor.field,
        centerEditor.field,
        fieldLabel('Lugar / referencia', stagePlace),
        fieldLabel('Fecha programada', planned),
        fieldLabel('Inicio real', started),
        fieldLabel('Fin real', finished),
        fieldLabel('Fecha realizada', realized)
      ]);

      const stageObservations = createTextarea(stage.observaciones || '');
      bindText(stageObservations, stage, 'observaciones', markDirty);

      const stageCancelled = createCheckbox(
        stage.id ? 'Anular o restaurar esta T, conservando su histórico' : 'Descartar esta T nueva',
        stage.cancelado
      );
      const stageCancelReason = createTextarea(stage.motivo_cancelacion || '');
      bindText(stageCancelReason, stage, 'motivo_cancelacion', markDirty);
      const stageCancelBox = element('div', { className: 'editor-conditional' }, [
        fieldLabel('Motivo obligatorio de anulación', stageCancelReason)
      ]);
      const refreshStageCancellation = () => {
        stageCancelBox.classList.toggle('hidden', !stage.cancelado || !stage.id);
        stageState.disabled = stage.cancelado;
        stageCard.classList.toggle('cancelled', stage.cancelado);
      };
      bindCheckbox(stageCancelled.input, stage, 'cancelado', markDirty, checked => {
        if (!stage.id && checked) {
          detail.etapas.splice(stageIndex, 1);
          renumberStages(detail.etapas);
          renderStages();
          return;
        }
        if (!checked && stage.estado === 'anulada') {
          stage.estado = 'pendiente';
          stage.estado_catalogo_codigo = 'pendiente';
          stageState.value = 'Pendiente';
        }
        refreshStageCancellation();
      });
      refreshStageCancellation();

      const worksHost = element('div', { className: 'editor-works' });
      renderWorks(detail, stage, worksHost, markDirty);
      const addWorkButton = element('button', { className: 'button secondary compact', type: 'button', text: '+ Añadir trabajo' });
      addWorkButton.addEventListener('click', () => {
        stage.trabajos.push(makeNewWork(detail.catalogos.tipos_trabajo[0]?.codigo || 'AV'));
        markDirty();
        renderWorks(detail, stage, worksHost, markDirty);
      });

      stageCard.append(
        stageHeader,
        grid,
        fieldLabel('Observaciones de la T', stageObservations),
        stageCancelled.label,
        stageCancelBox,
        element('div', { className: 'editor-subheading' }, [
          element('strong', { text: 'Trabajos de esta T' }),
          element('div', {
            className: 'muted',
            text: 'El campo Tipo es editable. Los tipos nuevos se incorporan al listado general al guardar la ficha.'
          })
        ]),
        worksHost,
        addWorkButton
      );
      stagesHost.append(stageCard);
    });
  };

  addStageButton.addEventListener('click', () => {
    detail.etapas.push(makeNewStage(detail.etapas));
    markDirty();
    renderStages();
  });

  renderStages();
  section.append(stagesHost, addStageButton);
  return section;
}
