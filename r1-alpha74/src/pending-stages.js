import { supabase } from '../../r1-alpha17/src/supabase.js';
import { openStageDetail } from '../../r1-alpha67/src/stage-detail.js';
import { buildListadosSpec, buildSpreadsheetXlsx } from './listados-export.js';
import { createDetailPdf, downloadDetailPdf } from './panel-pdf.js';

const nav = document.querySelector('#module-nav');
const content = document.querySelector('#module-content');
const MODULE_FLAG = 'alpha74PendingStages';
const SAVED_VIEW_KEY = 'metrogestion:a74:t-pendientes:filtros';
const PENDING_STATES = new Set(['pendiente', 'programada', 'en_curso']);
const FAMILY_FILTERS = Object.freeze([
  ['TODAS', 'Todas'], ['ITV', 'ITV'], ['AVERIA', 'Averías'],
  ['MANTENIMIENTO', 'Mantenimientos'], ['EXTINTOR', 'Extintores'],
  ['TRAMITE', 'Trámites'], ['OTROS', 'Otros'],
]);
let renderSequence = 0;

function el(tag, text = null, className = '') {
  const node = document.createElement(tag);
  if (text !== null && text !== undefined) node.textContent = String(text);
  if (className) node.className = className;
  return node;
}

function normalize(value) {
  return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es-ES');
}

function localDateKey(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
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

function sourceLabel(source) {
  return source === 'manteniment' ? 'Pendientes MANTENIMENT' : 'T del Hotel';
}

function ensureStyle() {
  if (document.querySelector('#alpha74-pending-stages-style')) return;
  const style = document.createElement('style');
  style.id = 'alpha74-pending-stages-style';
  style.textContent = `
    .a74-pending-view{display:grid;gap:14px}.a74-pending-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap}.a74-pending-head h2{margin:0}.a74-pending-head p{margin:4px 0 0}.a74-pending-head-actions,.a74-pending-export-actions,.a74-pending-sources{display:flex;gap:7px;flex-wrap:wrap}.a74-pending-sources{padding:5px;border:1px solid #cbd5e1;border-radius:12px;background:#f8fafc}.a74-pending-source.is-active{color:#fff;background:#075985;border-color:#075985}.a74-pending-metrics{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:9px}.a74-pending-metric{display:grid;gap:2px;text-align:left;padding:11px 12px;border:1px solid #d5e0e9;border-radius:11px;background:#f8fafc;color:#172033}.a74-pending-metric strong{font-size:1.45rem}.a74-pending-metric.is-active{outline:3px solid #7dd3fc;background:#eff6ff}.a74-pending-toolbar{display:grid;gap:10px}.a74-pending-filters{display:grid;grid-template-columns:minmax(220px,2fr) repeat(4,minmax(140px,1fr));gap:9px;align-items:end}.a74-pending-filters label{display:grid;gap:4px;font-size:.82rem;color:#475569}.a74-pending-filters input,.a74-pending-filters select{width:100%}.a74-pending-families{display:flex;gap:7px;flex-wrap:wrap}.a74-pending-family.is-active{color:#fff;background:#075985;border-color:#075985}.a74-pending-status{font-size:.9rem;color:#607083}.a74-pending-list{display:grid;gap:10px}.a74-pending-card{display:grid;gap:8px;padding:12px 13px;border:1px solid #d5e0e9;border-left:6px solid #60a5fa;border-radius:12px;background:#fff}.a74-pending-card.is-overdue{border-left-color:#ef4444;background:#fffafa}.a74-pending-card.is-undated{border-left-color:#94a3b8}.a74-pending-card.is-manteniment{border-left-color:#8b5cf6}.a74-pending-card-head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px}.a74-pending-card h3{margin:0;font-size:1rem}.a74-pending-badges{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end}.a74-pending-meta,.a74-pending-work{margin:0;color:#475569;font-size:.9rem}.a74-pending-actions{display:flex;justify-content:flex-end}.a74-pending-empty{padding:18px;text-align:center;border:1px dashed #94a3b8;border-radius:12px;color:#607083;background:#f8fafc}
    @media(max-width:1050px){.a74-pending-filters{grid-template-columns:repeat(2,minmax(0,1fr))}.a74-pending-filters label:first-child{grid-column:1/-1}}
    @media(max-width:760px){.a74-pending-metrics{grid-template-columns:repeat(2,minmax(0,1fr))}.a74-pending-filters{grid-template-columns:1fr}.a74-pending-filters label:first-child{grid-column:auto}.a74-pending-card-head{display:grid}.a74-pending-badges{justify-content:flex-start}.a74-pending-actions .button,.a74-pending-head-actions .button,.a74-pending-export-actions .button{width:100%}}
    @media print{body.a74-printing-pending *{visibility:hidden!important}body.a74-printing-pending .a74-pending-view,body.a74-printing-pending .a74-pending-view *{visibility:visible!important}body.a74-printing-pending .a74-pending-view{position:absolute;inset:0;width:100%}body.a74-printing-pending .a74-pending-head-actions,body.a74-printing-pending .a74-pending-export-actions,body.a74-printing-pending .a74-pending-sources,body.a74-printing-pending .a74-pending-toolbar,body.a74-printing-pending .a74-pending-actions{display:none!important}}
  `;
  document.head.append(style);
}

function renameNavigationButton() {
  const button = nav?.querySelector('button[data-module="t_programadas"]');
  if (!button || button.dataset.alpha74PendingLabel === '1') return;
  button.dataset.alpha74PendingLabel = '1';
  button.textContent = '📅 T pendientes';
  button.title = 'T del Hotel y necesidades pendientes de MANTENIMENT';
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
  const card = el('article', null, `a74-pending-card${row.source === 'manteniment' ? ' is-manteniment' : ''}`);
  const date = row.fecha_referencia ? String(row.fecha_referencia).slice(0, 10) : '';
  if (!date) card.classList.add('is-undated');
  else if (date < today) card.classList.add('is-overdue');
  const prefix = row.source === 'manteniment' ? (row.fila_origen ? `Fila ${row.fila_origen}` : 'MANTENIMENT') : `${row.posicion ?? '—'}T`;
  const title = el('h3', `${prefix} · ${row.nombre || 'Trabajo sin nombre'}`);
  const badges = el('div', null, 'a74-pending-badges');
  badges.append(el('span', familyLabel(row.familia), 'badge'), el('span', stateLabel(row.estado), 'badge'));
  badges.append(el('span', row.source === 'manteniment' ? 'MANTENIMENT' : 'HOTEL', 'badge'));
  if (date && date < today) badges.append(el('span', 'Vencida', 'badge'));
  const head = el('div', null, 'a74-pending-card-head');
  head.append(title, badges);
  const vehicle = [row.dfm, row.matricula].filter(Boolean).join(' · ') || 'Unidad sin identificar';
  const meta = [vehicle, row.numero_parada || 'Sin n.º de actuación', row.lugar || row.taller, formatDate(date)].filter(Boolean).join(' · ');
  card.append(head, el('p', meta, 'a74-pending-meta'));
  if (row.trabajos) card.append(el('p', row.trabajos, 'a74-pending-work'));
  if (row.etapa_id) {
    const actions = el('div', null, 'a74-pending-actions');
    const open = el('button', row.source === 'manteniment' ? 'Ver T relacionada' : 'Ver ficha de la T', 'button primary compact');
    open.type = 'button';
    open.addEventListener('click', () => openStageDetail({ id: row.etapa_id, registro_hotel_id: row.registro_hotel_id, posicion: row.posicion, nombre: row.nombre, estado: row.estado, tipo_etapa: row.tipo_etapa, lugar: row.lugar }));
    actions.append(open);
    card.append(actions);
  }
  return card;
}

function selectField(label, values, current = '') {
  const wrapper = el('label');
  const select = document.createElement('select');
  values.forEach(([value, text]) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = text;
    select.append(option);
  });
  select.value = current;
  wrapper.append(el('span', label), select);
  return { wrapper, select };
}

function uniqueOptions(rows, key, emptyLabel) {
  const values = [...new Set(rows.map(row => String(row[key] || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));
  return [['', emptyLabel], ...values.map(value => [value, value])];
}

function safeFilename(value) {
  return normalize(value).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'pendientes';
}

function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportTable(rows) {
  const headers = ['Origen', 'DFM', 'Matrícula', 'N.º actuación', 'T / fila', 'Tipo', 'Trabajo', 'Taller', 'Fecha', 'Estado'];
  const values = rows.map(row => [
    row.source === 'manteniment' ? 'MANTENIMENT' : 'Hotel', row.dfm || '', row.matricula || '', row.numero_parada || '',
    row.source === 'manteniment' ? (row.fila_origen ? `Fila ${row.fila_origen}` : '') : `${row.posicion ?? ''}T`,
    familyLabel(row.familia), row.trabajos || row.nombre || '', row.lugar || row.taller || '', formatDate(row.fecha_referencia), stateLabel(row.estado),
  ]);
  return { headers, values };
}

function pdfSpec(rows, source, filters) {
  const { headers, values } = exportTable(rows);
  return buildListadosSpec(headers, values, { listLabel: sourceLabel(source), filters });
}

function actionButton(text, title, handler) {
  const button = el('button', text, 'button secondary compact');
  button.type = 'button';
  button.title = title;
  button.addEventListener('click', handler);
  return button;
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
  copy.append(el('h2', 'T pendientes'), el('p', 'Consulta por separado las T del Hotel y cada necesidad pendiente de MANTENIMENT.', 'muted'));
  const headingActions = el('div', null, 'a74-pending-head-actions');
  const refresh = el('button', '↻ Actualizar', 'button secondary compact');
  refresh.type = 'button';
  refresh.addEventListener('click', () => renderPendingStages(button));
  headingActions.append(refresh);
  heading.append(copy, headingActions);
  const loading = el('div', 'Cargando T del Hotel y necesidades de MANTENIMENT…', 'notice warning');
  root.append(heading, loading);
  content.append(root);

  try {
    const [hotelResult, maintenanceResult] = await Promise.all([
      supabase.rpc('listar_t_pendientes_30d_alpha74'),
      supabase.rpc('listar_necesidades_manteniment_pendientes_alpha74'),
    ]);
    if (hotelResult.error) throw hotelResult.error;
    if (maintenanceResult.error) throw maintenanceResult.error;
    if (sequence !== renderSequence || content.dataset[MODULE_FLAG] !== '1') return;
    const hotelRows = [...new Map((hotelResult.data || []).filter(row => row.etapa_id && PENDING_STATES.has(row.estado)).map(row => [row.etapa_id, { ...row, source: 'hotel' }])).values()];
    const maintenanceRows = [...new Map((maintenanceResult.data || []).filter(row => row.necesidad_id).map(row => [row.necesidad_id, { ...row, source: 'manteniment' }])).values()];
    const allRows = [...hotelRows, ...maintenanceRows];
    const today = localDateKey();
    const horizon = addDays(today, 30);
    const saved = (() => { try { return JSON.parse(localStorage.getItem(SAVED_VIEW_KEY) || '{}'); } catch { return {}; } })();
    let source = saved.source === 'manteniment' ? 'manteniment' : 'hotel';
    let scope = saved.scope || 'all';
    let family = saved.family || 'TODAS';
    let search = saved.search || '';
    let unit = saved.unit || '';
    let stageState = saved.stageState || '';
    let workshop = saved.workshop || '';
    let dateFrom = saved.dateFrom || '';
    let dateTo = saved.dateTo || '';
    let visibleRows = [];

    loading.remove();
    const sources = el('div', null, 'a74-pending-sources');
    const metrics = el('div', null, 'a74-pending-metrics');
    const toolbar = el('div', null, 'a74-pending-toolbar');
    const filters = el('div', null, 'a74-pending-filters');
    const searchLabel = el('label');
    const searchInput = Object.assign(document.createElement('input'), { type: 'search', value: search, placeholder: 'DFM, matrícula, actuación, taller o trabajo' });
    searchLabel.append(el('span', 'Buscar'), searchInput);
    const unitField = selectField('Unidad', [['', 'Todas'], ['R', 'Solo R'], ['DFM', 'Solo DFM']], unit);
    const stateField = selectField('Estado', [['', 'Todos'], ['pendiente', 'Pendiente'], ['programada', 'Programada'], ['en_curso', 'En curso']], stageState);
    const workshopField = selectField('Taller', uniqueOptions(allRows.map(row => ({ ...row, taller_filtro: row.lugar || row.taller })), 'taller_filtro', 'Todos los talleres'), workshop);
    const fromLabel = el('label');
    const fromInput = Object.assign(document.createElement('input'), { type: 'date', value: dateFrom });
    fromLabel.append(el('span', 'Desde'), fromInput);
    const toLabel = el('label');
    const toInput = Object.assign(document.createElement('input'), { type: 'date', value: dateTo });
    toLabel.append(el('span', 'Hasta'), toInput);
    const families = el('div', null, 'a74-pending-families');
    const exportActions = el('div', null, 'a74-pending-export-actions');
    const status = el('div', '', 'a74-pending-status');
    status.setAttribute('aria-live', 'polite');
    const list = el('div', null, 'a74-pending-list');
    const sourceRows = () => source === 'manteniment' ? maintenanceRows : hotelRows;
    const filterSummary = () => [
      `Origen: ${sourceLabel(source)}`, family !== 'TODAS' ? `Tipo: ${familyLabel(family)}` : '', unit ? `Unidad: ${unit}` : '',
      stageState ? `Estado: ${stateLabel(stageState)}` : '', workshop ? `Taller: ${workshop}` : '', dateFrom ? `Desde: ${formatDate(dateFrom)}` : '',
      dateTo ? `Hasta: ${formatDate(dateTo)}` : '', search ? `Buscar: ${search}` : '',
    ].filter(Boolean);
    const matchesScope = row => {
      const date = String(row.fecha_referencia || '').slice(0, 10);
      if (scope === 'next30') return isRUnit(row) && date && date >= today && date <= horizon;
      if (scope === 'overdue') return date && date < today;
      if (scope === 'undated') return !date;
      if (scope === 'inProgress') return row.estado === 'en_curso';
      return true;
    };
    function persistView() {
      localStorage.setItem(SAVED_VIEW_KEY, JSON.stringify({ source, scope, family, search, unit, stageState, workshop, dateFrom, dateTo }));
    }
    function redrawList() {
      const query = normalize(search);
      visibleRows = sourceRows().filter(row => {
        const date = String(row.fecha_referencia || '').slice(0, 10);
        if (!matchesScope(row) || (family !== 'TODAS' && row.familia !== family)) return false;
        if ((unit === 'R' && !isRUnit(row)) || (unit === 'DFM' && isRUnit(row))) return false;
        if (stageState && row.estado !== stageState) return false;
        if (workshop && String(row.lugar || row.taller || '') !== workshop) return false;
        if (dateFrom && (!date || date < dateFrom)) return false;
        if (dateTo && (!date || date > dateTo)) return false;
        if (!query) return true;
        return normalize([row.dfm, row.matricula, row.numero_parada, row.nombre, row.lugar, row.taller, row.trabajos, row.tipo_trabajo, row.designacion, row.fila_origen, familyLabel(row.familia), formatDate(row.fecha_referencia)].filter(Boolean).join(' ')).includes(query);
      });
      list.replaceChildren();
      if (!visibleRows.length) list.append(el('div', `No hay ${sourceLabel(source)} con estos filtros.`, 'a74-pending-empty'));
      else visibleRows.forEach(row => list.append(stageCard(row, today)));
      status.textContent = `${visibleRows.length} de ${sourceRows().length} · ${sourceLabel(source)}`;
    }
    function redrawMetrics() {
      const rows = sourceRows();
      const counts = {
        all: rows.length,
        next30: rows.filter(row => { const date = String(row.fecha_referencia || '').slice(0, 10); return isRUnit(row) && date && date >= today && date <= horizon; }).length,
        overdue: rows.filter(row => row.fecha_referencia && String(row.fecha_referencia).slice(0, 10) < today).length,
        undated: rows.filter(row => !row.fecha_referencia).length,
        inProgress: rows.filter(row => row.estado === 'en_curso').length,
      };
      metrics.replaceChildren(
        metric('Todas pendientes', counts.all, 'all', scope, selectScope), metric('Pendientes 30d', counts.next30, 'next30', scope, selectScope),
        metric('Vencidas', counts.overdue, 'overdue', scope, selectScope), metric('Sin fecha', counts.undated, 'undated', scope, selectScope),
        metric('En curso', counts.inProgress, 'inProgress', scope, selectScope)
      );
    }
    function redrawSources() {
      sources.replaceChildren();
      [['hotel', `T del Hotel (${hotelRows.length})`], ['manteniment', `Pendientes MANTENIMENT (${maintenanceRows.length})`]].forEach(([key, label]) => {
        const sourceButton = el('button', label, `button secondary compact a74-pending-source${source === key ? ' is-active' : ''}`);
        sourceButton.type = 'button';
        sourceButton.setAttribute('aria-pressed', source === key ? 'true' : 'false');
        sourceButton.addEventListener('click', () => { source = key; scope = 'all'; redrawSources(); redrawMetrics(); redrawList(); persistView(); });
        sources.append(sourceButton);
      });
    }
    function selectScope(next) { scope = next; redrawMetrics(); redrawList(); persistView(); }
    FAMILY_FILTERS.forEach(([key, label]) => {
      const filter = el('button', label, 'button secondary compact a74-pending-family');
      filter.type = 'button';
      filter.classList.toggle('is-active', key === family);
      filter.setAttribute('aria-pressed', key === family ? 'true' : 'false');
      filter.addEventListener('click', () => {
        family = key;
        families.querySelectorAll('button').forEach(node => { node.classList.toggle('is-active', node === filter); node.setAttribute('aria-pressed', node === filter ? 'true' : 'false'); });
        redrawList(); persistView();
      });
      families.append(filter);
    });
    searchInput.addEventListener('input', () => { search = searchInput.value; redrawList(); });
    searchInput.addEventListener('change', persistView);
    unitField.select.addEventListener('change', () => { unit = unitField.select.value; redrawList(); persistView(); });
    stateField.select.addEventListener('change', () => { stageState = stateField.select.value; redrawList(); persistView(); });
    workshopField.select.addEventListener('change', () => { workshop = workshopField.select.value; redrawList(); persistView(); });
    fromInput.addEventListener('change', () => { dateFrom = fromInput.value; redrawList(); persistView(); });
    toInput.addEventListener('change', () => { dateTo = toInput.value; redrawList(); persistView(); });
    const saveView = actionButton('☆ Guardar vista', 'Conserva los filtros actuales en este dispositivo', event => {
      persistView(); const original = event.currentTarget.textContent; event.currentTarget.textContent = '✓ Vista guardada'; window.setTimeout(() => { event.currentTarget.textContent = original; }, 1600);
    });
    const clearFilters = actionButton('Limpiar filtros', 'Restablece todos los filtros', () => {
      scope = 'all'; family = 'TODAS'; search = ''; unit = ''; stageState = ''; workshop = ''; dateFrom = ''; dateTo = '';
      searchInput.value = ''; unitField.select.value = ''; stateField.select.value = ''; workshopField.select.value = ''; fromInput.value = ''; toInput.value = '';
      families.querySelectorAll('button').forEach((node, index) => { node.classList.toggle('is-active', index === 0); node.setAttribute('aria-pressed', index === 0 ? 'true' : 'false'); });
      redrawMetrics(); redrawList(); persistView();
    });
    const savePdf = actionButton('⬇ Guardar PDF', 'Guarda el resultado visible en PDF', () => downloadDetailPdf(createDetailPdf(pdfSpec(visibleRows, source, filterSummary()))));
    const saveXlsx = actionButton('⬇ Hoja de cálculo', 'Guarda el resultado visible en Excel', () => {
      const { headers, values } = exportTable(visibleRows);
      const workbook = buildSpreadsheetXlsx(headers, values, sourceLabel(source));
      saveBlob(new Blob([workbook], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `metrogestion-${safeFilename(sourceLabel(source))}-${today}.xlsx`);
    });
    const share = actionButton('↗ Compartir', 'Comparte el PDF con los filtros aplicados', async event => {
      const pdf = createDetailPdf(pdfSpec(visibleRows, source, filterSummary()));
      try {
        const canShare = pdf.file && navigator.share && (typeof navigator.canShare !== 'function' || navigator.canShare({ files: [pdf.file] }));
        if (canShare) await navigator.share({ title: `Metrogestión · ${sourceLabel(source)}`, files: [pdf.file] });
        else downloadDetailPdf(pdf);
      } catch (error) { if (error?.name !== 'AbortError') downloadDetailPdf(pdf); }
      event.currentTarget.blur();
    });
    const print = actionButton('🖨 Imprimir', 'Imprime únicamente el resultado visible', () => {
      const previousTitle = document.title;
      document.title = `Metrogestión - ${sourceLabel(source)}`;
      document.body.classList.add('a74-printing-pending');
      try { window.print(); } finally { document.body.classList.remove('a74-printing-pending'); document.title = previousTitle; }
    });
    filters.append(searchLabel, unitField.wrapper, stateField.wrapper, workshopField.wrapper, fromLabel, toLabel);
    exportActions.append(saveView, clearFilters, savePdf, saveXlsx, share, print);
    toolbar.append(filters, families, exportActions);
    redrawSources(); redrawMetrics();
    root.append(sources, metrics, toolbar, status, list);
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
  if (button) { event.preventDefault(); event.stopImmediatePropagation(); renderPendingStages(button); return; }
  if (content?.dataset?.[MODULE_FLAG] === '1') { delete content.dataset[MODULE_FLAG]; renderSequence += 1; }
}, true);
