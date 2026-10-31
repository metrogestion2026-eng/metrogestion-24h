import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import {
  hasSubstitutionContinuity, substitutionImputationBounds, imputableDaysInPeriod,
  needsSubstitutionMean, currentSubstitutionOwners, substitutionOwnershipText,
} from '../r1-alpha75/src/substitution-imputation.js';

const periods = [
  { periodo: '2026-10', fecha_inicio: '2026-09-26', fecha_cierre: '2026-10-25' },
  { periodo: '2026-11', fecha_inicio: '2026-10-26', fecha_cierre: '2026-11-25' },
];
const period = periods[1];
const source = readFileSync(new URL('../r1-alpha75/src/substitution-billing-hf2.js', import.meta.url), 'utf8');
function between(start, end) { return source.slice(source.indexOf(start), source.indexOf(end)); }
const context = vm.createContext({ Date, Intl, Math, Number, String, substitutionImputationBounds });
vm.runInContext(`const DAY_MS = 86400000;\n${between('function el(', 'async function isPrimaryAdmin')}\n${between('function findPeriod(', 'function metric(')}\nthis.snapshot = billingSnapshot;`, context);
const snapshot = (stop, reference = '2026-10-31') => context.snapshot({ fecha_pizarra: reference }, stop, periods);

function origin(extra = {}) {
  return { seguimiento_id: 'ORIGIN', clase_facturacion: 'DFM', sustituto: 'R-SINT', km_dia: null,
    fecha_inicio_parada: '2026-10-27', fecha_fin_parada: null,
    fecha_inicio_imputacion: '2026-10-27', fecha_fin_imputacion: '2026-10-28', dias_imputables_total: 2,
    continuidad_salida_id: 'LINK', continuidad_entrada_id: null, fin_imputacion_motivo: 'continuidad',
    continuidad_destino_seguimiento_id: 'DESTINATION', continuidad_destino_numero_parada: 'SINT-TALLER',
    propietario_sustitucion_seguimiento_id: 'DESTINATION', sustitucion_vigente: false, ...extra };
}

function destination(extra = {}) {
  return { seguimiento_id: 'DESTINATION', clase_facturacion: 'DFM', sustituto: 'R-SINT', km_dia: 456.789,
    fecha_inicio_parada: '2026-10-25', fecha_fin_parada: null,
    fecha_inicio_imputacion: '2026-10-29', fecha_fin_imputacion: null, dias_imputables_total: 3,
    continuidad_entrada_id: 'LINK', continuidad_salida_id: null,
    continuidad_origen_seguimiento_id: 'ORIGIN', continuidad_origen_numero_parada: 'SINT-ORIGEN',
    propietario_sustitucion_seguimiento_id: 'DESTINATION', sustitucion_vigente: true, ...extra };
}

test('Hotel/Histórico usan el tramo imputable, con fechas físicas separadas y media exacta conservada', () => {
  const a = origin(), b = destination();
  const before = JSON.stringify([a, b]);
  const first = snapshot(a), second = snapshot(b);
  assert.equal(first.totalDays, 2);
  assert.equal(first.periodDays, 2);
  assert.equal(second.totalDays, 3);
  assert.equal(second.periodDays, 3);
  assert.equal(first.totalDays + second.totalDays, 5);
  assert.equal(first.imputation.physicalStart, '2026-10-27');
  assert.equal(first.imputation.physicalEnd, '');
  assert.equal(second.imputation.physicalStart, '2026-10-25');
  assert.equal(second.startDate, '2026-10-29');
  assert.equal(second.media, 456.789);
  assert.equal('periodKm' in second, false);
  assert.equal('totalKm' in second, false);
  assert.equal(JSON.stringify([a, b]), before);
});

test('entrada el mismo día: origen cero, destino uno; no fuerza un mínimo de un día', () => {
  const a = origin({ fecha_inicio_parada: '2026-10-29', fecha_inicio_imputacion: '2026-10-29', dias_imputables_total: 0 });
  const first = snapshot(a, '2026-10-29');
  const second = snapshot(destination(), '2026-10-29');
  assert.equal(first.totalDays, 0);
  assert.equal(first.periodDays, 0);
  assert.equal(second.totalDays, 1);
  assert.equal(imputableDaysInPeriod(a, period, '2026-10-29'), 0);
});

test('Histórico limita los días a la fecha de la ficha y no imputa una entrada posterior', () => {
  assert.equal(snapshot(origin(), '2026-10-27').totalDays, 1);
  assert.equal(snapshot(origin(), '2026-10-28').totalDays, 2);
  assert.equal(snapshot(destination(), '2026-10-28').totalDays, 0);
  assert.equal(snapshot(destination(), '2026-10-29').totalDays, 1);
});

test('cambio de periodo distribuye ambos lados sin solapar el día de entrada', () => {
  const a = origin({ fecha_inicio_imputacion: '2026-10-24', fecha_fin_imputacion: '2026-10-25' });
  const b = destination({ fecha_inicio_imputacion: '2026-10-26' });
  assert.equal(imputableDaysInPeriod(a, periods[0], '2026-10-29'), 2);
  assert.equal(imputableDaysInPeriod(a, periods[1], '2026-10-29'), 0);
  assert.equal(imputableDaysInPeriod(b, periods[0], '2026-10-29'), 0);
  assert.equal(imputableDaysInPeriod(b, periods[1], '2026-10-29'), 4);
});

test('recuperación posterior cierra solo el límite que acredita el servidor', () => {
  const recovered = destination({ fecha_fin_parada: '2026-10-30', fecha_fin_imputacion: '2026-10-30', fin_imputacion_motivo: 'recuperacion',
    propietario_sustitucion_seguimiento_id: null, sustitucion_vigente: false });
  assert.equal(snapshot(recovered).totalDays, 2);
  assert.equal(snapshot(recovered).imputation.physicalEnd, '2026-10-30');
  assert.match(substitutionOwnershipText(recovered), /sin asignación vigente actual/);
  assert.equal(currentSubstitutionOwners([recovered]).size, 0);
});

test('no fabrica días de continuidad cuando faltan sus límites autoritativos', () => {
  const incomplete = origin(); delete incomplete.fecha_inicio_imputacion;
  assert.throws(() => snapshot(incomplete), /Faltan los límites de imputación/);
  assert.throws(() => imputableDaysInPeriod(incomplete, period, '2026-10-29'), /Faltan los límites/);
});

test('sin vínculo los límites reproducen la parada y recuperación previas, también para afectado R', () => {
  const old = { clase_facturacion: 'R', sustituto: 'R-SINT', fecha_inicio_parada: '2026-10-27', fecha_fin_parada: '2026-10-29', km_dia: null };
  assert.equal(hasSubstitutionContinuity(old), false);
  assert.equal(snapshot(old).totalDays, 3);
  assert.equal(snapshot(old).periodDays, 3);
  assert.deepEqual(substitutionImputationBounds(old), {
    linked: false, physicalStart: '2026-10-27', physicalEnd: '2026-10-29', start: '2026-10-27', end: '2026-10-29',
  });
  assert.equal(needsSubstitutionMean(old, period, '2026-10-31'), false);
});

test('Sin media mantiene el origen cortado que sí aporta días al periodo y excluye el origen de cero días', () => {
  assert.equal(needsSubstitutionMean(origin(), period, '2026-10-31'), true);
  assert.equal(needsSubstitutionMean(origin({ fecha_inicio_imputacion: '2026-10-29', dias_imputables_total: 0 }), period, '2026-10-31'), false);
  assert.equal(needsSubstitutionMean(origin({ km_dia: 333.333, km_dia_manual: 333.333 }), period, '2026-10-31'), false);
  assert.equal(needsSubstitutionMean(destination({ km_dia: null }), period, '2026-10-31'), true);
  assert.equal(needsSubstitutionMean(destination({ km_dia: null }), period, '2026-10-28'), false);
  assert.equal(needsSubstitutionMean(origin(), periods[0], '2026-10-31'), false);
});

test('Sin media no amplía el criterio anterior de las PA sin continuidad', () => {
  const legacy = { clase_facturacion: 'DFM', sustituto: 'R-SINT', km_dia: null, fecha_fin_parada: null };
  assert.equal(needsSubstitutionMean(legacy, period, '2026-10-31'), true);
  assert.equal(needsSubstitutionMean({ ...legacy, fecha_fin_parada: '2026-10-30' }, period, '2026-10-31'), false);
  assert.equal(needsSubstitutionMean({ ...legacy, km_dia: 456 }, period, '2026-10-31'), false);
});

test('el propietario de Panel procede del seguimiento acreditado, sin depender del orden de tarjetas', () => {
  const a = origin(), b = destination();
  for (const rows of [[a, b], [b, a]]) {
    const owners = currentSubstitutionOwners(rows);
    assert.equal(owners.size, 1);
    assert.equal(owners.get('R-SINT').seguimiento_id, 'DESTINATION');
  }
  assert.match(substitutionOwnershipText(a), /referencia.*otra PA/);
  assert.equal(substitutionOwnershipText(b), 'Sustitución vigente en esta PA');
});

test('sin proyección o con propietarios contradictorios, Panel no adivina una PA por estado de reserva ni última fila', () => {
  const unverified = { seguimiento_id: 'UNKNOWN', sustituto: 'R-SINT', estado: 'ocupada' };
  assert.equal(currentSubstitutionOwners([unverified]).size, 0);
  const conflict = { ...origin(), sustitucion_vigente: true, propietario_sustitucion_seguimiento_id: 'ORIGIN' };
  assert.equal(currentSubstitutionOwners([destination(), conflict]).size, 0);
  assert.equal(currentSubstitutionOwners([conflict, destination()]).size, 0);
  assert.equal(substitutionOwnershipText(unverified), '');
});
