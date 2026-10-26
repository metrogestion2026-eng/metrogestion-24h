import { supabase } from '../../r1-alpha17/src/supabase.js';

const nav = document.querySelector('#module-nav');
const content = document.querySelector('#module-content');
let renderToken = 0;

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
function fmtNum(value, digits = 0) {
  const n = Number(value);
  return Number.isFinite(n)
    ? new Intl.NumberFormat('es-ES', { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(n)
    : '—';
}
function todayMadrid() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());
}
function metric(label, value) {
  const box = el('div', null, 'alpha30-metric');
  box.append(el('strong', value), el('span', label, 'muted'));
  return box;
}
function table(headers, rows) {
  const wrap = el('div', null, 'alpha30-table-wrap');
  if (!rows.length) {
    wrap.append(el('div', 'No hay resultados con estos filtros.', 'alpha30-empty'));
    return wrap;
  }
  const t = el('table', null, 'alpha30-table');
  const thead = el('thead');
  const hr = el('tr');
  headers.forEach(h => hr.append(el('th', h)));
  thead.append(hr);
  const body = el('tbody');
  rows.forEach(values => {
    const tr = el('tr');
    values.forEach(v => tr.append(el('td', v ?? '—')));
    body.append(tr);
  });
  t.append(thead, body);
  wrap.append(t);
  return wrap;
}
function currentPeriod(periods) {
  const today = todayMadrid();
  return periods.find(p => today >= p.fecha_inicio && today <= p.fecha_cierre)
    || periods[0]
    || null;
}
function showError(host, error) {
  host.replaceChildren(el('div', `No se pudo cargar Listados: ${error?.message || error || 'error desconocido'}`, 'notice danger'));
}
function filteredBySearch(rows, query, fields) {
  const q = String(query || '').trim().toLocaleLowerCase('es-ES');
  if (!q) return rows;
  return rows.filter(row => fields.some(field =>
    String(row?.[field] ?? '').toLocaleLowerCase('es-ES').includes(q)
  ));
}

async function loadPeriods() {
  const { data, error } = await supabase
    .from('cierres_facturacion')
    .select('periodo,fecha_inicio,fecha_cierre')
    .order('periodo', { ascending: false });
  if (error) throw error;
  return data || [];
}

async function loadDfm({ period, from, to }) {
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

async function loadR({ from, to }) {
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

async function loadParadas({ from, to }) {
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

async function loadRPrice() {
  const { data, error } = await supabase
    .from('config_facturacion_sustituciones')
    .select('precio_r_unidad')
    .eq('id', 1)
    .maybeSingle();
  if (error) throw error;
  return data?.precio_r_unidad ?? null;
}

function renderListados() {
  const myToken = ++renderToken;
  content.replaceChildren();

  const wrap = el('section');
  wrap.dataset.alpha75Listados = '1';

  const head = el('div', null, 'alpha30-listados-head');
  const title = el('div');
  title.append(el('p', 'Informes operativos y facturación', 'eyebrow'), el('h2', 'Listados'));
  const controls = el('div', null, 'alpha30-controls');
  head.append(title, controls);
  wrap.append(head);

  // Sentinel + panel real: impide que el enhancer heredado alpha31 duplique el bloque R.
  const rConfig = el('div', null, 'alpha31-r-config');
  rConfig.hidden = true;
  wrap.append(rConfig);

  const filters = el('div', null, 'alpha30-filters');
  const mode = document.createElement('select');
  [['dfm','Facturación DFM'],['r','Sustituciones R'],['paradas','Paradas']].forEach(([v,t]) => mode.append(new Option(t,v)));
  const period = document.createElement('select');
  const from = document.createElement('input'); from.type = 'date';
  const to = document.createElement('input'); to.type = 'date';
  const search = document.createElement('input'); search.placeholder = 'DFM, R, matrícula, parada o INC';

  for (const [label,input] of [
    ['Tipo de listado',mode],['Periodo facturación',period],['Desde',from],['Hasta',to],['Buscar',search]
  ]) {
    const lab = el('label');
    lab.append(el('span', label), input);
    filters.append(lab);
  }
  wrap.append(filters);

  const summary = el('div', null, 'alpha30-summary');
  const status = el('div', 'Cargando periodos…', 'notice warning');
  const tableHost = el('div');
  wrap.append(summary, status, tableHost);
  content.append(wrap);

  let periods = [];
  let rows = [];

  function showRows() {
    summary.replaceChildren();
    tableHost.replaceChildren();
    const q = search.value;

    if (mode.value === 'dfm') {
      const visible = filteredBySearch(rows, q, ['dfm','matricula','numero_parada','sustituto']);
      const days = visible.reduce((sum,row) => sum + Number(row.dias_facturables || 0), 0);
      summary.append(metric('Paradas', visible.length), metric('Días facturables', fmtNum(days)));
      tableHost.append(table(
        ['Periodo','Inicio','Fin','DFM','Matrícula','Parada','Sustituto','Días','Media km/día','Fuente'],
        visible.map(x => [
          x.periodo, fmtDate(x.tramo_inicio), fmtDate(x.tramo_fin), x.dfm, x.matricula,
          x.numero_parada, x.sustituto, fmtNum(x.dias_facturables),
          x.km_dia == null ? '—' : fmtNum(x.km_dia), x.km_dia_fuente || '—'
        ])
      ));
      return;
    }

    if (mode.value === 'r') {
      const visible = filteredBySearch(rows, q, ['r_sustituido','matricula','numero_parada','r_sustituto','incidencia']);
      const units = visible.reduce((sum,row) => sum + Number(row.unidades || 0), 0);
      const amount = visible.reduce((sum,row) => sum + Number(row.importe || 0), 0);
      summary.append(
        metric('Sustituciones', visible.length),
        metric('Unidades', fmtNum(units)),
        metric('Importe', visible.some(x => x.precio_r_unidad != null) ? `${fmtNum(amount,2)} €` : 'Precio pendiente')
      );
      tableHost.append(table(
        ['Inicio','Fin','R sustituido','Matrícula','Parada','R sustituto','Días','Unidades','Precio/u','Importe'],
        visible.map(x => [
          fmtDate(x.fecha_inicio_parada), fmtDate(x.fecha_fin_parada), x.r_sustituido, x.matricula,
          x.numero_parada, x.r_sustituto, fmtNum(x.dias_parada_total), fmtNum(x.unidades),
          x.precio_r_unidad == null ? '—' : `${fmtNum(x.precio_r_unidad,2)} €`,
          x.importe == null ? '—' : `${fmtNum(x.importe,2)} €`
        ])
      ));
      return;
    }

    const visible = filteredBySearch(rows, q, ['dfm','matricula','numero_parada','incidencia']);
    const days = visible.reduce((sum,row) => sum + Number(row.dias_taller || 0), 0);
    summary.append(
      metric('Paradas', visible.length),
      metric('Días en taller', fmtNum(days,1)),
      metric('Promedio', visible.length ? fmtNum(days / visible.length,1) : '0,0')
    );
    tableHost.append(table(
      ['Fecha','Parada','DFM/R','Matrícula','INC','Causa','Estado','Taller','Días taller','UPC'],
      visible.map(x => [
        fmtDate(x.fecha_parada), x.numero_parada, x.dfm, x.matricula, x.incidencia, x.causa,
        x.estado, x.talleres || x.lugar, fmtNum(x.dias_taller,1), x.upc
      ])
    ));
  }

  async function showRConfig() {
    rConfig.replaceChildren();
    if (mode.value !== 'r') {
      rConfig.hidden = true;
      return;
    }
    rConfig.hidden = false;
    try {
      const value = await loadRPrice();
      if (myToken !== renderToken) return;
      const input = document.createElement('input');
      input.type = 'number'; input.min = '0'; input.max = '100000'; input.step = '0.01';
      input.value = value ?? ''; input.placeholder = 'Ej. 85,00';
      const label = el('label');
      label.append(el('span','Precio fijo por sustitución R (€)'),input);
      const save = el('button','Guardar precio R','button primary compact'); save.type='button';
      const message = el('span','', 'alpha31-status');
      save.addEventListener('click', async () => {
        const raw = input.value.trim();
        const price = raw === '' ? null : Number(raw);
        if (price != null && (!Number.isFinite(price) || price < 0 || price > 100000)) {
          message.textContent = 'Precio no válido.';
          return;
        }
        save.disabled = true; message.textContent = 'Guardando…';
        const { error } = await supabase.rpc('guardar_precio_r_sustitucion', { p_precio: price });
        save.disabled = false;
        message.textContent = error ? `No se pudo guardar: ${error.message}` : 'Precio R guardado.';
      });
      rConfig.append(label,save,message);
    } catch (error) {
      rConfig.append(el('span', `No se pudo cargar el precio R: ${error.message}`, 'alpha31-status'));
    }
  }

  async function refresh() {
    const token = ++renderToken;
    rows = [];
    summary.replaceChildren();
    tableHost.replaceChildren();
    status.className = 'notice warning';
    status.textContent = 'Cargando el listado solicitado…';

    period.disabled = mode.value !== 'dfm';
    showRConfig();

    try {
      if (mode.value === 'dfm') rows = await loadDfm({ period: period.value, from: from.value, to: to.value });
      else if (mode.value === 'r') rows = await loadR({ from: from.value, to: to.value });
      else rows = await loadParadas({ from: from.value, to: to.value });
      if (token !== renderToken) return;
      status.className = 'muted';
      status.textContent = `${rows.length} registro${rows.length === 1 ? '' : 's'} cargado${rows.length === 1 ? '' : 's'}.`;
      showRows();
    } catch (error) {
      if (token !== renderToken) return;
      status.className = '';
      showError(status, error);
    }
  }

  search.addEventListener('input', showRows);
  mode.addEventListener('change', refresh);
  period.addEventListener('change', refresh);
  from.addEventListener('change', refresh);
  to.addEventListener('change', refresh);

  (async () => {
    try {
      periods = await loadPeriods();
      if (myToken !== renderToken) return;
      period.replaceChildren();
      periods.forEach(p => period.append(new Option(
        `${p.periodo} · ${fmtDate(p.fecha_inicio)}–${fmtDate(p.fecha_cierre)}`,
        p.periodo
      )));
      const current = currentPeriod(periods);
      if (current) period.value = current.periodo;
      await refresh();
    } catch (error) {
      showError(status, error);
    }
  })();
}

function ensureAlpha75ListadosButton() {
  if (!nav) return;

  const inherited = [...nav.querySelectorAll('[data-alpha29-listados]')];
  inherited.forEach(button => {
    button.hidden = true;
    button.setAttribute('aria-hidden', 'true');
    button.tabIndex = -1;
  });

  let own = nav.querySelector('[data-alpha75-listados]');
  if (!own) {
    own = document.createElement('button');
    own.type = 'button';
    own.className = 'button secondary';
    own.dataset.alpha75Listados = '1';
    own.textContent = '📋 Listados';
    own.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      [...nav.querySelectorAll('button')].forEach(item => item.classList.remove('active'));
      own.classList.add('active');
      renderListados();
    });
    nav.append(own);
  }
}

if (nav) {
  const navObserver = new MutationObserver(() => queueMicrotask(ensureAlpha75ListadosButton));
  navObserver.observe(nav, { childList: true });
  ensureAlpha75ListadosButton();
}
