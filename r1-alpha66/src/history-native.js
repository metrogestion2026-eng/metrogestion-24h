import { clear, element, notice } from '../../r1-alpha17/src/dom.js';
import { supabase } from '../../r1-alpha17/src/supabase.js';
import { loadDocumentsForGroups } from './hotel-documents.js';
import { documentsForStages, renderHistoricalCard } from './history-card.js';

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

  const ids = (rows || []).map(row => row.id);
  let stages = [];
  if (ids.length) {
    const { data: stageRows, error: stagesError } = await supabase
      .from('etapas_hotel')
      .select('id,registro_hotel_id,seguimiento_id,grupo_documental_id,nombre,posicion,estado,tipo_etapa,taller_id,centro_taller_id,lugar,fecha_prevista,fecha_inicio_real,fecha_fin_real,fecha_real,observaciones,cancelado,motivo_cancelacion,version,actualizado_en')
      .in('registro_hotel_id', ids)
      .order('posicion', { ascending: true });

    if (stagesError) {
      clear(resultHost);
      resultHost.append(notice(
        `La pizarra existe, pero no se pudieron cargar sus T: ${stagesError.message}`,
        'danger'
      ));
      return;
    }
    stages = stageRows || [];
  }

  const stagesByRecord = new Map();
  stages.forEach(stage => {
    const list = stagesByRecord.get(stage.registro_hotel_id) || [];
    list.push(stage);
    stagesByRecord.set(stage.registro_hotel_id, list);
  });

  let documentsByGroup = new Map();
  try {
    documentsByGroup = await loadDocumentsForGroups(
      stages.map(stage => stage.grupo_documental_id)
    );
  } catch (error) {
    clear(resultHost);
    resultHost.append(notice(
      `No se pudo cargar la documentación de las T: ${error.message}`,
      'danger'
    ));
    return;
  }

  clear(resultHost);
  if (board.estado === 'archivada') {
    resultHost.append(element('div', { className: 'notice danger' }, [
      element('strong', { text: '⚠ PIZARRA ANTERIOR' }),
      element('div', {
        text: `Estás viendo la pizarra del ${shownDate}. Los documentos permanecen vinculados a cada T durante todo su recorrido.`,
      }),
    ]));
  } else {
    resultHost.append(notice(`Pizarra del ${shownDate} · estado ${board.estado}.`, 'success'));
  }

  const cardsHost = element('div', { className: 'grid', dataset: { historyCards: '1' } });
  resultHost.append(cardsHost);
  const reload = () => loadDay(container, dateValue, access, searchInput);

  (rows || []).forEach(row => {
    const rowStages = stagesByRecord.get(row.id) || [];
    const card = renderHistoricalCard(row, rowStages, documentsByGroup, access, reload);
    const documentNames = documentsForStages(rowStages, documentsByGroup)
      .map(doc => `${doc.nombre_mostrado || ''} ${doc.nombre_original || ''} ${doc.descripcion || ''}`)
      .join(' ');

    card.dataset.search = [
      row.dfm,
      row.matricula,
      row.reserva,
      row.matricula_reserva,
      row.numero_parada,
      row.causa,
      row.incidencia,
      row.lugar,
      ...rowStages.flatMap(stage => [stage.nombre, stage.lugar, stage.observaciones]),
      documentNames,
    ].filter(Boolean).join(' ').toLowerCase();
    cardsHost.append(card);
  });

  if (!(rows || []).length) {
    resultHost.append(notice('La pizarra existe, pero no contiene registros.', 'warning'));
  }

  const applySearch = () => {
    const query = searchInput.value.trim().toLowerCase();
    cardsHost.querySelectorAll('.hotel-card').forEach(card => {
      card.hidden = Boolean(query && !String(card.dataset.search || '').includes(query));
    });
  };
  searchInput.oninput = applySearch;
  applySearch();
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
    placeholder: 'DFM, matrícula, parada, T o documento',
    'aria-label': 'Buscar en la pizarra histórica',
  });
  const searchButton = element('button', {
    className: 'button primary',
    type: 'button',
    text: 'Buscar día',
  });
  const resultHost = element('div', {
    className: 'grid',
    dataset: { historyResults: '1' },
  });

  searchButton.addEventListener('click', () => {
    if (dateInput.value) loadDay(container, dateInput.value, access, searchInput);
  });

  container.append(
    element('div', { className: 'module-heading' }, [
      element('div', {}, [
        element('h2', { text: 'Histórico por día' }),
        element('p', {
          className: 'muted',
          text: 'Cada T conserva sus PDF y fotografías. También puedes añadirlos arrastrándolos a la zona de carga de la T.',
        }),
      ]),
      element('span', {
        className: 'badge',
        text: access.editDocuments ? 'Documentación editable' : 'Solo lectura',
      }),
    ]),
    element('div', { className: 'toolbar' }, [
      element('label', {}, [document.createTextNode('Fecha'), dateInput]),
      element('label', {}, [document.createTextNode('Buscar'), searchInput]),
      searchButton,
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
