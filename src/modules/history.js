import { clear, detail, element, notice } from '../dom.js';
import { supabase } from '../supabase.js';

function madridDate(date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(date);
}

function yesterday() {
  const date = new Date();
  date.setDate(date.getDate() - 1);
  return madridDate(date);
}

function renderHistoricalCard(row) {
  const stages = (row.etapas_hotel || []).sort((a, b) => Number(a.posicion) - Number(b.posicion));
  const title = row.vehiculo_sustituido
    ? `${String(row.vehiculo_sustituido).startsWith('R') ? 'Semirremolque' : 'DFM'} ${row.vehiculo_sustituido} · ${row.matricula_sustituido || '—'}`
    : `Reserva ${row.vehiculo_reserva || '—'} · ${row.matricula_reserva || '—'}`;

  const stageList = element('div', { className: 'grid' });
  if (!stages.length) stageList.append(element('span', { className: 'muted', text: 'Sin T registradas.' }));
  else stages.forEach(stage => {
    stageList.append(element('div', { className: 'badge', text: `${stage.posicion}T · ${stage.nombre} · ${stage.estado}` }));
  });

  return element('article', { className: 'card hotel-card', dataset: { state: row.estado || '' } }, [
    element('div', { className: 'hotel-card-head' }, [
      element('h3', { text: title }),
      element('span', { className: 'badge', text: row.numero_parada ? `Parada ${row.numero_parada}` : 'Sin nº de parada' })
    ]),
    element('div', { className: 'detail-grid' }, [
      detail('Estado', row.estado),
      detail('Reserva', row.vehiculo_reserva),
      detail('Prioridad', row.prioridad),
      detail('Lugar', row.lugar),
      detail('Causa', row.causa),
      detail('INC', row.incidencia)
    ]),
    stageList
  ]);
}

async function loadDay(container, dateValue) {
  const resultHost = container.querySelector('[data-history-results]');
  clear(resultHost);
  resultHost.append(notice(`Cargando la pizarra del ${new Date(`${dateValue}T12:00:00`).toLocaleDateString('es-ES')}…`, 'warning'));

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

  const { data: rows, error } = await supabase
    .from('registros_hotel')
    .select('*,etapas_hotel(*)')
    .eq('pizarra_id', board.id)
    .order('orden', { ascending: true });

  clear(resultHost);
  if (error) {
    resultHost.append(notice(`No se pudo cargar la pizarra del día: ${error.message}`, 'danger'));
    return;
  }

  resultHost.append(notice(`Pizarra del ${new Date(`${board.fecha}T12:00:00`).toLocaleDateString('es-ES')} · estado ${board.estado}.`, 'success'));
  (rows || []).forEach(row => resultHost.append(renderHistoricalCard(row)));
  if (!(rows || []).length) resultHost.append(notice('La pizarra existe, pero no contiene registros visibles.', 'warning'));
}

export async function renderHistory(container) {
  clear(container);

  const dateInput = element('input', { type: 'date', value: yesterday(), 'aria-label': 'Fecha de la pizarra' });
  const searchButton = element('button', { className: 'button primary', type: 'button', text: 'Buscar día' });
  const resultHost = element('div', { className: 'grid', dataset: { historyResults: '1' } });

  searchButton.addEventListener('click', () => {
    if (!dateInput.value) return;
    loadDay(container, dateInput.value);
  });

  container.append(
    element('div', { className: 'module-heading' }, [
      element('div', {}, [
        element('h2', { text: 'Histórico por día' }),
        element('p', { className: 'muted', text: 'Busca una fecha concreta y carga únicamente la pizarra de ese día.' })
      ]),
      element('span', { className: 'badge', text: 'Modo lectura de validación' })
    ]),
    element('div', { className: 'toolbar' }, [
      element('label', {}, [document.createTextNode('Fecha'), dateInput]),
      searchButton
    ]),
    resultHost
  );

  await loadDay(container, dateInput.value);
}
