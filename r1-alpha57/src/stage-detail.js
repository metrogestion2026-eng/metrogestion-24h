import { supabase } from '../../r1-alpha17/src/supabase.js';
import {
  categoryLabel,
  el,
  formatBytes,
  formatDateTime,
  modal,
} from '../../r1-alpha53/src/document-core.js';

const STAGE_STATE_LABELS = Object.freeze({
  pendiente: 'Pendiente',
  programada: 'Programada',
  en_curso: 'En curso',
  realizada: 'Realizada',
  anulada: 'Anulada',
});

function textValue(value) {
  if (value === 0) return '0';
  if (value === true) return 'Sí';
  if (value === false) return 'No';
  return value === null || value === undefined || value === '' ? '—' : String(value);
}

function field(label, value) {
  const host = el('div', null, 'a56-stage-field');
  host.append(el('span', label), el('strong', textValue(value)));
  return host;
}

function stageState(stage) {
  if (stage?.cancelado === true || stage?.estado === 'anulada') return 'Anulada';
  return STAGE_STATE_LABELS[stage?.estado] || stage?.estado || 'Sin estado';
}

function displayDate(value) {
  return value ? formatDateTime(value) : '—';
}

function normalise(value) {
  return String(value ?? '').trim().toLocaleLowerCase('es-ES');
}

function findType(catalogue, value) {
  const key = normalise(value);
  if (!key) return null;
  return (catalogue || []).find(item =>
    normalise(item.codigo) === key || normalise(item.nombre) === key
  ) || null;
}

function typeName(catalogue, value) {
  return findType(catalogue, value)?.nombre || String(value || 'Trabajo');
}

async function canEditWorkTypes() {
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData?.user) return false;

  const { data: profile, error } = await supabase
    .from('usuarios')
    .select('activo,tipo_usuario,permisos')
    .eq('id', authData.user.id)
    .maybeSingle();
  if (error || profile?.activo !== true) return false;
  if (profile.tipo_usuario === 'administrador_principal') return true;

  return ['hotel', 'historico', 't_programadas'].some(moduleId =>
    profile.permisos?.[moduleId]?.editar === true
  );
}

function makeTypeDatalist(catalogue, id) {
  const list = document.createElement('datalist');
  list.id = id;
  (catalogue || [])
    .slice()
    .sort((a, b) => String(a.nombre || '').localeCompare(String(b.nombre || ''), 'es'))
    .forEach(item => {
      const option = document.createElement('option');
      option.value = item.nombre || item.codigo;
      option.label = item.codigo || '';
      list.append(option);
    });
  return list;
}

function renderWork(work, index, catalogue, typeEditor) {
  const host = el('article', null, `a56-work-card${work.cancelado ? ' cancelled' : ''}`);
  const head = el('div', null, 'a56-work-head');
  head.append(
    el('strong', `${index + 1}. ${typeName(catalogue, work.tipo_trabajo)}`),
    el('span', work.cancelado ? 'Anulado' : 'Activo', 'badge')
  );
  host.append(head);

  if (typeEditor) host.append(typeEditor);

  const grid = el('div', null, 'a56-stage-grid');
  grid.append(
    field('Código del tipo', work.tipo_trabajo),
    field('Categoría técnica', work.categoria_tecnica),
    field('Km de avería', work.km_averia),
    field('Expediente', work.expediente),
    field('Peritaje / estado', work.peritaje_estado),
    field('Versión', work.version),
    field('Última modificación', displayDate(work.actualizado_en))
  );
  host.append(grid);

  const longFields = [
    ['Motivo de entrada / primer diagnóstico', work.motivo_entrada],
    ['Diagnóstico real', work.diagnostico_real],
    ['Descripción', work.descripcion],
    ['Observaciones', work.observaciones],
    ['Motivo de anulación', work.motivo_cancelacion],
  ].filter(([, value]) => value);

  longFields.forEach(([label, value]) => {
    const box = el('div', null, 'a56-stage-text');
    box.append(el('strong', label), el('p', value));
    host.append(box);
  });
  return host;
}

function renderWorksSection(works, catalogue, editable, saveTypes) {
  const section = el('section', null, 'a56-stage-section');
  const head = el('div', null, 'a56-stage-section-head');
  head.append(
    el('h4', 'Trabajos de esta T'),
    el('span', String(works.length), 'badge')
  );
  section.append(head);

  const status = el('div', null, 'a57-type-status');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  const controls = [];
  const listId = `a57-stage-types-${crypto.randomUUID()}`;
  const datalist = makeTypeDatalist(catalogue, listId);
  section.append(datalist);

  const worksList = el('div', null, 'a56-work-list');
  if (!works.length) {
    worksList.append(el('div', 'No hay trabajos asociados a esta T.', 'a56-stage-empty'));
  } else {
    works.forEach((work, index) => {
      let editor = null;
      if (editable && !work.cancelado && work.id) {
        editor = el('label', null, 'a57-work-type-editor');
        editor.append(el('span', 'Tipo de trabajo'));
        const input = document.createElement('input');
        input.type = 'text';
        input.value = typeName(catalogue, work.tipo_trabajo);
        input.placeholder = 'Elige un tipo o escribe uno nuevo';
        input.setAttribute('list', listId);
        input.setAttribute('autocomplete', 'off');
        input.setAttribute('spellcheck', 'false');
        editor.append(
          input,
          el('small', 'Elige uno existente o escribe uno nuevo. Al guardar quedará incorporado al listado general.')
        );
        controls.push({ input, work, original: work.tipo_trabajo });
      }
      worksList.append(renderWork(work, index, catalogue, editor));
    });
  }
  section.append(worksList);

  if (editable && controls.length) {
    const actions = el('div', null, 'a57-type-actions');
    const saveButton = el('button', 'Guardar tipos', 'button primary compact');
    saveButton.type = 'button';
    saveButton.disabled = true;
    const markDirty = () => {
      saveButton.disabled = false;
      status.className = 'a57-type-status';
      status.textContent = 'Cambios de tipo pendientes de guardar.';
    };
    controls.forEach(control => control.input.addEventListener('input', markDirty));

    saveButton.addEventListener('click', async () => {
      const changes = [];
      for (const control of controls) {
        const typed = control.input.value.trim();
        if (!typed) {
          status.className = 'a57-type-status error';
          status.textContent = 'El tipo de trabajo no puede quedar vacío.';
          control.input.focus();
          return;
        }
        const match = findType(catalogue, typed);
        const next = match?.codigo || typed;
        if (normalise(next) !== normalise(control.original)) {
          changes.push({
            id: control.work.id,
            version: Number(control.work.version),
            tipo: next,
          });
        }
      }

      if (!changes.length) {
        status.className = 'a57-type-status success';
        status.textContent = 'No hay cambios reales que guardar.';
        saveButton.disabled = true;
        return;
      }

      saveButton.disabled = true;
      controls.forEach(control => { control.input.disabled = true; });
      status.className = 'a57-type-status';
      status.textContent = 'Guardando tipos y actualizando el listado…';
      try {
        await saveTypes(changes);
      } catch (error) {
        controls.forEach(control => { control.input.disabled = false; });
        saveButton.disabled = false;
        status.className = 'a57-type-status error';
        status.textContent = error?.message || 'No se pudieron guardar los tipos.';
      }
    });

    actions.append(saveButton);
    section.append(status, actions);
  } else if (!editable && works.length) {
    section.append(el('div', 'Los tipos se muestran en modo consulta.', 'a57-type-status'));
  }

  return section;
}

function renderDocuments(documents) {
  const all = Array.isArray(documents) ? documents : [];
  const active = all.filter(doc => !doc.cancelado);
  const cancelled = all.filter(doc => doc.cancelado);
  const host = el('section', null, 'a56-stage-section');
  const head = el('div', null, 'a56-stage-section-head');
  head.append(el('h4', 'Documentación de esta T'), el('span', `${active.length} activo(s)`, 'badge'));
  host.append(head);

  const list = el('div', null, 'a56-stage-doc-list');
  if (!active.length) {
    list.append(el('div', 'Esta T no tiene documentos activos.', 'a56-stage-empty'));
  } else {
    active.forEach(doc => {
      const row = el('div', null, 'a56-stage-doc-item');
      row.append(
        el('strong', doc.nombre_mostrado || doc.nombre_original || 'Archivo'),
        el('span', `${categoryLabel(doc)} · ${formatBytes(doc.tamano_bytes)}`)
      );
      if (doc.descripcion) row.append(el('p', doc.descripcion));
      list.append(row);
    });
  }
  host.append(list);

  if (cancelled.length) {
    const old = el('details', null, 'a56-stage-cancelled-docs');
    old.append(el('summary', `Documentos anulados · ${cancelled.length}`));
    const oldList = el('div', null, 'a56-stage-doc-list');
    cancelled.forEach(doc => {
      const row = el('div', null, 'a56-stage-doc-item cancelled');
      row.append(
        el('strong', doc.nombre_mostrado || doc.nombre_original || 'Archivo'),
        el('span', doc.motivo_cancelacion || 'Anulado')
      );
      oldList.append(row);
    });
    old.append(oldList);
    host.append(old);
  }
  return host;
}

function renderStage(stage, works, documents, catalogue, editable, saveTypes, warning = '', success = '') {
  const content = el('div', null, 'a56-stage-detail-content');
  const stateLine = el('div', null, 'a56-stage-detail-state');
  stateLine.append(
    el('span', `T ${stage.posicion ?? '—'}`, 'badge'),
    el('span', stageState(stage), 'badge'),
    el('span', editable ? 'Tipos editables' : 'Vista de consulta', 'badge')
  );
  content.append(stateLine);

  if (warning) content.append(el('div', warning, 'a56-stage-warning'));
  if (success) content.append(el('div', success, 'a57-stage-success'));

  const grid = el('div', null, 'a56-stage-grid');
  grid.append(
    field('Nombre', stage.nombre),
    field('Estado', stageState(stage)),
    field('Tipo de T', stage.tipo_etapa),
    field('Lugar / taller', stage.lugar),
    field('Fecha programada', displayDate(stage.fecha_prevista)),
    field('Inicio real', displayDate(stage.fecha_inicio_real)),
    field('Fin real', displayDate(stage.fecha_fin_real)),
    field('Fecha realizada', displayDate(stage.fecha_real)),
    field('Posición', stage.posicion),
    field('Versión', stage.version),
    field('Acción del sistema', stage.accion_sistema),
    field('Última modificación', displayDate(stage.actualizado_en))
  );
  content.append(grid);

  if (stage.observaciones) {
    const notes = el('section', null, 'a56-stage-text');
    notes.append(el('strong', 'Observaciones'), el('p', stage.observaciones));
    content.append(notes);
  }
  if ((stage.cancelado || stage.estado === 'anulada') && stage.motivo_cancelacion) {
    const cancelled = el('section', null, 'a56-stage-text cancelled');
    cancelled.append(el('strong', 'Motivo de anulación'), el('p', stage.motivo_cancelacion));
    content.append(cancelled);
  }

  content.append(
    renderWorksSection(works, catalogue, editable, saveTypes),
    renderDocuments(documents)
  );
  return content;
}

export async function openStageDetail(stage, { documents = [] } = {}) {
  if (!stage?.id) {
    window.alert('No se puede abrir la T porque no dispone de identificador.');
    return;
  }

  const viewer = modal(`${stage.posicion ?? '—'}T · ${stage.nombre || 'Ficha de la T'}`);
  viewer.overlay.classList.add('a56-stage-detail-modal');
  const mount = el('div', null, 'a57-stage-mount');
  const loading = el('div', 'Cargando ficha completa de la T…', 'a56-stage-loading');
  mount.append(loading);
  viewer.card.append(mount);

  let currentStage = stage;
  let currentWorks = [];
  let currentCatalogue = [];
  let editable = false;
  let warnings = [];

  const redraw = success => {
    mount.replaceChildren(renderStage(
      currentStage,
      currentWorks,
      documents,
      currentCatalogue,
      editable,
      saveTypes,
      warnings.join(' · '),
      success
    ));
  };

  const saveTypes = async changes => {
    const request = `tipo_${crypto.randomUUID().replaceAll('-', '')}`;
    const { data, error } = await supabase.rpc('guardar_tipos_trabajo_etapa', {
      p_etapa_id: currentStage.id,
      p_cambios: changes,
      p_request_id: request,
    });
    if (error || !data?.ok) throw new Error(error?.message || 'No se pudieron guardar los tipos.');

    currentWorks = Array.isArray(data.trabajos) ? data.trabajos : currentWorks;
    currentCatalogue = Array.isArray(data.catalogo) ? data.catalogo : currentCatalogue;
    const newTypes = Number(data.tipos_nuevos || 0);
    const propagated = Number(data.copias_historicas_actualizadas || 0);
    const message = `✓ Tipos guardados${newTypes ? ` · ${newTypes} nuevo${newTypes === 1 ? '' : 's'} añadido${newTypes === 1 ? '' : 's'} al listado` : ''}${propagated ? ` · ${propagated} copia${propagated === 1 ? '' : 's'} histórica${propagated === 1 ? '' : 's'} actualizada${propagated === 1 ? '' : 's'}` : ''}.`;
    redraw(message);
  };

  try {
    const [stageResult, worksResult, catalogueResult, editAccess] = await Promise.all([
      supabase
        .from('etapas_hotel')
        .select('id,registro_hotel_id,seguimiento_id,grupo_documental_id,nombre,posicion,estado,tipo_etapa,taller_id,centro_taller_id,lugar,fecha_prevista,fecha_inicio_real,fecha_fin_real,fecha_real,observaciones,cancelado,motivo_cancelacion,cancelado_en,version,accion_sistema,etapa_origen_id,creado_en,actualizado_en')
        .eq('id', stage.id)
        .maybeSingle(),
      supabase
        .from('trabajos_etapa_hotel')
        .select('id,tipo_trabajo,categoria_tecnica,motivo_entrada,diagnostico_real,km_averia,expediente,descripcion,peritaje_estado,observaciones,cancelado,motivo_cancelacion,version,creado_en,actualizado_en')
        .eq('etapa_hotel_id', stage.id)
        .order('creado_en', { ascending: true }),
      supabase
        .from('catalogo_tipos_trabajo')
        .select('codigo,nombre,requiere_expediente,requiere_diagnostico')
        .eq('activo', true)
        .order('nombre', { ascending: true }),
      canEditWorkTypes(),
    ]);

    currentStage = stageResult.data || stage;
    currentWorks = worksResult.error ? [] : (worksResult.data || []);
    currentCatalogue = catalogueResult.error ? [] : (catalogueResult.data || []);
    editable = editAccess === true;
    warnings = [];
    if (stageResult.error) warnings.push(`No se pudo refrescar la T: ${stageResult.error.message}`);
    if (worksResult.error) warnings.push(`No se pudieron cargar los trabajos: ${worksResult.error.message}`);
    if (catalogueResult.error) warnings.push(`No se pudo cargar el listado de tipos: ${catalogueResult.error.message}`);
    redraw('');
  } catch (error) {
    loading.className = 'a56-stage-warning';
    loading.textContent = `No se pudo abrir la ficha de la T: ${error?.message || 'error desconocido'}`;
  }
}
