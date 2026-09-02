import { supabase } from '../../r1-alpha17/src/supabase.js';
import { createDetailPdf, downloadDetailPdf } from './panel-pdf.js';

const nav = document.querySelector('#module-nav');
const content = document.querySelector('#module-content');
const PANEL_FLAG = 'alpha70Panel';
const REFRESH_MS = 60000;

let renderSequence = 0;
let refreshTimer = null;
let lastLoadedAt = 0;

const numberFormat = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 0 });
const decimalFormat = new Intl.NumberFormat('es-ES', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const moneyFormat = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' });

function el(tag, text = null, className = '') {
  const node = document.createElement(tag);
  if (text !== null && text !== undefined) node.textContent = String(text);
  if (className) node.className = className;
  return node;
}

function localDateKey(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatDate(value) {
  if (!value) return '—';
  const raw = String(value).slice(0, 10);
  const [year, month, day] = raw.split('-');
  return year && month && day ? `${day}/${month}/${year}` : String(value);
}

function formatDateTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' });
}

function stateLabel(value) {
  return ({
    planificado: 'Pendiente de parar',
    pendiente_taller: 'Pendiente de taller',
    asistencia_24h: 'Asistencia 24H activa',
    pendiente_diagnostico: 'Pendiente de diagnóstico',
    pendiente_autorizacion: 'Pendiente de autorización',
    en_taller: 'En taller',
    pendiente_repuestos: 'Pendiente de repuestos',
    terminado_pendiente_recogida: 'Pendiente de recoger',
    recogido_pendiente_ruta: 'Pendiente de recuperar',
    reserva_liberada: 'Reserva libre',
    recuperado: 'Recuperado',
    anulada: 'Anulada',
    anulado: 'Anulado',
    abierta: 'Abierta',
    cerrada: 'Cerrada',
    pendiente: 'Pendiente',
    programada: 'Programada',
    en_curso: 'En curso',
    realizada: 'Realizada',
    libre: 'Libre',
    disponible_con_pendientes: 'Libre con pendientes',
    ocupada: 'Ocupada',
    fuera_servicio: 'Fuera de servicio',
    autorizado: 'Autorizado',
    aprobado: 'Autorizado',
    bloqueado: 'Bloqueado',
    revocado: 'Revocado',
  })[value] || value || '—';
}

function profileName(profile) {
  return [profile?.nombre, profile?.apellidos].filter(Boolean).join(' ').trim() || profile?.correo || 'Usuario';
}

function isPrimaryAdmin(profile) {
  return profile?.activo === true && profile?.tipo_usuario === 'administrador_principal';
}

function moduleAccess(profile, moduleId) {
  if (profile?.activo !== true) return { view: false, edit: false };
  if (isPrimaryAdmin(profile)) return { view: true, edit: true };
  const permission = profile?.permisos?.[moduleId] || {};
  const edit = permission.editar === true;
  const view = edit || permission.ver === true || permission.leer === true;
  return { view, edit };
}

async function currentProfile() {
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData?.user?.id) throw new Error('No se pudo comprobar la sesión actual.');
  const { data, error } = await supabase
    .from('usuarios')
    .select('id,nombre,apellidos,correo,tipo_usuario,permisos,activo')
    .eq('id', userData.user.id)
    .maybeSingle();
  if (error || !data) throw new Error(error?.message || 'No se encontró el perfil del usuario.');
  return data;
}

async function readQuery(label, query) {
  try {
    const { data, error } = await query;
    return { label, data: data || [], error };
  } catch (error) {
    return { label, data: [], error };
  }
}

function skipped(label) {
  return Promise.resolve({ label, data: [], error: null, skipped: true });
}

function sum(rows, key) {
  return rows.reduce((total, row) => total + Number(row?.[key] || 0), 0);
}

function daysBetween(start, end) {
  const a = new Date(`${start}T00:00:00`);
  const b = new Date(`${end}T00:00:00`);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null;
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

function vehicleTitle(row) {
  const code = row.dfm || row.unidad || row.vehiculo_codigo || '—';
  const plate = row.matricula || '';
  return `${String(code).startsWith('R') ? 'R' : 'DFM'} ${code}${plate ? ` · ${plate}` : ''}`;
}

function completedStageDate(stage) {
  return stage?.fecha_real || stage?.fecha_fin_real || null;
}

function latestCompletedStages(stages) {
  const latestByHotel = new Map();
  stages.forEach(stage => {
    if (stage.estado !== 'realizada' || stage.cancelado === true) return;
    const completedAt = completedStageDate(stage);
    if (!completedAt) return;
    const previous = latestByHotel.get(stage.registro_hotel_id);
    if (!previous || new Date(completedAt).getTime() > new Date(previous.completedAt).getTime()) {
      latestByHotel.set(stage.registro_hotel_id, { ...stage, completedAt });
    }
  });
  return latestByHotel;
}

function hotelItem(row, latestByHotel) {
  const substitute = row.sustituto ? `${row.tipo_sustituto || 'SUSTITUTO'} ${row.sustituto}${row.matricula_sustituto ? ` · ${row.matricula_sustituto}` : ''}` : 'Sin sustituto';
  const latestStage = latestByHotel.get(row.id);
  return {
    title: vehicleTitle(row),
    meta: `${row.numero_parada || 'Sin nº de parada'} · ${stateLabel(row.estado)} · Prioridad ${row.prioridad ?? '—'}`,
    lastStage: latestStage
      ? `Última T realizada: ${formatDateTime(latestStage.completedAt)} · ${latestStage.posicion || '—'}T ${latestStage.nombre || 'T sin nombre'}`
      : 'Última T realizada: ninguna registrada',
    note: [substitute, row.lugar, row.causa, row.incidencia ? `INC ${row.incidencia}` : ''].filter(Boolean).join(' · '),
  };
}

function printDetail(spec) {
  const previousTitle = document.title;
  document.title = `Metrogestión - ${spec.title} - ${localDateKey()}`;
  document.body.classList.add('a70-print-detail');
  try {
    window.print();
  } finally {
    document.body.classList.remove('a70-print-detail');
    document.title = previousTitle;
  }
}

async function shareDetail(spec, button) {
  const original = button.textContent;
  const pdf = createDetailPdf(spec);
  try {
    const payload = { title: `Metrogestión · ${spec.title}`, files: pdf.file ? [pdf.file] : [] };
    const canShareFile = pdf.file && navigator.share
      && (typeof navigator.canShare !== 'function' || navigator.canShare({ files: [pdf.file] }));
    if (canShareFile) {
      await navigator.share(payload);
      button.textContent = '✓ PDF compartido';
      return;
    }
    downloadDetailPdf(pdf);
    button.textContent = '✓ PDF descargado';
  } catch (error) {
    if (error?.name === 'AbortError') return;
    downloadDetailPdf(pdf);
    button.textContent = '✓ PDF descargado';
  } finally {
    window.setTimeout(() => { button.textContent = original; }, 1800);
  }
}

function saveDetailPdf(spec, button) {
  const original = button.textContent;
  downloadDetailPdf(createDetailPdf(spec));
  button.textContent = '✓ PDF guardado';
  window.setTimeout(() => { button.textContent = original; }, 1800);
}

function reserveItem(row, coverageMap) {
  const coverage = coverageMap.get(String(row.vehiculo_codigo || '').toUpperCase());
  return {
    title: `${row.vehiculo_codigo || '—'}${row.matricula ? ` · ${row.matricula}` : ''}`,
    meta: `${stateLabel(row.estado)}${row.etiqueta ? ` · ${row.etiqueta}` : ''}`,
    note: coverage
      ? `Sustituye a ${coverage.dfm || '—'}${coverage.matricula ? ` · ${coverage.matricula}` : ''} · ${coverage.numero_parada || ''}`
      : [row.ubicacion, row.pendientes].filter(Boolean).join(' · ') || 'Sin ocupación ni trabajos pendientes',
  };
}

function incidenceItem(row) {
  return {
    title: `DFM ${row.dfm || '—'}${row.matricula ? ` · ${row.matricula}` : ''}`,
    meta: `${stateLabel(row.estado)}${row.numero_caso ? ` · Caso ${row.numero_caso}` : ''} · ${formatDateTime(row.creado_en)}`,
    note: [row.averia, row.resultado, row.proveedor].filter(Boolean).join(' · ') || 'Sin detalle adicional',
  };
}

function contractItem(row, reason) {
  return {
    title: vehicleTitle(row),
    meta: reason,
    note: [row.marca, row.modelo, row.fin_contrato_fecha ? `Fin ${formatDate(row.fin_contrato_fecha)}` : '', row.fin_contrato_km ? `Contrato ${numberFormat.format(row.fin_contrato_km)} km` : '', row.km_actual != null ? `Actual ${numberFormat.format(row.km_actual)} km` : ''].filter(Boolean).join(' · '),
  };
}

function stageItem(row, hotelById) {
  const hotel = hotelById.get(row.registro_hotel_id);
  return {
    title: `${row.posicion || '—'}T · ${row.nombre || 'T sin nombre'} · ${hotel ? vehicleTitle(hotel) : 'Ficha no localizada'}`,
    meta: `${stateLabel(row.estado)} · ${row.fecha_prevista ? formatDateTime(row.fecha_prevista) : 'Sin fecha'}`,
    note: [row.lugar, hotel?.numero_parada, hotel?.causa].filter(Boolean).join(' · '),
  };
}

function billingDfmItem(row) {
  return {
    title: `${row.numero_parada || '—'} · DFM ${row.dfm || '—'}${row.matricula ? ` · ${row.matricula}` : ''}`,
    meta: `${formatDate(row.tramo_inicio)}–${formatDate(row.tramo_fin)} · ${numberFormat.format(row.dias_facturables || 0)} días`,
    note: `${numberFormat.format(row.km_facturables || 0)} km · Media ${row.km_dia == null ? 'sin dato' : `${numberFormat.format(row.km_dia)} km/día`} · Sustituto ${row.sustituto || '—'}`,
  };
}

function billingRItem(row) {
  return {
    title: `${row.numero_parada || '—'} · ${row.r_sustituido || 'R —'}`,
    meta: `${formatDate(row.fecha_inicio_parada)}–${formatDate(row.fecha_fin_parada)} · ${row.unidades || 0} unidad`,
    note: `Sustituto ${row.r_sustituto || '—'}${row.importe == null ? '' : ` · ${moneyFormat.format(Number(row.importe))}`}`,
  };
}

function userItem(row) {
  const usersAccess = isPrimaryAdmin(row) || moduleAccess(row, 'usuarios').view;
  return {
    title: profileName(row),
    meta: `${row.tipo_usuario || 'usuario'} · ${row.activo ? 'Activo' : 'Bloqueado'}`,
    note: `${row.correo || 'Sin correo'} · Usuarios: ${usersAccess ? 'autorizado' : 'sin acceso'}`,
  };
}

function deviceItem(row, userMap) {
  const owner = userMap.get(row.usuario_id);
  return {
    title: row.nombre || 'Dispositivo',
    meta: `${stateLabel(row.estado)} · ${owner ? profileName(owner) : row.usuario_id || 'Usuario no localizado'}`,
    note: `Solicitado ${formatDateTime(row.solicitado_en)}${row.ultimo_acceso_en ? ` · Último acceso ${formatDateTime(row.ultimo_acceso_en)}` : ''}`,
  };
}

function metricButton({ label, value, hint = '', tone = 'neutral', detail }, openDetail) {
  const button = el('button', null, `a52-metric tone-${tone}`);
  button.type = 'button';
  const valueNode = el('strong', value);
  const labelNode = el('span', label);
  button.append(valueNode, labelNode);
  if (hint) button.append(el('small', hint));
  if (detail) button.addEventListener('click', () => openDetail(detail));
  else button.disabled = true;
  return button;
}

function section(title, subtitle, metrics, openDetail, extra = null) {
  const host = el('section', null, 'a52-section');
  const head = el('div', null, 'a52-section-head');
  const copy = el('div');
  copy.append(el('h3', title));
  if (subtitle) copy.append(el('p', subtitle, 'muted'));
  head.append(copy);
  if (extra) head.append(extra);
  const grid = el('div', null, 'a52-metrics');
  metrics.forEach(spec => grid.append(metricButton(spec, openDetail)));
  host.append(head, grid);
  return host;
}

function stopAutoRefresh() {
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = null;
}

function panelOwnsContent() {
  return content?.dataset?.[PANEL_FLAG] === '1'
    && content.childElementCount === 1
    && content.firstElementChild?.matches?.('.a52-panel');
}

function panelRenderIsCurrent(sequence, root) {
  return sequence === renderSequence
    && panelOwnsContent()
    && content.firstElementChild === root;
}

function startAutoRefresh() {
  stopAutoRefresh();
  refreshTimer = setInterval(() => {
    if (!panelOwnsContent()) {
      delete content?.dataset?.[PANEL_FLAG];
      stopAutoRefresh();
      return;
    }
    if (!document.hidden && !document.querySelector('.hotel-editor-overlay')) {
      renderPanel({ automatic: true });
    }
  }, REFRESH_MS);
}

function markPanelButtonActive(button) {
  nav?.querySelectorAll('button').forEach(node => node.classList.toggle('active', node === button));
}

function openModule(moduleId) {
  const selectors = {
    hotel: '[data-module="hotel"]',
    reservas: '[data-module="reservas"]',
    t_programadas: '[data-module="t_programadas"]',
    listados: '[data-alpha29-listados]',
    activar24h: '[data-alpha34-24h]',
    usuarios: '[data-alpha51-users]',
  };
  const target = nav?.querySelector(selectors[moduleId] || '');
  if (target) target.click();
}

function findCurrentPeriod(rows, today) {
  const ordered = [...rows].sort((a, b) => String(b.periodo).localeCompare(String(a.periodo)));
  return ordered.find(row => String(row.fecha_inicio) <= today && String(row.fecha_cierre) >= today)
    || ordered.find(row => String(row.fecha_inicio) <= today)
    || ordered[0]
    || null;
}

function overlapPeriod(row, period) {
  if (!period) return false;
  const start = String(row.fecha_inicio_parada || '');
  const end = String(row.fecha_fin_parada || '9999-12-31');
  return start <= String(period.fecha_cierre) && end >= String(period.fecha_inicio);
}

function buildAlerts({ priorityStops, overdueStages, openIncidents, contractProblems, missingMedia }) {
  const alerts = [];
  priorityStops.forEach(row => alerts.push({
    severity: 'critical', icon: '⚠', title: `${vehicleTitle(row)} · Prioridad ${row.prioridad}`,
    meta: `${stateLabel(row.estado)} · ${row.lugar || 'Sin lugar'} · ${row.causa || 'Sin causa'}`,
  }));
  overdueStages.forEach(row => alerts.push({
    severity: 'warning', icon: '⏱', title: `${row.posicion || '—'}T vencida · ${row.nombre || 'Sin nombre'}`,
    meta: `${formatDateTime(row.fecha_prevista)} · ${row.lugar || 'Sin lugar'}`,
  }));
  openIncidents.forEach(row => alerts.push({
    severity: 'critical', icon: '🚨', title: `24H abierta · DFM ${row.dfm || '—'}`,
    meta: `${row.numero_caso ? `Caso ${row.numero_caso} · ` : ''}${row.averia || 'Sin descripción'}`,
  }));
  contractProblems.forEach(item => alerts.push({
    severity: 'warning', icon: '📄', title: `${vehicleTitle(item.row)} · contrato`, meta: item.reason,
  }));
  if (missingMedia.length) alerts.push({
    severity: 'info', icon: '🧮', title: `${missingMedia.length} parada(s) sin media de km`,
    meta: 'No puede cerrarse correctamente el cálculo de kilómetros de sustitución.',
  });
  return alerts.slice(0, 10);
}

async function renderPanel({ automatic = false } = {}) {
  if (!content) return;
  // Un refresco programado nunca puede recuperar el Panel si el usuario ya
  // está trabajando en otro módulo. El indicador por sí solo puede quedar
  // obsoleto cuando otro controlador intercepta el clic de navegación.
  if (automatic && !panelOwnsContent()) {
    delete content.dataset[PANEL_FLAG];
    stopAutoRefresh();
    return;
  }
  const sequence = ++renderSequence;
  stopAutoRefresh();
  content.dataset[PANEL_FLAG] = '1';
  content.replaceChildren();

  const root = el('section', null, 'a52-panel');
  const head = el('div', null, 'a52-panel-head');
  const copy = el('div');
  copy.append(el('p', 'Situación general', 'eyebrow'), el('h2', 'Panel'), el('p', 'Todo lo importante a simple vista; un clic abre el detalle.', 'muted'));
  const actions = el('div', null, 'a52-panel-actions');
  const updated = el('span', automatic ? 'Actualizando…' : 'Cargando datos…', 'a52-updated');
  const refresh = el('button', '↻ Actualizar', 'button secondary compact');
  refresh.type = 'button';
  refresh.addEventListener('click', () => renderPanel());
  actions.append(updated, refresh);
  head.append(copy, actions);
  const loading = el('div', 'Consultando Hotel, reservas, 24H, T, facturación, contratos y usuarios…', 'a52-loading');
  root.append(head, loading);
  content.append(root);

  try {
    const profile = await currentProfile();
    if (!panelRenderIsCurrent(sequence, root)) return;
    if (!moduleAccess(profile, 'resumen').view) throw new Error('Tu usuario no tiene acceso al Panel.');

    const admin = isPrimaryAdmin(profile);
    const canHotel = moduleAccess(profile, 'hotel').view;
    const canReservations = moduleAccess(profile, 'reservas').view || canHotel;
    const can24h = moduleAccess(profile, 'activar24h').view;
    const canUsers = moduleAccess(profile, 'usuarios').view;
    const canBilling = moduleAccess(profile, 'historico').view || moduleAccess(profile, 'resumen').view;
    const canFleet = can24h || moduleAccess(profile, 'resumen').view;

    const [hotelResult, reservesResult, incidentsResult, vehiclesResult, periodsResult, dfmBillingResult, rBillingResult, substitutionsResult, usersResult, devicesResult] = await Promise.all([
      canHotel ? readQuery('Hotel', supabase.from('hotel_actual_detalle').select('id,numero_parada,dfm,matricula,sustituto,matricula_sustituto,tipo_sustituto,estado,lugar,causa,incidencia,prioridad,proximo,t_pendientes,actualizado_en').order('orden', { ascending: true })) : skipped('Hotel'),
      canReservations ? readQuery('Reservas', supabase.from('reservas_hotel').select('id,vehiculo_codigo,matricula,etiqueta,estado,ubicacion,pendientes,activo,actualizado_en').eq('activo', true).order('vehiculo_codigo')) : skipped('Reservas'),
      can24h ? readQuery('24H', supabase.from('activaciones_24h').select('id,dfm,matricula,numero_caso,estado,resultado,averia,proveedor,creado_en,actualizado_en,creado_por').order('creado_en', { ascending: false })) : skipped('24H'),
      canFleet ? readQuery('Contratos', supabase.from('vehiculos').select('dfm,matricula,categoria,clase_vehiculo,marca,modelo,km_actual,fin_contrato_km,fin_contrato_fecha,activo').eq('activo', true).order('dfm')) : skipped('Contratos'),
      canBilling ? readQuery('Periodos', supabase.from('cierres_facturacion').select('periodo,fecha_inicio,fecha_cierre').order('periodo', { ascending: false })) : skipped('Periodos'),
      canBilling ? readQuery('Facturación DFM', supabase.from('facturacion_dfm_periodos').select('seguimiento_id,numero_parada,dfm,matricula,sustituto,periodo,tramo_inicio,tramo_fin,dias_facturables,km_dia,km_facturables,estado').order('periodo', { ascending: false })) : skipped('Facturación DFM'),
      canBilling ? readQuery('Facturación R', supabase.from('facturacion_r_sustituciones').select('seguimiento_id,numero_parada,r_sustituido,matricula,r_sustituto,fecha_inicio_parada,fecha_fin_parada,dias_parada_total,unidades,precio_r_unidad,importe').order('fecha_inicio_parada', { ascending: false })) : skipped('Facturación R'),
      canBilling ? readQuery('Sustituciones', supabase.from('paradas_sustitucion_resumen').select('seguimiento_id,numero_parada,unidad,matricula,sustituto,estado,fecha_fin_parada,clase_facturacion,km_dia,km_sustitucion_total')) : skipped('Sustituciones'),
      canUsers ? readQuery('Usuarios', supabase.from('usuarios').select('id,nombre,apellidos,correo,tipo_usuario,permisos,activo,creado_en,actualizado_en').order('creado_en')) : skipped('Usuarios'),
      admin ? readQuery('Dispositivos', supabase.from('dispositivos_usuario').select('id,usuario_id,nombre,estado,solicitado_en,ultimo_acceso_en,observaciones').order('solicitado_en', { ascending: false })) : skipped('Dispositivos'),
    ]);

    const hotelRows = hotelResult.data || [];
    const hotelIds = hotelRows.map(row => row.id).filter(Boolean);
    const stagesResult = canHotel && hotelIds.length
      ? await readQuery('T programadas', supabase.from('etapas_hotel').select('id,registro_hotel_id,nombre,posicion,estado,tipo_etapa,lugar,fecha_prevista,fecha_inicio_real,fecha_fin_real,fecha_real,cancelado').in('registro_hotel_id', hotelIds).eq('cancelado', false).order('fecha_prevista', { ascending: true, nullsFirst: false }))
      : { label: 'T programadas', data: [], error: null, skipped: !canHotel };

    if (!panelRenderIsCurrent(sequence, root)) return;

    const results = [hotelResult, reservesResult, incidentsResult, vehiclesResult, periodsResult, dfmBillingResult, rBillingResult, substitutionsResult, usersResult, devicesResult, stagesResult];
    const errors = results.filter(result => result.error).map(result => `${result.label}: ${result.error.message || result.error}`);

    const today = localDateKey();
    const now = new Date();
    const month = today.slice(0, 7);
    const period = findCurrentPeriod(periodsResult.data || [], today);

    const planned = hotelRows.filter(row => row.estado === 'planificado');
    const pendingWorkshop = hotelRows.filter(row => row.estado === 'pendiente_taller');
    const inWorkshop = hotelRows.filter(row => ['en_taller', 'pendiente_diagnostico', 'pendiente_autorizacion', 'pendiente_repuestos'].includes(row.estado));
    const pendingPickup = hotelRows.filter(row => row.estado === 'terminado_pendiente_recogida');
    const pendingRecover = hotelRows.filter(row => row.estado === 'recogido_pendiente_ruta');
    const priorityStops = hotelRows.filter(row => Number(row.prioridad) <= 1);

    const coverageMap = new Map();
    hotelRows.forEach(row => {
      if (row.sustituto) coverageMap.set(String(row.sustituto).toUpperCase(), row);
    });
    const reserveRows = (reservesResult.data || []).filter(row => !String(row.vehiculo_codigo || '').startsWith('TEST-'));
    const freeReserves = reserveRows.filter(row => row.estado === 'libre');
    const pendingReserves = reserveRows.filter(row => row.estado === 'disponible_con_pendientes');
    const occupiedReserves = reserveRows.filter(row => row.estado === 'ocupada');
    const outReserves = reserveRows.filter(row => row.estado === 'fuera_servicio');

    const incidents = incidentsResult.data || [];
    const openIncidents = incidents.filter(row => !['cerrada', 'anulada'].includes(row.estado));
    const closedToday = incidents.filter(row => row.estado === 'cerrada' && localDateKey(row.actualizado_en) === today);
    const cancelledIncidents = incidents.filter(row => row.estado === 'anulada');
    const incidentsMonth = incidents.filter(row => String(row.creado_en || '').slice(0, 7) === month);

    const hotelById = new Map(hotelRows.map(row => [row.id, row]));
    const stages = (stagesResult.data || []).filter(row => row.estado !== 'anulada');
    const latestCompletedByHotel = latestCompletedStages(stages);
    const toHotelItem = row => hotelItem(row, latestCompletedByHotel);
    const pendingStageStates = new Set(['pendiente', 'programada']);
    const overdueStages = stages.filter(row => row.fecha_prevista && pendingStageStates.has(row.estado) && new Date(row.fecha_prevista) < now && localDateKey(row.fecha_prevista) < today);
    const stagesToday = stages.filter(row => row.fecha_prevista && pendingStageStates.has(row.estado) && localDateKey(row.fecha_prevista) === today);
    const stagesNext7 = stages.filter(row => {
      if (!row.fecha_prevista || !pendingStageStates.has(row.estado)) return false;
      const key = localDateKey(row.fecha_prevista);
      const difference = daysBetween(today, key);
      return difference !== null && difference > 0 && difference <= 7;
    });
    const stagesInProgress = stages.filter(row => row.estado === 'en_curso');
    const stagesWithoutDate = stages.filter(row => !row.fecha_prevista && pendingStageStates.has(row.estado));

    const vehicles = vehiclesResult.data || [];
    const expiredByDate = vehicles.filter(row => row.fin_contrato_fecha && String(row.fin_contrato_fecha) < today);
    const exceededKm = vehicles.filter(row => row.fin_contrato_km != null && row.km_actual != null && Number(row.km_actual) > Number(row.fin_contrato_km));
    const expiring30 = vehicles.filter(row => {
      if (!row.fin_contrato_fecha) return false;
      const difference = daysBetween(today, String(row.fin_contrato_fecha));
      return difference !== null && difference >= 0 && difference <= 30;
    });
    const contractProblemMap = new Map();
    expiredByDate.forEach(row => contractProblemMap.set(row.dfm, { row, reason: `Contrato vencido por fecha · ${formatDate(row.fin_contrato_fecha)}` }));
    exceededKm.forEach(row => {
      const previous = contractProblemMap.get(row.dfm);
      const reason = `Kilómetros superados · ${numberFormat.format(row.km_actual)} / ${numberFormat.format(row.fin_contrato_km)} km`;
      contractProblemMap.set(row.dfm, { row, reason: previous ? `${previous.reason} · ${reason}` : reason });
    });
    const contractProblems = [...contractProblemMap.values()];

    const dfmRows = period ? (dfmBillingResult.data || []).filter(row => row.periodo === period.periodo) : [];
    const rRows = period ? (rBillingResult.data || []).filter(row => overlapPeriod(row, period)) : [];
    const missingMedia = (substitutionsResult.data || []).filter(row => row.clase_facturacion === 'DFM' && row.sustituto && row.fecha_fin_parada == null && row.km_dia == null);

    const users = usersResult.data || [];
    const userMap = new Map(users.map(row => [row.id, row]));
    const activeUsers = users.filter(row => row.activo === true);
    const blockedUsers = users.filter(row => row.activo !== true);
    const usersAuthorized = users.filter(row => isPrimaryAdmin(row) || moduleAccess(row, 'usuarios').view);
    const devices = devicesResult.data || [];
    const pendingDevices = devices.filter(row => row.estado === 'pendiente');

    const alerts = buildAlerts({ priorityStops, overdueStages, openIncidents, contractProblems, missingMedia });

    loading.remove();
    updated.textContent = `Actualizado ${new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })} · automático cada minuto`;
    lastLoadedAt = Date.now();

    const detailHost = el('section', null, 'a52-detail');
    detailHost.hidden = true;
    root.append(detailHost);

    const openDetail = spec => {
      detailHost.replaceChildren();
      const detailHead = el('div', null, 'a52-detail-head');
      const detailCopy = el('div');
      detailCopy.append(el('h3', spec.title), el('div', spec.subtitle || `${spec.items?.length || 0} resultado(s)`, 'muted'));
      const detailActions = el('div', null, 'a52-detail-actions');
      if (spec.exportable !== false) {
        const printButton = el('button', '🖨 Imprimir', 'button secondary compact');
        printButton.type = 'button';
        printButton.addEventListener('click', () => printDetail(spec));
        const pdfButton = el('button', '⬇ Guardar PDF', 'button secondary compact');
        pdfButton.type = 'button';
        pdfButton.title = 'Descarga directamente el listado en formato PDF';
        pdfButton.addEventListener('click', () => saveDetailPdf(spec, pdfButton));
        const shareButton = el('button', '↗ Compartir PDF', 'button secondary compact');
        shareButton.type = 'button';
        shareButton.addEventListener('click', () => shareDetail(spec, shareButton));
        detailActions.append(printButton, pdfButton, shareButton);
      }
      if (spec.module) {
        const moduleButton = el('button', spec.moduleLabel || 'Abrir módulo', 'button primary compact');
        moduleButton.type = 'button';
        moduleButton.addEventListener('click', () => openModule(spec.module));
        detailActions.append(moduleButton);
      }
      const closeButton = el('button', 'Cerrar detalle', 'button secondary compact');
      closeButton.type = 'button';
      closeButton.addEventListener('click', () => { detailHost.hidden = true; });
      detailActions.append(closeButton);
      detailHead.append(detailCopy, detailActions);
      const list = el('div', null, 'a52-detail-list');
      const items = spec.items || [];
      if (!items.length) list.append(el('div', spec.empty || 'No hay elementos en este bloque.', 'a52-empty'));
      items.forEach(item => {
        const card = el('article', null, 'a52-detail-item');
        card.append(el('strong', item.title || '—'));
        if (item.meta) card.append(el('span', item.meta));
        if (item.lastStage) card.append(el('span', item.lastStage, 'a70-last-stage'));
        if (item.note) card.append(el('p', item.note));
        list.append(card);
      });
      detailHost.append(detailHead, list);
      detailHost.hidden = false;
      detailHost.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    };

    const hotelMetrics = [
      { label: 'Fichas activas', value: hotelRows.length, hint: 'Toda la pizarra', tone: 'main', detail: { title: 'Fichas activas', items: hotelRows.map(toHotelItem), module: 'hotel', moduleLabel: 'Abrir Hotel', exportable: true } },
      { label: 'Pendientes de parar', value: planned.length, tone: 'yellow', detail: { title: 'Pendientes de parar', items: planned.map(toHotelItem), module: 'hotel', moduleLabel: 'Abrir Hotel' } },
      { label: 'Pendientes de taller', value: pendingWorkshop.length, tone: 'neutral', detail: { title: 'Pendientes de taller', items: pendingWorkshop.map(toHotelItem), module: 'hotel', moduleLabel: 'Abrir Hotel' } },
      { label: 'En taller', value: inWorkshop.length, tone: 'lilac', detail: { title: 'En taller', items: inWorkshop.map(toHotelItem), module: 'hotel', moduleLabel: 'Abrir Hotel' } },
      { label: 'Pendientes de recoger', value: pendingPickup.length, tone: 'blue', detail: { title: 'Pendientes de recoger', items: pendingPickup.map(toHotelItem), module: 'hotel', moduleLabel: 'Abrir Hotel' } },
      { label: 'Pendientes de recuperar', value: pendingRecover.length, tone: 'orange', detail: { title: 'Pendientes de recuperar', items: pendingRecover.map(toHotelItem), module: 'hotel', moduleLabel: 'Abrir Hotel' } },
    ];
    root.append(canHotel
      ? section('Operativa ahora', 'Estado real de las fichas activas del Hotel.', hotelMetrics, openDetail)
      : el('div', 'Hotel no está autorizado para este usuario.', 'a52-permission-note'));

    const attentionSection = el('section', null, 'a52-section');
    const attentionHead = el('div', null, 'a52-section-head');
    const attentionCopy = el('div');
    attentionCopy.append(el('h3', 'Atención inmediata'), el('p', 'Prioridades, T vencidas, 24H abiertas, contratos y datos incompletos.', 'muted'));
    attentionHead.append(attentionCopy, el('span', `${alerts.length} aviso(s)`, 'badge'));
    const alertList = el('div', null, 'a52-alerts');
    if (!alerts.length) alertList.append(el('div', 'No hay alertas críticas con los datos disponibles.', 'a52-empty'));
    alerts.forEach(alert => {
      const row = el('article', null, `a52-alert ${alert.severity}`);
      row.append(el('span', alert.icon, 'a52-alert-icon'));
      const alertText = el('div');
      alertText.append(el('strong', alert.title), el('small', alert.meta));
      row.append(alertText);
      alertList.append(row);
    });
    attentionSection.append(attentionHead, alertList);

    const reserveMetrics = [
      { label: 'Reservas activas', value: reserveRows.length, tone: 'main', detail: { title: 'Reservas activas', items: reserveRows.map(row => reserveItem(row, coverageMap)), module: 'reservas', moduleLabel: 'Abrir Reservas' } },
      { label: 'Libres', value: freeReserves.length, tone: 'green', detail: { title: 'Reservas libres', items: freeReserves.map(row => reserveItem(row, coverageMap)), module: 'reservas', moduleLabel: 'Abrir Reservas' } },
      { label: 'Con pendientes', value: pendingReserves.length, tone: 'amber', detail: { title: 'Reservas libres con pendientes', items: pendingReserves.map(row => reserveItem(row, coverageMap)), module: 'reservas', moduleLabel: 'Abrir Reservas' } },
      { label: 'Ocupadas', value: occupiedReserves.length, tone: 'lilac', detail: { title: 'Reservas ocupadas', items: occupiedReserves.map(row => reserveItem(row, coverageMap)), module: 'reservas', moduleLabel: 'Abrir Reservas' } },
      { label: 'Fuera de servicio', value: outReserves.length, tone: 'red', detail: { title: 'Reservas fuera de servicio', items: outReserves.map(row => reserveItem(row, coverageMap)), module: 'reservas', moduleLabel: 'Abrir Reservas' } },
    ];
    const reservationsSection = canReservations
      ? section('Reservas', 'Disponibilidad calculada desde el Hotel activo.', reserveMetrics, openDetail)
      : el('section', 'Reservas no está autorizado para este usuario.', 'a52-permission-note');
    const firstColumns = el('div', null, 'a52-columns');
    firstColumns.append(attentionSection, reservationsSection);
    root.append(firstColumns);

    const incidentMetrics = [
      { label: '24H abiertas', value: openIncidents.length, tone: openIncidents.length ? 'red' : 'green', detail: { title: 'Incidencias 24H abiertas', items: openIncidents.map(incidenceItem), module: 'activar24h', moduleLabel: 'Abrir Activar 24H' } },
      { label: 'Cerradas hoy', value: closedToday.length, tone: 'green', detail: { title: '24H cerradas hoy', items: closedToday.map(incidenceItem), module: 'activar24h', moduleLabel: 'Abrir Activar 24H' } },
      { label: 'Anuladas', value: cancelledIncidents.length, tone: 'neutral', detail: { title: '24H anuladas', items: cancelledIncidents.map(incidenceItem), module: 'activar24h', moduleLabel: 'Abrir Activar 24H' } },
      { label: 'Este mes', value: incidentsMonth.length, tone: 'main', detail: { title: `Incidencias 24H · ${month}`, items: incidentsMonth.map(incidenceItem), module: 'activar24h', moduleLabel: 'Abrir Activar 24H' } },
    ];
    const incidentSection = can24h
      ? section('Activar 24H', 'Incidencias y seguimiento de asistencia.', incidentMetrics, openDetail)
      : el('section', 'Activar 24H no está autorizado para este usuario.', 'a52-permission-note');

    const stageMetrics = [
      { label: 'T vencidas', value: overdueStages.length, tone: overdueStages.length ? 'red' : 'green', detail: { title: 'T vencidas', items: overdueStages.map(row => stageItem(row, hotelById)), module: 'hotel', moduleLabel: 'Abrir Hotel' } },
      { label: 'T de hoy', value: stagesToday.length, tone: 'amber', detail: { title: 'T previstas para hoy', items: stagesToday.map(row => stageItem(row, hotelById)), module: 'hotel', moduleLabel: 'Abrir Hotel' } },
      { label: 'Próximos 7 días', value: stagesNext7.length, tone: 'blue', detail: { title: 'T de los próximos 7 días', items: stagesNext7.map(row => stageItem(row, hotelById)), module: 'hotel', moduleLabel: 'Abrir Hotel' } },
      { label: 'En curso', value: stagesInProgress.length, tone: 'lilac', detail: { title: 'T en curso', items: stagesInProgress.map(row => stageItem(row, hotelById)), module: 'hotel', moduleLabel: 'Abrir Hotel' } },
      { label: 'Sin fecha', value: stagesWithoutDate.length, tone: 'neutral', detail: { title: 'T pendientes sin fecha', items: stagesWithoutDate.map(row => stageItem(row, hotelById)), module: 'hotel', moduleLabel: 'Abrir Hotel' } },
    ];
    const stagesSection = canHotel
      ? section('T programadas', 'Próximos movimientos y trabajos de las fichas activas.', stageMetrics, openDetail)
      : el('section', 'T programadas no está autorizado para este usuario.', 'a52-permission-note');
    const secondColumns = el('div', null, 'a52-columns');
    secondColumns.append(incidentSection, stagesSection);
    root.append(secondColumns);

    const periodLabel = period?.periodo || 'Sin periodo';
    const dfmKm = sum(dfmRows, 'km_facturables');
    const dfmDays = sum(dfmRows, 'dias_facturables');
    const rUnits = sum(rRows, 'unidades');
    const rAmount = sum(rRows, 'importe');
    const billingMetrics = [
      { label: 'Periodo actual', value: periodLabel, hint: period ? `${formatDate(period.fecha_inicio)}–${formatDate(period.fecha_cierre)}` : 'Sin calendario', tone: 'main', detail: { title: `Periodo ${periodLabel}`, subtitle: period ? `${formatDate(period.fecha_inicio)}–${formatDate(period.fecha_cierre)}` : 'No existe un periodo configurado', items: [], module: 'listados', moduleLabel: 'Abrir Listados' } },
      { label: 'Paradas DFM', value: dfmRows.length, tone: 'neutral', detail: { title: `Paradas DFM · ${periodLabel}`, items: dfmRows.map(billingDfmItem), module: 'listados', moduleLabel: 'Abrir Listados' } },
      { label: 'Días DFM', value: numberFormat.format(dfmDays), tone: 'blue', detail: { title: `Días facturables DFM · ${periodLabel}`, items: dfmRows.map(billingDfmItem), module: 'listados', moduleLabel: 'Abrir Listados' } },
      { label: 'KM DFM', value: numberFormat.format(dfmKm), hint: 'km facturables', tone: 'green', detail: { title: `Kilómetros facturables DFM · ${periodLabel}`, items: dfmRows.map(billingDfmItem), module: 'listados', moduleLabel: 'Abrir Listados' } },
      { label: 'Sustituciones R', value: rUnits, hint: rRows.length ? `${rRows.length} parada(s)` : '', tone: 'lilac', detail: { title: `Sustituciones R · ${periodLabel}`, items: rRows.map(billingRItem), module: 'listados', moduleLabel: 'Abrir Listados' } },
      { label: 'Importe R', value: rRows.some(row => row.importe != null) ? moneyFormat.format(rAmount) : '—', tone: 'orange', detail: { title: `Importe R · ${periodLabel}`, items: rRows.map(billingRItem), module: 'listados', moduleLabel: 'Abrir Listados' } },
      { label: 'Sin media km', value: missingMedia.length, tone: missingMedia.length ? 'red' : 'green', detail: { title: 'Paradas DFM sin media de km', items: missingMedia.map(row => ({ title: `${row.numero_parada || '—'} · ${row.unidad || '—'}`, meta: `${stateLabel(row.estado)} · Sustituto ${row.sustituto || '—'}`, note: 'Falta la media CTM o una media manual.' })), module: 'listados', moduleLabel: 'Abrir Listados' } },
    ];
    const billingSection = canBilling
      ? section('Facturación de sustituciones', 'Periodo vigente y cálculo acumulado.', billingMetrics, openDetail)
      : el('section', 'Facturación no está autorizada para este usuario.', 'a52-permission-note');

    const contractMetrics = [
      { label: 'Flota activa', value: vehicles.length, tone: 'main', detail: { title: 'Vehículos activos', items: vehicles.map(row => contractItem(row, 'Contrato vigente o pendiente de comprobar')), module: 'activar24h', moduleLabel: 'Abrir Activar 24H' } },
      { label: 'Vencidos por fecha', value: expiredByDate.length, tone: expiredByDate.length ? 'red' : 'green', detail: { title: 'Contratos vencidos por fecha', items: expiredByDate.map(row => contractItem(row, `Vencido el ${formatDate(row.fin_contrato_fecha)}`)), module: 'activar24h', moduleLabel: 'Abrir Activar 24H' } },
      { label: 'Superados por km', value: exceededKm.length, tone: exceededKm.length ? 'red' : 'green', detail: { title: 'Contratos superados por kilómetros', items: exceededKm.map(row => contractItem(row, `${numberFormat.format(row.km_actual)} / ${numberFormat.format(row.fin_contrato_km)} km`)), module: 'activar24h', moduleLabel: 'Abrir Activar 24H' } },
      { label: 'Vencen en 30 días', value: expiring30.length, tone: expiring30.length ? 'amber' : 'green', detail: { title: 'Contratos que vencen en 30 días', items: expiring30.map(row => contractItem(row, `Vence el ${formatDate(row.fin_contrato_fecha)}`)), module: 'activar24h', moduleLabel: 'Abrir Activar 24H' } },
    ];
    const contractsSection = canFleet
      ? section('Contratos', 'Control por fecha y kilómetros de la flota activa.', contractMetrics, openDetail)
      : el('section', 'Contratos no está autorizado para este usuario.', 'a52-permission-note');
    const thirdColumns = el('div', null, 'a52-columns');
    thirdColumns.append(billingSection, contractsSection);
    root.append(thirdColumns);

    if (canUsers) {
      const userMetrics = [
        { label: 'Usuarios activos', value: activeUsers.length, tone: 'green', detail: { title: 'Usuarios activos', items: activeUsers.map(userItem), module: 'usuarios', moduleLabel: 'Abrir Usuarios' } },
        { label: 'Bloqueados', value: blockedUsers.length, tone: blockedUsers.length ? 'red' : 'green', detail: { title: 'Usuarios bloqueados', items: blockedUsers.map(userItem), module: 'usuarios', moduleLabel: 'Abrir Usuarios' } },
        { label: 'Con acceso a Usuarios', value: usersAuthorized.length, tone: 'blue', detail: { title: 'Cuentas autorizadas para Usuarios', items: usersAuthorized.map(userItem), module: 'usuarios', moduleLabel: 'Abrir Usuarios' } },
        { label: 'Dispositivos pendientes', value: pendingDevices.length, tone: pendingDevices.length ? 'amber' : 'green', detail: { title: 'Dispositivos pendientes', items: pendingDevices.map(row => deviceItem(row, userMap)), module: 'usuarios', moduleLabel: 'Abrir Usuarios' } },
      ];
      root.append(section('Usuarios y accesos', 'Visible únicamente para el administrador o cuentas autorizadas.', userMetrics, openDetail));
    }

    if (errors.length) {
      const warning = el('div', null, 'a52-error');
      warning.append(el('strong', 'Parte del Panel no pudo actualizarse.'));
      errors.forEach(message => warning.append(el('div', message)));
      root.append(warning);
    }

    root.append(el('div', `Panel consultado por ${profileName(profile)}. Los cambios se realizan en el módulo de origen y el Panel los vuelve a leer.`, 'a52-footnote'));
    startAutoRefresh();
  } catch (error) {
    if (!panelRenderIsCurrent(sequence, root)) return;
    loading.className = 'a52-error';
    loading.textContent = `No se pudo cargar el Panel: ${error?.message || 'error desconocido'}`;
    updated.textContent = 'Sin actualizar';
  }
}

nav?.addEventListener('click', event => {
  const button = event.target.closest?.('button[data-module="resumen"]');
  if (button) {
    event.preventDefault();
    event.stopImmediatePropagation();
    markPanelButtonActive(button);
    renderPanel();
    return;
  }
  if (content?.dataset?.[PANEL_FLAG] === '1') {
    delete content.dataset[PANEL_FLAG];
    renderSequence += 1;
    stopAutoRefresh();
  }
}, true);

// La navegación de Hotel usa stopImmediatePropagation para sustituir la vista
// heredada. Por ello no siempre llega al manejador anterior. Observar la raíz
// hace que la propiedad del Panel se cancele también en ese caso.
if (content) {
  new MutationObserver(() => {
    if (!refreshTimer || panelOwnsContent()) return;
    delete content.dataset[PANEL_FLAG];
    renderSequence += 1;
    stopAutoRefresh();
  }).observe(content, { childList: true });
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && panelOwnsContent() && Date.now() - lastLoadedAt > REFRESH_MS) {
    renderPanel({ automatic: true });
  }
});
