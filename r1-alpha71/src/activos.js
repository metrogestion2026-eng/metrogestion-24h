import { supabase } from '../../r1-alpha17/src/supabase.js';

const nav = document.querySelector('#module-nav');
const content = document.querySelector('#module-content');
const appView = document.querySelector('#app-view');
const MODULE_FLAG = 'alpha71Activos';

let profilePromise = null;
let loadSequence = 0;
let currentRows = [];
let currentAccess = { view: false, edit: false };

function clean(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function el(tag, text = null, className = '') {
  const node = document.createElement(tag);
  if (text !== null && text !== undefined) node.textContent = String(text);
  if (className) node.className = className;
  return node;
}

function isPrimaryAdmin(profile) {
  return profile?.activo === true && profile?.tipo_usuario === 'administrador_principal';
}

function moduleAccess(profile) {
  if (profile?.activo !== true) return { view: false, edit: false };
  if (isPrimaryAdmin(profile)) return { view: true, edit: true };
  const permission = profile?.permisos?.activos || {};
  const edit = permission.editar === true;
  return { view: edit || permission.ver === true || permission.leer === true, edit };
}

async function currentProfile() {
  if (profilePromise) return profilePromise;
  profilePromise = (async () => {
    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError || !authData?.user?.id) return null;
    const { data, error } = await supabase
      .from('usuarios')
      .select('id,nombre,apellidos,correo,tipo_usuario,permisos,activo')
      .eq('id', authData.user.id)
      .maybeSingle();
    if (error) throw error;
    return data || null;
  })();
  return profilePromise;
}

function formatDate(value) {
  if (!value) return '—';
  const [year, month, day] = String(value).slice(0, 10).split('-');
  return year && month && day ? `${day}/${month}/${year}` : String(value);
}

function formatDateTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' });
}

function requestId(prefix = 'activos') {
  const token = crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${token}`.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 80);
}

function friendlyError(error, fallback = 'No se pudo completar la operación.') {
  const message = clean(error?.message || error?.details || '');
  if (error?.code === '42501') return 'Tu usuario o dispositivo no tiene permiso para modificar Activos.';
  if (error?.code === '23505') return 'Ya existe un activo con el mismo DFM, matrícula o bastidor.';
  return message || fallback;
}

function markButtonActive(button) {
  nav?.querySelectorAll('button').forEach(node => node.classList.toggle('active', node === button));
}

function closeModal(overlay) {
  overlay.remove();
  if (!document.querySelector('.a70-assets-modal')) document.body.classList.remove('a70-assets-modal-open');
}

function appendOption(select, value, label, selected = false) {
  const option = document.createElement('option');
  option.value = value;
  option.textContent = label;
  option.selected = selected;
  select.append(option);
}

function inputField(labelText, options = {}) {
  const {
    name, value = '', type = 'text', required = false, placeholder = '',
    options: selectOptions = null, wide = false, hint = '', min = null, readOnly = false,
  } = options;
  const label = el('label', null, `a70-assets-field${wide ? ' wide' : ''}`);
  label.append(el('span', `${labelText}${required ? ' *' : ''}`));
  let input;
  if (selectOptions) {
    input = document.createElement('select');
    selectOptions.forEach(option => appendOption(input, option.value, option.label, String(option.value) === String(value)));
  } else {
    input = document.createElement('input');
    input.type = type;
    input.value = value ?? '';
    input.placeholder = placeholder;
    input.readOnly = readOnly;
    if (min !== null) input.min = String(min);
  }
  input.name = name;
  input.required = required;
  if (['dfm', 'matricula', 'bastidor'].includes(name)) {
    input.autocapitalize = 'characters';
    input.spellcheck = false;
  }
  label.append(input);
  if (hint) label.append(el('small', hint));
  return label;
}

function vehicleSource(row) {
  return row.fuente_manteniment_fila == null ? 'Alta manual' : `MANTENIMENT · fila ${row.fuente_manteniment_fila}`;
}

function vehicleDescription(row) {
  return [
    row.clase_vehiculo,
    row.tipo_manteniment,
    [row.marca, row.modelo].filter(Boolean).join(' '),
  ].filter(Boolean).join(' · ') || 'Sin clasificación';
}

function emptyState(message) {
  return el('div', message, 'a70-assets-empty');
}

function renderMetrics(host, rows) {
  const metrics = [
    ['Total', rows.length],
    ['Activos', rows.filter(row => row.activo).length],
    ['Bajas', rows.filter(row => !row.activo).length],
    ['Desde MANTENIMENT', rows.filter(row => row.fuente_manteniment_fila != null).length],
    ['Altas manuales', rows.filter(row => row.fuente_manteniment_fila == null).length],
  ];
  const grid = el('div', null, 'a70-assets-metrics');
  metrics.forEach(([label, value]) => {
    const card = el('div', null, 'a70-assets-metric');
    card.append(el('strong', value), el('span', label));
    grid.append(card);
  });
  host.append(grid);
}

function filterRows(rows, controls) {
  const needle = clean(controls.search.value).toLocaleUpperCase('es-ES');
  const status = controls.status.value;
  const category = controls.category.value;
  const origin = controls.origin.value;
  return rows.filter(row => {
    if (status === 'active' && !row.activo) return false;
    if (status === 'inactive' && row.activo) return false;
    if (category !== 'all' && row.categoria !== category) return false;
    if (origin === 'sheet' && row.fuente_manteniment_fila == null) return false;
    if (origin === 'manual' && row.fuente_manteniment_fila != null) return false;
    if (!needle) return true;
    return [row.dfm, row.matricula, row.marca, row.modelo, row.bastidor, row.upc, row.telefono, row.tipo_manteniment]
      .some(value => String(value || '').toLocaleUpperCase('es-ES').includes(needle));
  });
}

function renderTable(host, rows, access, onChanged) {
  host.replaceChildren();
  if (!rows.length) {
    host.append(emptyState('No hay activos que coincidan con los filtros.'));
    return;
  }

  const tableWrap = el('div', null, 'a70-assets-table-wrap');
  const table = el('table', null, 'a70-assets-table');
  const head = document.createElement('thead');
  const headRow = document.createElement('tr');
  ['Activo', 'Vehículo', 'Datos operativos', 'Origen', 'Estado', 'Acciones'].forEach(label => headRow.append(el('th', label)));
  head.append(headRow);
  const body = document.createElement('tbody');

  rows.forEach(row => {
    const tr = document.createElement('tr');
    if (!row.activo) tr.classList.add('inactive');
    const identity = el('td');
    identity.dataset.label = 'Activo';
    identity.append(el('strong', row.dfm || '—'), el('span', row.matricula || '—', 'a70-assets-subline'));

    const vehicle = el('td');
    vehicle.dataset.label = 'Vehículo';
    vehicle.append(el('span', vehicleDescription(row)), el('span', row.bastidor ? `Bastidor ${row.bastidor}` : 'Sin bastidor', 'a70-assets-subline'));

    const operational = el('td');
    operational.dataset.label = 'Datos operativos';
    operational.append(
      el('span', row.upc ? `UPC ${row.upc}` : 'Sin UPC'),
      el('span', row.telefono ? `Tel. ${row.telefono}` : 'Sin teléfono', 'a70-assets-subline'),
      el('span', row.fecha_matriculacion ? `Matriculación ${formatDate(row.fecha_matriculacion)}` : 'Sin fecha de matriculación', 'a70-assets-subline'),
      el('span', row.fecha_alta_manteniment ? `Alta en delegación ${formatDate(row.fecha_alta_manteniment)}` : 'Sin fecha de alta en delegación', 'a70-assets-subline'),
      el('span', row.proxima_itv_fecha ? `Próxima ITV ${formatDate(row.proxima_itv_fecha)}` : 'Próxima ITV pendiente', 'a70-assets-subline')
    );

    const source = el('td');
    source.dataset.label = 'Origen';
    source.append(el('span', vehicleSource(row)), el('span', `Actualizado ${formatDateTime(row.actualizado_en)}`, 'a70-assets-subline'));

    const status = el('td');
    status.dataset.label = 'Estado';
    status.append(el('span', row.activo ? 'Activo' : 'Baja', `a70-assets-badge ${row.activo ? 'active' : 'inactive'}`));
    if (!row.activo && row.motivo_baja) status.append(el('span', row.motivo_baja, 'a70-assets-subline'));

    const actions = el('td', null, 'a70-assets-actions');
    actions.dataset.label = 'Acciones';
    if (access.edit) {
      const edit = el('button', 'Editar', 'button secondary compact');
      edit.type = 'button';
      edit.addEventListener('click', () => openAssetModal(row, onChanged));
      const toggle = el('button', row.activo ? 'Dar de baja' : 'Reactivar', `button compact ${row.activo ? 'danger' : 'primary'}`);
      toggle.type = 'button';
      toggle.addEventListener('click', () => openStateModal(row, onChanged));
      actions.append(edit, toggle);
    } else {
      actions.append(el('span', 'Solo lectura', 'muted'));
    }

    tr.append(identity, vehicle, operational, source, status, actions);
    body.append(tr);
  });

  table.append(head, body);
  tableWrap.append(table);
  host.append(tableWrap);
}

function assetPayload(form) {
  const values = Object.fromEntries(new FormData(form));
  return {
    dfm: clean(values.dfm),
    matricula: clean(values.matricula),
    categoria: clean(values.categoria),
    clase_vehiculo: clean(values.clase_vehiculo),
    tipo_manteniment: clean(values.tipo_manteniment),
    tipo_motor: clean(values.tipo_motor),
    marca: clean(values.marca),
    modelo: clean(values.modelo),
    bastidor: clean(values.bastidor),
    upc: clean(values.upc),
    telefono: clean(values.telefono),
    fecha_matriculacion: clean(values.fecha_matriculacion),
    fecha_alta_manteniment: clean(values.fecha_alta_manteniment),
    contrato_texto: clean(values.contrato_texto),
    fin_contrato_fecha: clean(values.fin_contrato_fecha),
    fin_contrato_km: clean(values.fin_contrato_km),
    km_actual: clean(values.km_actual),
    asignacion_manteniment: clean(values.asignacion_manteniment),
    reserva: values.reserva === 'true',
  };
}

function applyCategoryRules(form) {
  const category = form.elements.categoria;
  const vehicleClass = form.elements.clase_vehiculo;
  const upc = form.elements.upc;
  if (!category || !vehicleClass || !upc) return;
  const sync = () => {
    if (category.value === 'R') vehicleClass.value = 'semirremolque';
    else if (vehicleClass.value === 'semirremolque') vehicleClass.value = 'tractora';
    upc.required = category.value === 'DFM';
    upc.closest('label')?.classList.toggle('required-by-category', upc.required);
  };
  category.addEventListener('change', sync);
  sync();
}

function openAssetModal(row, onChanged) {
  const creating = !row;
  const overlay = el('div', null, 'a70-assets-modal');
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  const card = el('section', null, 'a70-assets-modal-card');
  const head = el('div', null, 'a70-assets-modal-head');
  const copy = el('div');
  copy.append(el('p', 'Flota operativa', 'eyebrow'), el('h2', creating ? 'Dar de alta un activo' : `Editar ${row.dfm}`));
  const close = el('button', 'Cerrar', 'button secondary compact');
  close.type = 'button';
  close.addEventListener('click', () => closeModal(overlay));
  head.append(copy, close);

  const explanation = el('p', creating
    ? 'El alta se guarda en la misma base de datos que utilizan Hotel, reservas y 24H.'
    : `Versión ${row.version}. Si MANTENIMENT actualiza la ficha mientras la editas, Metrogestión impedirá sobrescribirla.`, 'muted');

  const form = el('form', null, 'a70-assets-form');
  form.append(
    inputField('DFM / código', { name: 'dfm', value: row?.dfm, required: true, readOnly: !creating, placeholder: '2710 o R1320', hint: creating ? '' : 'Identificador permanente: no se modifica para conservar el histórico.' }),
    inputField('Matrícula', { name: 'matricula', value: row?.matricula, required: true, placeholder: '1234ABC' }),
    inputField('Categoría', { name: 'categoria', value: row?.categoria || 'DFM', required: true, options: [
      { value: 'DFM', label: 'DFM · vehículo motor' }, { value: 'R', label: 'R · semirremolque' },
    ] }),
    inputField('Clase', { name: 'clase_vehiculo', value: row?.clase_vehiculo || 'tractora', required: true, options: [
      { value: 'tractora', label: 'Tractora' }, { value: 'rigido', label: 'Rígido' }, { value: 'semirremolque', label: 'Semirremolque' },
    ] }),
    inputField('Tipo MANTENIMENT', { name: 'tipo_manteniment', value: row?.tipo_manteniment || 'ALTA', required: true, placeholder: 'ALTA' }),
    inputField('Tipo de motor', { name: 'tipo_motor', value: row?.tipo_motor, placeholder: 'DIESEL, ELÉCTRICO…' }),
    inputField('Marca', { name: 'marca', value: row?.marca, required: true, placeholder: 'IVECO' }),
    inputField('Modelo', { name: 'modelo', value: row?.modelo, placeholder: 'Modelo' }),
    inputField('Bastidor', { name: 'bastidor', value: row?.bastidor, required: true, placeholder: 'Número de bastidor' }),
    inputField('UPC / unidad', { name: 'upc', value: row?.upc, placeholder: 'UPC operativo', hint: 'Obligatorio para los DFM.' }),
    inputField('Teléfono del vehículo', { name: 'telefono', value: row?.telefono, type: 'tel', placeholder: 'Teléfono o SIM' }),
    inputField('Fecha de matriculación (columna I)', { name: 'fecha_matriculacion', value: row?.fecha_matriculacion, type: 'date', hint: 'Base del fin de contrato y de la primera ITV.' }),
    inputField('Fecha de alta en delegación (columna J)', { name: 'fecha_alta_manteniment', value: row?.fecha_alta_manteniment || new Date().toISOString().slice(0, 10), type: 'date', required: true }),
    inputField('Próxima ITV calculada', { name: 'proxima_itv_fecha', value: row?.proxima_itv_fecha, type: 'date', readOnly: true, hint: 'Se calcula automáticamente: matriculación + 1 año.' }),
    inputField('Asignación', { name: 'asignacion_manteniment', value: row?.asignacion_manteniment, placeholder: 'FLOTA, base, ruta…' }),
    inputField('Contrato / referencia', { name: 'contrato_texto', value: row?.contrato_texto, placeholder: 'Contrato o referencia' }),
    inputField('Fin de contrato calculado', { name: 'fin_contrato_fecha', value: row?.fin_contrato_fecha, type: 'date', readOnly: true, hint: 'Se recalcula desde la fecha de matriculación.' }),
    inputField('Km fin de contrato', { name: 'fin_contrato_km', value: row?.fin_contrato_km, type: 'number', min: 0 }),
    inputField('Km actuales', { name: 'km_actual', value: row?.km_actual, type: 'number', min: 0 }),
    inputField('Uso como reserva', { name: 'reserva', value: String(row?.reserva === true), options: [
      { value: 'false', label: 'No' }, { value: 'true', label: 'Sí' },
    ] })
  );
  applyCategoryRules(form);

  const status = el('p', '', 'status-message wide');
  const actions = el('div', null, 'a70-assets-modal-actions wide');
  const cancel = el('button', 'Cancelar', 'button secondary');
  cancel.type = 'button';
  cancel.addEventListener('click', () => closeModal(overlay));
  const save = el('button', creating ? 'Crear activo' : 'Guardar cambios', 'button primary');
  save.type = 'submit';
  actions.append(cancel, save);
  form.append(status, actions);

  form.addEventListener('submit', async event => {
    event.preventDefault();
    save.disabled = true;
    status.classList.remove('success');
    status.textContent = creating ? 'Creando activo…' : 'Guardando cambios…';
    const { error } = await supabase.rpc('guardar_activo', {
      p_id: row?.id || null,
      p_version: row?.version || null,
      p_payload: assetPayload(form),
      p_request_id: requestId('guardar-activo'),
    });
    if (error) {
      status.textContent = friendlyError(error, 'No se pudo guardar el activo.');
      save.disabled = false;
      return;
    }
    status.classList.add('success');
    status.textContent = creating ? 'Activo creado correctamente.' : 'Cambios guardados correctamente.';
    await onChanged();
    window.setTimeout(() => closeModal(overlay), 500);
  });

  card.append(head, explanation, form);
  overlay.append(card);
  overlay.addEventListener('click', event => { if (event.target === overlay) closeModal(overlay); });
  document.addEventListener('keydown', function escape(event) {
    if (event.key !== 'Escape' || !overlay.isConnected) return;
    closeModal(overlay);
    document.removeEventListener('keydown', escape);
  });
  document.body.append(overlay);
  document.body.classList.add('a70-assets-modal-open');
  form.elements.dfm?.focus();
}

function openStateModal(row, onChanged) {
  const reactivating = !row.activo;
  const overlay = el('div', null, 'a70-assets-modal');
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  const card = el('section', null, 'a70-assets-modal-card a70-assets-state-card');
  const head = el('div', null, 'a70-assets-modal-head');
  const copy = el('div');
  copy.append(el('p', 'Estado del activo', 'eyebrow'), el('h2', `${reactivating ? 'Reactivar' : 'Dar de baja'} ${row.dfm}`));
  const close = el('button', 'Cerrar', 'button secondary compact');
  close.type = 'button';
  close.addEventListener('click', () => closeModal(overlay));
  head.append(copy, close);
  card.append(head);

  const notice = el('div', null, reactivating ? 'a70-assets-notice success' : 'a70-assets-notice warning');
  notice.append(el('strong', reactivating ? 'El activo volverá a estar disponible.' : 'Es una baja lógica: no se borrará ningún dato.'));
  notice.append(el('p', reactivating
    ? 'MANTENIMENT podrá volver a actualizar sus datos en las próximas sincronizaciones.'
    : 'Se conserva el histórico y se bloquea su reactivación automática desde MANTENIMENT. Si existe una operación abierta, la baja será rechazada.'));
  card.append(notice);

  const form = el('form', null, 'a70-assets-state-form');
  const label = el('label', null, 'a70-assets-field wide');
  label.append(el('span', reactivating ? 'Nota de reactivación' : 'Motivo de la baja *'));
  const reason = document.createElement('textarea');
  reason.name = 'motivo';
  reason.required = !reactivating;
  reason.minLength = reactivating ? 0 : 5;
  reason.maxLength = 500;
  reason.placeholder = reactivating ? 'Opcional' : 'Indica el motivo (mínimo 5 caracteres)';
  label.append(reason);
  const status = el('p', '', 'status-message wide');
  const actions = el('div', null, 'a70-assets-modal-actions wide');
  const cancel = el('button', 'Cancelar', 'button secondary');
  cancel.type = 'button';
  cancel.addEventListener('click', () => closeModal(overlay));
  const confirm = el('button', reactivating ? 'Confirmar reactivación' : 'Confirmar baja', `button ${reactivating ? 'primary' : 'danger'}`);
  confirm.type = 'submit';
  actions.append(cancel, confirm);
  form.append(label, status, actions);
  form.addEventListener('submit', async event => {
    event.preventDefault();
    confirm.disabled = true;
    status.textContent = reactivating ? 'Reactivando…' : 'Registrando la baja…';
    const { error } = await supabase.rpc('cambiar_estado_activo', {
      p_id: row.id,
      p_version: row.version,
      p_activo: reactivating,
      p_motivo: clean(reason.value),
      p_request_id: requestId(reactivating ? 'reactivar-activo' : 'baja-activo'),
    });
    if (error) {
      status.textContent = friendlyError(error, `No se pudo ${reactivating ? 'reactivar' : 'dar de baja'} el activo.`);
      confirm.disabled = false;
      return;
    }
    status.classList.add('success');
    status.textContent = reactivating ? 'Activo reactivado.' : 'Baja registrada sin borrar el histórico.';
    await onChanged();
    window.setTimeout(() => closeModal(overlay), 500);
  });
  card.append(form);
  overlay.append(card);
  overlay.addEventListener('click', event => { if (event.target === overlay) closeModal(overlay); });
  document.body.append(overlay);
  document.body.classList.add('a70-assets-modal-open');
  reason.focus();
}

async function loadAssets(root, profile, sequence) {
  const loading = root.querySelector('.a70-assets-loading');
  const results = root.querySelector('.a70-assets-results');
  const metrics = root.querySelector('.a70-assets-metrics-host');
  const count = root.querySelector('.a70-assets-count');
  loading.hidden = false;
  loading.textContent = 'Consultando activos…';

  const { data, error } = await supabase
    .from('vehiculos')
    .select('id,dfm,matricula,categoria,clase_vehiculo,tipo_motor,tipo_manteniment,marca,modelo,bastidor,upc,telefono,fecha_matriculacion,fecha_alta_manteniment,proxima_itv_fecha,fin_contrato_fecha,fin_contrato_km,km_actual,contrato_texto,asignacion_manteniment,reserva,activo,version,alta_manual_en,baja_manual_en,motivo_baja,baja_manual_bloquea_sync,fuente_manteniment_fila,actualizado_en')
    .order('categoria', { ascending: true })
    .order('dfm', { ascending: true });
  if (sequence !== loadSequence || content?.dataset?.[MODULE_FLAG] !== '1') return;
  if (error) throw error;
  currentRows = data || [];
  loading.hidden = true;
  metrics.replaceChildren();
  renderMetrics(metrics, currentRows);

  const controls = {
    search: root.querySelector('[name="asset_search"]'),
    status: root.querySelector('[name="asset_status"]'),
    category: root.querySelector('[name="asset_category"]'),
    origin: root.querySelector('[name="asset_origin"]'),
  };
  const redraw = () => {
    const rows = filterRows(currentRows, controls);
    count.textContent = `${rows.length} de ${currentRows.length} activo(s)`;
    renderTable(results, rows, currentAccess, () => loadAssets(root, profile, ++loadSequence));
  };
  controls.search.oninput = redraw;
  controls.status.onchange = redraw;
  controls.category.onchange = redraw;
  controls.origin.onchange = redraw;
  redraw();
}

async function renderAssets(button) {
  if (!content) return;
  const sequence = ++loadSequence;
  content.dataset[MODULE_FLAG] = '1';
  content.replaceChildren();
  markButtonActive(button);

  const root = el('section', null, 'a70-assets');
  const head = el('div', null, 'a70-assets-head');
  const copy = el('div');
  copy.append(
    el('p', 'Flota maestra', 'eyebrow'),
    el('h2', 'Activos'),
    el('p', 'Vehículos de Supabase y altas manuales. Estos datos alimentan Hotel, reservas y asistencia 24H.', 'muted')
  );
  const headActions = el('div', null, 'a70-assets-head-actions');
  const refresh = el('button', '↻ Actualizar', 'button secondary compact');
  refresh.type = 'button';
  refresh.addEventListener('click', () => renderAssets(button));
  headActions.append(refresh);
  head.append(copy, headActions);
  root.append(head);

  const loading = el('div', 'Comprobando permisos…', 'a70-assets-loading');
  root.append(loading);
  content.append(root);

  try {
    const profile = await currentProfile();
    if (sequence !== loadSequence || content.dataset[MODULE_FLAG] !== '1') return;
    currentAccess = moduleAccess(profile);
    if (!currentAccess.view) throw new Error('Tu usuario no tiene acceso al catálogo de Activos.');
    if (currentAccess.edit) {
      const create = el('button', '+ Dar de alta', 'button primary compact');
      create.type = 'button';
      create.addEventListener('click', () => openAssetModal(null, () => loadAssets(root, profile, ++loadSequence)));
      headActions.prepend(create);
    }

    const metricsHost = el('div', null, 'a70-assets-metrics-host');
    const toolbar = el('div', null, 'a70-assets-toolbar');
    const searchLabel = el('label');
    searchLabel.append(el('span', 'Buscar'), Object.assign(document.createElement('input'), { name: 'asset_search', placeholder: 'DFM, matrícula, bastidor, marca, UPC…' }));
    const statusLabel = el('label');
    const status = document.createElement('select');
    status.name = 'asset_status';
    appendOption(status, 'active', 'Activos', true);
    appendOption(status, 'inactive', 'Bajas');
    appendOption(status, 'all', 'Todos');
    statusLabel.append(el('span', 'Estado'), status);
    const categoryLabel = el('label');
    const category = document.createElement('select');
    category.name = 'asset_category';
    appendOption(category, 'all', 'DFM y R', true);
    appendOption(category, 'DFM', 'Solo DFM');
    appendOption(category, 'R', 'Solo R');
    categoryLabel.append(el('span', 'Categoría'), category);
    const originLabel = el('label');
    const origin = document.createElement('select');
    origin.name = 'asset_origin';
    appendOption(origin, 'all', 'Todos los orígenes', true);
    appendOption(origin, 'sheet', 'MANTENIMENT');
    appendOption(origin, 'manual', 'Altas manuales');
    originLabel.append(el('span', 'Origen'), origin);
    toolbar.append(searchLabel, statusLabel, categoryLabel, originLabel);
    const summary = el('div', null, 'a70-assets-list-head');
    summary.append(el('strong', 'Listado'), el('span', '', 'a70-assets-count'));
    const results = el('div', null, 'a70-assets-results');
    root.append(metricsHost, toolbar, summary, results);
    await loadAssets(root, profile, sequence);
  } catch (error) {
    loading.hidden = false;
    loading.className = 'a70-assets-error';
    loading.textContent = friendlyError(error, 'No se pudo cargar Activos.');
  }
}

async function ensureNavButton() {
  if (!nav || !appView || appView.classList.contains('hidden') || nav.querySelector('[data-alpha70-activos]')) return;
  try {
    const profile = await currentProfile();
    if (!moduleAccess(profile).view || nav.querySelector('[data-alpha70-activos]')) return;
    const button = el('button', '🚚 Activos');
    button.type = 'button';
    button.dataset.module = 'activos';
    button.dataset.alpha70Activos = '1';
    const reservations = nav.querySelector('[data-module="reservas"]');
    if (reservations) nav.insertBefore(button, reservations);
    else nav.append(button);
  } catch (error) {
    console.warn('No se pudo habilitar la pestaña Activos.', error);
  }
}

function ensureStyle() {
  if (document.querySelector('#alpha70-assets-style')) return;
  const style = document.createElement('style');
  style.id = 'alpha70-assets-style';
  style.textContent = `
    .a70-assets{display:grid;gap:16px}.a70-assets-head,.a70-assets-list-head{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;flex-wrap:wrap}.a70-assets-head h2{margin:.12rem 0}.a70-assets-head-actions{display:flex;gap:8px;flex-wrap:wrap}
    .a70-assets-metrics{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:10px}.a70-assets-metric{display:grid;gap:3px;padding:14px;border:1px solid #cbd5e1;border-radius:12px;background:#fff}.a70-assets-metric strong{font-size:1.55rem;color:#0c4a6e}.a70-assets-metric span{color:#475569;font-size:.86rem}
    .a70-assets-toolbar{display:grid;grid-template-columns:minmax(260px,2fr) repeat(3,minmax(150px,1fr));gap:10px;padding:13px;border:1px solid #cbd5e1;border-radius:12px;background:#f8fafc}.a70-assets-toolbar label,.a70-assets-field{display:grid;gap:5px;font-weight:700}.a70-assets-toolbar input,.a70-assets-toolbar select,.a70-assets-field input,.a70-assets-field select,.a70-assets-field textarea{width:100%;box-sizing:border-box;min-height:44px;padding:9px 10px;border:1px solid #aebdca;border-radius:9px;background:#fff;font:inherit}.a70-assets-field textarea{min-height:100px;resize:vertical}.a70-assets-field small{color:#64748b;font-weight:400}
    .a70-assets-table-wrap{overflow:auto;border:1px solid #cbd5e1;border-radius:12px;background:#fff}.a70-assets-table{width:100%;border-collapse:collapse;min-width:1050px}.a70-assets-table th,.a70-assets-table td{padding:11px 10px;border-bottom:1px solid #e2e8f0;text-align:left;vertical-align:top}.a70-assets-table th{position:sticky;top:0;background:#eaf2f8;color:#0f3d57;font-size:.86rem}.a70-assets-table tr:last-child td{border-bottom:0}.a70-assets-table tr.inactive{background:#fff7ed;color:#7c2d12}.a70-assets-subline{display:block;margin-top:3px;color:#64748b;font-size:.82rem}.a70-assets-actions{display:flex;gap:6px;flex-wrap:wrap}.a70-assets-badge{display:inline-flex;padding:4px 8px;border-radius:999px;font-weight:800;font-size:.78rem}.a70-assets-badge.active{background:#dcfce7;color:#166534}.a70-assets-badge.inactive{background:#ffedd5;color:#9a3412}
    .a70-assets-empty,.a70-assets-loading,.a70-assets-error{padding:18px;border:1px solid #cbd5e1;border-radius:12px;background:#f8fafc}.a70-assets-error{border-color:#fecaca;background:#fef2f2;color:#991b1b}.a70-assets-count{color:#64748b}
    .a70-assets-modal{position:fixed;inset:0;z-index:1700;display:grid;place-items:center;padding:18px;background:rgba(15,23,42,.58)}.a70-assets-modal-card{width:min(980px,100%);max-height:92vh;overflow:auto;padding:19px;border-radius:16px;background:#fff;box-shadow:0 24px 70px rgba(15,23,42,.3)}.a70-assets-state-card{width:min(620px,100%)}.a70-assets-modal-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.a70-assets-modal-head h2{margin:.12rem 0}.a70-assets-form{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin-top:15px}.a70-assets-state-form{display:grid;gap:12px;margin-top:14px}.a70-assets-form .wide,.a70-assets-state-form .wide{grid-column:1/-1}.a70-assets-modal-actions{display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap}.a70-assets-notice{margin-top:12px;padding:13px;border-radius:11px}.a70-assets-notice p{margin:.4rem 0 0}.a70-assets-notice.warning{background:#fff7ed;color:#9a3412;border:1px solid #fed7aa}.a70-assets-notice.success{background:#f0fdf4;color:#166534;border:1px solid #bbf7d0}.a70-assets-modal-open{overflow:hidden}.status-message.success{color:#166534}
    @media(max-width:900px){.a70-assets-metrics{grid-template-columns:repeat(3,minmax(0,1fr))}.a70-assets-toolbar{grid-template-columns:repeat(2,minmax(0,1fr))}.a70-assets-form{grid-template-columns:repeat(2,minmax(0,1fr))}}
    @media(max-width:650px){.a70-assets-metrics,.a70-assets-toolbar,.a70-assets-form{grid-template-columns:1fr}.a70-assets-form .wide{grid-column:auto}.a70-assets-head-actions,.a70-assets-head-actions .button,.a70-assets-modal-actions,.a70-assets-modal-actions .button{width:100%}.a70-assets-table{min-width:0}.a70-assets-table thead{display:none}.a70-assets-table,.a70-assets-table tbody,.a70-assets-table tr,.a70-assets-table td{display:block;width:100%;box-sizing:border-box}.a70-assets-table tr{padding:10px;border-bottom:1px solid #cbd5e1}.a70-assets-table td{display:grid;grid-template-columns:105px minmax(0,1fr);gap:7px;padding:6px;border:0}.a70-assets-table td::before{content:attr(data-label);font-weight:800;color:#475569}.a70-assets-actions{display:flex!important}.a70-assets-actions::before{min-width:98px}.a70-assets-actions .button{flex:1}}
  `;
  document.head.append(style);
}

nav?.addEventListener('click', event => {
  const button = event.target.closest?.('[data-alpha70-activos]');
  if (!button) {
    if (content?.dataset?.[MODULE_FLAG] === '1') {
      delete content.dataset[MODULE_FLAG];
      loadSequence += 1;
    }
    return;
  }
  event.preventDefault();
  event.stopImmediatePropagation();
  renderAssets(button);
}, true);

ensureStyle();
if (appView) new MutationObserver(ensureNavButton).observe(appView, { attributes: true, childList: true, subtree: true });
ensureNavButton();

supabase.auth.onAuthStateChange(event => {
  if (['SIGNED_OUT', 'SIGNED_IN', 'USER_UPDATED'].includes(event)) profilePromise = null;
});
