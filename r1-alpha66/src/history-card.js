import { detail, element } from '../../r1-alpha17/src/dom.js';
import { openHotelEditor } from './hotel-editor.js';
import { createStageDocuments, summarizeDocuments } from './hotel-documents.js';
import { openStageDetail } from './stage-detail.js';
import { createOperationalDates, createSubstitutionBilling } from './card-operational.js';

export function formatDateTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? String(value)
    : date.toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' });
}

export function titleFor(row) {
  if (row.dfm) {
    return `${String(row.dfm).startsWith('R') ? 'Semirremolque' : 'DFM'} ${row.dfm} · ${row.matricula || '—'}`;
  }
  return `Reserva ${row.reserva || '—'} · ${row.matricula_reserva || '—'}`;
}

function stageStatus(stage) {
  if (stage.cancelado || stage.estado === 'anulada') return 'Anulada';
  return ({
    pendiente: 'Pendiente',
    programada: 'Programada',
    en_curso: 'En curso',
    realizada: 'Realizada',
  })[stage.estado] || stage.estado || '—';
}

function stageDate(stage) {
  if (stage.cancelado || stage.estado === 'anulada') return '';
  if (stage.estado === 'realizada') {
    return stage.fecha_real || stage.fecha_fin_real || stage.fecha_inicio_real || '';
  }
  if (stage.estado === 'en_curso') return stage.fecha_inicio_real || stage.fecha_prevista || '';
  return stage.fecha_prevista || '';
}

export function documentsForStages(stages, documentsByGroup) {
  return stages.flatMap(stage => documentsByGroup.get(stage.grupo_documental_id) || []);
}

function renderHistoricalStage(stage, documentsByGroup, canEditDocuments, onDocumentsChanged) {
  const documents = () => documentsByGroup.get(stage.grupo_documental_id) || [];
  const host = element('section', {
    className: 'a53-history-stage a56-history-stage',
    dataset: { stageId: stage.id || '' },
  });

  const openButton = element('button', {
    className: 'a56-history-stage-open',
    type: 'button',
    title: 'Abrir ficha completa de esta T',
  }, [
    element('span', { text: `${stage.posicion ?? '—'}T · ${stage.nombre || 'T sin nombre'}` }),
    element('small', { text: 'Ver ficha' }),
  ]);
  openButton.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    openStageDetail(stage, { documents: documents() });
  });

  const head = element('div', { className: 'a53-history-stage-head' }, [
    openButton,
    element('span', { className: 'badge', text: stageStatus(stage) }),
  ]);
  const meta = [
    stage.lugar,
    stageDate(stage) ? formatDateTime(stageDate(stage)) : 'Sin fecha',
  ].filter(Boolean).join(' · ');

  host.append(head, element('div', { className: 'a53-history-stage-meta', text: meta }));
  if (stage.observaciones) host.append(element('p', { text: stage.observaciones }));
  if ((stage.cancelado || stage.estado === 'anulada') && stage.motivo_cancelacion) {
    host.append(element('div', {
      className: 'notice danger',
      text: `T anulada: ${stage.motivo_cancelacion}`,
    }));
  }

  host.append(createStageDocuments(stage, {
    canEdit: canEditDocuments,
    documents: documents(),
    context: 'Documento único de la T: se muestra en esta fecha y en las demás fichas de su recorrido.',
    onChanged: next => {
      documentsByGroup.set(stage.grupo_documental_id, next);
      onDocumentsChanged();
    },
  }));
  return host;
}

export function renderHistoricalCard(row, stages, documentsByGroup, access, onSaved) {
  const flags = [];
  if (row.retirado_hotel_activo) flags.push('Retirado del Hotel activo');
  if (row.cancelado) {
    flags.push(`Cancelado${row.motivo_cancelacion ? `: ${row.motivo_cancelacion}` : ''}`);
  }

  const card = element('article', {
    className: 'card hotel-card',
    dataset: { state: row.estado || '' },
  });
  card.append(
    element('div', { className: 'hotel-card-head' }, [
      element('div', {}, [
        element('h3', { text: titleFor(row) }),
        flags.length ? element('div', { className: 'muted', text: flags.join(' · ') }) : null,
      ]),
      element('span', {
        className: 'badge',
        text: row.numero_parada ? `Parada ${row.numero_parada}` : 'Sin nº de parada',
      }),
    ]),
    createOperationalDates(row, stages),
    element('div', { className: 'detail-grid' }, [
      detail('Estado', row.estado),
      detail('Reserva', row.reserva),
      detail('Prioridad', row.prioridad),
      detail('Lugar', row.lugar),
      detail('Causa', row.causa),
      detail('INC', row.incidencia),
      detail('T realizadas', `${row.t_realizadas ?? 0} de ${row.total_t ?? 0}`),
      detail('Versión', row.version),
      detail('Última modificación', formatDateTime(row.actualizado_en)),
    ])
  );

  card.append(createSubstitutionBilling(row, { allowManual: false }));

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
  card.append(documentSummary);
  const stageList = element('div', { className: 'grid' });
  if (!stages.length) {
    stageList.append(element('span', { className: 'muted', text: 'Sin T registradas.' }));
  } else {
    stages
      .slice()
      .sort((a, b) => Number(a.posicion || 0) - Number(b.posicion || 0))
      .forEach(stage => stageList.append(renderHistoricalStage(
        stage,
        documentsByGroup,
        access.editDocuments,
        updateDocumentSummary
      )));
  }
  card.append(stageList);

  if (access.editFicha) {
    const button = element('button', {
      className: 'button primary compact',
      type: 'button',
      text: 'Editar ficha histórica',
    });
    button.addEventListener('click', () => openHotelEditor(row.id, { onSaved }));
    card.append(element('div', { className: 'reserve-actions' }, [button]));
  }
  return card;
}
