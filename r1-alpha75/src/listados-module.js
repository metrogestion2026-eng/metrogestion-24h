import { supabase } from '../../r1-alpha17/src/supabase.js';

const OWNER = globalThis.__METROGESTION_MODULE_OWNERS__?.listados;
const nav = document.querySelector('#module-nav');
const content = document.querySelector('#module-content');

const state = {
  view: 'dfm',
  periods: [],
  rows: [],
  request: 0,
};

function el(tag, text = null, className = '') {
  const node = document.createElement(tag);
  if (text != null) node.textContent = String(text);
  if (className) node.className = className;
  return node;
}
function fmtDate(value) {
  if (!value) return '—';
  const [y,m,d] = String(value).slice(0,10).split('-');
  return y && m && d ? `${d}/${m}/${y}` : String(value);
}
function fmtDateTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? String(value)
    : date.toLocaleString('es-ES', {
      dateStyle: 'short',
      timeStyle: 'short',
      timeZone: 'Europe/Madrid',
    });
}
function fmtNum(value, digits = 0) {
  const number = Number(value);
  return Number.isFinite(number)
    ? new Intl.NumberFormat('es-ES', {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(number)
    : '—';
}
function todayMadrid() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Madrid',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}
function metric(label, value) {
  const node = el('div', null, 'a7524-metric');
  node.append(el('strong', value), el('span', label, 'muted'));
  return node;
}
function setStatus(host, text, tone = 'warning') {
  host.className = tone === 'muted' ? 'muted' : `notice ${tone}`;
  host.textContent = text;
}
function currentPeriod() {
  const today = todayMadrid();
  return state.periods.find(period =>
    today >= period.fecha_inicio && today <= period.fecha_cierre
  ) || state.periods[0] || null;
}
function searchRows(rows, query, fields) {
  const needle = String(query || '').trim().toLocaleLowerCase('es-ES');
  if (!needle) return rows;
  return rows.filter(row => fields.some(field =>
    String(row?.[field] ?? '').toLocaleLowerCase('es-ES').includes(needle)
  ));
}
function renderTable(host, headers, rows) {
  host.replaceChildren();
  const wrap = el('div', null, 'a7524-table-wrap');
  if (!rows.length) {
    wrap.append(el('div', 'No hay resultados con estos filtros.', 'a7524-empty'));
    host.append(wrap);
    return;
  }

  const table = el('table', null, 'listados-table');
  const thead = el('thead');
  const hr = el('tr');
  headers.forEach(header => hr.append(el('th', header)));
  thead.append(hr);

  const tbody = el('tbody');
  rows.forEach(values => {
    const tr = el('tr');
    values.forEach(value => tr.append(el('td', value == null ? '—' : value)));
    tbody.append(tr);
  });

  table.append(thead, tbody);
  wrap.append(table);
  host.append(wrap);
}

async function readPeriods() {
  const { data, error } = await supabase
    .from('cierres_facturacion')
    .select('periodo,fecha_inicio,fecha_cierre')
    .order('periodo', { ascending: false });
  if (error) throw error;
  state.periods = data || [];
  return state.periods;
}
async function readDfm(period, from, to) {
  if (!period) return [];
  let query = supabase
    .from('facturacion_dfm_periodos')
    .select('seguimiento_id,numero_parada,dfm,matricula,sustituto,periodo,tramo_inicio,tramo_fin,dias_facturables,km_dia,km_dia_fuente,estado')
    .eq('periodo', period)
    .order('tramo_inicio', { ascending: true });
  if (from) query = query.gte('tramo_fin', from);
  if (to) query = query.lte('tramo_inicio', to);
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}
async function readR(from, to) {
  let query = supabase
    .from('facturacion_r_sustituciones')
    .select('seguimiento_id,numero_parada,r_sustituido,matricula,r_sustituto,fecha_inicio_parada,fecha_fin_parada,dias_parada_total,unidades,precio_r_unidad,importe,incidencia')
    .order('fecha_inicio_parada', { ascending: false });
  if (from) query = query.gte('fecha_fin_parada', from);
  if (to) query = query.lte('fecha_inicio_parada', to);
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}
async function readParadas(from, to) {
  let query = supabase
    .from('listado_paradas_operativas')
    .select('seguimiento_id,numero_parada,dfm,matricula,incidencia,causa,estado,talleres,lugar,dias_taller,upc,fecha_parada')
    .order('fecha_parada', { ascending: false });
  if (from) query = query.gte('fecha_parada', from);
  if (to) query = query.lte('fecha_parada', to);
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}
async function read24h(from, to) {
  let query = supabase
    .from('activaciones_24h')
    .select('id,dfm,matricula,numero_caso,estado,resultado,creado_en,averia,proveedor')
    .order('creado_en', { ascending: false })
    .limit(500);
  if (from) query = query.gte('creado_en', `${from}T00:00:00+01:00`);
  if (to) query = query.lte('creado_en', `${to}T23:59:59+01:00`);
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

function removeLegacyEntryPoints() {
  if (!nav) return;
  nav.querySelectorAll('[data-alpha29-listados]').forEach(button => button.remove());
  [...nav.querySelectorAll('button')].forEach(button => {
    if (button.dataset.alpha75Listados === '1') return;
    if ((button.textContent || '').trim().match(/listados/i)) button.remove();
  });
}

function ensureButton() {
  if (!nav || OWNER !== 'alpha75') return null;
  removeLegacyEntryPoints();

  let button = nav.querySelector('[data-alpha75-listados]');
  if (button) return button;

  button = document.createElement('button');
  button.type = 'button';
  button.className = 'button secondary';
  button.dataset.alpha75Listados = '1';
  button.textContent = '📋 Listados';

  const talleres = [...nav.querySelectorAll('button')]
    .find(item => /talleres/i.test(item.textContent || ''));
  if (talleres?.nextSibling) nav.insertBefore(button, talleres.nextSibling);
  else nav.append(button);

  button.addEventListener('click', event => {
    event.preventDefault();
    [...nav.querySelectorAll('button')].forEach(item => item.classList.remove('active'));
    button.classList.add('active');
    renderListados();
  });

  return button;
}

async function renderRConfig(host, refresh) {
  host.replaceChildren();
  host.classList.toggle('hidden', state.view !== 'r');
  if (state.view !== 'r') return;

  try {
    const { data, error } = await supabase
      .from('config_facturacion_sustituciones')
      .select('precio_r_unidad')
      .eq('id', 1)
      .maybeSingle();
    if (error) throw error;

    const input = document.createElement('input');
    input.type = 'number';
    input.min = '0';
    input.max = '100000';
    input.step = '0.01';
    input.placeholder = 'Ej. 85,00';
    input.value = data?.precio_r_unidad ?? '';

    const label = el('label');
    label.append(el('span', 'Precio fijo por sustitución R (€)'), input);

    const save = el('button', 'Guardar precio R', 'button primary compact');
    save.type = 'button';
    const message = el('span', '', 'muted');

    save.addEventListener('click', async () => {
      const raw = input.value.trim();
      const value = raw === '' ? null : Number(raw);
      if (value != null && (!Number.isFinite(value) || value < 0 || value > 100000)) {
        message.textContent = 'Precio no válido.';
        return;
      }

      save.disabled = true;
      message.textContent = 'Guardando…';
      const { error: saveError } = await supabase.rpc(
        'guardar_precio_r_sustitucion',
        { p_precio: value }
      );
      save.disabled = false;
      message.textContent = saveError
        ? `No se pudo guardar: ${saveError.message}`
        : 'Precio R guardado.';
      if (!saveError) await refresh();
    });

    host.append(label, save, message);
  } catch (error) {
    host.append(el('span', `No se pudo cargar el precio R: ${error.message}`, 'notice danger'));
  }
}

function renderListados() {
  if (!content || OWNER !== 'alpha75') return;
  const button = ensureButton();

  content.replaceChildren();
  const root = el('section', null, 'a7524-listados');
  root.dataset.listadosOwner = 'alpha75';

  const head = el('div', null, 'a7524-listados-head');
  const titleBox = el('div');
  titleBox.append(
    el('p', 'Informes operativos y facturación', 'eyebrow'),
    el('h2', 'Listados')
  );
  head.append(titleBox);
  root.append(head);

  const tabs = el('div', null, 'a7524-tabs');
  tabs.setAttribute('role', 'tablist');
  const definitions = [
    ['dfm', '🚛 Facturación DFM'],
    ['r', '🛻 Sustituciones R'],
    ['paradas', '📋 Paradas'],
    ['24h', '🚨 Incidencias 24H'],
  ];
  definitions.forEach(([view,label]) => {
    const tab = el('button', label, 'button secondary');
    tab.type = 'button';
    tab.dataset.view = view;
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-selected', view === state.view ? 'true' : 'false');
    tab.classList.toggle('active', view === state.view);
    tabs.append(tab);
  });
  root.append(tabs);

  const rConfig = el('div', null, 'a7524-r-config hidden');
  root.append(rConfig);

  const filters = el('div', null, 'listados-filters');
  const periodWrap = el('label');
  periodWrap.append(el('span', 'Periodo facturación'));
  const period = document.createElement('select');
  periodWrap.append(period);

  const fromWrap = el('label');
  fromWrap.append(el('span', 'Desde'));
  const from = document.createElement('input');
  from.type = 'date';
  fromWrap.append(from);

  const toWrap = el('label');
  toWrap.append(el('span', 'Hasta'));
  const to = document.createElement('input');
  to.type = 'date';
  toWrap.append(to);

  const searchWrap = el('label');
  searchWrap.append(el('span', 'Buscar'));
  const search = document.createElement('input');
  search.type = 'search';
  search.placeholder = 'DFM, R, matrícula, parada, INC…';
  searchWrap.append(search);

  const refreshButton = el('button', '↻ Actualizar', 'button secondary');
  refreshButton.type = 'button';

  filters.append(periodWrap, fromWrap, toWrap, searchWrap, refreshButton);
  root.append(filters);

  const status = el('div', 'Preparando Listados…', 'notice warning');
  const summary = el('div', null, 'a7524-summary');
  const tableHost = el('div');
  root.append(status, summary, tableHost);
  content.append(root);

  function updateTabs() {
    tabs.querySelectorAll('button[data-view]').forEach(tab => {
      const active = tab.dataset.view === state.view;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    periodWrap.classList.toggle('hidden', state.view !== 'dfm');
  }

  function showRows() {
    summary.replaceChildren();

    if (state.view === 'dfm') {
      const rows = searchRows(state.rows, search.value, ['dfm','matricula','numero_parada','sustituto']);
      const days = rows.reduce((total,row) => total + Number(row.dias_facturables || 0), 0);
      summary.append(metric('Paradas', rows.length), metric('Días facturables', fmtNum(days)));
      renderTable(
        tableHost,
        ['Periodo','Inicio','Fin','DFM','Matrícula','Parada','Sustituto','Días','Media km/día','Fuente','Estado'],
        rows.map(row => [
          row.periodo,
          fmtDate(row.tramo_inicio),
          fmtDate(row.tramo_fin),
          row.dfm,
          row.matricula,
          row.numero_parada,
          row.sustituto,
          fmtNum(row.dias_facturables),
          row.km_dia == null ? '—' : fmtNum(row.km_dia),
          row.km_dia_fuente || '—',
          row.estado || '—',
        ])
      );
      return;
    }

    if (state.view === 'r') {
      const rows = searchRows(state.rows, search.value, ['r_sustituido','matricula','numero_parada','r_sustituto','incidencia']);
      const units = rows.reduce((total,row) => total + Number(row.unidades || 0), 0);
      const amount = rows.reduce((total,row) => total + Number(row.importe || 0), 0);
      summary.append(
        metric('Sustituciones', rows.length),
        metric('Unidades', fmtNum(units)),
        metric(
          'Importe',
          rows.some(row => row.precio_r_unidad != null)
            ? `${fmtNum(amount,2)} €`
            : 'Precio pendiente'
        )
      );
      renderTable(
        tableHost,
        ['Inicio','Fin','R sustituido','Matrícula','Parada','R sustituto','Días','Unidades','Precio/u','Importe'],
        rows.map(row => [
          fmtDate(row.fecha_inicio_parada),
          fmtDate(row.fecha_fin_parada),
          row.r_sustituido,
          row.matricula,
          row.numero_parada,
          row.r_sustituto,
          fmtNum(row.dias_parada_total),
          fmtNum(row.unidades),
          row.precio_r_unidad == null ? '—' : `${fmtNum(row.precio_r_unidad,2)} €`,
          row.importe == null ? '—' : `${fmtNum(row.importe,2)} €`,
        ])
      );
      return;
    }

    if (state.view === 'paradas') {
      const rows = searchRows(state.rows, search.value, ['dfm','matricula','numero_parada','incidencia','talleres','causa']);
      const days = rows.reduce((total,row) => total + Number(row.dias_taller || 0), 0);
      summary.append(
        metric('Paradas', rows.length),
        metric('Días en taller', fmtNum(days,1)),
        metric('Promedio', rows.length ? fmtNum(days / rows.length,1) : '0,0')
      );
      renderTable(
        tableHost,
        ['Fecha','Parada','DFM/R','Matrícula','INC','Causa','Estado','Taller','Días taller','UPC'],
        rows.map(row => [
          fmtDate(row.fecha_parada),
          row.numero_parada,
          row.dfm,
          row.matricula,
          row.incidencia,
          row.causa,
          row.estado,
          row.talleres || row.lugar,
          fmtNum(row.dias_taller,1),
          row.upc,
        ])
      );
      return;
    }

    const rows = searchRows(state.rows, search.value, ['dfm','matricula','numero_caso','estado','resultado','averia','proveedor']);
    summary.append(metric('Incidencias', rows.length));
    renderTable(
      tableHost,
      ['Fecha','DFM','Matrícula','Caso','Estado','Resultado','Avería','Proveedor'],
      rows.map(row => [
        fmtDateTime(row.creado_en),
        row.dfm,
        row.matricula,
        row.numero_caso,
        row.estado,
        row.resultado,
        row.averia,
        row.proveedor,
      ])
    );
  }

  async function refresh() {
    const request = ++state.request;
    state.rows = [];
    summary.replaceChildren();
    tableHost.replaceChildren();
    setStatus(status, 'Cargando únicamente el listado solicitado…', 'warning');

    await renderRConfig(rConfig, refresh);

    try {
      if (state.view === 'dfm') state.rows = await readDfm(period.value, from.value, to.value);
      else if (state.view === 'r') state.rows = await readR(from.value, to.value);
      else if (state.view === 'paradas') state.rows = await readParadas(from.value, to.value);
      else state.rows = await read24h(from.value, to.value);

      if (request !== state.request) return;
      setStatus(
        status,
        `${state.rows.length} registro${state.rows.length === 1 ? '' : 's'} cargado${state.rows.length === 1 ? '' : 's'}.`,
        'muted'
      );
      showRows();
    } catch (error) {
      if (request !== state.request) return;
      setStatus(status, `No se pudo cargar este listado: ${error.message}`, 'danger');
    }
  }

  tabs.addEventListener('click', event => {
    const tab = event.target.closest('button[data-view]');
    if (!tab) return;
    state.view = tab.dataset.view;
    updateTabs();
    refresh();
  });
  period.addEventListener('change', refresh);
  from.addEventListener('change', refresh);
  to.addEventListener('change', refresh);
  search.addEventListener('input', showRows);
  refreshButton.addEventListener('click', refresh);

  (async () => {
    try {
      if (!state.periods.length) await readPeriods();
      period.replaceChildren();
      state.periods.forEach(item => period.append(new Option(
        `${item.periodo} · ${fmtDate(item.fecha_inicio)}–${fmtDate(item.fecha_cierre)}`,
        item.periodo
      )));
      const active = currentPeriod();
      if (active) period.value = active.periodo;
      updateTabs();
      await refresh();
    } catch (error) {
      setStatus(status, `No se pudieron cargar los periodos: ${error.message}`, 'danger');
    }
  })();

  button?.scrollIntoView?.({ block: 'nearest' });
}

if (OWNER === 'alpha75' && nav) {
  ensureButton();

  const observer = new MutationObserver(() => {
    removeLegacyEntryPoints();
    ensureButton();
  });
  observer.observe(nav, { childList: true });

  nav.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (button && button.dataset.alpha75Listados !== '1') {
      nav.querySelector('[data-alpha75-listados]')?.classList.remove('active');
    }
  });
}
