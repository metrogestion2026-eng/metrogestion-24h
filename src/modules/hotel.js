import { clear, detail, element, notice } from '../dom.js';
import { supabase } from '../supabase.js';
import { openHotelEditor } from './hotel-editor.js';

const STATE_LABELS = Object.freeze({
  planificado: 'Pendiente de parar',
  pendiente_taller: 'Pendiente de taller',
  pendiente_diagnostico: 'Pendiente de diagnóstico',
  pendiente_autorizacion: 'Pendiente de autorización',
  en_taller: 'En taller',
  pendiente_repuestos: 'Pendiente de repuestos',
  terminado_pendiente_recogida: 'Terminado, pendiente de recoger',
  recogido_pendiente_ruta: 'Recogido, recuperar ruta',
  reserva_liberada: 'Reserva libre',
  anulado: 'Anulado'
});

const STAGE_STATE_LABELS = Object.freeze({
  pendiente: 'Pendiente',
  programada: 'Programada',
  en_curso: 'En curso',
  realizada: 'Realizada',
  anulada: 'Anulada'
});

function vehicleLabel(row) {
  if (row.dfm) return `${String(row.dfm).startsWith('R') ? 'Semirremolque' : 'DFM'} ${row.dfm}${row.matricula ? ` · ${row.matricula}` : ''}`;
  return `Reserva ${row.reserva || '—'}${row.matricula_reserva ? ` · ${row.matricula_reserva}` : ''}`;
}

function metric(label, value) {
  return element('div', { className: 'metric' }, [
    element('strong', { text: value }),
    element('span', { className: 'muted', text: label })
  ]);
}

function formatDateTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('es-ES', {
    dateStyle: 'short',
    timeStyle: 'short'
  }).format(date);
}

function normalizeStages(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function stageVisual(stage) {
  if (stage.cancelado === true || stage.estado === 'anulada') {
    return { marker: '×', className: 'stage-cancelled', label: 'Anulada' };
  }
  if (stage.estado === 'realizada') {
    return { marker: '✓', className: 'stage-done', label: 'Realizada' };
  }
  if (stage.estado === 'en_curso') {
    return { marker: '→', className: 'stage-active', label: 'En curso' };
  }
  if (stage.estado === 'programada') {
    return { marker: '○', className: 'stage-scheduled', label: 'Programada' };
  }
  return { marker: '○', className: 'stage-pending', label: STAGE_STATE_LABELS[stage.estado] || stage.estado || 'Pendiente' };
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

function renderStage(stage) {
  const visual = stageVisual(stage);
  const dateInfo = stageDate(stage);
  const metaParts = [];

  if (stage.lugar) metaParts.push(stage.lugar);
  if (dateInfo?.value) metaParts.push(`${dateInfo.label}: ${formatDateTime(dateInfo.value)}`);
  if (!dateInfo?.value && stage.cancelado !== true && stage.estado !== 'anulada') metaParts.push('Sin fecha');

  const main = element('div', { className: 'hotel-stage-main' }, [
    element('strong', { text: `${stage.posicion ?? '—'}T · ${stage.nombre || 'T sin nombre'}` }),
    element('span', { className: `hotel-stage-status ${visual.className}`, text: visual.label })
  ]);

  const content = element('div', { className: 'hotel-stage-content' }, [
    main,
    element('div', { className: 'hotel-stage-meta', text: metaParts.join(' · ') || 'Sin lugar ni fecha' })
  ]);

  if (stage.observaciones) {
    content.append(element('div', { className: 'hotel-stage-note', text: stage.observaciones }));
  }
  if ((stage.cancelado === true || stage.estado === 'anulada') && stage.motivo_cancelacion) {
    content.append(element('div', { className: 'hotel-stage-note cancelled-note', text: `Motivo: ${stage.motivo_cancelacion}` }));
  }

  return element('div', { className: `hotel-stage-row ${visual.className}` }, [
    element('span', { className: 'hotel-stage-marker', text: visual.marker, 'aria-hidden': 'true' }),
    content
  ]);
}

function renderStages(row) {
  const stages = normalizeStages(row.etapas_resumen)
    .slice()
    .sort((left, right) => {
      const cancelledDifference = Number(Boolean(left.cancelado)) - Number(Boolean(right.cancelado));
      if (cancelledDifference !== 0) return cancelledDifference;
      return Number(left.posicion || 0) - Number(right.posicion || 0);
    });

  const activeStages = stages.filter(stage => stage.cancelado !== true && stage.estado !== 'anulada');
  const cancelledStages = stages.filter(stage => stage.cancelado === true || stage.estado === 'anulada');

  const section = element('section', { className: 'hotel-card-stages', 'aria-label': 'T de la parada' });
  section.append(element('div', { className: 'hotel-stage-heading' }, [
    element('h4', { text: 'T de la parada' }),
    element('span', { className: 'badge', text: `${activeStages.length} activa${activeStages.length === 1 ? '' : 's'}` })
  ]));

  const list = element('div', { className: 'hotel-stage-list' });
  if (!activeStages.length) {
    list.append(element('div', { className: 'hotel-stage-empty', text: 'No hay T activas registradas.' }));
  } else {
    activeStages.forEach(stage => list.append(renderStage(stage)));
  }
  section.append(list);

  if (cancelledStages.length) {
    const historicalList = element('div', { className: 'hotel-stage-list cancelled-list' });
    cancelledStages.forEach(stage => historicalList.append(renderStage(stage)));
    section.append(element('details', { className: 'hotel-stage-history' }, [
      element('summary', { text: `T anuladas / histórico · ${cancelledStages.length}` }),
      historicalList
    ]));
  }

  return section;
}

function renderCard(row, { editMode, pilotIds, onOpenEditor }) {
  const badges = element('div', { className: 'hotel-card-badges' }, [
    element('span', { className: 'badge', text: `Prioridad ${row.prioridad ?? '—'}` }),
    element('span', { className: 'badge', text: STATE_LABELS[row.estado] || row.estado || 'Sin estado' })
  ]);

  const pilot = pilotIds.has(row.id);
  if (pilot) badges.append(element('span', { className: 'badge pilot-badge', text: 'Piloto editable' }));

  const head = element('div', { className: 'hotel-card-head' }, [
    element('div', {}, [
      element('h3', { text: vehicleLabel(row) }),
      element('div', { className: 'muted', text: row.reserva ? `Reserva ${row.reserva}${row.matricula_reserva ? ` · ${row.matricula_reserva}` : ''}` : 'Sin reserva asignada' })
    ]),
    badges
  ]);

  const details = element('div', { className: 'detail-grid' }, [
    detail('Nº de parada', row.numero_parada),
    detail('Lugar', row.lugar),
    detail('UPC', row.upc),
    detail('Causa / pendientes', row.causa),
    detail('INC', row.incidencia),
    detail('Próximo previsto', row.proximo),
    detail('T realizadas', `${row.t_realizadas ?? 0} de ${row.total_t ?? 0}`),
    detail('T pendientes', row.t_pendientes ?? 0),
    detail('Versión', row.version),
    detail('Última actualización', row.actualizado_en ? new Date(row.actualizado_en).toLocaleString('es-ES') : '—')
  ]);

  const card = element('article', { className: 'card hotel-card', dataset: { state: row.estado || '' } }, [
    head,
    details,
    renderStages(row)
  ]);

  if (pilot) {
    const pilotInfo = editMode
      ? notice('Edición habilitada para esta ficha piloto. Los cambios se guardan juntos y quedan auditados.', 'warning')
      : notice('Ficha piloto preparada. Activa “Lectura y edición” para abrir el formulario completo.', 'success');
    card.append(pilotInfo);
  }

  if (editMode && pilot) {
    const openButton = element('button', { className: 'button primary hotel-open-editor', type: 'button', text: 'Abrir edición completa' });
    openButton.addEventListener('click', () => onOpenEditor(row.id));
    card.append(openButton);
  }

  return card;
}

export async function renderHotel(container, access = { view: false, edit: false }) {
  clear(container);
  let editMode = false;

  const titleBlock = element('div', {}, [
    element('h2', { text: 'Hotel · Pizarra actual' }),
    element('p', { className: 'muted', text: 'Una única interfaz para todos los perfiles. Abre siempre protegida en modo lectura.' })
  ]);

  const headingActions = element('div', { className: 'hotel-heading-actions' }, [
    element('span', { className: 'badge', text: 'Fuente: hotel_actual_detalle' })
  ]);

  const modeButton = access.edit
    ? element('button', { className: 'button secondary hotel-mode-button', type: 'button', text: '🔒 Modo lectura' })
    : null;
  if (modeButton) headingActions.prepend(modeButton);

  const heading = element('div', { className: 'module-heading' }, [titleBlock, headingActions]);
  const status = notice('Cargando la pizarra actual y sus T…', 'warning');
  container.append(heading, status);

  const [hotelResult, pilotResult] = await Promise.all([
    supabase.from('hotel_actual_detalle').select('*').order('orden', { ascending: true }),
    access.edit
      ? supabase.from('hotel_edicion_piloto').select('registro_hotel_id').eq('activo', true)
      : Promise.resolve({ data: [], error: null })
  ]);

  status.remove();

  if (hotelResult.error) {
    container.append(notice(`No se pudo cargar Hotel: ${hotelResult.error.message}`, 'danger'));
    return;
  }
  if (pilotResult.error) {
    container.append(notice(`Hotel se cargó en lectura, pero no pudo comprobarse el piloto de edición: ${pilotResult.error.message}`, 'warning'));
  }

  const rows = hotelResult.data || [];
  const pilotIds = new Set((pilotResult.data || []).map(row => row.registro_hotel_id));
  const active = rows.length;
  const workshop = rows.filter(row => ['pendiente_diagnostico', 'pendiente_autorizacion', 'en_taller', 'pendiente_repuestos'].includes(row.estado)).length;
  const ready = rows.filter(row => row.estado === 'terminado_pendiente_recogida').length;
  const planned = rows.filter(row => row.estado === 'planificado').length;

  const summary = element('div', { className: 'summary-grid' }, [
    metric('Movimientos activos', active),
    metric('En gestión de taller', workshop),
    metric('Terminados para recoger', ready),
    metric('Pendientes de parar', planned)
  ]);
  const modeNotice = element('div', { className: 'hotel-mode-notice' });
  const list = element('div', { className: 'grid' });
  container.append(summary, modeNotice, list);

  const renderRows = () => {
    list.replaceChildren();
    modeNotice.replaceChildren();

    if (access.edit) {
      modeNotice.append(editMode
        ? notice('⚠ Lectura y edición activada. Solo la ficha piloto muestra el formulario; el resto sigue protegido.', 'warning')
        : notice('🔒 Protección activada: ninguna ficha puede modificarse.', 'success'));
    } else {
      modeNotice.append(notice('Modo lectura permanente: este usuario no tiene permiso de edición.', 'success'));
    }

    if (!rows.length) {
      list.append(notice('No hay registros visibles en la pizarra actual.', 'success'));
      return;
    }

    rows.forEach(row => {
      list.append(renderCard(row, {
        editMode: access.edit && editMode,
        pilotIds,
        onOpenEditor: async id => {
          await openHotelEditor(id, {
            onSaved: async () => {
              await renderHotel(container, access);
            }
          });
        }
      }));
    });
  };

  if (modeButton) {
    modeButton.addEventListener('click', () => {
      editMode = !editMode;
      modeButton.textContent = editMode ? '✏️ Lectura y edición' : '🔒 Modo lectura';
      modeButton.classList.toggle('primary', editMode);
      modeButton.classList.toggle('secondary', !editMode);
      renderRows();
    });
  }

  renderRows();
}
