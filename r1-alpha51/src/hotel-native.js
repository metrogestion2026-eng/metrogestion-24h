import { clear, detail, element, notice } from '../../r1-alpha17/src/dom.js';
import { supabase } from '../../r1-alpha17/src/supabase.js';
import { openHotelEditor } from '../../r1-alpha17/src/modules/hotel-editor.js';

const STATE_LABELS = Object.freeze({
  planificado: 'Pendiente de parar',
  pendiente_taller: 'Pendiente de taller',
  pendiente_diagnostico: 'Pendiente de diagnóstico',
  pendiente_autorizacion: 'Pendiente de autorización',
  en_taller: 'En taller',
  pendiente_repuestos: 'Pendiente de repuestos',
  terminado_pendiente_recogida: 'Pendiente de recoger',
  recogido_pendiente_ruta: 'Pendiente de recuperar',
  reserva_liberada: 'Reserva libre',
  recuperado: 'Recuperado',
  anulado: 'Anulado',
});

const STAGE_STATE_LABELS = Object.freeze({
  pendiente: 'Pendiente',
  programada: 'Programada',
  en_curso: 'En curso',
  realizada: 'Realizada',
  anulada: 'Anulada',
});

const HOTEL_FILTERS = Object.freeze([
  { key: 'all', label: 'Fichas activas', states: null, title: 'Mostrar todas las fichas activas' },
  { key: 'planned', label: 'Pendientes de parar', states: new Set(['planificado']), title: 'Mostrar solo pendientes de parar' },
  { key: 'pending-workshop', label: 'Pendientes de taller', states: new Set(['pendiente_taller']), title: 'Mostrar solo pendientes de taller' },
  { key: 'workshop', label: 'En taller', states: new Set(['en_taller', 'pendiente_diagnostico', 'pendiente_autorizacion', 'pendiente_repuestos']), title: 'Mostrar solo vehículos en taller' },
  { key: 'pickup', label: 'Pendientes de recoger', states: new Set(['terminado_pendiente_recogida']), title: 'Mostrar solo pendientes de recoger' },
  { key: 'recover', label: 'Pendientes de recuperar', states: new Set(['recogido_pendiente_ruta']), title: 'Mostrar solo pendientes de recuperar' },
]);

function ensureNativeHotelStyle() {
  if (document.querySelector('#alpha51-native-hotel-style')) return;
  const style = document.createElement('style');
  style.id = 'alpha51-native-hotel-style';
  style.textContent = `
    .hotel-card.alpha51-native-filter-hidden{display:none!important}
    .hotel-filter-metric[data-alpha51-active="1"]{outline:3px solid #075985;outline-offset:2px;background:#f0f9ff}
  `;
  document.head.append(style);
}
ensureNativeHotelStyle();

function metric(filter, value) {
  const node = element('div', {
    className: 'metric hotel-filter-metric',
    dataset: { hotelFilter: filter.key },
  }, [
    element('strong', { text: value }),
    element('span', { className: 'muted', text: filter.label }),
  ]);
  node.setAttribute('role', 'button');
  node.setAttribute('tabindex', '0');
  node.setAttribute('aria-label', filter.title);
  node.setAttribute('aria-pressed', 'false');
  node.title = filter.title;
  if (filter.key === 'pending-workshop') node.dataset.alpha33Pending = '1';
  if (filter.key === 'planned') node.dataset.alpha51Planned = '1';
  return node;
}

function formatDateTime(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ''
    : new Intl.DateTimeFormat('es-ES', { dateStyle: 'short', timeStyle: 'short' }).format(date);
}

function formatBoardDate(value) {
  if (!value) return 'Fecha no disponible';
  const [year, month, day] = String(value).split('-');
  return year && month && day ? `${day}/${month}/${year}` : String(value);
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

function vehicleLabel(row) {
  if (row.dfm) {
    return `${String(row.dfm).startsWith('R') ? 'Semirremolque' : 'DFM'} ${row.dfm}${row.matricula ? ` · ${row.matricula}` : ''}`;
  }
  return `${row.tipo_sustituto === 'RESERVA' ? 'Reserva' : 'Unidad'} ${row.sustituto || row.reserva || '—'}${(row.matricula_sustituto || row.matricula_reserva) ? ` · ${row.matricula_sustituto || row.matricula_reserva}` : ''}`;
}

function substituteText(row) {
  const code = row.sustituto || row.reserva;
  if (!code) return 'Sin sustituto asignado';
  const type = row.tipo_sustituto || 'RESERVA';
  const registration = row.matricula_sustituto || row.matricula_reserva;
  const extra = type === 'RESERVA' && row.etiqueta_sustituto ? ` · ${row.etiqueta_sustituto}` : '';
  return `${type} ${code}${registration ? ` · ${registration}` : ''}${extra}`;
}

function stageVisual(stage) {
  if (stage.cancelado === true || stage.estado === 'anulada') return { marker: '×', className: 'stage-cancelled', label: 'Anulada' };
  if (stage.estado === 'realizada') return { marker: '✓', className: 'stage-done', label: 'Realizada' };
  if (stage.estado === 'en_curso') return { marker: '→', className: 'stage-active', label: 'En curso' };
  if (stage.estado === 'programada') return { marker: '○', className: 'stage-scheduled', label: 'Programada' };
  return { marker: '○', className: 'stage-pending', label: STAGE_STATE_LABELS[stage.estado] || stage.estado || 'Pendiente' };
}

function stageDate(stage) {
  if (stage.cancelado === true || stage.estado === 'anulada') return null;
  if (stage.estado === 'realizada') return { label: 'Realizada', value: stage.fecha_real || stage.fecha_fin_real || stage.fecha_inicio_real };
  if (stage.estado === 'en_curso') return { label: 'Inicio', value: stage.fecha_inicio_real || stage.fecha_prevista };
  return { label: 'Programada', value: stage.fecha_prevista };
}

function renderStage(stage) {
  const visual = stageVisual(stage);
  const dateInfo = stageDate(stage);
  const meta = [];
  if (stage.lugar) meta.push(stage.lugar);
  if (dateInfo?.value) meta.push(`${dateInfo.label}: ${formatDateTime(dateInfo.value)}`);
  if (!dateInfo?.value && stage.cancelado !== true && stage.estado !== 'anulada') meta.push('Sin fecha');

  const content = element('div', { className: 'hotel-stage-content' }, [
    element('div', { className: 'hotel-stage-main' }, [
      element('strong', { text: `${stage.posicion ?? '—'}T · ${stage.nombre || 'T sin nombre'}` }),
      element('span', { className: `hotel-stage-status ${visual.className}`, text: visual.label }),
    ]),
    element('div', { className: 'hotel-stage-meta', text: meta.join(' · ') || 'Sin lugar ni fecha' }),
  ]);

  if (stage.observaciones) content.append(element('div', { className: 'hotel-stage-note', text: stage.observaciones }));
  if ((stage.cancelado === true || stage.estado === 'anulada') && stage.motivo_cancelacion) {
    content.append(element('div', { className: 'hotel-stage-note cancelled-note', text: `Motivo: ${stage.motivo_cancelacion}` }));
  }

  return element('div', { className: `hotel-stage-row ${visual.className}` }, [
    element('span', { className: 'hotel-stage-marker', text: visual.marker }),
    content,
  ]);
}

function renderStages(row) {
  const stages = normalizeStages(row.etapas_resumen)
    .slice()
    .sort((a, b) => Number(Boolean(a.cancelado)) - Number(Boolean(b.cancelado)) || Number(a.posicion || 0) - Number(b.posicion || 0));
  const active = stages.filter(stage => stage.cancelado !== true && stage.estado !== 'anulada');
  const cancelled = stages.filter(stage => stage.cancelado === true || stage.estado === 'anulada');
  const section = element('section', { className: 'hotel-card-stages' });
  section.append(element('div', { className: 'hotel-stage-heading' }, [
    element('h4', { text: 'T de la parada' }),
    element('span', { className: 'badge', text: `${active.length} activa${active.length === 1 ? '' : 's'}` }),
  ]));

  const list = element('div', { className: 'hotel-stage-list' });
  if (!active.length) list.append(element('div', { className: 'hotel-stage-empty', text: 'No hay T activas registradas.' }));
  else active.forEach(stage => list.append(renderStage(stage)));
  section.append(list);

  if (cancelled.length) {
    const history = element('div', { className: 'hotel-stage-list cancelled-list' });
    cancelled.forEach(stage => history.append(renderStage(stage)));
    section.append(element('details', { className: 'hotel-stage-history' }, [
      element('summary', { text: `T anuladas / histórico · ${cancelled.length}` }),
      history,
    ]));
  }
  return section;
}

function renderCard(row, { editMode, editableIds, onOpenEditor }) {
  const badges = element('div', { className: 'hotel-card-badges' }, [
    element('span', { className: 'badge', text: `Prioridad ${row.prioridad ?? '—'}` }),
    element('span', { className: 'badge', text: STATE_LABELS[row.estado] || row.estado || 'Sin estado' }),
    element('span', { className: 'badge', text: `Fondo ${row.fondo_visual || 'blanco'}` }),
    row.trazo_marron ? element('span', { className: 'badge hotel-brown-outline-badge', text: 'Trazo marrón' }) : null,
  ]);
  const editable = editableIds.has(row.id);
  const card = element('article', {
    className: `card hotel-card hotel-final-card hotel-bg-${row.fondo_visual || 'blanco'}${row.trazo_marron ? ' hotel-outline-brown' : ''}`,
    dataset: { state: row.estado || '' },
  }, [
    element('div', { className: 'hotel-card-head' }, [
      element('div', {}, [
        element('h3', { text: vehicleLabel(row) }),
        element('div', { className: 'hotel-substitute-line', text: substituteText(row) }),
      ]),
      badges,
    ]),
    element('div', { className: 'detail-grid' }, [
      detail('Nº de parada', row.numero_parada),
      detail('Lugar', row.lugar),
      detail('UPC', row.upc),
      detail('Causa', row.causa),
      detail('INC', row.incidencia),
      detail('Próximo', row.proximo),
      detail('T realizadas', `${row.t_realizadas ?? 0} de ${row.total_t ?? 0}`),
      detail('T pendientes', row.t_pendientes ?? 0),
    ]),
    row.observaciones
      ? element('section', { className: 'hotel-final-notes' }, [
          element('strong', { text: 'Anotaciones' }),
          element('p', { text: row.observaciones }),
        ])
      : null,
    renderStages(row),
  ]);

  if (editMode && editable) {
    const button = element('button', { className: 'button primary hotel-open-editor', type: 'button', text: 'Abrir edición completa' });
    button.addEventListener('click', () => onOpenEditor(row.id));
    card.append(button);
  }
  return card;
}

async function getHotelAccess() {
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData?.user) return { view: false, edit: false };

  const { data: profile, error } = await supabase
    .from('usuarios')
    .select('activo,tipo_usuario,permisos')
    .eq('id', authData.user.id)
    .maybeSingle();
  if (error || profile?.activo !== true) return { view: false, edit: false };
  if (profile.tipo_usuario === 'administrador_principal') return { view: true, edit: true };

  const permission = profile.permisos?.hotel || {};
  const edit = permission.editar === true;
  const view = edit || permission.ver === true || permission.leer === true;
  return { view, edit };
}

async function renderHotelNative(container, access = { view: false, edit: false }) {
  clear(container);
  container.dataset.alpha51HotelNative = 'loading';
  let editMode = false;
  let activeFilter = 'all';

  const headingActions = element('div', { className: 'hotel-heading-actions' }, [
    element('span', { className: 'badge', text: 'Hotel activo real · Alpha51' }),
  ]);
  const modeButton = access.edit
    ? element('button', { className: 'button secondary hotel-mode-button', type: 'button', text: '🔒 Modo lectura' })
    : null;
  if (modeButton) headingActions.prepend(modeButton);

  const title = element('h2', { text: 'Hotel · Pizarra actual' });
  const subtitle = element('p', { className: 'muted', text: 'Cargando fecha de pizarra…' });
  container.append(element('div', { className: 'module-heading' }, [
    element('div', {}, [title, subtitle]),
    headingActions,
  ]));

  if (!access.view) {
    container.append(notice('No tienes permiso para consultar el Hotel.', 'danger'));
    container.dataset.alpha51HotelNative = '1';
    return;
  }

  const loading = notice('Cargando Hotel activo y T…', 'warning');
  container.append(loading);
  const [boardResult, hotelResult, editableResult] = await Promise.all([
    supabase.from('pizarras').select('id,fecha,estado').eq('estado', 'en_curso').maybeSingle(),
    supabase.from('hotel_actual_detalle').select('*').order('orden', { ascending: true }),
    access.edit
      ? supabase.from('hotel_edicion_piloto').select('registro_hotel_id').eq('activo', true)
      : Promise.resolve({ data: [], error: null }),
  ]);
  loading.remove();

  if (boardResult.error) {
    container.append(notice(`Hotel se cargó, pero no pudo leerse la fecha de la pizarra: ${boardResult.error.message}`, 'warning'));
    subtitle.textContent = 'Fecha de pizarra no disponible.';
  } else if (boardResult.data) {
    title.textContent = `Hotel · Pizarra actual · ${formatBoardDate(boardResult.data.fecha)}`;
    subtitle.textContent = `Pizarra del ${formatBoardDate(boardResult.data.fecha)} · ${boardResult.data.estado === 'en_curso' ? 'en curso' : boardResult.data.estado}.`;
  } else {
    subtitle.textContent = 'No se encontró una pizarra en curso.';
  }

  if (hotelResult.error) {
    container.append(notice(`No se pudo cargar Hotel: ${hotelResult.error.message}`, 'danger'));
    container.dataset.alpha51HotelNative = '1';
    return;
  }
  if (editableResult.error) {
    container.append(notice(`Hotel se cargó, pero no pudo comprobarse la edición: ${editableResult.error.message}`, 'warning'));
  }

  const rows = hotelResult.data || [];
  const editableIds = new Set((editableResult.data || []).map(row => row.registro_hotel_id));
  const summary = element('div', { className: 'summary-grid' }, HOTEL_FILTERS.map(filter => {
    const value = filter.states ? rows.filter(row => filter.states.has(row.estado)).length : rows.length;
    return metric(filter, value);
  }));
  const modeNotice = element('div');
  const list = element('div', { className: 'grid' });
  container.append(summary, modeNotice, list);

  const applyFilter = () => {
    const selected = HOTEL_FILTERS.find(filter => filter.key === activeFilter) || HOTEL_FILTERS[0];
    list.querySelectorAll('.hotel-card').forEach(card => {
      const hidden = Boolean(selected.states && !selected.states.has(card.dataset.state || ''));
      card.classList.remove('hotel-filter-hidden', 'alpha33-pending-hidden');
      card.classList.toggle('alpha51-native-filter-hidden', hidden);
    });
    summary.querySelectorAll('.hotel-filter-metric').forEach(node => {
      const active = node.dataset.hotelFilter === selected.key;
      node.classList.toggle('is-active', active);
      node.dataset.alpha51Active = active ? '1' : '0';
      node.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  };

  const activateMetric = target => {
    const key = target?.dataset?.hotelFilter;
    if (!HOTEL_FILTERS.some(filter => filter.key === key)) return;
    activeFilter = key;
    applyFilter();
  };

  summary.addEventListener('click', event => {
    const target = event.target.closest('.hotel-filter-metric');
    if (!target) return;
    event.preventDefault();
    event.stopPropagation();
    activateMetric(target);
  });
  summary.addEventListener('keydown', event => {
    const target = event.target.closest('.hotel-filter-metric');
    if (!target || !['Enter', ' '].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    activateMetric(target);
  });

  const renderRows = () => {
    list.replaceChildren();
    modeNotice.replaceChildren();
    if (access.edit) {
      modeNotice.append(editMode
        ? notice(`✏️ Lectura y edición activada · ${editableIds.size} fichas autorizadas.`, 'warning')
        : notice('🔒 Protección activada: ninguna ficha puede modificarse.', 'success'));
    } else {
      modeNotice.append(notice('Modo lectura permanente.', 'success'));
    }

    rows.forEach(row => list.append(renderCard(row, {
      editMode: access.edit && editMode,
      editableIds,
      onOpenEditor: async id => openHotelEditor(id, {
        onSaved: async () => renderHotelNative(container, access),
      }),
    })));
    applyFilter();
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
  container.dataset.alpha51HotelNative = '1';
}

const nav = document.querySelector('#module-nav');
const content = document.querySelector('#module-content');
const appView = document.querySelector('#app-view');
let rendering = false;
let scheduled = false;

async function openNativeHotel(button) {
  if (!content || rendering) return;
  rendering = true;
  try {
    nav?.querySelectorAll('button').forEach(node => node.classList.toggle('active', node === button));
    const access = await getHotelAccess();
    await renderHotelNative(content, access);
  } catch (error) {
    clear(content);
    content.append(notice(`No se pudo cargar Hotel: ${error?.message || 'error desconocido'}`, 'danger'));
    content.dataset.alpha51HotelNative = '1';
  } finally {
    rendering = false;
  }
}

function scheduleTakeover() {
  if (scheduled) return;
  scheduled = true;
  queueMicrotask(() => {
    scheduled = false;
    if (!nav || !content || !appView || appView.classList.contains('hidden') || rendering) return;
    const button = nav.querySelector('button[data-module="hotel"].active');
    if (!button || content.dataset.alpha51HotelNative === '1') return;
    // En la apertura inicial dejamos terminar el render antiguo antes de sustituirlo.
    // Así no quedan dos cargas asíncronas escribiendo sobre la misma pantalla.
    if (!content.querySelector('.summary-grid')) return;
    openNativeHotel(button);
  });
}

nav?.addEventListener('click', event => {
  const button = event.target.closest('button[data-module]');
  if (!button) return;
  if (button.dataset.module !== 'hotel') {
    if (content) delete content.dataset.alpha51HotelNative;
    return;
  }
  event.preventDefault();
  event.stopImmediatePropagation();
  openNativeHotel(button);
}, true);

if (appView) {
  const observer = new MutationObserver(scheduleTakeover);
  observer.observe(appView, { attributes: true, childList: true, subtree: true });
}
scheduleTakeover();
