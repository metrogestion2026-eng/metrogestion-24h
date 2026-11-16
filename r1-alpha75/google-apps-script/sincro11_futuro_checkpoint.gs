/**
 * METROGES · SINCRO 11 · REFERENCIA FUTURA F2 (CANDIDATA NO INSTALADA).
 * Para añadir como un archivo .gs NUEVO al proyecto vinculado a MANTENIMIENTOS.
 * NO reemplaza el módulo V1 ya sellado, ni onEdit, ni el sincronizador Alpha75.
 * NO escribe en MANTENIMENT ni TANCAMENT, no envía HTTP, no crea T o PA.
 *
 * PREVISUALIZAR: metroSincro11F2Previsualizar()          -> SOLO LECTURA.
 * COMPARAR:      metroSincro11F2Comparar()               -> SOLO LECTURA.
 * ESTADO:        metroSincro11F2Estado()                 -> SOLO LECTURA.
 * CREAR REF.:    metroSincro11F2CrearReferencia_(codigo) -> SOLO CON AUTORIZACIÓN
 *                EXPLÍCITA FUTURA, no aparece como comando de menú.
 *
 * La nueva referencia F2 empezaría desde su propia fecha de captura; NO
 * reconstruye ni reemplaza retroactivamente la base V1 del 16/11/2026.
 * Por precaución todas las diferencias quedan SIN APROBAR/SIN SINCRONIZAR.
 */
const METRO_SINCRO11_F2 = Object.freeze({
  version: 'sincro11-futuro-checkpoint-20261116.1',
  spreadsheetId: '1PQE5VsjTvDFvQZcqedyQKIs3RbSySHFK4JPQXBD0XyU',
  sheetName: 'MANTENIMENT',
  idColumnIndex: 19, columnCount: 26, maxRows: 25000,
  corteUtc: '2026-11-15T23:00:00.000Z',
  v1Manifest: 'MG11_BASE_V1_MANIFEST',
  f2Prefix: 'MG11_F2_CHECKPOINT_',
  f2Manifest: 'MG11_F2_CHECKPOINT_MANIFEST',
  rowsPerChunk: 160,
  maxPropertyValueBytes: 8000,
  maxStoreBytes: 430000,
  maxDetails: 100,
  // No introducir esta cadena en una función ejecutable automáticamente.
  confirmacion: 'CONFIRMO_REFERENCIA_FUTURA_F2_NO_OPERATIVA',
});

function metroSincro11F2Propiedades_() {
  const store = PropertiesService.getDocumentProperties();
  if (!store) throw new Error('F2: el proyecto debe estar vinculado a MANTENIMIENTOS. Sin DocumentProperties.');
  return store;
}

function metroSincro11F2Id_(v) {
  const s = String(v == null ? '' : v).trim();
  if (!/^\d{1,15}$/.test(s)) return 0;
  const n = Number(s);
  return Number.isSafeInteger(n) && n > 0 ? n : 0;
}

function metroSincro11F2Canon_(value) {
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) throw new Error('F2: fecha de celda inválida.');
    return ['DATE', value.toISOString()];
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('F2: número de celda inválido.');
    return ['NUMBER', value];
  }
  if (typeof value === 'boolean') return ['BOOLEAN', value];
  if (value === undefined || value === null) return ['EMPTY', ''];
  if (typeof value !== 'string') throw new Error('F2: tipo de celda incompatible.');
  return ['STRING', value];
}

function metroSincro11F2Hash_(text) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8);
  return Utilities.base64EncodeWebSafe(bytes.slice(0, 16)).replace(/=+$/g, '');
}

function metroSincro11F2Leer_() {
  const libro = SpreadsheetApp.openById(METRO_SINCRO11_F2.spreadsheetId);
  if (!libro || libro.getId() !== METRO_SINCRO11_F2.spreadsheetId)
    throw new Error('F2: no se acredita el archivo madre de MANTENIMENT.');
  const hoja = libro.getSheetByName(METRO_SINCRO11_F2.sheetName);
  if (!hoja || hoja.getName() !== METRO_SINCRO11_F2.sheetName || hoja.getMaxColumns() < 26)
    throw new Error('F2: pestaña MANTENIMENT o columnas no acreditadas.');
  const last = hoja.getLastRow();
  if (last < 2 || last > METRO_SINCRO11_F2.maxRows)
    throw new Error('F2: cantidad de filas fuera de límites.');
  const n = last - 1;
  const rango = hoja.getRange(2, 1, n, METRO_SINCRO11_F2.columnCount);
  const values = rango.getValues();
  const formulas = rango.getFormulas();
  const notes = rango.getNotes();
  if (values.length !== n || formulas.length !== n || notes.length !== n)
    throw new Error('F2: fotografía incompleta.');
  const ids = new Map();
  let formulasExcluidas = 0, notesCount = 0;
  for (let i = 0; i < n; i++) {
    const v = values[i], f = formulas[i], notas = notes[i];
    if (!Array.isArray(v) || !Array.isArray(f) || !Array.isArray(notas) ||
        v.length !== 26 || f.length !== 26 || notas.length !== 26)
      throw new Error('F2: fila incompleta; no autorizar ninguna escritura.');
    const id = metroSincro11F2Id_(v[METRO_SINCRO11_F2.idColumnIndex]);
    if (!id) throw new Error('F2: ID_FILA de columna T inválida o ausente.');
    if (ids.has(id)) throw new Error('F2: ID_FILA duplicado, no se elige la primera fila.');
    const registro = [];
    for (let col = 0; col < 26; col++) {
      if (col === METRO_SINCRO11_F2.idColumnIndex) continue;
      const formula = String(f[col] || '');
      const nota = String(notas[col] || '');
      if (nota) notesCount++;
      // Una fórmula no se compara por su A1 ni por el valor recalculado.
      const dato = formula ? ['FORMULA_NO_OPERATIVA'] : metroSincro11F2Canon_(v[col]);
      if (formula) formulasExcluidas++;
      registro.push([col + 1, dato, nota]);
    }
    ids.set(id, metroSincro11F2Hash_(JSON.stringify(registro)));
  }
  return { ids, formulasExcluidas, notesCount, capturada_en: new Date().toISOString() };
}

function metroSincro11F2Ordenar_(ids) {
  return [...ids.entries()].sort((a,b) => a[0] - b[0])
    .map(pair => pair[0] + '|' + pair[1]).join('\n');
}

function metroSincro11F2ValidarV1_(store) {
  const v1 = store.getProperty(METRO_SINCRO11_F2.v1Manifest);
  if (!v1) throw new Error('F2: no existe la base V1 sellada. Detener; NO crear otra V1.');
  let obj;
  try { obj = JSON.parse(v1); } catch (_) { throw new Error('F2: manifiesto V1 incompatible.'); }
  if (obj.spreadsheet_id !== METRO_SINCRO11_F2.spreadsheetId ||
      obj.hoja !== METRO_SINCRO11_F2.sheetName ||
      !Number.isInteger(obj.cantidad) || obj.cantidad < 1 ||
      typeof obj.checksum !== 'string' || !obj.checksum)
    throw new Error('F2: manifiesto V1 no acreditado; se preserva sin cambios.');
  return { version: obj.version, filas: obj.cantidad, fecha: obj.recogido_en, checksum: obj.checksum };
}

function metroSincro11F2Paquetes_(snapshot) {
  const serializado = metroSincro11F2Ordenar_(snapshot.ids);
  const filas = serializado.split('\n');
  const parts = [];
  for (let i = 0; i < filas.length; i += METRO_SINCRO11_F2.rowsPerChunk) {
    const chunk = filas.slice(i, i + METRO_SINCRO11_F2.rowsPerChunk).join('\n');
    if (chunk.length > METRO_SINCRO11_F2.maxPropertyValueBytes)
      throw new Error('F2: paquete demasiado grande, no publicar referencia.');
    parts.push(chunk);
  }
  return { serializado, parts, checksum: metroSincro11F2Hash_(serializado) };
}

function metroSincro11F2Previsualizar() {
  const store = metroSincro11F2Propiedades_();
  const v1 = metroSincro11F2ValidarV1_(store);
  const foto = metroSincro11F2Leer_();
  const props = store.getProperties();
  const existe = !!props[METRO_SINCRO11_F2.f2Manifest];
  const parcial = !existe && Object.keys(props).some(k => k.startsWith(METRO_SINCRO11_F2.f2Prefix));
  const paquete = metroSincro11F2Paquetes_(foto);
  const occupied = Object.entries(props).reduce((n, [k,v]) => n + k.length + String(v).length, 0);
  const bytes = paquete.parts.reduce((n,p) => n + p.length + METRO_SINCRO11_F2.f2Prefix.length + 48, 0);
  return {
    version: METRO_SINCRO11_F2.version, filas: foto.ids.size,
    notas: foto.notesCount, formulas_ignoradas: foto.formulasExcluidas,
    v1_existente: true, v1_filas: v1.filas, v1_checksum: v1.checksum,
    referencia_f2_existente: existe, referencia_f2_parcial: parcial,
    capacidad_estimada_suficiente: occupied + bytes + 500 < METRO_SINCRO11_F2.maxStoreBytes,
    fecha_lectura: foto.capturada_en,
    // La previsualización NUNCA crea una referencia ni autoriza algo.
    propiedades_modificadas: false, hojas_modificadas: false, autoriza_sincronizar: false,
  };
}

function metroSincro11F2Estado() {
  const store = metroSincro11F2Propiedades_();
  const v1 = metroSincro11F2ValidarV1_(store);
  const props = store.getProperties();
  const manifestText = props[METRO_SINCRO11_F2.f2Manifest];
  const parcial = !manifestText && Object.keys(props).some(k => k.startsWith(METRO_SINCRO11_F2.f2Prefix));
  if (!manifestText) return {
    v1_preservada: true, v1_filas: v1.filas,
    referencia_f2_existente: false, referencia_f2_parcial: parcial,
    aviso: parcial ? 'Hay paquetes F2 incompletos: detener y revisar, no reintentar a ciegas.' : 'Referencia futura F2 aún no creada.',
    autoriza_sincronizar: false,
  };
  const loaded = metroSincro11F2Cargar_(store);
  return { v1_preservada: true, v1_filas: v1.filas, referencia_f2_existente: true,
    fecha_f2: loaded.manifest.capturada_en, filas_f2: loaded.manifest.filas,
    checksum_f2: loaded.manifest.checksum, autoriza_sincronizar: false };
}

function metroSincro11F2Cargar_(store) {
  const raw = store.getProperty(METRO_SINCRO11_F2.f2Manifest);
  if (!raw) throw new Error('F2: falta la referencia futura; no se puede comparar.');
  let manifest;
  try { manifest = JSON.parse(raw); } catch (_) { throw new Error('F2: manifiesto F2 no válido.'); }
  if (manifest.version !== METRO_SINCRO11_F2.version ||
      manifest.spreadsheet_id !== METRO_SINCRO11_F2.spreadsheetId ||
      manifest.hoja !== METRO_SINCRO11_F2.sheetName ||
      !Number.isInteger(manifest.filas) || manifest.filas < 1 ||
      !Number.isInteger(manifest.partes) || manifest.partes < 1 || manifest.partes > 200 ||
      typeof manifest.capturada_en !== 'string' ||
      !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(manifest.capturada_en) ||
      !Number.isFinite(Date.parse(manifest.capturada_en)) ||
      manifest.capturada_en < METRO_SINCRO11_F2.corteUtc)
    throw new Error('F2: referencia F2 incompatible o anterior al corte.');
  const parts = [];
  for (let i = 0; i < manifest.partes; i++) {
    const part = store.getProperty(METRO_SINCRO11_F2.f2Prefix + manifest.captura_id + '_' + i);
    if (!part) throw new Error('F2: falta paquete ' + i + ' de referencia; bloquear.');
    parts.push(part);
  }
  const serializado = parts.join('\n');
  if (metroSincro11F2Hash_(serializado) !== manifest.checksum)
    throw new Error('F2: referencia alterada; checksum incorrecto.');
  const ids = new Map();
  for (const line of serializado.split('\n')) {
    const match = /^(\d{1,15})\|([A-Za-z0-9_-]{22})$/.exec(line);
    if (!match) throw new Error('F2: registro o huella corruptos.');
    const id = metroSincro11F2Id_(match[1]);
    if (!id || ids.has(id)) throw new Error('F2: duplicado o ID inválido en referencia.');
    ids.set(id, match[2]);
  }
  if (ids.size !== manifest.filas) throw new Error('F2: cantidad de referencia distinta.');
  return {manifest, ids};
}

/**
 * Única escritura posible de esta candidata: propiedades DOCUMENTALES F2.
 * No la invoque desde los menús; requiere pasar el código exacto como argumento
 * desde una decisión futura y autorizada. NO re-sella V1 y NO inicia sync.
 */
function metroSincro11F2CrearReferencia_(codigo) {
  if (codigo !== METRO_SINCRO11_F2.confirmacion)
    throw new Error('F2: falta autorización explícita para nueva referencia futura. No se ha escrito nada.');
  const lock = LockService.getDocumentLock();
  if (!lock || !lock.tryLock(2500)) throw new Error('F2: referencia ocupada; detener.');
  try {
    const store = metroSincro11F2Propiedades_();
    const v1 = metroSincro11F2ValidarV1_(store);
    const props = store.getProperties();
    if (props[METRO_SINCRO11_F2.f2Manifest] ||
        Object.keys(props).some(k => k.startsWith(METRO_SINCRO11_F2.f2Prefix)))
      throw new Error('F2: ya existe referencia F2 o restos parciales. NO sobrescribir.');
    const foto1 = metroSincro11F2Leer_();
    const foto2 = metroSincro11F2Leer_();
    const first = metroSincro11F2Ordenar_(foto1.ids);
    const second = metroSincro11F2Ordenar_(foto2.ids);
    if (first !== second) throw new Error('F2: hubo cambios entre las fotografías, no guardar nada.');
    if (foto2.capturada_en < METRO_SINCRO11_F2.corteUtc)
      throw new Error('F2: captura anterior al corte; detener.');
    const paquete = metroSincro11F2Paquetes_(foto2);
    const id = Utilities.getUuid();
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error('F2: UUID de referencia no válido.');
    const parts = paquete.parts.map((value,index)=>({key:METRO_SINCRO11_F2.f2Prefix + id + '_' + index,value}));
    const manifest = {
      version: METRO_SINCRO11_F2.version,
      spreadsheet_id: METRO_SINCRO11_F2.spreadsheetId, hoja: METRO_SINCRO11_F2.sheetName,
      captura_id: id, capturada_en: foto2.capturada_en,
      filas: foto2.ids.size, partes: parts.length, checksum: paquete.checksum,
      v1_checksum: v1.checksum,
    };
    const bytesExistentes = Object.entries(props).reduce((n,[k,v])=>n+k.length+String(v).length,0);
    const bytesNuevos = parts.reduce((n,p)=>n+p.key.length+p.value.length,0)+
      METRO_SINCRO11_F2.f2Manifest.length+JSON.stringify(manifest).length;
    if (bytesExistentes + bytesNuevos > METRO_SINCRO11_F2.maxStoreBytes)
      throw new Error('F2: capacidad de DocumentProperties insuficiente. No escribir.');
    // Commit en dos fases; V1 jamás se escribe o borra. Manifiesto F2 al final.
    for (const part of parts) store.setProperty(part.key, part.value);
    for (const part of parts) if (store.getProperty(part.key) !== part.value)
      throw new Error('F2: escritura incompleta. No utilizar sin revisión.');
    store.setProperty(METRO_SINCRO11_F2.f2Manifest, JSON.stringify(manifest));
    return {resultado:'REFERENCIA_F2_CREADA',v1_preservada:true,filas_f2:manifest.filas,
      fecha_f2:manifest.capturada_en,checksum_f2:manifest.checksum,
      hojas_modificadas:false,escritura_en_backend:false,autoriza_sincronizar:false};
  } finally { lock.releaseLock(); }
}

function metroSincro11F2Comparar() {
  const store = metroSincro11F2Propiedades_();
  const v1 = metroSincro11F2ValidarV1_(store);
  const base = metroSincro11F2Cargar_(store);
  if (base.manifest.v1_checksum !== v1.checksum)
    throw new Error('F2: la referencia V1 ha cambiado; detener.');
  const live = metroSincro11F2Leer_();
  if (live.capturada_en < base.manifest.capturada_en)
    throw new Error('F2: observación anterior a referencia.');
  const nuevas = [], cambios = [], ausencias = [];
  for (const [id,hash] of live.ids) {
    if (!base.ids.has(id)) nuevas.push({id_fila:id,clase:'ALTA_NO_CONFIRMADA'});
    else if (base.ids.get(id) !== hash) cambios.push({id_fila:id,clase:'CONTENIDO_DISTINTO_PENDIENTE_DE_COTEJO'});
  }
  for (const id of base.ids.keys())
    if (!live.ids.has(id)) ausencias.push({id_fila:id,clase:'AUSENCIA_REQUIERE_REVISION'});
  for (const arr of [nuevas,cambios,ausencias]) arr.sort((a,b)=>a.id_fila-b.id_fila);
  const limit = METRO_SINCRO11_F2.maxDetails;
  return {
    resultado:'SOLO_LECTURA_FUTURA_NO_AUTORIZADA',
    fecha_referencia:base.manifest.capturada_en,
    fecha_observacion:live.capturada_en,
    filas_referencia:base.ids.size,filas_actuales:live.ids.size,
    altas_nuevas:nuevas.length,cambios_observados:cambios.length,
    identidades_ausentes:ausencias.length,
    altas:nuevas.slice(0,limit),cambios:cambios.slice(0,limit),ausencias:ausencias.slice(0,limit),
    lista_parcial:nuevas.length>limit||cambios.length>limit||ausencias.length>limit,
    notas_leidas:live.notesCount,formulas_no_operativas:live.formulasExcluidas,
    origen_humano_acreditado:false,fecha_exacta_de_edicion_acreditada:false,
    permite_crear_T:false,permite_crear_PA:false,
    autoriza_sincronizar:false,escritura_en_hojas:false,escritura_en_backend:false,
    aviso:'La referencia F2 no es V1. Una diferencia no demuestra autoría ni fecha de edición; confirmar antes de cualquier futura sincronización.'
  };
}