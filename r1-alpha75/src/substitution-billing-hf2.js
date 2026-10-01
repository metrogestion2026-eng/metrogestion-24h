// 75.23-hf2: preserves alpha67 billing arithmetic and presentation.
// Deliberately local to alpha75; the older shared module remains unchanged.
import { supabase } from '../../r1-alpha17/src/supabase.js';
import { createBillingReader } from './billing-data-hf2.js';

const DAY_MS = 86400000;
const billingReader = createBillingReader(supabase);
const billingRenders = new WeakMap();
const billingViews = new WeakMap();
let primaryAdminPromise = null;

function el(tag, text = null, className = '') {
  const node = document.createElement(tag);
  if (text !== null && text !== undefined) node.textContent = String(text);
  if (className) node.className = className;
  return node;
}

function madridToday() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Madrid',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function dateOnly(value) {
  if (!value) return '';
  const raw = String(value);
  const match = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  if (match) return match[1];
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Madrid',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(parsed);
}

function utcDate(value) {
  const iso = dateOnly(value);
  if (!iso) return null;
  const [year, month, day] = iso.split('-').map(Number);
  if (![year, month, day].every(Number.isFinite)) return null;
  return new Date(Date.UTC(year, month - 1, day));
}

function formatDate(value) {
  const date = utcDate(value);
  return date
    ? new Intl.DateTimeFormat('es-ES', { timeZone: 'UTC' }).format(date)
    : '—';
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

function formatNumber(value, digits = 0) {
  const number = Number(value);
  return Number.isFinite(number)
    ? new Intl.NumberFormat('es-ES', {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      }).format(number)
    : '—';
}

function compareDate(a, b) {
  return String(a || '').localeCompare(String(b || ''));
}

function maxDate(...values) {
  return values.map(dateOnly).filter(Boolean).sort(compareDate).at(-1) || '';
}

function minDate(...values) {
  return values.map(dateOnly).filter(Boolean).sort(compareDate)[0] || '';
}

function inclusiveDays(startValue, endValue) {
  const start = utcDate(startValue);
  const end = utcDate(endValue);
  if (!start || !end || end < start) return 0;
  return Math.floor((end.getTime() - start.getTime()) / DAY_MS) + 1;
}

async function isPrimaryAdmin() {
  if (primaryAdminPromise) return primaryAdminPromise;
  primaryAdminPromise = (async () => {
    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError || !authData?.user?.id) return false;
    const { data, error } = await supabase
      .from('usuarios')
      .select('tipo_usuario,activo')
      .eq('id', authData.user.id)
      .maybeSingle();
    if (error) return false;
    return data?.activo === true && data?.tipo_usuario === 'administrador_principal';
  })();
  return primaryAdminPromise;
}

function findPeriod(periods, referenceDate) {
  const reference = dateOnly(referenceDate);
  if (!reference) return null;
  const exact = periods.find(period =>
    compareDate(reference, period.fecha_inicio) >= 0
    && compareDate(reference, period.fecha_cierre) <= 0
  );
  if (exact) return exact;
  return periods
    .filter(period => compareDate(period.fecha_inicio, reference) <= 0)
    .sort((a, b) => compareDate(b.fecha_inicio, a.fecha_inicio))[0] || null;
}

function billingSnapshot(row, stop, periods) {
  const referenceDate = dateOnly(row?.fecha_pizarra) || madridToday();
  const startDate = dateOnly(stop?.fecha_inicio_parada) || dateOnly(row?.fecha_parada);
  const declaredEnd = dateOnly(stop?.fecha_fin_parada);
  const endDate = declaredEnd ? minDate(declaredEnd, referenceDate) : referenceDate;
  const totalDays = inclusiveDays(startDate, endDate);
  const period = findPeriod(periods, referenceDate);
  const periodStart = period && startDate ? maxDate(startDate, period.fecha_inicio) : '';
  const periodEnd = period && startDate ? minDate(endDate, period.fecha_cierre) : '';
  const periodDays = period && startDate ? inclusiveDays(periodStart, periodEnd) : 0;
  const rawMedia = stop?.km_dia;
  const parsedMedia = rawMedia == null || rawMedia === '' ? Number.NaN : Number(rawMedia);
  const media = Number.isFinite(parsedMedia) ? parsedMedia : null;
  const periodKm = media == null ? null : Math.round(periodDays * media);
  const totalKm = media == null ? null : Math.round(totalDays * media);
  const historical = referenceDate !== madridToday();

  return {
    referenceDate,
    startDate,
    endDate,
    totalDays,
    period,
    periodStart,
    periodEnd,
    periodDays,
    media,
    periodKm,
    totalKm,
    historical,
  };
}

function metric(label, value, note = '') {
  const cell = el('div', null, 'subst-cell a66-billing-cell');
  cell.append(el('strong', value), el('span', label, 'muted'));
  if (note) cell.append(el('small', note, 'a66-billing-note'));
  return cell;
}

function activePeriodText(snapshot) {
  if (!snapshot.period) return 'Periodo no configurado';
  return `${snapshot.period.periodo} · ${formatDate(snapshot.period.fecha_inicio)}–${formatDate(snapshot.period.fecha_cierre)}`;
}

function overlapText(snapshot) {
  if (!snapshot.period || !snapshot.periodDays) return 'Sin días dentro de este periodo';
  return `${formatDate(snapshot.periodStart)}–${formatDate(snapshot.periodEnd)} · cómputo inclusivo`;
}

function billingClass(stop, row) {
  if (stop?.clase_facturacion) return stop.clase_facturacion;
  return String(row?.dfm || row?.vehiculo_sustituido || '').startsWith('R') ? 'R' : 'DFM';
}

function createManualEditor(row, stop, snapshot, rerender) {
  const editor = el('section', null, 'alpha31-editor a66-manual-editor');
  editor.append(el(
    'div',
    `Automático CTM: ${stop.km_dia_automatico == null ? 'sin dato' : `${formatNumber(stop.km_dia_automatico)} km/día`} · Manual: ${stop.km_dia_manual == null ? 'no' : `${formatNumber(stop.km_dia_manual)} km/día`} · Usado: ${snapshot.media == null ? '—' : `${formatNumber(snapshot.media)} km/día`} · Fuente: ${stop.km_dia_fuente || '—'}`,
    'alpha31-source'
  ));

  const grid = el('div', null, 'alpha31-grid');
  const media = document.createElement('input');
  media.type = 'number';
  media.min = '1';
  media.max = '5000';
  media.step = '0.001';
  media.value = stop.km_dia_manual ?? stop.km_dia ?? '';
  const observation = document.createElement('input');
  observation.type = 'text';
  observation.maxLength = 500;
  observation.placeholder = 'Motivo o nota opcional';
  observation.value = stop.ajuste_observaciones || '';
  const mediaLabel = el('label');
  mediaLabel.append(el('span', 'Media km/día manual'), media);
  const observationLabel = el('label');
  observationLabel.append(el('span', 'Observación'), observation);
  grid.append(mediaLabel, observationLabel);

  const actions = el('div', null, 'alpha31-actions');
  const save = el('button', 'Guardar media manual', 'button primary compact');
  const reset = el('button', 'Volver a automático', 'button secondary compact');
  save.type = reset.type = 'button';
  reset.disabled = stop.km_dia_manual == null;
  const status = el('div', '', 'alpha31-status');
  status.setAttribute('aria-live', 'polite');

  const trackingId = stop.seguimiento_id || row.seguimiento_id;
  save.addEventListener('click', async () => {
    const value = Number(media.value);
    if (!Number.isFinite(value) || value <= 0 || value > 5000) {
      status.textContent = 'Introduce una media válida entre 1 y 5000 km/día.';
      return;
    }
    save.disabled = reset.disabled = true;
    status.textContent = 'Guardando media manual…';
    const { error } = await supabase.rpc('guardar_km_dia_sustitucion', {
      p_seguimiento_id: trackingId,
      p_km_dia: value,
      p_observaciones: observation.value.trim(),
    });
    if (error) {
      save.disabled = false;
      reset.disabled = stop.km_dia_manual == null;
      status.textContent = `No se pudo guardar: ${error.message}`;
      return;
    }
    status.textContent = 'Media manual guardada. Actualizando cálculo…';
    billingReader.invalidate(trackingId);
    await rerender();
  });

  reset.addEventListener('click', async () => {
    save.disabled = reset.disabled = true;
    status.textContent = 'Restaurando la media automática CTM…';
    const { error } = await supabase.rpc('guardar_km_dia_sustitucion', {
      p_seguimiento_id: trackingId,
      p_km_dia: null,
      p_observaciones: '',
    });
    if (error) {
      save.disabled = false;
      reset.disabled = false;
      status.textContent = `No se pudo restaurar: ${error.message}`;
      return;
    }
    status.textContent = 'Media automática restaurada. Actualizando cálculo…';
    billingReader.invalidate(trackingId);
    await rerender();
  });

  actions.append(save, reset);
  editor.append(grid, actions, status);
  return editor;
}

async function renderBillingBody(body, row, allowManual) {
  const generation = billingReader.generation;
  const renderId = (billingRenders.get(body) || 0) + 1;
  billingRenders.set(body, renderId);
  body.replaceChildren(el('div', 'Calculando días totales y periodo actual…', 'a66-billing-loading'));

  try {
    const data = await billingReader.read(row?.seguimiento_id);
    if (!body.isConnected || generation !== billingReader.generation || renderId !== billingRenders.get(body)) return;
    const stop = data.stop;
    const snapshot = billingSnapshot(row, stop, data.periods);
    const type = billingClass(stop, row);
    const periodLabel = snapshot.historical ? 'Días del periodo de la ficha' : 'Días del periodo actual';
    const periodNameLabel = snapshot.historical ? 'Periodo de la ficha' : 'Periodo actual';

    const grid = el('div', null, 'subst-grid a66-billing-grid');
    grid.append(
      metric(
        'Días totales desde parada',
        formatNumber(snapshot.totalDays),
        snapshot.startDate
          ? `${formatDate(snapshot.startDate)}–${formatDate(snapshot.endDate)}`
          : 'Fecha de parada no informada'
      ),
      metric(periodLabel, formatNumber(snapshot.periodDays), overlapText(snapshot)),
      metric(periodNameLabel, snapshot.period?.periodo || '—', activePeriodText(snapshot)),
      metric('Sustituto', stop.sustituto || 'Sin sustituto', stop.matricula_sustituto || '')
    );

    if (type === 'R') {
      const parsedRPrice = data.rPrice == null || data.rPrice === '' ? Number.NaN : Number(data.rPrice);
      const rPrice = Number.isFinite(parsedRPrice) ? parsedRPrice : null;
      const hasPrice = rPrice != null;
      grid.append(
        metric('Tipo de facturación', stop.sustituto ? '1 unidad' : 'Sin sustitución', 'Los días se muestran como control operativo'),
        metric('Precio por unidad', hasPrice ? `${formatNumber(rPrice, 2)} €` : 'Pendiente', 'Configuración general de sustituciones R'),
        metric('Importe', stop.sustituto && hasPrice ? `${formatNumber(rPrice, 2)} €` : '—', stop.sustituto ? 'Una unidad fija' : 'Sin sustituto'),
        metric('KM de sustitución', 'No aplica', 'Semirremolque R')
      );
    } else {
      grid.append(
        metric('Media usada', snapshot.media == null ? 'Sin media' : `${formatNumber(snapshot.media)} km/día`, stop.km_dia_fuente || 'SIN_MEDIA'),
        metric('KM del periodo', snapshot.periodKm == null ? '—' : `${formatNumber(snapshot.periodKm)} km`, `${formatNumber(snapshot.periodDays)} días × media`),
        metric('KM sustitución total', snapshot.totalKm == null ? '—' : `${formatNumber(snapshot.totalKm)} km`, `${formatNumber(snapshot.totalDays)} días × media`)
      );
    }

    body.replaceChildren(grid);
    body.append(el(
      'div',
      `Fecha de referencia: ${formatDate(snapshot.referenceDate)} · Los días se cuentan incluyendo el día inicial y el final.`,
      'subst-period a66-billing-period'
    ));

    if (allowManual && type === 'DFM' && stop.seguimiento_id && await isPrimaryAdmin()) {
      if (!body.isConnected || generation !== billingReader.generation || renderId !== billingRenders.get(body)) return;
      body.append(createManualEditor(row, stop, snapshot, () => renderBillingBody(body, row, allowManual)));
    } else if (type === 'R') {
      body.append(el(
        'div',
        `Facturación R: una unidad fija cuando existe sustituto · Precio actual: ${data.rPrice == null ? 'pendiente de configurar' : `${formatNumber(data.rPrice, 2)} €`}. Los días totales y del periodo quedan visibles como control.`,
        'alpha31-source a66-r-source'
      ));
    }
  } catch (error) {
    if (!body.isConnected || generation !== billingReader.generation || renderId !== billingRenders.get(body)) return;
    body.replaceChildren(el(
      'div',
      error?.message || 'No se pudieron calcular los datos de sustitución y facturación.',
      'notice danger'
    ));
    const retry = el('button', 'Reintentar cálculo de esta parada', 'button secondary compact');
    retry.type = 'button';
    retry.addEventListener('click', () => {
      if (generation !== billingReader.generation) return;
      billingReader.invalidate(row?.seguimiento_id);
      void renderBillingBody(body, row, allowManual);
    });
    body.append(retry);
  }
}

export function createSubstitutionBilling(row, { allowManual = false } = {}) {
  const box = el('section', null, 'subst-box a66-substitution-box');
  // Evita que el enriquecedor antiguo vuelva a controlar este componente nativo.
  box.dataset.alpha31 = '1';
  box.dataset.alpha66Billing = '1';
  box.dataset.alpha75Billing = '75.23-hf2';
  box.append(el('h4', 'Sustitución / facturación'));
  const body = el('div', null, 'a66-substitution-body');
  box.append(body);
  billingViews.set(body, () => renderBillingBody(body, row, allowManual));
  void renderBillingBody(body, row, allowManual);
  return box;
}

export function invalidateSubstitutionBilling() {
  primaryAdminPromise = null;
  billingReader.reset();
}

supabase.auth.onAuthStateChange((_event, session) => {
  invalidateSubstitutionBilling();
  const generation = billingReader.generation;
  // Clear old values immediately. Any new read must pass the server again.
  const bodies = document.querySelectorAll('[data-alpha75-billing] .a66-substitution-body');
  bodies.forEach(body => {
    body.replaceChildren(el('div', 'Identificación actualizada. Vuelve a abrir la ficha para consultar el cálculo.', 'a66-billing-loading'));
  });
  if (session) setTimeout(() => {
    if (generation !== billingReader.generation) return;
    bodies.forEach(body => { if (body.isConnected) void billingViews.get(body)?.(); });
  }, 0);
});
