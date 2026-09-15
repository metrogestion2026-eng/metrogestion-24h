const PAGE_SIZE = 200;
const DETAIL_CHUNK = 20;
const RECORD_FIELDS = [
  'vehiculo_sustituido', 'matricula_sustituido', 'vehiculo_reserva', 'matricula_reserva',
  'etiqueta_reserva', 'numero_parada', 'causa', 'incidencia', 'lugar', 'trabajos_reserva',
  'observaciones', 'proximo', 'upc', 'marca', 'modelo', 'estado',
];
const STAGE_FIELDS = [
  'nombre', 'lugar', 'observaciones', 'motivo_cancelacion', 'estado_catalogo_codigo',
  'tipo_etapa', 'estado',
];
const WORK_FIELDS = [
  'tipo_trabajo', 'categoria_tecnica', 'motivo_entrada', 'diagnostico_real',
  'expediente', 'descripcion', 'peritaje_estado', 'observaciones', 'motivo_cancelacion',
];
const DOCUMENT_FIELDS = ['nombre_original', 'nombre_mostrado', 'descripcion'];

export function safeHistorySearch(value) {
  return String(value ?? '').trim().replace(/[,%_()]/g, ' ')
    .replace(/\s+/g, ' ').trim().slice(0, 100);
}

function searchable(value) {
  return String(value ?? '').normalize('NFD').replace(/\p{M}/gu, '')
    .replace(/_/g, ' ').replace(/\s+/g, ' ').toLowerCase();
}

// El filtro textual del servidor obliga a comprobar permisos en todas las T.
// Recorrer por la clave primaria mantiene cada petición acotada, sin OFFSET,
// sin count exacto y sin alterar las políticas RLS que aplica Supabase.
async function readPages(client, table, columns, consume, filters = []) {
  let after = null;
  for (;;) {
    let query = client.from(table).select(columns.join(',')).order('id', { ascending: true });
    if (after) query = query.gt('id', after);
    for (const [column, value] of filters) query = query.eq(column, value);
    const { data, error } = await query.limit(PAGE_SIZE);
    if (error) throw new Error(error.message || `No se pudo consultar ${table}.`);
    const rows = data || [];
    if (!rows.length) return;
    consume(rows);
    const next = rows.at(-1)?.id;
    if (!next || next === after) throw new Error('No se pudo avanzar en la búsqueda del Histórico.');
    after = next;
    if (rows.length < PAGE_SIZE) return;
  }
}

export async function searchHistoricalRecords(client, value, limit = 500) {
  const term = searchable(safeHistorySearch(value));
  if (!term) return { rows: [], total: 0, truncated: false };
  const pageSize = Math.min(500, Math.max(1, Math.trunc(Number(limit)) || 500));
  const matches = (row, fields) => fields.some(field => searchable(row[field]).includes(term));
  const records = new Map();
  const boards = new Map();
  const trackingIds = new Set();
  const recordIds = new Set();
  const stageRecords = new Map();
  const groupRecords = new Map();
  const matchingWorkStages = new Set();
  const markRecord = id => {
    if (!id) return;
    recordIds.add(id);
    const tracking = records.get(id)?.seguimiento_id;
    if (tracking) trackingIds.add(tracking);
  };

  // Como máximo dos recorridos de tablas simultáneos.
  await Promise.all([
    readPages(client, 'registros_hotel', [
      'id', 'pizarra_id', 'seguimiento_id', 'orden', 'actualizado_en',
      'tipo_sustituto', 'cancelado', 'retirado_hotel_activo', ...RECORD_FIELDS,
    ], rows => rows.forEach(row => records.set(row.id, row))),
    readPages(client, 'pizarras', ['id', 'fecha', 'estado'], rows => rows.forEach(row => boards.set(row.id, row))),
  ]);
  for (const row of records.values()) {
    const parada = `PA-${String(row.numero_parada || '').replace(/^PA[- ]*/i, '')}`;
    if (matches(row, RECORD_FIELDS) || searchable(parada).includes(term)) markRecord(row.id);
  }
  // La situación de sustitución momentánea es calculada por la vista, no una
  // columna persistida; conserva también esa búsqueda.
  if (searchable('sustitucion_momentanea').includes(term)) {
    const key = (board, vehicle) => `${board}|${searchable(vehicle).replace(/\s+/g, '')}`;
    const replacements = new Map();
    for (const row of records.values()) {
      if (row.cancelado || row.retirado_hotel_activo || row.tipo_sustituto !== 'FLOTA') continue;
      const replacementKey = key(row.pizarra_id, row.vehiculo_reserva);
      const ids = replacements.get(replacementKey) || new Set();
      ids.add(row.id);
      replacements.set(replacementKey, ids);
    }
    for (const row of records.values()) {
      const ids = replacements.get(key(row.pizarra_id, row.vehiculo_sustituido));
      if (row.vehiculo_sustituido && ids && [...ids].some(id => id !== row.id)) markRecord(row.id);
    }
  }
  await Promise.all([
    readPages(client, 'etapas_hotel', ['id', 'registro_hotel_id', 'grupo_documental_id', ...STAGE_FIELDS], rows => {
      for (const row of rows) {
        stageRecords.set(row.id, row.registro_hotel_id);
        if (row.grupo_documental_id) {
          const ids = groupRecords.get(row.grupo_documental_id) || new Set();
          ids.add(row.registro_hotel_id);
          groupRecords.set(row.grupo_documental_id, ids);
        }
        if (matches(row, STAGE_FIELDS)) markRecord(row.registro_hotel_id);
      }
    }),
    readPages(client, 'trabajos_etapa_hotel', ['id', 'etapa_hotel_id', ...WORK_FIELDS], rows => {
      for (const row of rows) if (matches(row, WORK_FIELDS)) matchingWorkStages.add(row.etapa_hotel_id);
    }),
  ]);
  for (const stageId of matchingWorkStages) markRecord(stageRecords.get(stageId));
  await Promise.all([
    readPages(client, 'documentos_gestion', [
      'id', 'registro_hotel_id', 'etapa_hotel_id', 'grupo_etapa_id', 'seguimiento_id', ...DOCUMENT_FIELDS,
    ], rows => {
      for (const row of rows) {
        if (!matches(row, DOCUMENT_FIELDS)) continue;
        markRecord(row.registro_hotel_id);
        markRecord(stageRecords.get(row.etapa_hotel_id));
        for (const id of groupRecords.get(row.grupo_etapa_id) || []) markRecord(id);
        if (row.seguimiento_id) trackingIds.add(row.seguimiento_id);
      }
    }),
    readPages(client, 'anotaciones_manuales_hotel', ['id', 'seguimiento_id', 'registro_origen_id', 'texto'], rows => {
      for (const row of rows) if (searchable(row.texto).includes(term)) {
        markRecord(row.registro_origen_id);
        if (row.seguimiento_id) trackingIds.add(row.seguimiento_id);
      }
    }, [['cancelada', false]]),
  ]);

  // Una coincidencia antigua conduce a la ficha más reciente del seguimiento.
  // Las fichas anuladas siguen siendo recuperables desde el Histórico.
  const latest = new Map();
  const newestFirst = (a, b) => String(boards.get(b.pizarra_id)?.fecha || '').localeCompare(String(boards.get(a.pizarra_id)?.fecha || ''))
    || String(b.actualizado_en || '').localeCompare(String(a.actualizado_en || ''))
    || String(a.id).localeCompare(String(b.id));
  for (const row of records.values()) {
    if (!boards.has(row.pizarra_id) || (!recordIds.has(row.id) && !trackingIds.has(row.seguimiento_id))) continue;
    const key = row.seguimiento_id || row.id;
    if (!latest.has(key) || newestFirst(row, latest.get(key)) < 0) latest.set(key, row);
  }
  const selected = [...latest.values()].sort((a, b) =>
    String(boards.get(b.pizarra_id)?.fecha || '').localeCompare(String(boards.get(a.pizarra_id)?.fecha || ''))
    || Number(a.orden || 0) - Number(b.orden || 0) || String(a.id).localeCompare(String(b.id))
  ).slice(0, pageSize);
  const rowsById = new Map();
  for (let start = 0; start < selected.length; start += DETAIL_CHUNK) {
    const { data, error } = await client.from('hotel_por_dia').select('*')
      .in('id', selected.slice(start, start + DETAIL_CHUNK).map(row => row.id));
    if (error) throw new Error(error.message || 'No se pudieron cargar las fichas encontradas.');
    (data || []).forEach(row => rowsById.set(row.id, row));
  }
  return {
    rows: selected.map(row => rowsById.get(row.id)).filter(Boolean),
    total: latest.size,
    truncated: latest.size > pageSize,
  };
}
