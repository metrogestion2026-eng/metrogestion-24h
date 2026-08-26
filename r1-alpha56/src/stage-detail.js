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

function renderWork(work, index) {
  const host = el('article', null, `a56-work-card${work.cancelado ? ' cancelled' : ''}`);
  const head = el('div', null, 'a56-work-head');
  head.append(
    el('strong', `${index + 1}. ${work.tipo_trabajo || 'Trabajo'}`),
    el('span', work.cancelado ? 'Anulado' : 'Activo', 'badge')
  );
  host.append(head);

  const grid = el('div', null, 'a56-stage-grid');
  grid.append(
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

function renderStage(stage, works, documents, warning = '') {
  const content = el('div', null, 'a56-stage-detail-content');
  const stateLine = el('div', null, 'a56-stage-detail-state');
  stateLine.append(
    el('span', `T ${stage.posicion ?? '—'}`, 'badge'),
    el('span', stageState(stage), 'badge'),
    el('span', 'Vista de consulta', 'badge')
  );
  content.append(stateLine);

  if (warning) content.append(el('div', warning, 'a56-stage-warning'));

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

  const worksSection = el('section', null, 'a56-stage-section');
  const worksHead = el('div', null, 'a56-stage-section-head');
  worksHead.append(el('h4', 'Trabajos asociados'), el('span', String(works.length), 'badge'));
  worksSection.append(worksHead);
  const worksList = el('div', null, 'a56-work-list');
  if (!works.length) worksList.append(el('div', 'No hay trabajos asociados a esta T.', 'a56-stage-empty'));
  else works.forEach((work, index) => worksList.append(renderWork(work, index)));
  worksSection.append(worksList);
  content.append(worksSection, renderDocuments(documents));
  return content;
}

export async function openStageDetail(stage, { documents = [] } = {}) {
  if (!stage?.id) {
    window.alert('No se puede abrir la T porque no dispone de identificador.');
    return;
  }

  const viewer = modal(`${stage.posicion ?? '—'}T · ${stage.nombre || 'Ficha de la T'}`);
  viewer.overlay.classList.add('a56-stage-detail-modal');
  const loading = el('div', 'Cargando ficha completa de la T…', 'a56-stage-loading');
  viewer.card.append(loading);

  try {
    const [stageResult, worksResult] = await Promise.all([
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
    ]);

    const currentStage = stageResult.data || stage;
    const warnings = [];
    if (stageResult.error) warnings.push(`No se pudo refrescar la T: ${stageResult.error.message}`);
    if (worksResult.error) warnings.push(`No se pudieron cargar los trabajos: ${worksResult.error.message}`);
    loading.replaceWith(renderStage(
      currentStage,
      worksResult.error ? [] : (worksResult.data || []),
      documents,
      warnings.join(' · ')
    ));
  } catch (error) {
    loading.className = 'a56-stage-warning';
    loading.textContent = `No se pudo abrir la ficha de la T: ${error?.message || 'error desconocido'}`;
  }
}
