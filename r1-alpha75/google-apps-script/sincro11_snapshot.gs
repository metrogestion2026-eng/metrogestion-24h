/**
 * METROGES · SINCRO 11 · BASE DE CAMBIOS FUTUROS (CANDIDATA SEGURA).
 * Revisión: 2026-11-15. Archivo ADICIONAL para Apps Script vinculado a
 * MANTENIMIENTOS; no sustituye el sincronizador existente.
 *
 * NUNCA escribe en MANTENIMENT ni TANCAMENT, ni llama a Supabase/Drive/HTTP.
 * No crea activadores ni ejecuta órdenes. El sellado escribe SOLO en las
 * propiedades de documento, para mantener una referencia de comparación.
 * NUNCA considera una fecha antigua en I/J/K motivo para excluir una edición.
 * NUNCA identifica filas por número físico, PA, UUID de trabajo o DFM:
 * solamente por ID_FILA en la columna T (20).
 *
 * 1) metroSincro11PrevisualizarBase() — lectura, 0 escrituras.
 * 2) metroSincro11SellarBase()       — una vez, con ventana sin ediciones;
 *     registra la fotografía de partida en DocumentProperties (no hoja).
 * 3) metroSincro11Comparar()         — lectura, 0 escrituras.
 *
 * Un cambio detectado es una DIFERENCIA DE CONTENIDO posterior a la base,
 * no prueba por sí sola quién editó, cuándo ocurrió exactamente ni permiso
 * para sobrescribir. No implica sincronización ni confirmación de órdenes.
 */
const METRO_SINCRO11 = Object.freeze({
  spreadsheetId: '1PQE5VsjTvDFvQZcqedyQKIs3RbSySHFK4JPQXBD0XyU',
  sheetName: 'MANTENIMENT',
  identityColumn: 20,
  columnCount: 26,
  prefix: 'MG11_BASE_V1_',
  manifest: 'MG11_BASE_V1_MANIFEST',
  version: 'sincro11-base-readonly-20261115.1',
  maxRows: 25000,
  rowsPerChunk: 160,
  maxPropertyBytes: 8000,
  maxPropertyStoreBytes: 450000,
  maxDetails: 100,
});

function metroSincro11Propiedades_() {
  const store = PropertiesService.getDocumentProperties();
  if (!store) throw new Error('Este proyecto debe estar vinculado al archivo MANTENIMIENTOS. No hay DocumentProperties.');
  return store;
}

function metroSincro11HexId_(value) {
  const original = String(value === null || value === undefined ? '' : value).trim();
  if (!/^\d{1,15}$/.test(original)) return 0;
  const n = Number(original);
  return Number.isSafeInteger(n) && n > 0 ? n : 0;
}

function metroSincro11Valor_(value) {
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) throw new Error('Fecha de hoja no válida');
    return ['DATE', value.toISOString()];
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Número de hoja no finito');
    return ['NUMBER', value];
  }
  if (typeof value === 'boolean') return ['BOOLEAN', value];
  if (value == null) return ['EMPTY', ''];
  return ['STRING', String(value)];
}

function metroSincro11Huella_(text) {
  // SHA-256, 128 bits guardados. No es una firma de autorización.
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8);
  return Utilities.base64EncodeWebSafe(bytes.slice(0, 16)).replace(/=+$/g, '');
}

function metroSincro11ObtenerHoja_() {
  const ss = SpreadsheetApp.openById(METRO_SINCRO11.spreadsheetId);
  if (!ss || ss.getId() !== METRO_SINCRO11.spreadsheetId) throw new Error('Archivo origen no acreditado');
  const sheet = ss.getSheetByName(METRO_SINCRO11.sheetName);
  if (!sheet || sheet.getName() !== METRO_SINCRO11.sheetName) throw new Error('Falta la pestaña MANTENIMENT');
  if (sheet.getMaxColumns() < METRO_SINCRO11.columnCount) throw new Error('Menos de 26 columnas; revisar estructura');
  return sheet;
}

function metroSincro11Leer_() {
  const sheet = metroSincro11ObtenerHoja_();
  const last = sheet.getLastRow();
  if (last < 2 || last > METRO_SINCRO11.maxRows) throw new Error('Rango de filas fuera del alcance controlado');
  const n = last - 1;
  const range = sheet.getRange(2, 1, n, METRO_SINCRO11.columnCount);
  const values = range.getValues(), formulas = range.getFormulas(), notes = range.getNotes();
  if (values.length !== n || formulas.length !== n || notes.length !== n) throw new Error('Fotografía inconsistente');
  const rows = new Map();
  const sinIdentidad = [], duplicados = [];
  let conNotas = 0;
  for (let i = 0; i < n; i++) {
    const vals = values[i], fs = formulas[i], ns = notes[i];
    if (!Array.isArray(vals) || vals.length !== METRO_SINCRO11.columnCount ||
        !Array.isArray(fs) || fs.length !== METRO_SINCRO11.columnCount ||
        !Array.isArray(ns) || ns.length !== METRO_SINCRO11.columnCount)
      throw new Error('Dimensiones de origen no verificadas');
    const id = metroSincro11HexId_(vals[METRO_SINCRO11.identityColumn - 1]);
    const physical = i + 2;
    if (!id) { sinIdentidad.push(physical); continue; }
    if (rows.has(id)) { duplicados.push({ id_fila: id, filas: [rows.get(id).fila_fisica, physical] }); continue; }
    const data = [];
    for (let c = 0; c < METRO_SINCRO11.columnCount; c++) {
      if (c === METRO_SINCRO11.identityColumn - 1) continue;
      const formula = String(fs[c] || '');
      const note = String(ns[c] || '');
      if (note) conNotas++;
      data.push([c + 1, formula ? ['FORMULA', formula] : metroSincro11Valor_(vals[c]), note]);
    }
    rows.set(id, {
      id_fila: id, fila_fisica: physical, dfm: String(vals[0] ?? '').trim(),
      tipo: String(vals[7] ?? '').trim(),
      fecha_necesidad: metroSincro11Valor_(vals[8]),
      huella: metroSincro11Huella_(JSON.stringify(data)),
    });
  }
  return { rows, sinIdentidad, duplicados, conNotas, ultima_fila_fisica: last };
}

function metroSincro11BaseSerializada_(rows) {
  return Array.from(rows.values())
    .sort((a,b) => a.id_fila - b.id_fila)
    .map(x => x.id_fila + '|' + x.huella).join('\n');
}

function metroSincro11Validar_(data) {
  if (data.sinIdentidad.length || data.duplicados.length) {
    throw new Error('ID_FILA no válido: ' + data.sinIdentidad.length + ' filas sin identidad y ' +
      data.duplicados.length + ' repetidos. No se ha autorizado ninguna escritura.');
  }
}

function metroSincro11PrevisualizarBase() {
  const data = metroSincro11Leer_();
  const store = metroSincro11Propiedades_();
  const prop = store.getProperties();
  const baseSellada = !!prop[METRO_SINCRO11.manifest];
  const selladoParcial = !baseSellada && Object.keys(prop).some(k => k.startsWith(METRO_SINCRO11.prefix));
  return {
    version: METRO_SINCRO11.version,
    filas_identificadas: data.rows.size,
    notas_en_celdas: data.conNotas,
    filas_sin_id: data.sinIdentidad.slice(0, 20),
    identidades_duplicadas: data.duplicados.slice(0, 20),
    base_ya_sellada: baseSellada,
    base_parcial_a_revisar: selladoParcial,
    puede_sellar: !data.sinIdentidad.length && !data.duplicados.length && !baseSellada && !selladoParcial,
    hojas_modificadas: 0,
    sincronizacion_autorizada: false,
  };
}

function metroSincro11PrepararPaquetes_(data, snapshotId) {
  const registros = metroSincro11BaseSerializada_(data.rows).split('\n');
  const chunks = [];
  for (let i = 0; i < registros.length; i += METRO_SINCRO11.rowsPerChunk) {
    const content = registros.slice(i, i + METRO_SINCRO11.rowsPerChunk).join('\n');
    if (content.length > METRO_SINCRO11.maxPropertyBytes) throw new Error('Paquete de base demasiado grande');
    chunks.push({ key: METRO_SINCRO11.prefix + snapshotId + '_' + chunks.length, content });
  }
  const all = registros.join('\n');
  const manifest = {
    version: METRO_SINCRO11.version, spreadsheet_id: METRO_SINCRO11.spreadsheetId,
    hoja: METRO_SINCRO11.sheetName, snapshot_id: snapshotId,
    recogido_en: new Date().toISOString(),
    cantidad: data.rows.size, partes: chunks.length,
    checksum: metroSincro11Huella_(all),
  };
  return { chunks, manifest, all };
}

function metroSincro11ConLock_(fn) {
  const lock = LockService.getDocumentLock();
  if (!lock) throw new Error('No existe bloqueo de documento');
  if (!lock.tryLock(2500)) throw new Error('Otro proceso está usando la base. Repetir solo después de revisar.');
  try { return fn(); } finally { lock.releaseLock(); }
}

function metroSincro11SellarBase() {
  return metroSincro11ConLock_(() => {
    const store = metroSincro11Propiedades_();
    if (store.getProperty(METRO_SINCRO11.manifest))
      throw new Error('Ya existe una base. No se sobreescribe ni se reinicia automáticamente.');
    const props = store.getProperties();
    const keys = Object.keys(props);
    if (keys.some(k => k.startsWith(METRO_SINCRO11.prefix)))
      throw new Error('Existen restos de un sellado anterior. Requiere revisión; no se borra nada automáticamente.');
    const source = metroSincro11Leer_();
    metroSincro11Validar_(source);
    // Segunda fotografía íntegra: un cambio durante el sellado impide publicar la base.
    const confirmation = metroSincro11Leer_();
    metroSincro11Validar_(confirmation);
    const sourceText = metroSincro11BaseSerializada_(source.rows);
    if (sourceText !== metroSincro11BaseSerializada_(confirmation.rows))
      throw new Error('MANTENIMENT cambió durante la captura: no se ha sellado ninguna base.');
    const snapshotId = Utilities.getUuid();
    if (!/^[0-9a-f-]{36}$/i.test(snapshotId)) throw new Error('Identificador de base inválido');
    const bundle = metroSincro11PrepararPaquetes_(confirmation, snapshotId);
    // La cuota corresponde a DocumentProperties; no al libro de celdas.
    const ocupacion = Object.entries(props).reduce((n, [k,v]) => n + k.length + String(v).length, 0);
    const adicional = bundle.chunks.reduce((n,x) => n + x.key.length + x.content.length, 0) +
      METRO_SINCRO11.manifest.length + JSON.stringify(bundle.manifest).length;
    if (ocupacion + adicional > METRO_SINCRO11.maxPropertyStoreBytes)
      throw new Error('No hay espacio suficiente en propiedades. No se toca la hoja.');
    // Commit de dos fases: publicar el MANIFEST siempre al final.
    for (const part of bundle.chunks) store.setProperty(part.key, part.content);
    for (const part of bundle.chunks) {
      if (store.getProperty(part.key) !== part.content)
        throw new Error('Falta un paquete. Base INCOMPLETA, NO utilizar hasta revisar.');
    }
    store.setProperty(METRO_SINCRO11.manifest, JSON.stringify(bundle.manifest));
    return {
      resultado: 'BASE_SELLADA', fecha_base: bundle.manifest.recogido_en,
      filas: bundle.manifest.cantidad, paquetes: bundle.manifest.partes,
      checksum: bundle.manifest.checksum,
      escritura_en_hojas: false, envio_a_metroges: false,
    };
  });
}

function metroSincro11CargarBase_() {
  const store = metroSincro11Propiedades_();
  const content = store.getProperty(METRO_SINCRO11.manifest);
  if (!content) throw new Error('No hay base sellada. No se puede distinguir pasado y futuro.');
  const manifest = JSON.parse(content);
  if (manifest.version !== METRO_SINCRO11.version ||
      manifest.spreadsheet_id !== METRO_SINCRO11.spreadsheetId ||
      manifest.hoja !== METRO_SINCRO11.sheetName ||
      !/^[0-9a-f-]{36}$/i.test(manifest.snapshot_id) ||
      !Number.isInteger(manifest.partes) || manifest.partes < 1 || manifest.partes > 200 ||
      !Number.isInteger(manifest.cantidad) || manifest.cantidad < 1)
    throw new Error('Base incompatible; no aplicar ningún cambio');
  const sections = [];
  for (let i = 0; i < manifest.partes; i++) {
    const chunk = store.getProperty(METRO_SINCRO11.prefix + manifest.snapshot_id + '_' + i);
    if (!chunk) throw new Error('Base incompleta; falta el paquete ' + i);
    sections.push(chunk);
  }
  const serialized = sections.join('\n');
  if (metroSincro11Huella_(serialized) !== manifest.checksum) throw new Error('Base corrupta; huella distinta');
  const result = new Map();
  for (const line of serialized.split('\n')) {
    const match = /^(\d{1,15})\|([a-zA-Z0-9_-]{22})$/.exec(line);
    if (!match) throw new Error('Identidad o huella de base inválida');
    const id = metroSincro11HexId_(match[1]);
    if (!id || result.has(id)) throw new Error('Identidad duplicada en base');
    result.set(id, match[2]);
  }
  if (result.size !== manifest.cantidad) throw new Error('Cantidad de base inconsistente');
  return { manifest, rows: result };
}

function metroSincro11Comparar() {
  const base = metroSincro11CargarBase_();
  const live = metroSincro11Leer_();
  metroSincro11Validar_(live);
  const novedades = [], desaparecidas = [];
  for (const row of live.rows.values()) {
    if (!base.rows.has(row.id_fila)) {
      novedades.push({ tipo: 'ALTA_NUEVA', id_fila: row.id_fila, dfm: row.dfm, designacion: row.tipo });
    } else if (base.rows.get(row.id_fila) !== row.huella) {
      novedades.push({ tipo: 'CAMBIO_DESDE_BASE', id_fila: row.id_fila, dfm: row.dfm, designacion: row.tipo,
        // Sólo fechas informativas, NO comparaciones con el día del calendario.
        fecha_operativa_original_o_actual: row.fecha_necesidad });
    }
  }
  for (const id of base.rows.keys()) {
    if (!live.rows.has(id)) desaparecidas.push({ tipo: 'ID_FILA_AUSENTE', id_fila: id });
  }
  const sort = (a,b) => a.id_fila - b.id_fila;
  novedades.sort(sort); desaparecidas.sort(sort);
  return {
    resultado: 'PREVISION_SOLO_LECTURA', version: METRO_SINCRO11.version,
    fecha_base: base.manifest.recogido_en, fecha_observacion: new Date().toISOString(),
    filas_base: base.manifest.cantidad, filas_actuales: live.rows.size,
    modificaciones_o_altas: novedades.length, identidades_desaparecidas: desaparecidas.length,
    cambios: novedades.slice(0, METRO_SINCRO11.maxDetails),
    ausencias: desaparecidas.slice(0, METRO_SINCRO11.maxDetails),
    lista_parcial: novedades.length > METRO_SINCRO11.maxDetails || desaparecidas.length > METRO_SINCRO11.maxDetails,
    aviso: 'Cambio observado desde la base: NO demuestra autor humano ni equivale a T o PA nuevas. Requiere cotejo manual. No escribir en MANTENIMENT ni confirmar órdenes.',
    escritura_en_hojas: false, escritura_en_backend: false, autoriza_sincronizar: false,
  };
}

function metroSincro11Estado() {
  const store = metroSincro11Propiedades_();
  const has = !!store.getProperty(METRO_SINCRO11.manifest);
  if (!has) {
    const parcial = Object.keys(store.getProperties()).some(k => k.startsWith(METRO_SINCRO11.prefix));
    return { base_sellada: false, base_parcial_a_revisar: parcial,
      aviso: parcial ? 'BASE PARCIAL NO UTILIZABLE: revisar antes de repetir' : 'NO HAY BASE; no asumir que lo histórico sea nuevo' };
  }
  const loaded = metroSincro11CargarBase_();
  return {
    base_sellada: true, version: loaded.manifest.version,
    fecha_base: loaded.manifest.recogido_en, filas: loaded.manifest.cantidad,
    checksum: loaded.manifest.checksum,
    escritura_en_hojas: false, autoriza_sincronizar: false,
  };
}