import { clear, element, notice } from '../../r1-alpha17/src/dom.js';
import { supabase } from '../../r1-alpha17/src/supabase.js';
import { loadDocumentsForGroups } from '../../r1-alpha67/src/hotel-documents.js';
import { renderHistoricalCard } from './history-card.js';

function madridDate(date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Madrid',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function yesterday() {
  const date = new Date();
  date.setDate(date.getDate() - 1);
  return madridDate(date);
}

const STAGE_SELECT = [
  'id', 'registro_hotel_id', 'seguimiento_id', 'grupo_documental_id', 'nombre', 'posicion',
  'estado', 'estado_catalogo_codigo', 'tipo_etapa', 'taller_id', 'centro_taller_id', 'lugar',
  'fecha_prevista', 'fecha_inicio_real', 'fecha_fin_real', 'fecha_real', 'observaciones',
  'cancelado', 'motivo_cancelacion', 'version', 'actualizado_en',
].join(',');
const HISTORY_SEARCH_LIMIT = 500;
const HISTORY_QUERY_CHUNK = 80;
const RECORD_SEARCH_COLUMNS = [
  'dfm', 'matricula', 'reserva', 'matricula_reserva', 'sustituto', 'matricula_sustituto',
  'numero_parada', 'causa', 'incidencia', 'lugar', 'trabajos_reserva', 'observaciones',
  'proximo', 'upc', 'marca', 'modelo', 'estado',
];
const STAGE_SEARCH_COLUMNS = [
  'nombre', 'lugar', 'observaciones', 'motivo_cancelacion', 'estado_catalogo_codigo',
  'tipo_etapa', 'estado',
];
const DOCUMENT_SEARCH_COLUMNS = ['nombre_original', 'nombre_mostrado', 'descripcion'];

function chunks(values, size = HISTORY_QUERY_CHUNK) {
  const result = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

function historyDateLabel(value) {
  if (!value) return 'Sin fecha';
  return new Date(`${value}T12:00:00`).toLocaleDateString('es-ES');
}

function safeHistorySearch(value) {
  return String(value ?? '')
    .trim()
    .replace(/[,%_()]/g, ' ')
    .replace(/\s+/g, ' ')
    .slice(0, 100);
}

function ilikeAny(columns, value) {
  return columns.map(column => `${column}.ilike.%${value}%`).join(',');
}

function uniqueLatestRows(rows) {
  const ordered = (rows || []).slice().sort((a, b) => {
    const dateOrder = String(b.fecha_pizarra || '').localeCompare(String(a.fecha_pizarra || ''));
    return dateOrder || Number(a.orden || 0) - Number(b.orden || 0);
  });
  const seen = new Set();
  return ordered.filter(row => {
    const key = row.seguimiento_id || row.id;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function getHistoryAccess() {
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData?.user) {
    return { view: false, editFicha: false, editDocuments: false };
  }

  const { data: profile, error } = await supabase
    .from('usuarios')
    .select('activo,tipo_usuario,permisos')
    .eq('id', authData.user.id)
    .maybeSingle();

  if (error || profile?.activo !== true) {
    return { view: false, editFicha: false, editDocuments: false };
  }
  if (profile.tipo_usuario === 'administrador_principal') {
    return { view: true, editFicha: true, editDocuments: true };
  }

  const history = profile.permisos?.historico || {};
  const hotel = profile.permisos?.hotel || {};
  const documentation = profile.permisos?.documentacion || {};
  const view = history.ver === true
    || history.leer === true
    || history.editar === true
    || hotel.ver === true
    || hotel.leer === true
    || hotel.editar === true;

  return {
    view,
    editFicha: hotel.editar === true || history.editar === true,
    editDocuments: hotel.editar === true || documentation.editar === true,
  };
}

async function loadHistoryRelations(rows) {
  const ids = (rows || []).map(row => row.id).filter(Boolean);
  const stageResults = await Promise.all(chunks(ids).map(recordIds => supabase
    .from('etapas_hotel')
    .select(STAGE_SELECT)
    .in('registro_hotel_id', recordIds)
    .order('posicion', { ascending: true })));
  const stageError = stageResults.find(result => result.error)?.error;
  if (stageError) throw new Error(`No se pudieron cargar las T: ${stageError.message}`);

  const stages = stageResults.flatMap(result => result.data || []);
  const stagesByRecord = new Map();
  stages.forEach(stage => {
    const list = stagesByRecord.get(stage.registro_hotel_id) || [];
    list.push(stage);
    stagesByRecord.set(stage.registro_hotel_id, list);
  });

  const groupIds = [...new Set(stages.map(stage => stage.grupo_documental_id).filter(Boolean))];
  const documentMaps = await Promise.all(chunks(groupIds).map(loadDocumentsForGroups));
  const documentsByGroup = new Map(groupIds.map(id => [id, []]));
  documentMaps.forEach(map => map.forEach((documents, groupId) => {
    documentsByGroup.set(groupId, documents);
  }));

  return { stagesByRecord, documentsByGroup };
}

async function showHistoryRows(container, rows, access, {
  board = null,
  dateValue = '',
  searchTerm = '',
  truncated = false,
  reload,
} = {}) {
  const resultHost = container.querySelector('[data-history-results]');
  let relations;
  try {
    relations = await loadHistoryRelations(rows);
  } catch (error) {
    clear(resultHost);
    resultHost.append(notice(
      `No se pudieron cargar las T o sus documentos: ${error.message}`,
      'danger'
    ));
    return;
  }

  const { stagesByRecord, documentsByGroup } = relations;
  clear(resultHost);
  if (searchTerm) {
    resultHost.append(notice(
      `${rows.length} ficha${rows.length === 1 ? '' : 's'} encontrada${rows.length === 1 ? '' : 's'} en todo el Histórico para “${searchTerm}”.`,
      rows.length ? 'success' : 'warning'
    ));
    if (truncated) {
      resultHost.append(notice(
        `Se muestran las ${HISTORY_SEARCH_LIMIT} coincidencias más recientes. Concreta la búsqueda para reducir el resultado.`,
        'warning'
      ));
    }
  } else {
    const shownDate = historyDateLabel(dateValue);
    if (board?.estado === 'archivada') {
      resultHost.append(element('div', { className: 'notice danger' }, [
        element('strong', { text: '⚠ PIZARRA ANTERIOR' }),
        element('div', {
          text: `Estás viendo la pizarra del ${shownDate}. Los documentos permanecen vinculados a cada T durante todo su recorrido.`,
        }),
      ]));
    } else {
      resultHost.append(notice(`Pizarra del ${shownDate} · estado ${board?.estado || 'sin estado'}.`, 'success'));
    }
  }

  const cardsHost = element('div', { className: 'grid', dataset: { historyCards: '1' } });
  resultHost.append(cardsHost);

  (rows || []).forEach(row => {
    const rowStages = stagesByRecord.get(row.id) || [];
    const card = renderHistoricalCard(row, rowStages, documentsByGroup, access, reload);
    if (searchTerm) {
      card.prepend(element('div', {
        className: 'badge',
        text: `Pizarra ${historyDateLabel(row.fecha_pizarra)}${row.estado_pizarra ? ` · ${row.estado_pizarra}` : ''}`,
      }));
    }
    cardsHost.append(card);
  });

  if (!(rows || []).length && !searchTerm) {
    resultHost.append(notice('La pizarra existe, pero no contiene registros.', 'warning'));
  }
}

async function loadDay(container, dateValue, access, searchInput) {
  const resultHost = container.querySelector('[data-history-results]');
  clear(resultHost);
  const shownDate = new Date(`${dateValue}T12:00:00`).toLocaleDateString('es-ES');
  resultHost.append(notice(
    `Cargando la pizarra del ${shownDate}, sus T y documentos…`,
    'warning'
  ));

  const { data: board, error: boardError } = await supabase
    .from('pizarras')
    .select('id,fecha,estado')
    .eq('fecha', dateValue)
    .maybeSingle();

  if (boardError) {
    clear(resultHost);
    resultHost.append(notice(`No se pudo buscar la pizarra: ${boardError.message}`, 'danger'));
    return;
  }
  if (!board) {
    clear(resultHost);
    resultHost.append(notice('No existe una pizarra para el día seleccionado.', 'warning'));
    return;
  }

  const { data: rows, error: rowsError } = await supabase
    .from('hotel_por_dia')
    .select('*')
    .eq('fecha_pizarra', dateValue)
    .order('orden', { ascending: true });

  if (rowsError) {
    clear(resultHost);
    resultHost.append(notice(`No se pudo cargar la pizarra del día: ${rowsError.message}`, 'danger'));
    return;
  }

  const reload = () => loadDay(container, dateValue, access, searchInput);
  await showHistoryRows(container, rows || [], access, { board, dateValue, reload });
}

async function searchAllHistory(container, access, searchInput) {
  const resultHost = container.querySelector('[data-history-results]');
  const searchTerm = safeHistorySearch(searchInput.value);
  if (!searchTerm) {
    clear(resultHost);
    resultHost.append(notice('Escribe un DFM, matrícula, parada, reserva, INC, T o documento.', 'warning'));
    searchInput.focus();
    return;
  }

  clear(resultHost);
  resultHost.append(notice(
    `Buscando “${searchTerm}” en todas las pizarras, T y documentos…`,
    'warning'
  ));

  const [recordResult, stageResult, documentResult] = await Promise.all([
    supabase
      .from('hotel_por_dia')
      .select('*', { count: 'exact' })
      .or(ilikeAny(RECORD_SEARCH_COLUMNS, searchTerm))
      .order('fecha_pizarra', { ascending: false })
      .order('orden', { ascending: true })
      .limit(HISTORY_SEARCH_LIMIT),
    supabase
      .from('etapas_hotel')
      .select('id,registro_hotel_id,grupo_documental_id')
      .or(ilikeAny(STAGE_SEARCH_COLUMNS, searchTerm))
      .limit(HISTORY_SEARCH_LIMIT),
    supabase
      .from('documentos_gestion')
      .select('registro_hotel_id,etapa_hotel_id,grupo_etapa_id')
      .or(ilikeAny(DOCUMENT_SEARCH_COLUMNS, searchTerm))
      .limit(HISTORY_SEARCH_LIMIT),
  ]);

  const searchError = recordResult.error || stageResult.error || documentResult.error;
  if (searchError) {
    clear(resultHost);
    resultHost.append(notice(`No se pudo buscar en todo el Histórico: ${searchError.message}`, 'danger'));
    return;
  }

  const recordIds = new Set((stageResult.data || []).map(stage => stage.registro_hotel_id).filter(Boolean));
  const documentStageIds = new Set();
  const documentGroupIds = new Set();
  (documentResult.data || []).forEach(document => {
    if (document.registro_hotel_id) recordIds.add(document.registro_hotel_id);
    if (document.etapa_hotel_id) documentStageIds.add(document.etapa_hotel_id);
    if (document.grupo_etapa_id) documentGroupIds.add(document.grupo_etapa_id);
  });

  const documentStageQueries = [
    ...chunks([...documentStageIds]).map(ids => supabase
      .from('etapas_hotel')
      .select('registro_hotel_id')
      .in('id', ids)),
    ...chunks([...documentGroupIds]).map(ids => supabase
      .from('etapas_hotel')
      .select('registro_hotel_id')
      .in('grupo_documental_id', ids)),
  ];
  const documentStageResults = await Promise.all(documentStageQueries);
  const documentStageError = documentStageResults.find(result => result.error)?.error;
  if (documentStageError) {
    clear(resultHost);
    resultHost.append(notice(`No se pudieron relacionar los documentos encontrados: ${documentStageError.message}`, 'danger'));
    return;
  }
  documentStageResults.forEach(result => (result.data || []).forEach(stage => {
    if (stage.registro_hotel_id) recordIds.add(stage.registro_hotel_id);
  }));

  const directRows = recordResult.data || [];
  const directIds = new Set(directRows.map(row => row.id));
  const additionalIds = [...recordIds].filter(id => !directIds.has(id));
  const additionalResults = await Promise.all(chunks(additionalIds).map(ids => supabase
    .from('hotel_por_dia')
    .select('*')
    .in('id', ids)));
  const additionalError = additionalResults.find(result => result.error)?.error;
  if (additionalError) {
    clear(resultHost);
    resultHost.append(notice(`No se pudieron cargar las fichas encontradas: ${additionalError.message}`, 'danger'));
    return;
  }

  const allRows = uniqueLatestRows([
    ...directRows,
    ...additionalResults.flatMap(result => result.data || []),
  ]);
  const truncated = Number(recordResult.count || 0) > HISTORY_SEARCH_LIMIT
    || allRows.length > HISTORY_SEARCH_LIMIT;
  const rows = allRows.slice(0, HISTORY_SEARCH_LIMIT);
  const reload = () => searchAllHistory(container, access, searchInput);
  await showHistoryRows(container, rows, access, { searchTerm, truncated, reload });
}

async function renderHistoryNative(container, access) {
  clear(container);
  container.dataset.alpha55HistoryNative = '1';

  if (!access.view) {
    container.append(notice('No tienes permiso para consultar el Histórico.', 'danger'));
    return;
  }

  const dateInput = element('input', {
    type: 'date',
    value: yesterday(),
    'aria-label': 'Fecha de la pizarra',
  });
  const searchInput = element('input', {
    type: 'search',
    placeholder: 'DFM, matrícula, parada, reserva, INC, T o documento',
    'aria-label': 'Buscar en todo el histórico',
    enterkeyhint: 'search',
  });
  const dayButton = element('button', {
    className: 'button primary',
    type: 'button',
    text: 'Buscar día',
  });
  const globalSearchButton = element('button', {
    className: 'button primary',
    type: 'button',
    text: 'Buscar en todo el Histórico',
  });
  const resultHost = element('div', {
    className: 'grid',
    dataset: { historyResults: '1' },
  });

  dayButton.addEventListener('click', () => {
    searchInput.value = '';
    if (dateInput.value) loadDay(container, dateInput.value, access, searchInput);
  });
  globalSearchButton.addEventListener('click', () => searchAllHistory(container, access, searchInput));
  searchInput.addEventListener('keydown', event => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    searchAllHistory(container, access, searchInput);
  });

  container.append(
    element('div', { className: 'module-heading' }, [
      element('div', {}, [
        element('h2', { text: 'Histórico' }),
        element('p', {
          className: 'muted',
          text: 'Busca una ficha en todas las fechas o consulta una pizarra concreta. Cada T conserva sus PDF y fotografías.',
        }),
      ]),
      element('span', {
        className: 'badge',
        text: access.editDocuments ? 'Documentación editable' : 'Solo lectura',
      }),
    ]),
    element('div', { className: 'toolbar' }, [
      element('label', {}, [document.createTextNode('Fecha'), dateInput]),
      dayButton,
    ]),
    element('div', { className: 'toolbar' }, [
      element('label', {}, [document.createTextNode('Buscar en todo el Histórico'), searchInput]),
      globalSearchButton,
    ]),
    resultHost
  );

  await loadDay(container, dateInput.value, access, searchInput);
}

const nav = document.querySelector('#module-nav');
const content = document.querySelector('#module-content');
let rendering = false;

async function openHistory(button) {
  if (!content || rendering) return;
  rendering = true;

  try {
    nav?.querySelectorAll('button').forEach(node => node.classList.toggle('active', node === button));
    const access = await getHistoryAccess();
    await renderHistoryNative(content, access);
  } catch (error) {
    clear(content);
    content.append(notice(
      `No se pudo cargar el Histórico: ${error?.message || 'error desconocido'}`,
      'danger'
    ));
  } finally {
    rendering = false;
  }
}

nav?.addEventListener('click', event => {
  const button = event.target.closest('button[data-module="historico"]');
  if (!button) {
    if (content) delete content.dataset.alpha55HistoryNative;
    return;
  }

  if (content) delete content.dataset.alpha55HotelNative;
  event.preventDefault();
  event.stopImmediatePropagation();
  openHistory(button);
}, true);
