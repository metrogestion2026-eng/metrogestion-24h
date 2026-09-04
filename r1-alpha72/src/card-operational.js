import { createSubstitutionBilling } from '../../r1-alpha67/src/card-operational.js';

function el(tag, text = null, className = '') {
  const node = document.createElement(tag);
  if (text !== null && text !== undefined) node.textContent = String(text);
  if (className) node.className = className;
  return node;
}

function formatDate(value) {
  if (!value) return '—';
  const raw = String(value);
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) {
    const [, year, month, day] = match;
    return `${Number(day)}/${Number(month)}/${year}`;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? String(value)
    : date.toLocaleDateString('es-ES', { timeZone: 'Europe/Madrid' });
}

function formatDateTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? String(value)
    : date.toLocaleString('es-ES', {
        timeZone: 'Europe/Madrid',
        dateStyle: 'short',
        timeStyle: 'short',
      });
}

function timestamp(value) {
  if (!value) return 0;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function validStage(stage) {
  return stage?.cancelado !== true && stage?.estado !== 'anulada';
}

function completedAt(stage) {
  // fecha_real es la fecha operativa de realización que también muestra el
  // listado de T. fecha_fin_real solo se usa como respaldo cuando no existe.
  return stage?.fecha_real
    || stage?.fecha_fin_real
    || stage?.fecha_inicio_real
    || stage?.fecha_prevista
    || null;
}

export function selectOperationalStage(stages = []) {
  const valid = stages.filter(validStage);
  const running = valid
    .filter(stage => stage.estado === 'en_curso')
    .sort((a, b) =>
      timestamp(b.fecha_inicio_real || b.fecha_prevista)
      - timestamp(a.fecha_inicio_real || a.fecha_prevista)
      || Number(b.posicion || 0) - Number(a.posicion || 0)
    );

  if (running[0]) {
    return {
      stage: running[0],
      title: 'T en ejecución',
      dateLabel: 'Fecha de inicio de la T',
      date: running[0].fecha_inicio_real || running[0].fecha_prevista,
      state: 'En curso',
    };
  }

  const completed = valid
    .filter(stage => stage.estado === 'realizada')
    .sort((a, b) =>
      timestamp(completedAt(b)) - timestamp(completedAt(a))
      || Number(b.posicion || 0) - Number(a.posicion || 0)
    );

  if (completed[0]) {
    return {
      stage: completed[0],
      title: 'T actual · última ejecutada',
      dateLabel: 'Fecha de la T ejecutada',
      date: completedAt(completed[0]),
      state: 'Realizada',
    };
  }

  const next = valid
    .filter(stage => ['programada', 'pendiente'].includes(stage.estado))
    .sort((a, b) => {
      const aDate = timestamp(a.fecha_prevista) || Number.MAX_SAFE_INTEGER;
      const bDate = timestamp(b.fecha_prevista) || Number.MAX_SAFE_INTEGER;
      return aDate - bDate || Number(a.posicion || 0) - Number(b.posicion || 0);
    });

  if (next[0]) {
    return {
      stage: next[0],
      title: 'Próxima T',
      dateLabel: 'Fecha prevista de la T',
      date: next[0].fecha_prevista,
      state: next[0].estado === 'programada' ? 'Programada' : 'Pendiente',
    };
  }

  return null;
}

function dateCell(label, value, note = '', tone = '') {
  const cell = el('div', null, `a66-date-cell${tone ? ` ${tone}` : ''}`);
  cell.append(
    el('span', label, 'a66-date-label'),
    el('strong', value || '—', 'a66-date-value')
  );
  if (note) cell.append(el('span', note, 'a66-date-note'));
  return cell;
}

export function createOperationalDates(row, stages) {
  const selected = selectOperationalStage(stages);
  const section = el('section', null, 'a66-operational-dates');
  section.append(el('h4', 'Fechas operativas de la ficha', 'a66-date-heading'));

  const grid = el('div', null, 'a66-date-grid');
  grid.append(dateCell(
    'Fecha de parada',
    row?.fecha_parada ? formatDate(row.fecha_parada) : 'Sin registrar',
    row?.fecha_parada ? 'Inicio de la inmovilización' : 'Debe quedar informada en la ficha',
    row?.fecha_parada ? 'stop' : 'warning'
  ));

  if (selected) {
    const stage = selected.stage;
    grid.append(
      dateCell(
        selected.title,
        `${stage.posicion ?? '—'}T · ${stage.nombre || 'T sin nombre'}`,
        `${selected.state}${stage.lugar ? ` · ${stage.lugar}` : ''}`,
        selected.state === 'En curso' ? 'running' : 'stage'
      ),
      dateCell(
        selected.dateLabel,
        selected.date ? formatDateTime(selected.date) : 'Sin registrar',
        selected.date ? 'Fecha vinculada a la T mostrada' : 'La T no tiene fecha informada',
        selected.date ? 'stage-date' : 'warning'
      )
    );
  } else {
    grid.append(
      dateCell('T actual', 'Sin T registrada', 'La ficha no contiene ninguna T activa', 'warning'),
      dateCell('Fecha de la T', 'Sin registrar', 'No hay una T de referencia', 'warning')
    );
  }

  section.append(grid);
  return section;
}

export { createSubstitutionBilling };
