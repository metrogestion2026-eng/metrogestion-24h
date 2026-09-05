import { clear, element, notice } from '../../r1-alpha17/src/dom.js';
import { supabase } from '../../r1-alpha17/src/supabase.js';
import { openHotelCreate } from './hotel-create.js';
import { openHotelEditor } from './hotel-editor.js';
import { loadDocumentsForGroups } from '../../r1-alpha67/src/hotel-documents.js';
import {
  HOTEL_FILTERS,
  STATE_LABELS,
  ensureNativeHotelStyle,
  metric,
  formatBoardDate,
} from '../../r1-alpha53/src/hotel-utils.js';
import { renderHotelCard } from './hotel-card.js';

ensureNativeHotelStyle();

const hotelViewState = {
  filter: 'all',
  search: '',
  editMode: false,
};

function ensureAlpha71HotelStyle() {
  if (document.querySelector('#alpha71-hotel-style')) return;
  const style = document.createElement('style');
  style.id = 'alpha71-hotel-style';
  style.textContent = `
    .a71-hotel-summary {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 10px;
      margin-bottom: 14px;
    }
    @media (max-width: 760px) {
      .a71-hotel-summary { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }
  `;
  document.head.append(style);
}

ensureAlpha71HotelStyle();

function normaliseSearch(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function buildSearchBase(row, stages) {
  const stageValues = stages.flatMap(stage => [
    stage.posicion != null ? `${stage.posicion}t` : '',
    stage.nombre,
    stage.estado,
    stage.tipo_etapa,
    stage.lugar,
    stage.observaciones,
  ]);
  return normaliseSearch([
    row.dfm,
    row.matricula,
    row.numero_parada,
    row.sustituto,
    row.reserva,
    row.matricula_sustituto,
    row.matricula_reserva,
    row.tipo_sustituto,
    row.modalidad_operativa,
    row.modalidad_operativa_nombre,
    row.etiqueta_sustituto,
    row.etiqueta_reserva,
    row.estado,
    STATE_LABELS[row.estado],
    row.lugar,
    row.causa,
    row.incidencia,
    row.upc,
    row.proximo,
    row.observaciones,
    row.marca,
    row.modelo,
    row.tipo_unidad,
    ...stageValues,
  ].filter(Boolean).join(' '));
}

function matchesSearch(card, query) {
  const normalised = normaliseSearch(query);
  if (!normalised) return true;
  const terms = normalised.split(/\s+/).filter(Boolean);
  const haystack = normaliseSearch(`${card.dataset.searchBase || ''} ${card.textContent || ''}`);
  return terms.every(term => haystack.includes(term));
}

async function getHotelAccess() {
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData?.user) return { view: false, editFicha: false, editDocuments: false };

  const { data: profile, error } = await supabase
    .from('usuarios')
    .select('activo,tipo_usuario,permisos')
    .eq('id', authData.user.id)
    .maybeSingle();
  if (error || profile?.activo !== true) return { view: false, editFicha: false, editDocuments: false };
  if (profile.tipo_usuario === 'administrador_principal') {
    return { view: true, editFicha: true, editDocuments: true };
  }

  const hotel = profile.permisos?.hotel || {};
  const documentation = profile.permisos?.documentacion || {};
  const editFicha = hotel.editar === true;
  const view = editFicha || hotel.ver === true || hotel.leer === true;
  const editDocuments = editFicha || documentation.editar === true;
  return { view, editFicha, editDocuments };
}

async function loadHotelData(access) {
  const [boardResult, hotelResult, editableResult] = await Promise.all([
    supabase.from('pizarras').select('id,fecha,estado').eq('estado', 'en_curso').maybeSingle(),
    supabase.from('hotel_actual_detalle').select('*').order('orden', { ascending: true }),
    access.editFicha
      ? supabase.from('hotel_edicion_piloto').select('registro_hotel_id').eq('activo', true)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (hotelResult.error) throw new Error(`No se pudo cargar Hotel: ${hotelResult.error.message}`);
  const rows = hotelResult.data || [];
  const recordIds = rows.map(row => row.id).filter(Boolean);
  let stages = [];

  if (recordIds.length) {
    const { data, error } = await supabase
      .from('etapas_hotel')
      .select('id,registro_hotel_id,seguimiento_id,grupo_documental_id,nombre,posicion,estado,estado_catalogo_codigo,tipo_etapa,taller_id,centro_taller_id,lugar,fecha_prevista,fecha_inicio_real,fecha_fin_real,fecha_real,observaciones,cancelado,motivo_cancelacion,version,accion_sistema,etapa_origen_id,actualizado_en')
      .in('registro_hotel_id', recordIds)
      .order('posicion', { ascending: true });
    if (error) throw new Error(`No se pudieron cargar las T: ${error.message}`);
    stages = data || [];
  }

  const stagesByRecord = new Map();
  stages.forEach(stage => {
    const current = stagesByRecord.get(stage.registro_hotel_id) || [];
    current.push(stage);
    stagesByRecord.set(stage.registro_hotel_id, current);
  });

  let documentsByGroup = new Map();
  let documentsWarning = '';
  try {
    documentsByGroup = await loadDocumentsForGroups(stages.map(stage => stage.grupo_documental_id));
  } catch (error) {
    documentsWarning = `No pudo leerse la documentación: ${error.message}`;
  }

  return {
    boardResult,
    editableResult,
    rows,
    stagesByRecord,
    documentsByGroup,
    documentsWarning,
  };
}

async function renderHotelNative(container, access) {
  clear(container);
  container.dataset.alpha56HotelNative = 'loading';
  let editMode = access.editFicha && hotelViewState.editMode;
  let activeFilter = HOTEL_FILTERS.some(filter => filter.key === hotelViewState.filter)
    ? hotelViewState.filter
    : 'all';

  const headingActions = element('div', { className: 'hotel-heading-actions' }, [
    element('span', { className: 'badge', text: 'Hotel activo real · Alpha58' }),
  ]);
  const modeButton = access.editFicha
    ? element('button', {
        className: 'button secondary a56-mode-button',
        type: 'button',
        text: '🔒 Modo lectura',
      })
    : null;
  const createButton = access.editFicha
    ? element('button', {
        className: 'button primary a58-create-card',
        type: 'button',
        text: '＋ Crear nueva ficha',
        title: 'Activa “Lectura y edición” para crear una ficha nueva',
      })
    : null;
  if (createButton) {
    createButton.disabled = true;
    createButton.setAttribute('aria-disabled', 'true');
    headingActions.prepend(createButton);
  }
  if (modeButton) headingActions.prepend(modeButton);

  const title = element('h2', { text: 'Hotel · Pizarra actual' });
  const subtitle = element('p', { className: 'muted', text: 'Cargando fecha de pizarra…' });
  container.append(element('div', { className: 'module-heading' }, [
    element('div', {}, [title, subtitle]),
    headingActions,
  ]));

  if (!access.view) {
    container.append(notice('No tienes permiso para consultar el Hotel.', 'danger'));
    container.dataset.alpha56HotelNative = '1';
    return;
  }

  const loading = notice('Cargando Hotel, T, trabajos y documentación…', 'warning');
  container.append(loading);

  try {
    const data = await loadHotelData(access);
    loading.remove();

    if (data.boardResult.error) {
      container.append(notice(
        `Hotel se cargó, pero no pudo leerse la fecha de la pizarra: ${data.boardResult.error.message}`,
        'warning'
      ));
      subtitle.textContent = 'Fecha de pizarra no disponible.';
    } else if (data.boardResult.data) {
      title.textContent = `Hotel · Pizarra actual · ${formatBoardDate(data.boardResult.data.fecha)}`;
      subtitle.textContent = `Pizarra del ${formatBoardDate(data.boardResult.data.fecha)} · ${data.boardResult.data.estado === 'en_curso' ? 'en curso' : data.boardResult.data.estado}.`;
    } else {
      subtitle.textContent = 'No se encontró una pizarra en curso.';
    }

    if (data.editableResult.error) {
      container.append(notice(
        `Hotel se cargó, pero no pudo comprobarse la edición: ${data.editableResult.error.message}`,
        'warning'
      ));
    }
    if (data.documentsWarning) container.append(notice(data.documentsWarning, 'warning'));

    const { rows, stagesByRecord, documentsByGroup } = data;
    const editableIds = new Set((data.editableResult.data || []).map(row => row.registro_hotel_id));

    const searchInput = element('input', {
      type: 'search',
      placeholder: 'DFM, matrícula, nº de parada, sustituto, INC, lugar, T…',
      autocomplete: 'off',
      spellcheck: 'false',
      'aria-label': 'Buscar una ficha en la pizarra',
    });
    searchInput.value = hotelViewState.search;
    const clearSearch = element('button', {
      className: 'button secondary compact a54-search-clear',
      type: 'button',
      text: 'Limpiar búsqueda',
    });
    clearSearch.disabled = true;
    const searchCount = element('span', {
      className: 'a54-search-count',
      text: `${rows.length} fichas activas`,
    });
    searchCount.setAttribute('aria-live', 'polite');

    const searchBar = element('section', { className: 'a54-hotel-search' }, [
      element('div', { className: 'a54-search-row' }, [
        element('label', { className: 'a54-search-field' }, [
          element('span', { text: 'Buscar ficha en la Pizarra' }),
          searchInput,
        ]),
        clearSearch,
      ]),
      element('div', { className: 'a54-search-bottom' }, [
        element('span', {
          className: 'a54-search-help',
          text: 'Busca también por matrícula del sustituto, UPC, causa, estado, taller, nombre de la T y documentación visible.',
        }),
        searchCount,
      ]),
    ]);

    // Clase propia: evita que los controladores de filtros heredados de
    // Alpha27/28/32/33 vuelvan a seleccionar "Fichas activas".
    const summary = element('div', { className: 'a71-hotel-summary' }, HOTEL_FILTERS.map(filter =>
      metric(filter, filter.states ? rows.filter(row => filter.states.has(row.estado)).length : rows.length)
    ));
    const modeNotice = element('div');
    const list = element('div', { className: 'grid' });
    const noResults = element('div', {
      className: 'a54-no-results',
      text: 'No hay fichas que coincidan con la búsqueda.',
    });
    noResults.hidden = true;
    container.append(searchBar, summary, modeNotice, list, noResults);

    const applyFilter = () => {
      const selected = HOTEL_FILTERS.find(filter => filter.key === activeFilter) || HOTEL_FILTERS[0];
      const query = searchInput.value.trim();
      let visible = 0;

      list.querySelectorAll('.hotel-card').forEach(card => {
        const stateMatches = !selected.states || selected.states.has(card.dataset.state || '');
        const hidden = !stateMatches || !matchesSearch(card, query);
        card.classList.remove(
          'hotel-filter-hidden',
          'alpha33-pending-hidden',
          'alpha51-native-filter-hidden',
          'alpha53-native-filter-hidden',
          'alpha54-native-filter-hidden'
        );
        card.classList.toggle('alpha56-native-filter-hidden', hidden);
        if (!hidden) visible += 1;
      });

      summary.querySelectorAll('.hotel-filter-metric').forEach(node => {
        const active = node.dataset.hotelFilter === selected.key;
        node.classList.toggle('is-active', active);
        node.dataset.alpha53Active = active ? '1' : '0';
        node.setAttribute('aria-pressed', active ? 'true' : 'false');
      });

      clearSearch.disabled = !query;
      const suffix = selected.key === 'all' ? '' : ` · ${selected.label}`;
      searchCount.textContent = `${visible} de ${rows.length} ficha${rows.length === 1 ? '' : 's'}${suffix}`;
      noResults.hidden = visible !== 0;
      if (!visible) {
        noResults.textContent = query
          ? `No hay fichas que coincidan con “${query}”${selected.key === 'all' ? '.' : ` dentro de ${selected.label.toLowerCase()}.`}`
          : `No hay fichas en el bloque ${selected.label.toLowerCase()}.`;
      }
    };

    const activateMetric = target => {
      const key = target?.dataset?.hotelFilter;
      if (!HOTEL_FILTERS.some(filter => filter.key === key)) return;
      activeFilter = key;
      hotelViewState.filter = key;
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
    searchInput.addEventListener('input', () => {
      hotelViewState.search = searchInput.value;
      applyFilter();
    });
    searchInput.addEventListener('keydown', event => {
      if (event.key !== 'Escape' || !searchInput.value) return;
      event.preventDefault();
      searchInput.value = '';
      hotelViewState.search = '';
      applyFilter();
    });
    clearSearch.addEventListener('click', () => {
      searchInput.value = '';
      hotelViewState.search = '';
      applyFilter();
      searchInput.focus();
    });

    const syncCreateButton = () => {
      if (!createButton) return;
      createButton.disabled = !editMode;
      createButton.setAttribute('aria-disabled', editMode ? 'false' : 'true');
      createButton.title = editMode
        ? 'Crear una nueva ficha en la pizarra actual'
        : 'Activa “Lectura y edición” para crear una ficha nueva';
    };

    const renderRows = () => {
      list.replaceChildren();
      modeNotice.replaceChildren();
      if (access.editFicha) {
        modeNotice.append(editMode
          ? notice(`✏️ Lectura y edición activada · ${editableIds.size} fichas autorizadas. Ya puedes crear una nueva ficha o editar las existentes.`, 'warning')
          : notice('🔒 Protección de la ficha activada. El botón “Crear nueva ficha” permanece visible y se habilita al activar “Lectura y edición”.', 'success'));
      } else {
        modeNotice.append(notice(
          access.editDocuments
            ? 'Modo lectura de ficha. La documentación de las T está autorizada.'
            : 'Modo lectura permanente.',
          'success'
        ));
      }

      rows.forEach(row => {
        const rowStages = stagesByRecord.get(row.id) || [];
        const card = renderHotelCard(row, rowStages, documentsByGroup, {
          editMode: access.editFicha && editMode,
          editableIds,
          canEditDocuments: access.editDocuments,
          onOpenEditor: async id => openHotelEditor(id, {
            onSaved: async () => renderHotelNative(container, access),
          }),
        });
        card.dataset.searchBase = buildSearchBase(row, rowStages);
        list.append(card);
      });
      applyFilter();
    };

    if (createButton) {
      createButton.addEventListener('click', () => {
        if (!editMode || createButton.disabled) return;
        openHotelCreate({
          onSaved: async () => renderHotelNative(container, access),
        });
      });
    }

    if (modeButton) {
      modeButton.addEventListener('click', () => {
        editMode = !editMode;
        hotelViewState.editMode = editMode;
        modeButton.textContent = editMode ? '✏️ Lectura y edición' : '🔒 Modo lectura';
        modeButton.classList.toggle('primary', editMode);
        modeButton.classList.toggle('secondary', !editMode);
        syncCreateButton();
        renderRows();
      });
    }

    if (modeButton) {
      modeButton.textContent = editMode ? '✏️ Lectura y edición' : '🔒 Modo lectura';
      modeButton.classList.toggle('primary', editMode);
      modeButton.classList.toggle('secondary', !editMode);
    }
    syncCreateButton();
    renderRows();
    container.dataset.alpha56HotelNative = '1';
  } catch (error) {
    loading.remove();
    container.append(notice(error?.message || 'No se pudo cargar Hotel.', 'danger'));
    container.dataset.alpha56HotelNative = '1';
  }
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
    // Cancela de inmediato cualquier propiedad residual del Panel. Su
    // temporizador no debe poder sustituir Hotel mientras se edita una ficha.
    delete content.dataset.alpha70Panel;
    delete content.dataset.alpha52Panel;
    delete content.dataset.alpha62PanelOwned;
    nav?.querySelectorAll('button').forEach(node => node.classList.toggle('active', node === button));
    const access = await getHotelAccess();
    await renderHotelNative(content, access);
  } catch (error) {
    clear(content);
    content.append(notice(`No se pudo cargar Hotel: ${error?.message || 'error desconocido'}`, 'danger'));
    content.dataset.alpha56HotelNative = '1';
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
    if (!button || content.dataset.alpha56HotelNative === '1' || !content.querySelector('.summary-grid')) return;
    openNativeHotel(button);
  });
}

nav?.addEventListener('click', event => {
  const button = event.target.closest('button[data-module]');
  if (!button) return;
  if (button.dataset.module !== 'hotel') {
    if (content) delete content.dataset.alpha56HotelNative;
    hotelViewState.filter = 'all';
    hotelViewState.search = '';
    hotelViewState.editMode = false;
    return;
  }
  if (content) delete content.dataset.alpha55HistoryNative;
  event.preventDefault();
  event.stopImmediatePropagation();
  openNativeHotel(button);
}, true);

if (appView) {
  const observer = new MutationObserver(scheduleTakeover);
  observer.observe(appView, { attributes: true, childList: true, subtree: true });
}

scheduleTakeover();
