import { detail, element } from '../../r1-alpha17/src/dom.js';
import { createStageDocuments, summarizeDocuments } from '../../r1-alpha67/src/hotel-documents.js';
import { openStageDetail } from '../../r1-alpha67/src/stage-detail.js';
import { createOperationalDates, createSubstitutionBilling } from './card-operational.js';
import { createQuickStageControl } from '../../r1-alpha67/src/stage-quick.js';
import { renderAnnotationsChronology, renderQuickAnnotationComposer } from './annotations.js';
import {
  STATE_LABELS,
  STAGE_STATE_LABELS,
  formatDateTime,
  vehicleLabel,
  substituteText,
} from '../../r1-alpha53/src/hotel-utils.js';

function stageVisual(stage) {
  if (stage.cancelado === true || stage.estado === 'anulada') {
    return { marker: '×', className: 'stage-cancelled', label: 'Anulada' };
  }
  const customLabel = stage.estado_catalogo_codigo && stage.estado_catalogo_codigo !== stage.estado
    ? stage.estado_catalogo_codigo
    : '';
  if (stage.estado === 'realizada') return { marker: '✓', className: 'stage-done', label: customLabel || 'Realizada' };
  if (stage.estado === 'en_curso') return { marker: '→', className: 'stage-active', label: customLabel || 'En curso' };
  if (stage.estado === 'programada') return { marker: '○', className: 'stage-scheduled', label: customLabel || 'Programada' };
  return { marker: '○', className: 'stage-pending', label: customLabel || STAGE_STATE_LABELS[stage.estado] || stage.estado || 'Pendiente' };
}

function stageDate(stage) {
  if (stage.cancelado === true || stage.estado === 'anulada') return null;
  if (stage.estado === 'realizada') {
    return { label: 'Realizada', value: stage.fecha_real || stage.fecha_fin_real || stage.fecha_inicio_real };
  }
  if (stage.estado === 'en_curso') {
    return { label: 'Inicio', value: stage.fecha_inicio_real || stage.fecha_prevista };
  }
  return { label: 'Programada', value: stage.fecha_prevista };
}

function isInteractiveTarget(target) {
  return Boolean(target?.closest?.('button,a,input,textarea,select,summary,details,label'));
}

function renderStage(stage, documentsByGroup, canEditDocuments, onDocumentsChanged) {
  const visual = stageVisual(stage);
  const dateInfo = stageDate(stage);
  const meta = [];

  if (stage.lugar) meta.push(stage.lugar);
  if (dateInfo?.value) meta.push(`${dateInfo.label}: ${formatDateTime(dateInfo.value)}`);
  if (!dateInfo?.value && stage.cancelado !== true && stage.estado !== 'anulada') meta.push('Sin fecha');

  const currentDocuments = () => documentsByGroup.get(stage.grupo_documental_id) || [];
  const openDetail = event => {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    openStageDetail(stage, { documents: currentDocuments() });
  };

  const openButton = element('button', {
    className: 'a56-stage-open',
    type: 'button',
    title: 'Abrir la ficha completa de esta T',
    'aria-label': `Abrir ficha completa de ${stage.posicion ?? '—'}T ${stage.nombre || ''}`,
  }, [
    element('span', {
      className: 'a56-stage-title',
      text: `${stage.posicion ?? '—'}T · ${stage.nombre || 'T sin nombre'}`,
    }),
    element('span', { className: 'a56-stage-open-label', text: 'Ver ficha' }),
  ]);
  openButton.addEventListener('click', openDetail);

  const content = element('div', { className: 'hotel-stage-content' }, [
    element('div', { className: 'hotel-stage-main' }, [
      openButton,
      element('span', { className: `hotel-stage-status ${visual.className}`, text: visual.label }),
    ]),
    element('div', { className: 'hotel-stage-meta', text: meta.join(' · ') || 'Sin lugar ni fecha' }),
  ]);

  if (stage.observaciones) {
    content.append(element('div', { className: 'hotel-stage-note', text: stage.observaciones }));
  }
  if ((stage.cancelado === true || stage.estado === 'anulada') && stage.motivo_cancelacion) {
    content.append(element('div', {
      className: 'hotel-stage-note cancelled-note',
      text: `Motivo: ${stage.motivo_cancelacion}`,
    }));
  }

  // Control nativo de la propia T. Solo se renderiza para el administrador principal.
  content.append(createQuickStageControl(stage));

  content.append(createStageDocuments(stage, {
    canEdit: canEditDocuments,
    documents: currentDocuments(),
    context: 'Los archivos pertenecen a esta T y permanecen disponibles también en Histórico.',
    onChanged: next => {
      documentsByGroup.set(stage.grupo_documental_id, next);
      onDocumentsChanged();
    },
  }));

  const row = element('section', {
    className: `a56-stage-row ${visual.className}`,
    dataset: { stageId: stage.id || '' },
  }, [
    element('span', { className: 'a56-stage-marker', text: visual.marker }),
    content,
  ]);

  row.addEventListener('click', event => {
    if (isInteractiveTarget(event.target)) return;
    openDetail(event);
  });
  return row;
}

function documentsForStages(stages, documentsByGroup) {
  return stages.flatMap(stage => documentsByGroup.get(stage.grupo_documental_id) || []);
}

function renderStages(stages, documentsByGroup, canEditDocuments, onDocumentsChanged) {
  const ordered = stages.slice().sort((a, b) =>
    Number(Boolean(a.cancelado)) - Number(Boolean(b.cancelado))
    || Number(a.posicion || 0) - Number(b.posicion || 0)
  );
  const active = ordered.filter(stage => stage.cancelado !== true && stage.estado !== 'anulada');
  const cancelled = ordered.filter(stage => stage.cancelado === true || stage.estado === 'anulada');

  const section = element('section', { className: 'hotel-card-stages' });
  section.append(element('div', { className: 'hotel-stage-heading' }, [
    element('h4', { text: 'T de la parada' }),
    element('span', { className: 'badge', text: `${active.length} activa${active.length === 1 ? '' : 's'}` }),
  ]));

  const list = element('div', { className: 'hotel-stage-list' });
  if (!active.length) {
    list.append(element('div', { className: 'hotel-stage-empty', text: 'No hay T activas registradas.' }));
  } else {
    active.forEach(stage => list.append(renderStage(
      stage,
      documentsByGroup,
      canEditDocuments,
      onDocumentsChanged
    )));
  }
  section.append(list);

  if (cancelled.length) {
    const history = element('div', { className: 'hotel-stage-list cancelled-list' });
    cancelled.forEach(stage => history.append(renderStage(
      stage,
      documentsByGroup,
      canEditDocuments,
      onDocumentsChanged
    )));
    section.append(element('details', { className: 'hotel-stage-history' }, [
      element('summary', { text: `T anuladas / histórico · ${cancelled.length}` }),
      history,
    ]));
  }

  return section;
}

export function renderHotelCard(row, stages, documentsByGroup, manualNotes, {
  editMode,
  editableIds,
  canEditDocuments,
  canAddNotes,
  onAddNote,
  onOpenEditor,
}) {
  const badges = element('div', { className: 'hotel-card-badges' }, [
    element('span', { className: 'badge', text: `Prioridad ${row.prioridad ?? '—'}` }),
    element('span', { className: 'badge', text: STATE_LABELS[row.estado] || row.estado || 'Sin estado' }),
    element('span', { className: 'badge', text: `Fondo ${row.fondo_visual || 'blanco'}` }),
    row.trazo_marron
      ? element('span', { className: 'badge hotel-brown-outline-badge', text: 'Trazo marrón' })
      : null,
    row.modalidad_operativa_nombre
      ? element('span', { className: 'badge', text: row.modalidad_operativa_nombre })
      : null,
  ]);

  const editable = editableIds.has(row.id);
  const card = element('article', {
    className: `card hotel-card hotel-final-card hotel-bg-${row.fondo_visual || 'blanco'}${row.trazo_marron ? ' hotel-outline-brown' : ''}`,
    dataset: { state: row.estado || '' },
  });

  card.append(
    element('div', { className: 'hotel-card-head' }, [
      element('div', {}, [
        element('h3', { text: vehicleLabel(row) }),
        element('div', { className: 'hotel-substitute-line', text: substituteText(row) }),
      ]),
      badges,
    ]),
    createOperationalDates(row, stages),
    element('div', { className: 'detail-grid' }, [
      detail('Nº de parada', row.numero_parada),
      detail('Lugar', row.lugar),
      detail('UPC', row.upc),
      detail('Causa', row.causa),
      detail('INC', row.incidencia),
      detail('Próximo', row.proximo),
      detail('T realizadas', `${row.t_realizadas ?? 0} de ${row.total_t ?? 0}`),
      detail('T pendientes', row.t_pendientes ?? 0),
    ])
  );

  const chronology = renderAnnotationsChronology(stages, manualNotes, row.observaciones);
  if (chronology) card.append(chronology);
  if (canAddNotes && typeof onAddNote === 'function') {
    card.append(renderQuickAnnotationComposer(text => onAddNote(row.id, text)));
  }

  card.append(createSubstitutionBilling(row, { allowManual: true }));

  const documentSummary = element('div', { className: 'a53-card-doc-summary' });
  const updateDocumentSummary = () => {
    const summary = summarizeDocuments(documentsForStages(stages, documentsByGroup));
    documentSummary.replaceChildren(
      element('strong', { text: `📎 ${summary.total} archivo${summary.total === 1 ? '' : 's'}` }),
      element('span', {
        className: 'muted',
        text: `${summary.photos} foto${summary.photos === 1 ? '' : 's'} · ${summary.pdfs} PDF${summary.cancelled ? ` · ${summary.cancelled} anulado${summary.cancelled === 1 ? '' : 's'}` : ''}`,
      })
    );
  };

  updateDocumentSummary();
  card.append(
    documentSummary,
    renderStages(stages, documentsByGroup, canEditDocuments, updateDocumentSummary)
  );

  if (editMode && editable) {
    const button = element('button', {
      className: 'button primary a56-open-editor',
      type: 'button',
      text: 'Abrir edición completa',
    });
    button.addEventListener('click', () => onOpenEditor(row.id));
    card.append(button);
  }

  return card;
}
