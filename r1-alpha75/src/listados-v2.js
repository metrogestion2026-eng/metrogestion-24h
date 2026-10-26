import { supabase } from '../../r1-alpha17/src/supabase.js';

const dom = {
  user: document.querySelector('#v2-user'),
  role: document.querySelector('#v2-role'),
  warning: document.querySelector('#v2-auth-warning'),
  app: document.querySelector('#v2-app'),
  tabs: document.querySelector('#v2-tabs'),
  title: document.querySelector('#v2-title'),
  periodWrap: document.querySelector('#v2-period-wrap'),
  period: document.querySelector('#v2-period'),
  from: document.querySelector('#v2-from'),
  to: document.querySelector('#v2-to'),
  search: document.querySelector('#v2-search'),
  refresh: document.querySelector('#v2-refresh'),
  status: document.querySelector('#v2-status'),
  summary: document.querySelector('#v2-summary'),
  table: document.querySelector('#v2-table'),
  rConfig: document.querySelector('#v2-r-config'),
  print: document.querySelector('#v2-print'),
  csv: document.querySelector('#v2-csv'),
};

const state = {
  view: 'dfm',
  periods: [],
  rows: [],
  profile: null,
  request: 0,
  headers: [],
  tableRows: [],
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
    : date.toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Madrid' });
}
function fmtNum(value, digits = 0) {
  const number = Number(value);
  return Number.isFinite(number)
    ? new Intl.NumberFormat('es-ES', { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(number)
    : '—';
}
function todayMadrid() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());
}
function metric(label, value) {
  const node = el('div', null, 'v2-metric');
  node.append(el('strong', value), el('span', label, 'muted'));
  return node;
}
function setStatus(text, tone = 'warning') {
  dom.status.className = tone === 'muted' ? 'muted' : `notice ${tone}`;
  dom.status.textContent = text;
}
function currentPeriod() {
  const today = todayMadrid();
  return state.periods.find(p => today >= p.fecha_inicio && today <= p.fecha_cierre)
    || state.periods[0]
    || null;
}
function searchRows(rows, fields) {
  const query = dom.search.value.trim().toLocaleLowerCase('es-ES');
  if (!query) return rows;
  return rows.filter(row => fields.some(field =>
    String(row?.[field] ?? '').toLocaleLowerCase('es-ES').includes(query)
  ));
}
function renderTable(headers, rows) {
  state.headers = headers.slice();
  state.tableRows = rows.map(row => row.map(value => value == null ? '—' : String(value)));
  dom.table.replaceChildren();

  const wrap = el('div', null, 'v2-table-wrap');
  if (!rows.length) {
    wrap.append(el('div', 'No hay resultados con estos filtros.', 'v2-empty'));
    dom.table.append(wrap);
    return;
  }

  const table = el('table', null, 'v2-table');
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
  dom.table.append(wrap);
}

async function readPeriods() {
  const { data, error } = await supabase
    .from('cierres_facturacion')
    .select('periodo,fecha_inicio,fecha_cierre')
    .order('periodo', { ascending: false });
  if (error) throw error;
  state.periods = data || [];
  dom.period.replaceChildren();
  state.periods.forEach(period => dom.period.append(new Option(
    `${period.periodo} · ${fmtDate(period.fecha_inicio)}–${fmtDate(period.fecha_cierre)}`,
    period.periodo
  )));
  const active = currentPeriod();
  if (active) dom.period.value = active.periodo;
}

async function readDfm() {
  if (!dom.period.value) return [];
  let query = supabase
    .from('facturacion_dfm_periodos')
    .select('seguimiento_id,numero_parada,dfm,matricula,sustituto,periodo,tramo_inicio,tramo_fin,dias_facturables,km_dia,km_dia_fuente,estado')
    .eq('periodo', dom.period.value)
    .order('tramo_inicio', { ascending: true });
  if (dom.from.value) query = query.gte('tramo_fin', dom.from.value);
  if (dom.to.value) query = query.lte('tramo_inicio', dom.to.value);
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}
async function readR() {
  let query = supabase
    .from('facturacion_r_sustituciones')
    .select('seguimiento_id,numero_parada,r_sustituido,matricula,r_sustituto,fecha_inicio_parada,fecha_fin_parada,dias_parada_total,unidades,precio_r_unidad,importe,incidencia')
    .order('fecha_inicio_parada', { ascending: false });
  if (dom.from.value) query = query.gte('fecha_fin_parada', dom.from.value);
  if (dom.to.value) query = query.lte('fecha_inicio_parada', dom.to.value);
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}
async function readParadas() {
  let query = supabase
    .from('listado_paradas_operativas')
    .select('seguimiento_id,numero_parada,dfm,matricula,incidencia,causa,estado,talleres,lugar,dias_taller,upc,fecha_parada')
    .order('fecha_parada', { ascending: false });
  if (dom.from.value) query = query.gte('fecha_parada', dom.from.value);
  if (dom.to.value) query = query.lte('fecha_parada', dom.to.value);
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}
async function read24h() {
  let query = supabase
    .from('activaciones_24h')
    .select('id,dfm,matricula,numero_caso,estado,resultado,creado_en,averia,proveedor')
    .order('creado_en', { ascending: false });
  if (dom.from.value) query = query.gte('creado_en', `${dom.from.value}T00:00:00+01:00`);
  if (dom.to.value) query = query.lte('creado_en', `${dom.to.value}T23:59:59+01:00`);
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

async function renderRConfig() {
  dom.rConfig.replaceChildren();
  dom.rConfig.classList.toggle('hidden', state.view !== 'r');
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
      const { error: saveError } = await supabase.rpc('guardar_precio_r_sustitucion', { p_precio: value });
      save.disabled = false;
      message.textContent = saveError ? `No se pudo guardar: ${saveError.message}` : 'Precio R guardado.';
      if (!saveError) await refresh();
    });

    dom.rConfig.append(label, save, message);
  } catch (error) {
    dom.rConfig.append(el('span', `No se pudo cargar el precio R: ${error.message}`, 'notice danger'));
  }
}

function renderRows() {
  dom.summary.replaceChildren();

  if (state.view === 'dfm') {
    const rows = searchRows(state.rows, ['dfm','matricula','numero_parada','sustituto']);
    const days = rows.reduce((sum,row) => sum + Number(row.dias_facturables || 0), 0);
    dom.summary.append(metric('Paradas', rows.length), metric('Días facturables', fmtNum(days)));
    renderTable(
      ['Periodo','Inicio','Fin','DFM','Matrícula','Parada','Sustituto','Días','Media km/día','Fuente','Estado'],
      rows.map(row => [
        row.periodo, fmtDate(row.tramo_inicio), fmtDate(row.tramo_fin), row.dfm, row.matricula,
        row.numero_parada, row.sustituto, fmtNum(row.dias_facturables),
        row.km_dia == null ? '—' : fmtNum(row.km_dia), row.km_dia_fuente || '—', row.estado || '—'
      ])
    );
    return;
  }

  if (state.view === 'r') {
    const rows = searchRows(state.rows, ['r_sustituido','matricula','numero_parada','r_sustituto','incidencia']);
    const units = rows.reduce((sum,row) => sum + Number(row.unidades || 0), 0);
    const amount = rows.reduce((sum,row) => sum + Number(row.importe || 0), 0);
    dom.summary.append(
      metric('Sustituciones', rows.length),
      metric('Unidades', fmtNum(units)),
      metric('Importe', rows.some(row => row.precio_r_unidad != null) ? `${fmtNum(amount,2)} €` : 'Precio pendiente')
    );
    renderTable(
      ['Inicio','Fin','R sustituido','Matrícula','Parada','R sustituto','Días','Unidades','Precio/u','Importe'],
      rows.map(row => [
        fmtDate(row.fecha_inicio_parada), fmtDate(row.fecha_fin_parada), row.r_sustituido, row.matricula,
        row.numero_parada, row.r_sustituto, fmtNum(row.dias_parada_total), fmtNum(row.unidades),
        row.precio_r_unidad == null ? '—' : `${fmtNum(row.precio_r_unidad,2)} €`,
        row.importe == null ? '—' : `${fmtNum(row.importe,2)} €`
      ])
    );
    return;
  }

  if (state.view === 'paradas') {
    const rows = searchRows(state.rows, ['dfm','matricula','numero_parada','incidencia','talleres','causa']);
    const days = rows.reduce((sum,row) => sum + Number(row.dias_taller || 0), 0);
    dom.summary.append(
      metric('Paradas', rows.length),
      metric('Días en taller', fmtNum(days,1)),
      metric('Promedio', rows.length ? fmtNum(days / rows.length,1) : '0,0')
    );
    renderTable(
      ['Fecha','Parada','DFM/R','Matrícula','INC','Causa','Estado','Taller','Días taller','UPC'],
      rows.map(row => [
        fmtDate(row.fecha_parada), row.numero_parada, row.dfm, row.matricula, row.incidencia, row.causa,
        row.estado, row.talleres || row.lugar, fmtNum(row.dias_taller,1), row.upc
      ])
    );
    return;
  }

  const rows = searchRows(state.rows, ['dfm','matricula','numero_caso','estado','resultado','averia','proveedor']);
  dom.summary.append(metric('Incidencias', rows.length));
  renderTable(
    ['Fecha','DFM','Matrícula','Caso','Estado','Resultado','Avería','Proveedor'],
    rows.map(row => [
      fmtDateTime(row.creado_en), row.dfm, row.matricula, row.numero_caso, row.estado,
      row.resultado, row.averia, row.proveedor
    ])
  );
}

async function refresh() {
  const request = ++state.request;
  state.rows = [];
  dom.summary.replaceChildren();
  dom.table.replaceChildren();
  setStatus('Cargando únicamente el listado solicitado…', 'warning');

  try {
    if (state.view === 'dfm') state.rows = await readDfm();
    else if (state.view === 'r') state.rows = await readR();
    else if (state.view === 'paradas') state.rows = await readParadas();
    else state.rows = await read24h();

    if (request !== state.request) return;
    setStatus(`${state.rows.length} registro${state.rows.length === 1 ? '' : 's'} cargado${state.rows.length === 1 ? '' : 's'}.`, 'muted');
    renderRows();
  } catch (error) {
    if (request !== state.request) return;
    setStatus(`No se pudo cargar este listado: ${error.message}`, 'danger');
  }
}

function setView(view) {
  state.view = view;
  [...dom.tabs.querySelectorAll('button[data-view]')].forEach(button => {
    button.classList.toggle('active', button.dataset.view === view);
  });

  const titles = {
    dfm: 'Facturación DFM',
    r: 'Sustituciones R',
    paradas: 'Paradas',
    '24h': 'Incidencias 24H',
  };
  dom.title.textContent = titles[view] || 'Listados V2';
  dom.periodWrap.classList.toggle('hidden', view !== 'dfm');
  renderRConfig();
  refresh();
}

function csvCell(value) {
  const text = String(value ?? '');
  return `"${text.replaceAll('"','""')}"`;
}
function downloadCsv() {
  const rows = [state.headers, ...state.tableRows];
  if (!state.headers.length) return;
  const csv = '\uFEFF' + rows.map(row => row.map(csvCell).join(';')).join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `metrogestion-listados-v2-${state.view}-${todayMadrid()}.csv`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function boot() {
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData?.user) {
    dom.warning.classList.remove('hidden');
    return;
  }

  const { data: profile, error: profileError } = await supabase
    .from('usuarios')
    .select('id,nombre,apellidos,correo,tipo_usuario,activo')
    .eq('id', authData.user.id)
    .maybeSingle();

  if (profileError || profile?.activo !== true) {
    dom.warning.textContent = profileError
      ? `No se pudo validar el usuario: ${profileError.message}`
      : 'La cuenta no está activa.';
    dom.warning.classList.remove('hidden');
    return;
  }

  state.profile = profile;
  dom.user.textContent = [profile.nombre, profile.apellidos].filter(Boolean).join(' ').trim() || profile.correo || authData.user.email;
  dom.role.textContent = profile.tipo_usuario || '';
  dom.app.classList.remove('hidden');

  try {
    await readPeriods();
    setView('dfm');
  } catch (error) {
    setStatus(`No se pudieron cargar los periodos de facturación: ${error.message}`, 'danger');
  }
}

dom.tabs.addEventListener('click', event => {
  const button = event.target.closest('button[data-view]');
  if (button) setView(button.dataset.view);
});
dom.period.addEventListener('change', refresh);
dom.from.addEventListener('change', refresh);
dom.to.addEventListener('change', refresh);
dom.search.addEventListener('input', renderRows);
dom.refresh.addEventListener('click', refresh);
dom.print.addEventListener('click', () => window.print());
dom.csv.addEventListener('click', downloadCsv);

void boot();
