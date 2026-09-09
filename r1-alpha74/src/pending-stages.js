import { supabase } from '../../r1-alpha17/src/supabase.js';
import { openStageDetail } from '../../r1-alpha67/src/stage-detail.js';

const nav = document.querySelector('#module-nav');
const content = document.querySelector('#module-content');
const MODULE_FLAG = 'alpha74PendingStages';
const PENDING_STATES = new Set(['pendiente', 'programada', 'en_curso']);
const FAMILY_FILTERS = Object.freeze([
  ['TODAS', 'Todas'],
  ['ITV', 'ITV'],
  ['AVERIA', 'Averías'],
  ['MANTENIMIENTO', 'Mantenimientos'],
  ['EXTINTOR', 'Extintores'],
  ['TRAMITE', 'Trámites'],
  ['OTROS', 'Otros'],
]);

let renderSequence = 0;

function el(tag, text = null, className = '') {
  const node = document.createElement(tag);
  if (text !== null && text !== undefined) node.textContent = String(text);
  if (className) node.className = className;
  return node;
}

function normalize(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('es-ES');
}

function localDateKey(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addDays(key, days) {
  const date = new Date(`${key}T12:00:00`);
  date.setDate(date.getDate() + days);
  return localDateKey(date);
}

function formatDate(value) {
  if (!value) return 'Sin fecha';
  const [year, month, day] = String(value).slice(0, 10).split('-');
  return year && month && day ? `${day}/${month}/${year}` : String(value);
}

function stateLabel(value) {
  return ({ pendiente: 'Pendiente', programada: 'Programada', en_curso: 'En curso' })[value] || value || 'Pendiente';
}

function familyLabel(value) {
  return ({ AVERIA: 'Avería', MANTENIMIENTO: 'Mantenimiento', EXTINTOR: 'Extintor', TRAMITE: 'Trámite', OTROS: 'Otros' })[value] || value;
}

function isRUnit(row) {
  return String(row?.dfm || '').trim().toUpperCase().startsWith('R');
}

function ensureStyle() {
  if (document.querySelector('#alpha74-pending-stages-style')) return;
  const style = document.createElement('style');
  style.id = 'alpha74-pending-stages-style';
  style.textContent = `
    .a74-pending-view{display:grid;gap:14px}.a74-pending-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap}.a74-pending-head h2{margin:0}.a74-pending-head p{margin:4px 0 0}.a74-pending-metrics{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:9px}.a74-pending-metric{display:grid;gap:2px;text-align:left;padding:11px 12px;border:1px solid #d5e0e9;border-radius:11px;background:#f8fafc;color:#172033}.a74-pending-metric strong{font-size:1.45rem}.a74-pending-metric.is-active{outline:3px solid #7dd3fc;background:#eff6ff}.a74-pending-toolbar{display:grid;grid-template-columns:minmax(220px,1fr) auto;gap:10px;align-items:end}.a74-pending-families{display:flex;gap:7px;flex-wrap:wrap}.a74-pending-family.is-active{color:#fff;background:#075985;border-color:#075985}.a74-pending-status{font-size:.9rem;color:#607083}.a74-pending-list{display:grid;gap:10px}.a74-pending-card{display:grid;gap:8px;padding:12px 13px;border:1px solid #d5e0e9;border-left:6px solid #60a5fa;border-radius:12px;background:#fff}.a74-pending-card.is-overdue{border-left-color:#ef4444;background:#fffafa}.a74-pending-card.is-undated{border-left-color:#94a3b8}.a74-pending-card-head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px}.a74-pending-card h3{margin:0;font-size:1rem}.a74-pending-badges{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end}.a74-pending-meta,.a74-pending-work{margin:0;color:#475569;font-size:.9rem}.a74-pending-actions{display:flex;justify-content:flex-end}.a74-pending-empty{padding:18px;text-align:center;border:1px dashed #94a3b8;border-radius:12px;color:#607083;background:#f8fafc}
    @media(max-width:760px){.a74-pending-metrics{grid-template-columns:repeat(2,minmax(0,1fr))}.a74-pending-toolbar{grid-template-columns:1fr}.a74-pending-card-head{display:grid}.a74-pending-badges{justify-content:flex-start}.a74-pending-actions .button{width:100%}}
  `;
  document.head.append(style);
}

function renameNavigationButton() {
  const button = nav?.querySelector('button[data-module="t_programadas"]');
  if (!button || button.dataset.alpha74PendingLabel === '1') return;
  button.dataset.alpha74PendingLabel = '1';
  button.textContent = '📅 T pendientes';
  button.title = 'T pendientes, vencidas y previstas en los próximos 30 días';
}

function metric(label, value, scope, activeScope, onSelect) {
  const button = el('button', null, `a74-pending-metric${scope === activeScope ? ' is-active' : ''}`);
  button.type = 'button';
  button.dataset.scope = scope;
  button.setAttribute('aria-pressed', scope === activeScope ? 'true' : 'false');
  button.append(el('strong', value), el('span', label));
  button.addEventListener('click', () => onSelect(scope));
  return button;
}

function stageCard(row, today) {
  const card = el('article', null, 'a74-pending-card');
  const date = row.fecha_referencia ? String(row.fecha_referencia).slice(0, 10) : '';
  if (!date) card.classList.add('is-undated');
  else if (date < today) card.classList.add('is-overdue');

  const title = el('h3', `${row.posicion ?? '—'}T · ${row.nombre || 'T sin nombre'}`);
  const badges = el('div', null, 'a74-pending-badges');
  badges.append(
    el('span', familyLabel(row.familia), 'badge'),
    el('span', stateLabel(row.estado), 'badge')
  );
  if (row.origen_manteniment) badges.append(el('span', 'MANTENIMENT', 'badge'));
  if (date && date < today) badges.append(el('span', 'Vencida', 'badge'));

  const head = el('div', null, 'a74-pending-card-head');
  head.append(title, badges);
  const vehicle = [row.dfm, row.matricula].filter(Boolean).join(' · ') || 'Unidad sin identificar';
  const meta = [vehicle, row.numero_parada || 'Sin n.º de actuación', row.lugar, formatDate(date)].filter(Boolean).join(' · ');
  card.append(head, el('p', meta, 'a74-pending-meta'));
  if (row.trabajos) card.append(el('p', row.trabajos, 'a74-pending-work'));

  const actions = el('div', null, 'a74-pending-actions');
  const open = el('button', 'Ver ficha de la T', 'button primary compact');
  open.type = 'button';
  open.addEventListener('click', () => openStageDetail({
    id: row.etapa_id,
    registro_hotel_id: row.registro_hotel_id,
    posicion: row.posicion,
    nombre: row.nombre,
    estado: row.estado,
    tipo_etapa: row.tipo_etapa,
    lugar: row.lugar,
  }));
  actions.append(open);
  card.append(actions);
  return card;
}

async function renderPendingStages(button) {
  if (!content) return;
  const sequence = ++renderSequence;
  nav?.querySelectorAll('button').forEach(node => node.classList.toggle('active', node === button));
  content.dataset[MODULE_FLAG] = '1';
  content.replaceChildren();

  const root = el('section', null, 'a74-pending-view');
  const heading = el('div', null, 'a74-pending-head');
  const copy = el('div');
  copy.append(el('h2', 'T pendientes'), el('p', 'Incluye Pendientes 30d de unidades R, vencidas y T sin fecha; una sola ficha por T.', 'muted'));
  const refresh = el('button', '↻ Actualizar', 'button secondary compact');
  refresh.type = 'button';
  refresh.addEventListener('click', () => renderPendingStages(button));
  heading.append(copy, refresh);
  const loading = el('div', 'Cargando T pendientes y necesidades de MANTENIMENT…', 'notice warning');
  root.append(heading, loading);
  content.append(root);

  try {
    const { data, error } = await supabase.rpc('listar_t_pendientes_30d_alpha74');
    if (error) throw error;
    if (sequence !== renderSequence || content.dataset[MODULE_FLAG] !== '1') return;

    const rows = [...new Map((data || [])
      .filter(row => row.etapa_id && PENDING_STATES.has(row.estado))
      .map(row => [row.etapa_id, row])).values()];
    const today = localDateKey();
    const horizon = addDays(today, 30);
    let scope = 'all';
    let family = 'TODAS';
    let search = '';

    const counts = {
      all: rows.length,
      next30: rows.filter(row => {
        const date = String(row.fecha_referencia || '').slice(0, 10);
        return isRUnit(row) && date && date >= today && date <= horizon;
      }).length,
      overdue: rows.filter(row => row.fecha_referencia && String(row.fecha_referencia).slice(0, 10) < today).length,
      undated: rows.filter(row => !row.fecha_referencia).length,
      inProgress: rows.filter(row => row.estado === 'en_curso').length,
    };

    loading.remove();
    const metrics = el('div', null, 'a74-pending-metrics');
    const controls = el('div', null, 'a74-pending-toolbar');
    const searchLabel = el('label');
    searchLabel.append(el('span', 'Buscar'), Object.assign(document.createElement('input'), {
      type: 'search',
      placeholder: 'DFM, matrícula, actuación, taller o trabajo',
    }));
    const searchInput = searchLabel.querySelector('input');
    const families = el('div', null, 'a74-pending-families');
    const status = el('div', '', 'a74-pending-status');
    status.setAttribute('aria-live', 'polite');
    const list = el('div', null, 'a74-pending-list');

    const matchesScope = row => {
      const date = String(row.fecha_referencia || '').slice(0, 10);
      if (scope === 'next30') return isRUnit(row) && date && date >= today && date <= horizon;
      if (scope === 'overdue') return date && date < today;
      if (scope === 'undated') return !date;
      if (scope === 'inProgress') return row.estado === 'en_curso';
      return true;
    };

    const redrawList = () => {
      const query = normalize(search);
      const visible = rows.filter(row => {
        if (!matchesScope(row)) return false;
        if (family !== 'TODAS' && row.familia !== family) return false;
        if (!query) return true;
        return normalize([
          row.dfm, row.matricula, row.numero_parada, row.nombre,
          row.lugar, row.trabajos, familyLabel(row.familia), formatDate(row.fecha_referencia),
        ].filter(Boolean).join(' ')).includes(query);
      });
      list.replaceChildren();
      if (!visible.length) list.append(el('div', 'No hay T pendientes con estos filtros.', 'a74-pending-empty'));
      else visible.forEach(row => list.append(stageCard(row, today)));
      status.textContent = `${visible.length} de ${rows.length} T pendientes`;
    };

    const redrawMetrics = () => {
      metrics.replaceChildren(
        metric('Todas pendientes', counts.all, 'all', scope, selectScope),
        metric('Pendientes 30d', counts.next30, 'next30', scope, selectScope),
        metric('Vencidas', counts.overdue, 'overdue', scope, selectScope),
        metric('Sin fecha', counts.undated, 'undated', scope, selectScope),
        metric('En curso', counts.inProgress, 'inProgress', scope, selectScope)
      );
    };

    function selectScope(next) {
      scope = next;
      redrawMetrics();
      redrawList();
    }

    FAMILY_FILTERS.forEach(([key, label]) => {
      const filter = el('button', label, 'button secondary compact a74-pending-family');
      filter.type = 'button';
      filter.classList.toggle('is-active', key === family);
      filter.addEventListener('click', () => {
        family = key;
        families.querySelectorAll('button').forEach(node => {
          node.classList.toggle('is-active', node === filter);
          node.setAttribute('aria-pressed', node === filter ? 'true' : 'false');
        });
        redrawList();
      });
      filter.setAttribute('aria-pressed', key === family ? 'true' : 'false');
      families.append(filter);
    });

    searchInput.addEventListener('input', () => {
      search = searchInput.value;
      redrawList();
    });

    redrawMetrics();
    controls.append(searchLabel, families);
    root.append(metrics, controls, status, list);
    redrawList();
  } catch (error) {
    if (sequence !== renderSequence || content.dataset[MODULE_FLAG] !== '1') return;
    loading.className = 'notice danger';
    loading.textContent = `No se pudieron cargar las T pendientes: ${error?.message || 'error desconocido'}`;
  }
}

ensureStyle();
renameNavigationButton();
if (nav) new MutationObserver(renameNavigationButton).observe(nav, { childList: true, subtree: true });

nav?.addEventListener('click', event => {
  const button = event.target.closest?.('button[data-module="t_programadas"]');
  if (button) {
    event.preventDefault();
    event.stopImmediatePropagation();
    renderPendingStages(button);
    return;
  }
  if (content?.dataset?.[MODULE_FLAG] === '1') {
    delete content.dataset[MODULE_FLAG];
    renderSequence += 1;
  }
}, true);
