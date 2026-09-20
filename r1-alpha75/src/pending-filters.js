// Same predicate for the counters and the list. Unit is an explicit filter.
export function matchesPendingScope(row, scope, today, horizon) {
  const date = String(row.fecha_referencia || '').slice(0, 10);
  if (scope === 'next30') return Boolean(date && date <= horizon);
  if (scope === 'overdue') return Boolean(date && date < today);
  if (scope === 'undated') return !date;
  if (scope === 'inProgress') return row.estado === 'en_curso';
  return true;
}
