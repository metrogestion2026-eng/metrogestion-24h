const METROGESTION = Object.freeze({
  spreadsheetId: '1PQE5VsjTvDFvQZcqedyQKIs3RbSySHFK4JPQXBD0XyU',
  spreadsheetName: 'MANTENIMIENTOS',
  sheetName: 'MANTENIMENT',
  archivoFlotaFolderId: '1dh2MBTf3KctAh6KvaisAWa-F895ta7YO',
  syncUrl: 'https://aemoouldgguyjsxrfuwo.supabase.co/functions/v1/manteniment-sync-r1',
  scriptVersion: 'alpha75-2026.09.17.3',
  tokenProperty: 'METROGESTION_SYNC_TOKEN',
  triggerHandler: 'metrogestionSincronizarProgramada',
});

const METROGESTION_EXECUTION_CACHE = new Map();

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Metrogestión')
    .addItem('Guardar clave de conexión', 'metrogestionGuardarClave')
    .addItem('Sincronizar ahora', 'metrogestionSincronizarAhora')
    .addSeparator()
    .addItem('Instalar actualización cada 6 horas', 'metrogestionInstalarActualizacion')
    .addItem('Vista previa de próximas necesidades', 'metrogestionPreverNecesidades')
    .addItem('Pausar / reanudar próximas necesidades', 'metrogestionPausarNecesidades')
    .addItem('Ver estado local', 'metrogestionVerEstadoLocal')
    .addToUi();
}

function metrogestionGuardarClave() {
  const ui = SpreadsheetApp.getUi();
  const response = ui.prompt(
    'Metrogestión · conexión protegida',
    'Pega la clave generada por Alpha68. Se guardará en las Propiedades del script y no en ninguna celda.',
    ui.ButtonSet.OK_CANCEL
  );
  if (response.getSelectedButton() !== ui.Button.OK) return;
  const token = response.getResponseText().trim();
  if (!/^mg_[0-9a-f]{64}$/i.test(token)) {
    ui.alert('La clave no tiene el formato esperado. No se ha guardado nada.');
    return;
  }
  PropertiesService.getScriptProperties().setProperty(METROGESTION.tokenProperty, token);
  ui.alert('Clave guardada. Ya puedes ejecutar “Sincronizar ahora”.');
}

function metrogestionSincronizarProgramada() {
  metrogestionLanzarProgramada_();
}

function metrogestionInstalarActualizacion() {
  const ui = SpreadsheetApp.getUi();
  if (!metrogestionLeerToken_()) {
    ui.alert('Primero debes guardar la clave de conexión.');
    return;
  }
  ScriptApp.getProjectTriggers()
    .filter(trigger => trigger.getHandlerFunction() === METROGESTION.triggerHandler)
    .forEach(trigger => ScriptApp.deleteTrigger(trigger));
  ScriptApp.newTrigger(METROGESTION.triggerHandler)
    .timeBased()
    .everyHours(6)
    .create();
  PropertiesService.getScriptProperties().setProperty('METROGESTION_TRIGGER_INSTALADO_EN', new Date().toISOString());
  ui.alert('Actualización automática instalada. Se ejecutará cada seis horas.');
}

function metrogestionVerEstadoLocal() {
  const props = PropertiesService.getScriptProperties();
  const token = metrogestionLeerToken_();
  const triggers = ScriptApp.getProjectTriggers()
    .filter(trigger => trigger.getHandlerFunction() === METROGESTION.triggerHandler).length;
  const lastAt = props.getProperty('METROGESTION_ULTIMA_EJECUCION') || 'sin ejecución';
  const lastResult = props.getProperty('METROGESTION_ULTIMO_RESULTADO') || 'sin resultado';
  SpreadsheetApp.getUi().alert([
    `Versión del script: ${METROGESTION.scriptVersion}`,
    `Clave: ${token ? 'guardada' : 'no guardada'}`,
    `Disparador activo: ${triggers ? 'sí' : 'no'}`,
    `Última ejecución: ${lastAt}`,
    `Resultado: ${lastResult}`,
  ].join('\n'));
}

function metrogestionSolicitarCiclo_(sheet, modo, token) {
const lastRow = sheet.getLastRow();
if (lastRow < 2) throw new Error('MANTENIMENT no contiene filas de datos.');
const values = sheet.getRange(1, 1, lastRow, 17).getDisplayValues();
const notes = sheet.getRange(1, 1, lastRow, 1).getNotes();
const workNotes = sheet.getRange(1, 5, lastRow, 1).getNotes();
// A (DFM/R) amarillo fuerza la inclusión de la necesidad aunque su fecha
// quede fuera de la ventana ordinaria de un mes.
const priorityBackgrounds = sheet.getRange(1, 1, lastRow, 1).getBackgrounds();
// H (MANTENIMENT) es la referencia visual del estado de la necesidad:
// blanco = pendiente; cualquier otro fondo = ya clasificada/no pendiente.
const workBackgrounds = sheet.getRange(1, 8, lastRow, 1).getBackgrounds();
// G solo representa el tipo de trabajo cuando no está amarilla. Una G
// amarilla contiene un pedido (actual 2600…, heredado P-… o PEDIDO).
const orderBackgrounds = sheet.getRange(1, 7, lastRow, 1).getBackgrounds();
metrogestionValidarCabeceras_(values[0]);
const rows = [];
for (let index = 1; index < values.length; index += 1) {
  const row = values[index];
  if (metrogestionNormalizar_(row[7]) !== 'ALTA') continue;
  rows.push({
    fila: index + 1,
    dfm: row[0],
    matricula: row[1],
    tipo: row[2],
    upc: row[3],
    telefono: row[5],
    contrato: row[6],
    estado: row[7],
    fecha_matriculacion: metrogestionFechaIso_(row[8], 'matriculación'),
    fecha_alta: metrogestionFechaIso_(row[9], 'alta en delegación'),
    asignacion: row[13],
    marca: row[14],
    bastidor: row[16],
  });
}
const paradas = metrogestionLeerParadasVinculadas_(values, notes);
const trabajos = metrogestionLeerTrabajos_(
  values,
  workNotes,
  workBackgrounds,
  priorityBackgrounds,
  metrogestionFechaCorteTrabajos_(),
  orderBackgrounds
);
const modifiedAt = DriveApp.getFileById(METROGESTION.spreadsheetId).getLastUpdated();
const generatedAt = new Date();
const payload = {
  spreadsheet_id: METROGESTION.spreadsheetId,
  spreadsheet_name: METROGESTION.spreadsheetName,
  hoja: METROGESTION.sheetName,
  modo,
  version_script: METROGESTION.scriptVersion,
  generado_en: generatedAt.toISOString(),
  archivo_modificado_en: modifiedAt.toISOString(),
  filas: rows,
  paradas,
  trabajos,
};
payload.checksum = metrogestionSha256_(JSON.stringify({ filas: rows, paradas, trabajos }));
const response = UrlFetchApp.fetch(METROGESTION.syncUrl, {
  method: 'post',
  contentType: 'application/json',
  payload: JSON.stringify({ token, payload }),
  muteHttpExceptions: true,
  followRedirects: false,
});
const code = response.getResponseCode();
const body = response.getContentText();
let result;
try {
  result = JSON.parse(body);
} catch (error) {
  throw new Error(`Supabase devolvió una respuesta no válida (${code}).`);
}
if (code < 200 || code >= 300) {
  throw new Error(result.message || result.error || `Error HTTP ${code}.`);
}
if (result?.ok !== true) throw new Error(result?.error || 'La base de datos rechazó la sincronización.');
const syncResult = result.resultado || {};
return { syncResult, trabajos };
}

function metrogestionSuspenderFiltro_(sheet) {
  const filter = sheet.getFilter();
  if (!filter) return null;
  const range = filter.getRange();
  const startColumn = range.getColumn();
  const endColumn = range.getLastColumn();
  const criteria = [];
  for (let column = startColumn; column <= endColumn; column += 1) {
    const criterion = filter.getColumnFilterCriteria(column);
    if (criterion) criteria.push({ column, criterion });
  }
  const state = {
    startRow: range.getRow(),
    startColumn,
    numRows: range.getNumRows(),
    numColumns: range.getNumColumns(),
    maxRows: sheet.getMaxRows(),
    criteria,
  };
  filter.remove();
  SpreadsheetApp.flush();
  return state;
}

function metrogestionRestaurarFiltro_(sheet, state) {
  if (!state) return;
  const current = sheet.getFilter();
  if (current) current.remove();
  const addedRows = Math.max(0, sheet.getMaxRows() - state.maxRows);
  const availableRows = sheet.getMaxRows() - state.startRow + 1;
  const numRows = Math.min(availableRows, state.numRows + addedRows);
  if (numRows < 1) return;
  const filter = sheet
    .getRange(state.startRow, state.startColumn, numRows, state.numColumns)
    .createFilter();
  state.criteria.forEach(item => {
    filter.setColumnFilterCriteria(item.column, item.criterion);
  });
  SpreadsheetApp.flush();
}

function metrogestionLeerToken_() {
  return (PropertiesService.getScriptProperties().getProperty(METROGESTION.tokenProperty) || '').trim();
}

function metrogestionAsegurarProteccionColumnasAuxiliares_(sheet) {
  const description = 'METROGESTION · R/S calculadas exclusivamente desde J';
  const existing = sheet
    .getProtections(SpreadsheetApp.ProtectionType.RANGE)
    .find(protection => protection.getDescription() === description);
  if (existing) {
    if (existing.isWarningOnly()) existing.setWarningOnly(false);
    return existing;
  }
  return sheet.getRange('R:S')
    .protect()
    .setDescription(description)
    .setWarningOnly(false);
}

function metrogestionValidarCabeceras_(headers) {
  const expected = {
    0: 'DFM',
    1: 'MATRI',
    2: 'TIPO',
    3: 'UPC/INC',
    5: 'LUGAR/TALLER/TEL',
    6: 'PEDIDO/NOTA/FIN CONTRA',
    7: 'MANTENIMENT',
    8: 'PROGRAMAT',
    13: 'ASSIGNAT',
    14: 'MARCA',
    16: 'ALBARA / ENTRADA',
  };
  Object.keys(expected).forEach(key => {
    const column = Number(key);
    if (metrogestionNormalizar_(headers[column]) !== expected[column]) {
      throw new Error(`La estructura de MANTENIMENT ha cambiado en la columna ${column + 1}. No se envía ningún dato.`);
    }
  });
}

function metrogestionNormalizar_(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function metrogestionFechaIso_(value, label) {
  const text = String(value || '').trim();
  if (!text) return '';
  let match = text.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (match) return `${match[3]}-${match[2]}-${match[1]}`;
  match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) return text;
  throw new Error(`Fecha de ${label || 'MANTENIMENT'} no válida: ${text}`);
}

function metrogestionNumero_(value, label, ignorarNegativoDePeriodoAbierto) {
  let text = String(value || '').replace(/\s/g, '');
  if (!text) return '';
  if (text.includes(',') && text.includes('.')) text = text.replaceAll('.', '').replace(',', '.');
  else text = text.replace(',', '.');
  const number = Number(text);
  if (!Number.isFinite(number)) throw new Error(`${label} no contiene un número válido: ${value}`);
  if (number < 0 && ignorarNegativoDePeriodoAbierto) return '';
  if (number < 0) throw new Error(`${label} no contiene un número válido: ${value}`);
  return number;
}

function metrogestionKilometrosFacturables_(value, rowNumber, periodoAbierto) {
  const status = metrogestionNormalizar_(value);
  // Algunas plantillas históricas reservan P para el control validado OK/KO.
  // Ese estado pertenece a MANTENIMENT: se conserva en la hoja y no se envía
  // como kilometraje a Metrogestión.
  if (status === 'OK' || status === 'KO') return '';
  return metrogestionNumero_(value, `Los kilómetros de la fila ${rowNumber}`, periodoAbierto);
}

function metrogestionPeriodoTancament_(value, rowNumber) {
  const text = metrogestionNormalizar_(value);
  if (!text) return '';
  // Q también contiene enlaces y referencias documentales como FOTO u OR-….
  // Solo un valor que empiece por TANCAMENT pertenece al cierre facturable.
  if (!text.startsWith('TANCAMENT')) return '';
  if (!/^TANCAMENT \d+$/.test(text)) {
    throw new Error(`TANCAMENT de la fila ${rowNumber} debe ir seguido del número de periodo.`);
  }
  return text;
}

function metrogestionLeerParadasVinculadas_(values, notes) {
  const result = [];
  for (let index = 1; index < values.length; index += 1) {
    const note = String(notes[index]?.[0] || '').trim();
    const match = note.match(/^METROGESTION_PARADA:([0-9a-f-]{36})$/i);
    if (!match) continue;
    const row = values[index];
    const estado = metrogestionNormalizar_(row[7]);
    if (!['PARADA', 'ANULADA'].includes(estado)) {
      throw new Error(`La fila vinculada ${index + 1} debe conservar MANTENIMENT = PARADA o ANULADA.`);
    }
    if (estado === 'ANULADA') {
      result.push({
        fila: index + 1,
        sync_id: match[1],
        estado,
      });
      continue;
    }
    const fechaK = metrogestionFechaIso_(row[10], `de recuperación o corte de la fila ${index + 1}`);
    const periodoAbierto = !fechaK;
    result.push({
      fila: index + 1,
      sync_id: match[1],
      dfm: row[0],
      matricula: row[1],
      tipo: row[2],
      upc: row[3],
      numero_parada: row[4],
      sustituto: row[6],
      estado,
      fecha_programada: metrogestionFechaIso_(row[8], `programada de la fila ${index + 1}`),
      fecha_parada: metrogestionFechaIso_(row[9], `de parada de la fila ${index + 1}`),
      fecha_k: fechaK,
      dias_parada: metrogestionNumero_(row[11], `Los días de la fila ${index + 1}`, periodoAbierto),
      marca: row[14],
      km_facturables: metrogestionKilometrosFacturables_(row[15], index + 1, periodoAbierto),
      tancament: metrogestionPeriodoTancament_(row[16], index + 1),
    });
  }
  return result;
}

function metrogestionNotaTrabajoId_(note) {
  const match = String(note || '').match(/(?:^|\n)METROGESTION_T:([0-9a-f-]{36})(?:\n|$)/i);
  return match ? match[1] : '';
}

function metrogestionClaveFilaTrabajo_(row, pedidoEnG) {
  const designacion = metrogestionNormalizar_(row[7]);
  const noEsTrabajo = new Set([
    'ALTA', 'BAJA', 'PARADA', 'ANULADA', 'FIN', 'ARCHIVO', 'CARPETA', 'PRIMITIVA',
    'TANCAMENT', 'MITJANA', 'CANVI',
  ]);
  if (!designacion || noEsTrabajo.has(designacion)) return '';
  return [
    metrogestionNormalizar_(row[0]),
    metrogestionNormalizar_(row[1]),
    metrogestionNormalizar_(row[5]),
    pedidoEnG ? '' : metrogestionNormalizar_(row[6]),
    designacion,
    metrogestionFechaIso_(row[8], 'de necesidad'),
  ].join('|');
}

function metrogestionFechaCorteTrabajos_() {
  // Un mes natural nunca supera 31 días. El filtrado definitivo, ligado a la
  // fecha de creación de cada parada, vuelve a aplicarse de forma autoritativa
  // en Supabase.
  const horizon = new Date(Date.now() + (31 * 24 * 60 * 60 * 1000));
  return Utilities.formatDate(horizon, 'Europe/Madrid', 'yyyy-MM-dd');
}

function metrogestionEsFondoBlanco_(value) {
  const color = String(value || '').trim().toLowerCase();
  return color === '' || color === '#ffffff' || color === '#fff';
}

function metrogestionEsFondoAmarillo_(value) {
  const color = String(value || '').trim().toLowerCase();
  return new Set(['#ffff00', '#ff0', '#fff2cc', '#ffe599', '#ffd966']).has(color);
}

function metrogestionEsNumeroParada_(value) {
  return /^PA-\d+$/.test(metrogestionNormalizar_(value));
}

function metrogestionLeerTrabajos_(
  values,
  workNotes,
  workBackgrounds,
  priorityBackgrounds,
  fechaCorteIso,
  orderBackgrounds
) {
  // TANCAMENT, MITJANA y CANVI son líneas auxiliares de cálculo de MANTENIMENT.
  // Aunque contienen una fecha en I, sus columnas J/K/L son métricas y no
  // representan la realización o recogida de una T.
  const ignored = new Set([
    'ALTA', 'BAJA', 'PARADA', 'ANULADA', 'FIN', 'ARCHIVO', 'CARPETA', 'PRIMITIVA',
    'TANCAMENT', 'MITJANA', 'CANVI',
  ]);
  const result = [];
  for (let index = 1; index < values.length; index += 1) {
    const row = values[index];
    const dfm = metrogestionNormalizar_(row[0]);
    const designacion = metrogestionNormalizar_(row[7]);
    // Alpha75 admite tanto semirremolques R como tractoras y rígidos DFM.
    // Una línea sin unidad identificable no puede crear una actuación segura.
    if (!dfm) continue;
    if (!designacion || ignored.has(designacion) || !String(row[8] || '').trim()) continue;
    const trabajoSyncId = metrogestionNotaTrabajoId_(workNotes[index]?.[0]);
    const numeroParadaHoja = String(row[4] || '').trim();
    // Las referencias antiguas de E (HD…, GP…, M…, etc.) no son paradas.
    // Solo PA-… puede vincular una necesidad con una ficha de Hotel.
    const numeroParadaValido = metrogestionEsNumeroParada_(numeroParadaHoja);
    // Si E ya contiene una referencia histórica distinta de PA-…, la fila es
    // anterior a Metrogestión y no debe incorporarse a Hotel ni recibir una
    // actuación nueva, aunque A conserve el antiguo fondo amarillo.
    if (numeroParadaHoja && !numeroParadaValido && !trabajoSyncId) continue;
    const numeroParada = numeroParadaValido ? numeroParadaHoja : '';
    const pedidoEnG = metrogestionEsFondoAmarillo_(orderBackgrounds?.[index]?.[0]);
    const pedido = pedidoEnG ? String(row[6] || '').trim() : '';
    let tipoTrabajo = pedidoEnG ? '' : row[6];
    if (designacion === 'LKT') {
      const frio = metrogestionMarcaFrio_(row[14]);
      if (frio) tipoTrabajo = frio === 'CARRIER' ? 'TRÁMITE' : 'GESTIÓN';
    }
    const fechaNecesidad = metrogestionFechaIso_(row[8], `de necesidad de la fila ${index + 1}`);
    const fechaRealizada = metrogestionFechaIso_(row[9], `de realización de la fila ${index + 1}`);
    // Solo la nota técnica confirma que la necesidad ya está vinculada. Tener
    // un número en E no convierte una línea histórica realizada en pendiente.
    const vinculada = Boolean(trabajoSyncId);
    const fechaRecogida = metrogestionFechaIso_(row[10], `de recogida de la fila ${index + 1}`);
    const cierreFisicoPendiente = metrogestionCierreFisico_(designacion) && !fechaRecogida;
    const pendienteFondoBlanco = metrogestionEsFondoBlanco_(workBackgrounds?.[index]?.[0]);
    const prioridadFondoAmarillo = metrogestionEsFondoAmarillo_(priorityBackgrounds?.[index]?.[0]);

    // H manda sobre cualquier otra señal visual: si tiene color, la necesidad
    // ya está clasificada o realizada y no vuelve a entrar. El amarillo de A
    // solo elimina el límite de fecha para una H que continúa blanca.
    // Una H coloreada puede corresponder a una necesidad pendiente que ya está
    // en Hotel. Si conserva número de actuación en E y J sigue vacío, también
    // se envía para completar o reparar su enlace técnico.
    const pendienteYaEnHotel = !vinculada && Boolean(numeroParada) && !fechaRealizada;
    if (!pendienteFondoBlanco && !pendienteYaEnHotel) continue;
    if (!vinculada && fechaRealizada && !cierreFisicoPendiente) continue;
    if (!vinculada && !prioridadFondoAmarillo && fechaCorteIso && fechaNecesidad > fechaCorteIso) continue;
    result.push({
      fila: index + 1,
      trabajo_sync_id: trabajoSyncId,
      clave_fila: metrogestionClaveFilaTrabajo_(row, pedidoEnG),
      dfm: row[0],
      matricula: row[1],
      numero_parada: numeroParada,
      taller: row[5],
      tipo_trabajo: tipoTrabajo,
      pedido,
      pedido_fondo_amarillo: pedidoEnG,
      designacion: row[7],
      marca_vehiculo: row[14],
      marca_equipo: metrogestionMarcaFrio_(row[14]),
      fecha_necesidad: fechaNecesidad,
      fecha_realizada: fechaRealizada,
      fecha_recogida: fechaRecogida,
      pendiente_fondo_blanco: pendienteFondoBlanco,
      prioridad_fondo_amarillo: prioridadFondoAmarillo,
    });
  }
  return result;
}

function metrogestionEsTipoAdministrativo_(value) {
  const tipo = metrogestionNormalizar_(value);
  return tipo === 'TRAMITE' || tipo === 'GESTION';
}

function metrogestionFechaIsoDesdeDate_(value) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function metrogestionMoverMeses_(fechaIso, months) {
  const source = metrogestionDate_(fechaIso);
  const day = source.getDate();
  const result = new Date(source.getFullYear(), source.getMonth() + months, 1);
  const lastDay = new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate();
  result.setDate(Math.min(day, lastDay));
  return metrogestionFechaIsoDesdeDate_(result);
}

function metrogestionMoverAnos_(fechaIso, years) {
  const source = metrogestionDate_(fechaIso);
  const result = new Date(source.getFullYear() + years, source.getMonth(), 1);
  const lastDay = new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate();
  result.setDate(Math.min(source.getDate(), lastDay));
  return metrogestionFechaIsoDesdeDate_(result);
}

function metrogestionSiguienteCaducidadItv_(fechaCaducidadIso, fechaRealizadaIso) {
  if (!fechaCaducidadIso || !fechaRealizadaIso) return '';
  const inicioVentana = metrogestionMoverMeses_(fechaCaducidadIso, -1);
  const conservaCaducidad = fechaRealizadaIso >= inicioVentana && fechaRealizadaIso <= fechaCaducidadIso;
  return metrogestionMoverAnos_(conservaCaducidad ? fechaCaducidadIso : fechaRealizadaIso, 1);
}

function metrogestionAplicarComandos_(sheet, commands, sheetState, currentWorks) {
  return commands.map(command => {
    if (command?.tipo === 'alta') return metrogestionAplicarComandoAlta_(sheet, command, sheetState);
    const payload = command?.payload || {};
    const syncId = String(command?.sync_id || payload.sync_id || '').trim();
    if (!/^[0-9a-f-]{36}$/i.test(syncId)) throw new Error('Supabase devolvió una fila PARADA sin identificador válido.');
    if (payload.solo_trabajos === true) {
      const adjustment24h = metrogestionAplicarAjuste24h_(sheet, payload.ajuste_24h, sheetState);
      const assignedWorks = metrogestionAplicarAsignacionesTrabajos_(
        sheet,
        Array.isArray(payload.trabajos_asignados) ? payload.trabajos_asignados : [],
        payload.numero_parada,
        sheetState,
        currentWorks,
        payload.reversion_t || null
      );
      const linkedArchiveRows = metrogestionEnlazarArchivoParada_(
        sheet,
        payload.numero_parada,
        payload.dfm,
        sheetState
      );
      return {
        tipo: 'trabajos',
        sync_id: syncId,
        revision: Number(command.revision),
        estado: 'aplicado',
        trabajos_asignados: assignedWorks,
        ajustes_24h: adjustment24h,
        filas_archivo_enlazadas: linkedArchiveRows,
      };
    }
    let rowNumber = metrogestionBuscarFilaPorSyncId_(sheet, syncId, sheetState);
    if (!rowNumber) rowNumber = metrogestionBuscarFilaParadaExistente_(sheet, payload, sheetState);
    const nuevaFila = !rowNumber;
    if (nuevaFila) rowNumber = metrogestionInsertarFilaParada_(sheet, payload, sheetState);
    metrogestionEscribirFilaParada_(sheet, rowNumber, payload, syncId, nuevaFila, sheetState);
    const adjustment24h = metrogestionAplicarAjuste24h_(sheet, payload.ajuste_24h, sheetState);
    const assignedWorks = metrogestionAplicarAsignacionesTrabajos_(
      sheet,
      Array.isArray(payload.trabajos_asignados) ? payload.trabajos_asignados : [],
      payload.numero_parada,
      sheetState,
      currentWorks,
      payload.reversion_t || null
    );
    const linkedArchiveRows = metrogestionEnlazarArchivoParada_(
      sheet,
      payload.numero_parada,
      payload.dfm,
      sheetState
    );
    return {
      tipo: 'parada',
      sync_id: syncId,
      revision: Number(command.revision),
      estado: 'aplicado',
      fila: rowNumber,
      trabajos_asignados: assignedWorks,
      ajustes_24h: adjustment24h,
      filas_archivo_enlazadas: linkedArchiveRows,
    };
  });
}

function metrogestionClaveNumeroParada_(value) {
  return metrogestionNormalizar_(value).replace(/^PA-/, '');
}

function metrogestionBuscarCarpetaUnica_(parent, name) {
  const folders = parent.getFoldersByName(name);
  if (!folders.hasNext()) return null;
  const folder = folders.next();
  if (folders.hasNext()) {
    throw new Error(`Hay más de una carpeta llamada ${name}. No se han modificado los enlaces.`);
  }
  return folder;
}

function metrogestionCarpetasPorNombre_(parent, name) {
  const result = [];
  const folders = parent.getFoldersByName(name);
  while (folders.hasNext()) result.push(folders.next());
  return result;
}

function metrogestionFechaCarpeta_(folder) {
  try {
    const createdAt = folder.getDateCreated();
    return createdAt instanceof Date ? createdAt.getTime() : new Date(createdAt).getTime();
  } catch (_) {
    return Number.MAX_SAFE_INTEGER;
  }
}

function metrogestionIdCarpeta_(folder) {
  try {
    return String(folder.getId() || '');
  } catch (_) {
    const match = String(folder.getUrl?.() || '').match(/\/folders\/([^/?#]+)/i);
    return match ? match[1] : '';
  }
}

function metrogestionIdCarpetaDesdeUrl_(url) {
  const match = String(url || '').match(/\/folders\/([^/?#]+)/i);
  return match ? match[1] : '';
}

function metrogestionOrdenarCarpetas_(folders) {
  return folders.slice().sort((left, right) => {
    const dateDifference = metrogestionFechaCarpeta_(left) - metrogestionFechaCarpeta_(right);
    if (dateDifference) return dateDifference;
    return metrogestionIdCarpeta_(left).localeCompare(metrogestionIdCarpeta_(right));
  });
}

function metrogestionObtenerCarpetaParada_(dfm, numeroParada, preferredUrls) {
  const codigoDfm = String(dfm || '').trim();
  if (!codigoDfm) throw new Error(`No se puede localizar el archivo de ${numeroParada}: falta el DFM.`);
  const cacheKey = `${metrogestionNormalizar_(codigoDfm)}|${metrogestionNormalizar_(numeroParada)}`;
  if (METROGESTION_EXECUTION_CACHE.has(cacheKey)) {
    return METROGESTION_EXECUTION_CACHE.get(cacheKey);
  }
  const archivoFlota = DriveApp.getFolderById(METROGESTION.archivoFlotaFolderId);
  const carpetaDfm = metrogestionBuscarCarpetaUnica_(archivoFlota, codigoDfm);
  if (!carpetaDfm) {
    throw new Error(`No existe la carpeta del DFM ${codigoDfm} dentro de A-FLOTA.`);
  }
  let carpetasParadas = metrogestionCarpetasPorNombre_(carpetaDfm, 'PARADAS');
  if (!carpetasParadas.length) carpetasParadas = [carpetaDfm.createFolder('PARADAS')];

  const candidatas = [];
  carpetasParadas.forEach(paradas => {
    metrogestionCarpetasPorNombre_(paradas, numeroParada).forEach(parada => candidatas.push(parada));
  });
  if (candidatas.length) {
    const preferredIds = new Set((preferredUrls || []).map(metrogestionIdCarpetaDesdeUrl_).filter(Boolean));
    const preferred = candidatas.filter(folder => preferredIds.has(metrogestionIdCarpeta_(folder)));
    const selected = metrogestionOrdenarCarpetas_(preferred.length ? preferred : candidatas)[0];
    METROGESTION_EXECUTION_CACHE.set(cacheKey, selected);
    return selected;
  }

  const paradas = metrogestionOrdenarCarpetas_(carpetasParadas)[0];
  const selected = paradas.createFolder(numeroParada);
  METROGESTION_EXECUTION_CACHE.set(cacheKey, selected);
  return selected;
}

function metrogestionEnlazarArchivoParada_(sheet, numeroParada, dfm, sheetState) {
  const stopKey = metrogestionClaveNumeroParada_(numeroParada);
  if (!stopKey) return 0;
  const canonicalStop = `PA-${stopKey}`;
  const lastRow = sheetState?.values?.length || sheet.getLastRow();
  if (lastRow < 2) return 0;
  const values = sheetState?.values
    || sheet.getRange(1, 1, lastRow, 17).getDisplayValues();
  const matchingRows = [];
  values.forEach((row, index) => {
    if (index > 0 && metrogestionClaveNumeroParada_(row[4]) === stopKey) matchingRows.push(index + 1);
  });
  if (!matchingRows.length) return 0;

  // El enlace que hubiera en E puede pertenecer a GP, ACT u otro trabajo.
  // La carpeta común se resuelve siempre por su ruta canónica; así los enlaces
  // históricos de trabajos distintos no compiten entre sí.
  const inferredDfm = String(dfm || values[matchingRows[0] - 1]?.[0] || '').trim();
  const currentRichTexts = new Map();
  // Una lectura de E evita una llamada remota por cada fila de la parada.
  const firstMatchingRow = matchingRows[0];
  const richTexts = sheet.getRange(firstMatchingRow, 5, matchingRows[matchingRows.length - 1] - firstMatchingRow + 1, 1).getRichTextValues();
  const currentUrls = matchingRows.map(rowNumber => {
    const richText = richTexts[rowNumber - firstMatchingRow][0];
    currentRichTexts.set(rowNumber, richText);
    return richText ? richText.getLinkUrl() : '';
  }).filter(Boolean);
  const folderUrl = metrogestionObtenerCarpetaParada_(inferredDfm, canonicalStop, currentUrls).getUrl();

  matchingRows.forEach(rowNumber => {
    const cell = sheet.getRange(rowNumber, 5);
    const current = currentRichTexts.get(rowNumber) || null;
    const currentFolderId = metrogestionIdCarpetaDesdeUrl_(current ? current.getLinkUrl() : '');
    const expectedFolderId = metrogestionIdCarpetaDesdeUrl_(folderUrl);
    if (currentFolderId && currentFolderId === expectedFolderId) return;
    const text = String(values[rowNumber - 1]?.[4] || cell.getDisplayValue() || canonicalStop);
    const builder = current
      ? current.copy()
      : SpreadsheetApp.newRichTextValue().setText(text);
    cell.setRichTextValue(builder.setLinkUrl(folderUrl).build());
  });
  return matchingRows.length;
}

function metrogestionNotaSinTrabajo_(note) {
  return String(note || '').split(/\r?\n/)
    .filter(line => line && !/^METROGESTION_T:/i.test(line))
    .join('\n');
}

function metrogestionAplicarAjuste24h_(sheet, adjustment, sheetState) {
  if (!adjustment || typeof adjustment !== 'object') return 0;
  const dfm = metrogestionNormalizar_(adjustment.dfm);
  const numeroParada = metrogestionNormalizar_(adjustment.numero_parada);
  if (!dfm || !numeroParada) throw new Error('La fila AV24H no tiene DFM o número de actuación.');

  const lastRow = sheetState?.values?.length || sheet.getLastRow();
  const values = sheetState?.values || sheet.getRange(1, 1, lastRow, 17).getDisplayValues();
  let avRow = 0;
  let desvinculadas = 0;

  values.forEach((row, index) => {
    const rowNumber = index + 1;
    if (rowNumber < 2
        || metrogestionNormalizar_(row[0]) !== dfm
        || metrogestionNormalizar_(row[4]) !== numeroParada) return;
    const designacion = metrogestionNormalizar_(row[7]);
    if (designacion === 'AV24H') {
      avRow = rowNumber;
      return;
    }
    if (designacion === 'PARADA' || designacion === 'ANULADA') return;

    const cell = sheet.getRange(rowNumber, 5);
    const note = sheetState?.notesE?.[rowNumber - 1] ?? cell.getNote();
    cell.clearContent().setNote(metrogestionNotaSinTrabajo_(note)).setBackground('#ffffff');
    if (sheetState?.values?.[rowNumber - 1]) sheetState.values[rowNumber - 1][4] = '';
    if (sheetState?.notesE) sheetState.notesE[rowNumber - 1] = metrogestionNotaSinTrabajo_(note);
    desvinculadas += 1;
  });

  const nuevaFila = !avRow;
  if (nuevaFila) avRow = metrogestionInsertarFilaParada_(sheet, adjustment, sheetState);
  const range = sheet.getRange(avRow, 1, 1, 17);
  const row = range.getValues()[0];
  row[0] = adjustment.dfm || '';
  row[1] = adjustment.matricula || '';
  row[2] = adjustment.tipo || '';
  row[3] = adjustment.upc || '';
  row[4] = adjustment.numero_parada || '';
  row[5] = '';
  row[6] = adjustment.tipo_trabajo || 'AVERÍA';
  row[7] = adjustment.designacion || 'AV24H';
  row[8] = metrogestionDate_(adjustment.fecha_necesidad);
  row[9] = metrogestionDate_(adjustment.fecha_entrada);
  row[10] = metrogestionDate_(adjustment.fecha_salida);
  row[14] = adjustment.marca || '';
  range.setValues([row]);
  range.setBackground(adjustment.fecha_salida ? '#d9ead3' : '#ffffff');
  sheet.getRange(avRow, 5).setBackground('#cfe2f3');
  sheet.getRange(avRow, 9, 1, 3).setNumberFormat('dd/MM/yyyy');
  sheet.getRange(avRow, 5).setNote(`METROGESTION_AV24H:${adjustment.seguimiento_id}`);
  const detalle = [
    adjustment.numero_caso ? `CASO ${adjustment.numero_caso}` : '',
    adjustment.averia || '',
    adjustment.diagnostico || '',
  ].filter(Boolean).join('\n');
  if (detalle) sheet.getRange(avRow, 8).setNote(detalle);

  if (sheetState?.values?.[avRow - 1]) {
    const cached = sheetState.values[avRow - 1];
    row.forEach((value, index) => { cached[index] = value; });
    cached[8] = adjustment.fecha_necesidad || '';
    cached[9] = adjustment.fecha_entrada || '';
    cached[10] = adjustment.fecha_salida || '';
  }
  if (sheetState?.notesE) {
    sheetState.notesE[avRow - 1] = `METROGESTION_AV24H:${adjustment.seguimiento_id}`;
  }
  return desvinculadas + (nuevaFila ? 1 : 0);
}

function metrogestionNotaConTrabajo_(note, syncId) {
  const lines = String(note || '').split(/\r?\n/)
    .filter(line => line && !/^METROGESTION_T:/i.test(line));
  lines.push(`METROGESTION_T:${syncId}`);
  return lines.join('\n');
}

function metrogestionCoincideIdentidadTrabajo_(row, expectedKey) {
  const parts = String(expectedKey || '').split('|');
  if (parts.length !== 6) return false;
  return metrogestionNormalizar_(row[0]) === parts[0]
    && metrogestionNormalizar_(row[1]) === parts[1]
    && metrogestionNormalizar_(row[7]) === parts[4]
    && metrogestionFechaIso_(row[8], 'de necesidad') === parts[5];
}

function metrogestionCoincideTrabajoRealizado_(row, expectedKey) {
  return Boolean(String(row?.[9] || '').trim())
    && metrogestionCoincideIdentidadTrabajo_(row, expectedKey);
}

function metrogestionBuscarFilaTrabajo_(sheet, assignment, usedRows, sheetState) {
  const lastRow = sheetState?.values?.length || sheet.getLastRow();
  const expectedKey = String(assignment?.clave_fila || '').trim();
  const requested = Number(assignment?.fila || 0);
  if (requested >= 2 && requested <= lastRow && !usedRows.has(requested)) {
    const row = sheetState?.values?.[requested - 1]
      || sheet.getRange(requested, 1, 1, 17).getDisplayValues()[0];
    if (metrogestionClaveFilaTrabajo_(row) === expectedKey) return requested;
    // Una necesidad ya realizada puede haber recibido F o G antes de que
    // Metrogestión lograra grabar su nota técnica. Se reconoce por la identidad
    // estable DFM + matrícula + H + fecha I, nunca solo por el número de fila.
    if (metrogestionCoincideTrabajoRealizado_(row, expectedKey)) return requested;
  }
  const values = sheetState?.values?.slice(1)
    || sheet.getRange(2, 1, lastRow - 1, 17).getDisplayValues();
  const matches = [];
  values.forEach((row, index) => {
    const rowNumber = index + 2;
    if (!usedRows.has(rowNumber) && metrogestionClaveFilaTrabajo_(row) === expectedKey) matches.push(rowNumber);
  });
  if (matches.length) {
    matches.sort((a, b) => Math.abs(a - requested) - Math.abs(b - requested) || a - b);
    return matches[0];
  }
  const completedMatches = [];
  values.forEach((row, index) => {
    const rowNumber = index + 2;
    if (!usedRows.has(rowNumber) && metrogestionCoincideTrabajoRealizado_(row, expectedKey)) {
      completedMatches.push(rowNumber);
    }
  });
  if (!completedMatches.length) {
    throw new Error(`No se localiza la necesidad procedente de la fila ${requested || 'desconocida'}.`);
  }
  completedMatches.sort((a, b) => Math.abs(a - requested) - Math.abs(b - requested) || a - b);
  return completedMatches[0];
}

function metrogestionBuscarFilaTrabajoPorActuacion_(
  sheet,
  assignment,
  expectedStop,
  usedRows,
  sheetState
) {
  const lastRow = sheetState?.values?.length || sheet.getLastRow();
  const values = sheetState?.values?.slice(1)
    || sheet.getRange(2, 1, lastRow - 1, 17).getDisplayValues();
  const expectedKey = String(assignment?.clave_fila || '').trim();
  const requested = Number(assignment?.fila || 0);
  const matches = [];
  values.forEach((row, index) => {
    const rowNumber = index + 2;
    const rowStop = metrogestionNormalizar_(row[4]).replace(/^PA-/, '');
    if (
      !usedRows.has(rowNumber)
      && rowStop === expectedStop
      && metrogestionClaveFilaTrabajo_(row) === expectedKey
    ) matches.push(rowNumber);
  });
  matches.sort((a, b) => Math.abs(a - requested) - Math.abs(b - requested) || a - b);
  return matches[0] || 0;
}

function metrogestionIdentidadClaveTrabajo_(key) {
  const parts = String(key || '').split('|');
  return parts.length === 6 ? [parts[0], parts[1], parts[4], parts[5]].join('|') : '';
}

function metrogestionTrabajoActual_(assignment, currentWorks, usedRows) {
  const works = Array.isArray(currentWorks) ? currentWorks : [];
  const expectedKey = String(assignment?.clave_fila || '').trim();
  const requested = Number(assignment?.fila || 0);
  const occupied = usedRows instanceof Set ? usedRows : new Set();
  const matches = works.filter(work => {
    const rowNumber = Number(work?.fila || 0);
    return String(work?.clave_fila || '').trim() === expectedKey
      && rowNumber >= 2
      && !occupied.has(rowNumber);
  });
  matches.sort((left, right) => {
    const leftRow = Number(left?.fila || 0);
    const rightRow = Number(right?.fila || 0);
    return Number(rightRow === requested) - Number(leftRow === requested)
      || Math.abs(leftRow - requested) - Math.abs(rightRow - requested)
      || leftRow - rightRow;
  });
  return matches[0] || null;
}

function metrogestionFilasTrabajoVinculado_(sheet, syncId, sheetState) {
  const lastRow = sheetState?.values?.length || sheet.getLastRow();
  const notes = sheetState?.notesE
    || sheet.getRange(1, 5, lastRow, 1).getNotes().map(row => String(row?.[0] || ''));
  const matches = [];
  notes.forEach((note, index) => {
    if (metrogestionNotaTrabajoId_(note).toLowerCase() === syncId.toLowerCase()) matches.push(index + 1);
  });
  return matches;
}

function metrogestionAplicarAsignacionesTrabajos_(
  sheet,
  assignments,
  numeroParada,
  sheetState,
  currentWorks,
  reversion
) {
  if (!assignments.length) return 0;
  const expectedStop = metrogestionNormalizar_(numeroParada).replace(/^PA-/, '');
  if (!expectedStop) throw new Error('No se pueden vincular T sin número de actuación.');
  const usedRows = new Set();
  const planned = assignments.map(assignment => {
    const syncId = String(assignment?.trabajo_sync_id || '').trim();
    if (!/^[0-9a-f-]{36}$/i.test(syncId)) throw new Error('Supabase devolvió una T sin identificador válido.');
    // Una orden pendiente puede conservar la clave y el número de fila que
    // tenía cuando se creó. La nota técnica es la identidad estable: si el
    // trabajo ya está vinculado a esta parada, se omite sin tocar el histórico.
    const originalRequested = Number(assignment?.fila || 0);
    const originalExpectedKey = String(assignment?.clave_fila || '').trim();
    const linkedRows = metrogestionFilasTrabajoVinculado_(sheet, syncId, sheetState);
    const currentWork = metrogestionTrabajoActual_(assignment, currentWorks, usedRows);
    const linkedByStopRow = metrogestionBuscarFilaTrabajoPorActuacion_(
      sheet,
      assignment,
      expectedStop,
      usedRows,
      sheetState
    );
    // Una H ya coloreada deja de aparecer como pendiente, pero si conserva la
    // misma identidad y el mismo número de actuación sigue siendo la necesidad
    // correcta. Se añade su nota técnica sin modificar F, G, H, I, J o K.
    if (!currentWork && linkedByStopRow) {
      usedRows.add(linkedByStopRow);
      return {
        rowNumber: linkedByStopRow,
        syncId,
        alreadyLinked: false,
        linkedByStop: true,
      };
    }
    // Si tampoco existe una fila con su identidad y actuación, la referencia
    // antigua se descarta sin tocar la fila que ahora ocupa aquel número.
    if (!currentWork) {
      return {
        rowNumber: linkedRows.find(rowNumber => !usedRows.has(rowNumber)) || 0,
        syncId,
        alreadyLinked: true,
        noLongerPending: true,
      };
    }
    const requested = Number(currentWork?.fila || originalRequested);
    const expectedKey = String(currentWork?.clave_fila || originalExpectedKey).trim();
    // Un mismo trabajo puede proceder de varias filas/bloques de MANTENIMENT.
    // Compartir METROGESTION_T es válido siempre que todas pertenezcan a la
    // misma parada. Se escoge primero su fila original, después su clave y por
    // último la copia vinculada más cercana que todavía no se haya consumido.
    linkedRows.forEach(linkedRowNumber => {
      const linkedStopValue = sheetState?.values?.[linkedRowNumber - 1]?.[4]
        ?? sheet.getRange(linkedRowNumber, 5).getDisplayValue();
      const linkedStop = metrogestionNormalizar_(linkedStopValue).replace(/^PA-/, '');
      if (linkedStop && linkedStop !== expectedStop) {
        throw new Error(`El trabajo vinculado de la fila ${linkedRowNumber} pertenece a otra actuación. No se ha reasignado.`);
      }
    });
    const linkedRow = (
      linkedRows.includes(requested) && !usedRows.has(requested) ? requested : 0
    ) || linkedRows.find(rowNumber => {
      if (usedRows.has(rowNumber)) return false;
      const row = sheetState?.values?.[rowNumber - 1]
        || sheet.getRange(rowNumber, 1, 1, 17).getDisplayValues()[0];
      return metrogestionClaveFilaTrabajo_(row) === expectedKey;
    }) || linkedRows
      .filter(rowNumber => !usedRows.has(rowNumber))
      .sort((a, b) => Math.abs(a - requested) - Math.abs(b - requested) || a - b)[0]
      || 0;
    const rowNumber = linkedRow
      || metrogestionBuscarFilaTrabajo_(
        sheet,
        { ...assignment, fila: requested, clave_fila: expectedKey },
        usedRows,
        sheetState
      );
    usedRows.add(rowNumber);
    const currentStopValue = sheetState?.values?.[rowNumber - 1]?.[4]
      ?? sheet.getRange(rowNumber, 5).getDisplayValue();
    const currentStop = metrogestionNormalizar_(currentStopValue).replace(/^PA-/, '');
    if (currentStop && currentStop !== expectedStop) {
      throw new Error(`La fila ${rowNumber} ya pertenece a otra actuación. No se ha reasignado.`);
    }
    return { rowNumber, syncId, alreadyLinked: Boolean(linkedRow) };
  });

  planned.filter(item => !item.alreadyLinked && item.rowNumber).forEach(({ rowNumber, syncId }) => {
    const cell = sheet.getRange(rowNumber, 5);
    const currentValue = sheetState?.values?.[rowNumber - 1]?.[4]
      ?? cell.getDisplayValue();
    if (metrogestionNormalizar_(currentValue) !== metrogestionNormalizar_(numeroParada)) {
      cell.setValue(numeroParada);
    }
    const currentNote = sheetState?.notesE?.[rowNumber - 1] ?? cell.getNote();
    const nextNote = metrogestionNotaConTrabajo_(currentNote, syncId);
    cell.setNote(nextNote);
    cell.setBackground('#cfe2f3');
    if (sheetState?.values?.[rowNumber - 1]) sheetState.values[rowNumber - 1][4] = numeroParada;
    if (sheetState?.notesE) sheetState.notesE[rowNumber - 1] = nextNote;
  });

  // Las fechas reales de las T gobiernan J/K en todas las líneas de trabajo
  // vinculadas a la misma visita. Una recogida confirmada colorea A:Q para que
  // la necesidad quede visualmente cerrada y no vuelva a tratarse como pendiente.
  // Si la T se reabre, el mismo vínculo técnico permite deshacer exactamente
  // J o K sin depender de que la fila siga apareciendo entre las necesidades.
  const reversalIds = new Set(
    (Array.isArray(reversion?.trabajo_sync_ids) ? reversion.trabajo_sync_ids : [])
      .map(value => String(value || '').trim().toLowerCase())
      .filter(Boolean)
  );
  planned.forEach((item, index) => {
    if (!item.rowNumber) return;
    const assignment = assignments[index] || {};
    const fechaEntradaIso = String(assignment.fecha_entrada || '').trim();
    const fechaSalidaIso = String(assignment.fecha_salida || '').trim();
    const cached = sheetState?.values?.[item.rowNumber - 1];
    const revertThisWork = reversalIds.has(item.syncId.toLowerCase());

    if (revertThisWork && reversion?.limpiar_fecha_entrada === true) {
      sheet.getRange(item.rowNumber, 10).clearContent().setNumberFormat('dd/MM/yyyy');
      if (cached) cached[9] = '';
    }

    if (revertThisWork && reversion?.limpiar_fecha_salida === true) {
      sheet.getRange(item.rowNumber, 11).clearContent().setNumberFormat('dd/MM/yyyy');
      sheet.getRange(item.rowNumber, 1, 1, 17).setBackground('#ffffff');
      sheet.getRange(item.rowNumber, 5).setBackground('#cfe2f3');
      if (cached) cached[10] = '';
    }

    if (fechaEntradaIso && !(revertThisWork && reversion?.limpiar_fecha_entrada === true)) {
      const currentEntry = String(cached?.[9] ?? sheet.getRange(item.rowNumber, 10).getDisplayValue()).trim();
      if (!currentEntry) sheet.getRange(item.rowNumber, 10).setValue(metrogestionDate_(fechaEntradaIso));
      sheet.getRange(item.rowNumber, 10).setNumberFormat('dd/MM/yyyy');
      if (cached && !currentEntry) cached[9] = fechaEntradaIso;
    }

    if (fechaSalidaIso && !(revertThisWork && reversion?.limpiar_fecha_salida === true)) {
      const currentExit = String(cached?.[10] ?? sheet.getRange(item.rowNumber, 11).getDisplayValue()).trim();
      if (!currentExit) sheet.getRange(item.rowNumber, 11).setValue(metrogestionDate_(fechaSalidaIso));
      sheet.getRange(item.rowNumber, 11).setNumberFormat('dd/MM/yyyy');
      metrogestionPintarCierre_(sheet, item.rowNumber);
      if (
        !currentExit
        && metrogestionEsTipoAdministrativo_(cached?.[6])
        && Array.isArray(sheetState?.cierresAdministrativos)
      ) {
        sheetState.cierresAdministrativos.push(item.rowNumber);
      }
      if (cached && !currentExit) cached[10] = fechaSalidaIso;
    }
  });

  return planned.filter(item => !item.alreadyLinked).length;
}

function metrogestionAplicarComandoAlta_(sheet, command, sheetState) {
  const payload = command?.payload || {};
  const vehicleId = String(command?.vehiculo_id || payload.vehiculo_id || '').trim();
  if (!/^[0-9a-f-]{36}$/i.test(vehicleId)) throw new Error('Supabase devolvió un activo sin identificador válido.');
  let rowNumber = metrogestionBuscarFilaAlta_(sheet, payload, sheetState);
  if (!rowNumber) rowNumber = metrogestionInsertarFilaAlta_(sheet, sheetState);
  metrogestionEscribirFilaAlta_(sheet, rowNumber, payload, vehicleId, sheetState);
  return {
    tipo: 'alta',
    vehiculo_id: vehicleId,
    revision: Number(command.revision),
    estado: 'aplicado',
    fila: rowNumber,
  };
}

function metrogestionCopiarPlantillaOperativa_(sheet, sourceRow, targetRow) {
  // R y S pertenecen a ARRAYFORMULA y deben quedar libres para que calculen
  // mes y año desde J. Solo copiamos las columnas operativas A:Q.
  sheet.getRange(sourceRow, 1, 1, 17).copyTo(sheet.getRange(targetRow, 1, 1, 17));
}

function metrogestionBuscarFilaAlta_(sheet, payload, sheetState) {
  const lastRow = sheetState?.values?.length || sheet.getLastRow();
  if (lastRow < 2) return 0;
  const requested = Number(payload.fila || 0);
  if (requested >= 2 && requested <= lastRow) {
    const current = sheetState?.values?.[requested - 1]?.slice(0, 8)
      || sheet.getRange(requested, 1, 1, 8).getDisplayValues()[0];
    if (metrogestionNormalizar_(current[0]) === metrogestionNormalizar_(payload.dfm)) return requested;
  }
  const values = sheetState?.values?.slice(1).map(row => row.slice(0, 8))
    || sheet.getRange(2, 1, lastRow - 1, 8).getDisplayValues();
  const dfm = metrogestionNormalizar_(payload.dfm);
  const index = values.findIndex(row => metrogestionNormalizar_(row[0]) === dfm && metrogestionNormalizar_(row[7]) === 'ALTA');
  return index < 0 ? 0 : index + 2;
}

function metrogestionInsertarFilaAlta_(sheet, sheetState) {
  const lastRow = sheetState?.values?.length || sheet.getLastRow();
  const values = sheetState?.values?.slice(1).map(row => row.slice(0, 8))
    || sheet.getRange(2, 1, Math.max(lastRow - 1, 1), 8).getDisplayValues();
  const exampleIndex = values.findIndex(row => metrogestionNormalizar_(row[7]) === 'ALTA');
  if (exampleIndex < 0) throw new Error('No existe una fila ALTA que pueda utilizarse como plantilla.');
  const exampleRow = exampleIndex + 2;
  sheet.insertRowAfter(lastRow);
  const targetRow = lastRow + 1;
  metrogestionCopiarPlantillaOperativa_(sheet, exampleRow, targetRow);
  sheet.getRange(targetRow, 1, 1, 17).clearContent().clearNote();
  sheet.setRowHeight(targetRow, sheet.getRowHeight(exampleRow));
  if (sheetState?.values) sheetState.values.push(Array(17).fill(''));
  if (sheetState?.notesA) sheetState.notesA.push('');
  if (sheetState?.notesE) sheetState.notesE.push('');
  return targetRow;
}

function metrogestionEscribirFilaAlta_(sheet, rowNumber, payload, vehicleId, sheetState) {
  const range = sheet.getRange(rowNumber, 1, 1, 17);
  const row = range.getValues()[0];
  row[0] = payload.dfm || '';
  row[1] = payload.matricula || '';
  row[2] = payload.tipo || '';
  row[3] = payload.upc || '';
  row[5] = payload.telefono || '';
  row[6] = payload.contrato || '';
  row[7] = payload.estado === 'BAJA' ? 'BAJA' : 'ALTA';
  row[8] = metrogestionDate_(payload.fecha_matriculacion);
  row[9] = metrogestionDate_(payload.fecha_alta);
  row[13] = payload.asignacion || '';
  row[14] = payload.marca || '';
  row[16] = payload.bastidor || '';
  range.setValues([row]);
  sheet.getRange(rowNumber, 9, 1, 2).setNumberFormat('dd/MM/yyyy');
  sheet.getRange(rowNumber, 1).setNote(`METROGESTION_ALTA:${vehicleId}`);
  if (row[7] === 'BAJA') sheet.getRange(rowNumber, 1, 1, 17).setBackground('#ead1dc');
  if (sheetState?.values) {
    const cached = row.map(value => String(value ?? ''));
    // La hoja recibe objetos Date, pero la caché debe conservar el mismo
    // formato ISO que utiliza el resto de la sincronización.
    cached[8] = payload.fecha_matriculacion || '';
    cached[9] = payload.fecha_alta || '';
    sheetState.values[rowNumber - 1] = cached;
  }
  if (sheetState?.notesA) sheetState.notesA[rowNumber - 1] = `METROGESTION_ALTA:${vehicleId}`;
}

function metrogestionBuscarFilaPorSyncId_(sheet, syncId, sheetState) {
  const lastRow = sheetState?.values?.length || sheet.getLastRow();
  if (lastRow < 2) return 0;
  const expected = `METROGESTION_PARADA:${syncId}`.toUpperCase();
  const notes = sheetState?.notesA?.slice(1)
    || sheet.getRange(2, 1, lastRow - 1, 1).getNotes().map(item => String(item[0] || ''));
  const index = notes.findIndex(item => String(item || '').trim().toUpperCase() === expected);
  return index < 0 ? 0 : index + 2;
}

function metrogestionBuscarFilaParadaExistente_(sheet, payload, sheetState) {
  const lastRow = sheetState?.values?.length || sheet.getLastRow();
  if (lastRow < 2) return 0;
  const values = sheetState?.values?.slice(1)
    || sheet.getRange(2, 1, lastRow - 1, 17).getDisplayValues();
  const dfm = metrogestionNormalizar_(payload.dfm);
  const numeroParada = metrogestionNormalizar_(payload.numero_parada);
  if (!dfm || !numeroParada) return 0;

  const matches = [];
  values.forEach((row, index) => {
    const estado = metrogestionNormalizar_(row[7]);
    if (
      metrogestionNormalizar_(row[0]) === dfm
      && metrogestionNormalizar_(row[4]) === numeroParada
      && ['PARADA', 'ANULADA'].includes(estado)
    ) matches.push({
      rowNumber: index + 2,
      tancament: metrogestionNormalizar_(row[16]),
      sustituto: metrogestionNormalizar_(row[6]),
      fechaK: String(row[10] || '').trim(),
      fechaKIso: metrogestionFechaIso_(row[10], `de recuperación o corte de la fila ${index + 2}`),
    });
  });

  if (matches.length === 0) return 0;
  if (matches.length === 1) return matches[0].rowNumber;

  let candidates = matches;
  const tancament = metrogestionNormalizar_(payload.tancament);
  if (tancament) {
    const samePeriod = matches.filter(item => item.tancament === tancament);
    if (samePeriod.length === 0) return 0;
    if (samePeriod.length === 1) return samePeriod[0].rowNumber;
    candidates = samePeriod;
  }

  const sustituto = metrogestionNormalizar_(payload.sustituto);
  if (sustituto) {
    const sameSubstitute = candidates.filter(item => item.sustituto === sustituto);
    if (sameSubstitute.length === 1) return sameSubstitute[0].rowNumber;
    if (sameSubstitute.length > 1) candidates = sameSubstitute;
  }

  // Cuando la orden ya contiene una fecha de recuperación o corte, esa fecha
  // identifica el periodo histórico exacto aunque el TANCAMENT no venga aún
  // informado desde Metrogestión.
  const fechaK = metrogestionFechaIso_(payload.fecha_k, 'de recuperación o corte recibida');
  if (fechaK) {
    const sameClosingDate = candidates.filter(item => item.fechaKIso === fechaK);
    if (sameClosingDate.length === 1) return sameClosingDate[0].rowNumber;
    if (sameClosingDate.length > 1) candidates = sameClosingDate;
  }

  // Una misma parada puede conservar varios TANCAMENT. La fila vigente es la
  // del periodo operativo todavía abierto, identificada porque K está vacía.
  const openPeriods = candidates.filter(item => !item.fechaK);
  if (openPeriods.length === 1) return openPeriods[0].rowNumber;
  if (openPeriods.length > 1) candidates = openPeriods;
  if (candidates.length === 1) return candidates[0].rowNumber;

  throw new Error(
    `La actuación ${payload.numero_parada} del DFM ${payload.dfm} mantiene varias filas igualmente válidas; no se ha creado ni modificado ninguna.`
  );
}

function metrogestionInsertarFilaParada_(sheet, payload, sheetState) {
  const lastRow = sheetState?.values?.length || sheet.getLastRow();
  const values = sheetState?.values?.slice(1).map(row => row.slice(0, 8))
    || sheet.getRange(2, 1, Math.max(lastRow - 1, 1), 8).getDisplayValues();
  const dfm = metrogestionNormalizar_(payload.dfm);
  let altaRow = 0;
  let anchorRow = 0;
  values.forEach((row, index) => {
    const number = index + 2;
    if (metrogestionNormalizar_(row[0]) === dfm) {
      anchorRow = number;
      if (metrogestionNormalizar_(row[7]) === 'ALTA') altaRow = number;
    }
  });
  if (!altaRow) throw new Error(`No se encuentra la fila ALTA del DFM ${payload.dfm || 'sin código'}.`);
  anchorRow = Math.max(anchorRow, altaRow);
  sheet.insertRowAfter(anchorRow);
  const targetRow = anchorRow + 1;
  metrogestionCopiarPlantillaOperativa_(sheet, altaRow, targetRow);
  sheet.getRange(targetRow, 1, 1, 17).clearContent().clearNote();
  sheet.setRowHeight(targetRow, sheet.getRowHeight(altaRow));
  if (sheetState?.values) sheetState.values.splice(targetRow - 1, 0, Array(17).fill(''));
  if (sheetState?.notesA) sheetState.notesA.splice(targetRow - 1, 0, '');
  if (sheetState?.notesE) sheetState.notesE.splice(targetRow - 1, 0, '');
  return targetRow;
}

function metrogestionDate_(iso) {
  const text = String(iso || '').trim();
  if (!text) return '';
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) throw new Error(`Supabase devolvió una fecha no válida: ${text}`);
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function metrogestionEscribirFilaParada_(sheet, rowNumber, payload, syncId, nuevaFila, sheetState) {
  const estado = metrogestionNormalizar_(payload.estado) === 'ANULADA' ? 'ANULADA' : 'PARADA';
  if (nuevaFila) {
    const range = sheet.getRange(rowNumber, 1, 1, 17);
    const row = range.getValues()[0];
    row[0] = payload.dfm || '';
    row[1] = payload.matricula || '';
    row[2] = payload.tipo || '';
    row[3] = payload.upc || '';
    row[4] = payload.numero_parada || '';
    row[6] = payload.sustituto || '';
    row[7] = estado;
    row[8] = metrogestionDate_(payload.fecha_programada);
    row[9] = metrogestionDate_(payload.fecha_parada);
    row[10] = metrogestionDate_(payload.fecha_k);
    row[11] = payload.dias_parada ?? '';
    row[14] = payload.marca || '';
    row[15] = payload.km_facturables ?? '';
    row[16] = payload.tancament || '';
    range.setValues([row]);
  } else {
    // Metrogestión protege la identidad (A-E, G y O) y el marcador PARADA (H).
    // MANTENIMENT sigue gobernando I y J. L y P reflejan el cálculo vigente
    // devuelto por Metrogestión para evitar fórmulas antiguas con K vacía. Q conserva cualquier valor
    // informado y Metrogestión solo completa el periodo actual si está vacío.
    // Al realizar la T final de recuperación, también completa K si está vacía.
    sheet.getRange(rowNumber, 1, 1, 4).setValues([[
      payload.dfm || '',
      payload.matricula || '',
      payload.tipo || '',
      payload.upc || '',
    ]]);
    const paradaEsperada = String(payload.numero_parada || '').trim();
    const paradaActual = String(sheet.getRange(rowNumber, 5).getDisplayValue() || '').trim();
    // Si el valor ya coincide, no tocamos E y conservamos su enlace de Drive.
    if (paradaActual !== paradaEsperada) sheet.getRange(rowNumber, 5).setValue(paradaEsperada);
    sheet.getRange(rowNumber, 7, 1, 2).setValues([[payload.sustituto || '', estado]]);
    sheet.getRange(rowNumber, 15).setValue(payload.marca || '');
    sheet.getRange(rowNumber, 12).setValue(payload.dias_parada ?? '');
    sheet.getRange(rowNumber, 16).setValue(payload.km_facturables ?? '');

    const fechaKIso = String(payload.fecha_k || '').trim();
    const fechaKActual = String(
      sheetState?.values?.[rowNumber - 1]?.[10]
      ?? sheet.getRange(rowNumber, 11).getDisplayValue()
    ).trim();
    if (payload.reversion_t?.limpiar_k_parada === true) {
      sheet.getRange(rowNumber, 11).clearContent();
      if (sheetState?.values?.[rowNumber - 1]) sheetState.values[rowNumber - 1][10] = '';
    } else if (fechaKIso && !fechaKActual) {
      sheet.getRange(rowNumber, 11).setValue(metrogestionDate_(fechaKIso));
      if (sheetState?.values?.[rowNumber - 1]) sheetState.values[rowNumber - 1][10] = fechaKIso;
    }

    const tancamentEsperado = String(payload.tancament || '').trim();
    const tancamentActual = String(
      sheetState?.values?.[rowNumber - 1]?.[16]
      ?? sheet.getRange(rowNumber, 17).getDisplayValue()
    ).trim();
    if (tancamentEsperado && !tancamentActual) {
      sheet.getRange(rowNumber, 17).setValue(tancamentEsperado);
      if (sheetState?.values?.[rowNumber - 1]) {
        sheetState.values[rowNumber - 1][16] = tancamentEsperado;
      }
    }
  }
  sheet.getRange(rowNumber, 9, 1, 3).setNumberFormat('dd/MM/yyyy');
  sheet.getRange(rowNumber, 12).setNumberFormat('0');
  sheet.getRange(rowNumber, 16).setNumberFormat('0.00');
  sheet.getRange(rowNumber, 1).setNote(`METROGESTION_PARADA:${syncId}`);
  const baseColour = '#cfe2f3';
  if (nuevaFila) sheet.getRange(rowNumber, 1, 1, 17).setBackground(baseColour);
  const rowColour = nuevaFila ? baseColour : sheet.getRange(rowNumber, 1).getBackground();
  sheet.getRange(rowNumber, 8).setBackground(estado === 'ANULADA' ? '#f4cccc' : rowColour);
  sheet.getRange(rowNumber, 17).setBackground(
    payload.tancament && payload.tancament_supervisado !== true ? '#f4cccc' : rowColour
  );
  if (sheetState?.values?.[rowNumber - 1]) {
    const cached = sheetState.values[rowNumber - 1];
    cached[0] = payload.dfm || '';
    cached[1] = payload.matricula || '';
    cached[2] = payload.tipo || '';
    cached[3] = payload.upc || '';
    cached[4] = payload.numero_parada || '';
    cached[6] = payload.sustituto || '';
    cached[7] = estado;
    cached[11] = payload.dias_parada ?? '';
    cached[14] = payload.marca || '';
    cached[15] = payload.km_facturables ?? '';
    if (nuevaFila) {
      cached[8] = payload.fecha_programada || '';
      cached[9] = payload.fecha_parada || '';
      cached[10] = payload.fecha_k || '';
      cached[11] = payload.dias_parada ?? '';
      cached[15] = payload.km_facturables ?? '';
      cached[16] = payload.tancament || '';
    }
  }
  if (sheetState?.notesA) sheetState.notesA[rowNumber - 1] = `METROGESTION_PARADA:${syncId}`;
}

function metrogestionConfirmarComandos_(token, confirmations) {
  const response = UrlFetchApp.fetch(METROGESTION.syncUrl, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({ action: 'ack', token, confirmaciones: confirmations }),
    muteHttpExceptions: true,
    followRedirects: false,
  });
  const code = response.getResponseCode();
  const body = response.getContentText();
  let result;
  try { result = JSON.parse(body); } catch (error) { throw new Error(`No se pudo confirmar la escritura en MANTENIMENT (${code}).`); }
  if (code < 200 || code >= 300 || result?.ok !== true) {
    throw new Error(result?.error || `No se pudo confirmar la escritura en MANTENIMENT (${code}).`);
  }
}

function metrogestionSha256_(text) {
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8);
  return digest.map(byte => (byte + 256).toString(16).slice(-2)).join('');
}

// BEGIN MOTOR NECESIDADES — generado; editar shared/manteniment-necesidades.js
/* Motor puro de próximas necesidades. Se incluye en el Apps Script distribuido.
 * No usa reloj, red ni filas como identidad. La escritura vive en el adaptador.
 */
function metrogestionTipoNecesidad_(value) {
  const type = metrogestionNormalizar_(value).replace(/^ALTA /, '');
  return type === 'EXT' ? 'EXTINTOR' : type;
}

function metrogestionFechaNecesidad_(value) {
  if (!String(value || '').trim()) return '';
  const short = String(value).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  const normalized = short ? `${short[3].length === 2 ? '20' + short[3] : short[3]}-${short[2].padStart(2, '0')}-${short[1].padStart(2, '0')}` : value;
  const iso = metrogestionFechaIso_(normalized, 'necesidad');
  if (metrogestionFechaIsoDesdeDate_(metrogestionDate_(iso)) !== iso) {
    throw new Error('Fecha inexistente: ' + value);
  }
  return iso;
}

function metrogestionMarcaFrio_(value) {
  const marca = metrogestionNormalizar_(value);
  if (/(^|[^A-Z])CARRIER([^A-Z]|$)/.test(marca)) return 'CARRIER';
  if (/\b(THERMO KING|TERMO KING|THERMOKING|DAIKIN|HWASUNG|FRIGOBLOCK)\b/.test(marca)) return marca;
  return '';
}

function metrogestionCierreUnico_(type) {
  return ['ITV', '44TN', 'RT', 'TMG', 'LKT', 'SG', 'EXTINTOR', 'ATP', 'OTA'].includes(metrogestionTipoNecesidad_(type));
}

function metrogestionCierreFisico_(type) {
  return ['REPUESTOS', 'ACT', 'LINDEP', 'CV'].includes(metrogestionTipoNecesidad_(type));
}

function metrogestionMetadatosNecesidad_(note) {
  const line = String(note || '').split('\n').find(x => x.startsWith('METROGESTION_NECESIDAD:'));
  if (!line) return {};
  const meta = JSON.parse(line.slice('METROGESTION_NECESIDAD:'.length));
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) throw new Error('Nota de necesidad no válida');
  return meta;
}

function metrogestionNotaNecesidad_(note, meta) {
  const human = String(note || '').split('\n').filter(x => !x.startsWith('METROGESTION_NECESIDAD:')).join('\n').trim();
  return [human, 'METROGESTION_NECESIDAD:' + JSON.stringify(meta)].filter(Boolean).join('\n');
}

function metrogestionFirmaNecesidad_(values) {
  return JSON.stringify(values.slice(0, 17).map((value, i) => {
    if ([8, 9, 10, 12].includes(i) && value) {
      try { return metrogestionFechaNecesidad_(value); } catch (_) { /* dato manual */ }
    }
    return String(value || '').trim();
  }));
}

function metrogestionCalcularProxima_(type, dates) {
  switch (type) {
    case 'ITV': return metrogestionSiguienteCaducidadItv_(dates.i, dates.j);
    case 'RT': case 'TMG': return dates.j ? metrogestionMoverAnos_(dates.j, 2) : '';
    case 'LKT': return dates.j ? metrogestionMoverAnos_(dates.j, 1) : '';
    case 'SG': return dates.i ? metrogestionMoverAnos_(dates.i, 1) : '';
    case 'ATP': case 'EXTINTOR': return dates.m;
    case 'LINDEP': return dates.k ? metrogestionMoverAnos_(dates.k, 3) : '';
    default: return '';
  }
}

function metrogestionPlanificarNecesidades_(records, today) {
  const recurring = new Set(['ITV', 'RT', 'TMG', 'LKT', 'SG', 'ATP', 'EXTINTOR', 'LINDEP']);
  const plan = { cambios: [], nuevas: [], avisos: [], reutilizadas: 0 };
  const byUnit = new Map();
  const byOrigin = new Map();
  const ids = new Map();
  const changes = new Map();
  const warning = (r, message) => plan.avisos.push({ fila: r.row, dfm: r.dfm, tipo: r.type, motivo: message });
  const change = r => {
    if (!changes.has(r.row)) changes.set(r.row, { fila: r.row, original: r.values.slice(), values: r.values.slice(), nota: r.note || '', verde: false, amarilloM: false, cierre: false });
    return changes.get(r.row);
  };
  const rows = records.map(record => {
    const r = { ...record, values: record.values.slice(), dfm: metrogestionNormalizar_(record.values[0]), type: metrogestionTipoNecesidad_(record.values[7]), meta: {} };
    try { r.meta = metrogestionMetadatosNecesidad_(r.note); } catch (error) { r.invalid = true; warning(r, error.message); }
    if ((r.meta.dfm && r.meta.dfm !== r.dfm) || (r.meta.matricula && r.meta.matricula !== metrogestionNormalizar_(r.values[1])) || (r.meta.tipo && r.meta.tipo !== r.type && r.type !== 'ANULADA' && !(['ALTA', 'BAJA'].includes(r.type) && r.meta.inicial === 'LINDEP'))) {
      r.invalid = true; warning(r, 'La unidad o el tipo no coincide con su ciclo registrado.');
    }
    if (r.meta.id) {
      if (!ids.has(r.meta.id)) ids.set(r.meta.id, []);
      ids.get(r.meta.id).push(r);
    }
    if (r.meta.origen) {
      if (!byOrigin.has(r.meta.origen)) byOrigin.set(r.meta.origen, []);
      byOrigin.get(r.meta.origen).push(r);
    }
    if (!byUnit.has(r.dfm)) byUnit.set(r.dfm, []);
    byUnit.get(r.dfm).push(r);
    return r;
  });
  ids.forEach(list => {
    if (list.length > 1) list.forEach(r => { r.invalid = true; warning(r, 'Identificador de necesidad repetido; revisar las copias.'); });
  });

  const active = new Map();
  byUnit.forEach((list, dfm) => {
    const status = list.filter(r => ['ALTA', 'BAJA'].includes(metrogestionNormalizar_(r.values[7]))).sort((a, b) => b.row - a.row)[0];
    if (status && metrogestionNormalizar_(status.values[7]) === 'ALTA') active.set(dfm, status);
  });
  const fleetBrand = dfm => {
    const brands = [...new Set((byUnit.get(dfm) || []).map(r => metrogestionMarcaFrio_(r.values[14])).filter(Boolean))];
    const carriers = brands.filter(x => x === 'CARRIER');
    return carriers.length && brands.length > 1 ? '' : brands[0] || '';
  };
  const category = r => {
    if (r.type === 'SG') return 'GESTIÓN';
    if (r.type !== 'LKT') return 'TRÁMITE';
    const brand = metrogestionMarcaFrio_(r.values[14]) || fleetBrand(r.dfm);
    return brand ? (brand === 'CARRIER' ? 'TRÁMITE' : 'GESTIÓN') : '';
  };
  const dates = r => {
    if (r.dates) return r.dates;
    try {
      r.dates = { i: metrogestionFechaNecesidad_(r.values[8]), j: metrogestionFechaNecesidad_(r.values[9]), k: metrogestionFechaNecesidad_(r.values[10]), m: metrogestionFechaNecesidad_(r.values[12]) };
      return r.dates;
    } catch (error) { r.invalid = true; warning(r, error.message); return null; }
  };
  const currentSignature = r => metrogestionFirmaNecesidad_(r.values);
  const childEditable = child => !child.invalid && !child.values[4] && !child.values[9] && !child.values[10]
    && child.meta.generada === true && child.meta.firma === currentSignature(child);
  const writeMeta = (r, meta) => {
    r.meta = meta;
    const c = change(r);
    c.nota = metrogestionNotaNecesidad_(c.nota, meta);
  };

  // Anulación/reapertura de un origen: solo se retira su hija automática intacta.
  // Las hijas manuales, ya vinculadas o realizadas se conservan con un aviso.
  byOrigin.forEach((children, origin) => {
    const source = ids.get(origin)?.[0];
    if (!source || source.invalid) {
      children.forEach(child => warning(child, 'No se localiza un origen único; revisar antes de modificar.'));
      return;
    }
    const d = dates(source);
    const isInitial = source.meta.inicial === 'LINDEP';
    const closed = d && (isInitial ? active.has(source.dfm) : (d.k || (metrogestionCierreUnico_(source.type) && d.j)));
    if (source.type !== 'ANULADA' && active.has(source.dfm) && closed) return;
    children.forEach(child => {
      if (child.type === 'ANULADA' && child.meta.suspendida) return;
      if (!childEditable(child)) { warning(child, 'Origen anulado, reabierto o de baja; la siguiente necesidad tiene cambios y requiere revisión.'); return; }
      const c = change(child);
      c.values[7] = 'ANULADA';
      c.anulada = true;
      writeMeta(child, { ...child.meta, suspendida: true, tipo: child.type, firma: metrogestionFirmaNecesidad_(c.values) });
    });
  });

  const linkNext = (source, type, nextDate, cat, mDate) => {
    const meta = { ...source.meta };
    const sourceId = meta.id || `N:${source.dfm}:${type}:${metrogestionFirmaNecesidad_([source.dfm, source.values[1], '', '', '', '', '', type, source.values[8], source.values[9], source.values[10]])}`;
    // El ID se guarda en la nota de I y sobrevive a cambios de fechas o de fila.
    const own = byOrigin.get(sourceId) || [];
    const existing = (byUnit.get(source.dfm) || []).filter(r => r.row !== source.row && !r.invalid && r.type === type);
    const exact = existing.filter(r => dates(r)?.i === nextDate);
    const pending = existing.filter(r => { const d = dates(r); return d && !d.j && !d.k && r.type !== 'ANULADA'; });
    const candidates = own.length ? own : exact;
    if (candidates.length > 1) { warning(source, 'Más de una próxima necesidad coincide; no se crea otra.'); return; }
    let child = candidates[0];
    if (child && child.dfm !== source.dfm) { warning(source, 'La siguiente necesidad pertenece a otra unidad.'); return; }
    if (!child && pending.length) { warning(source, 'Ya existe una necesidad pendiente con otra fecha; revisar M y la fila pendiente.'); return; }
    if (child && child.meta.origen && child.meta.origen !== sourceId) { warning(source, 'La próxima necesidad ya pertenece a otro ciclo.'); return; }
    if (child && own.length && (child.type === 'ANULADA' || dates(child)?.i !== nextDate)) {
      if (!childEditable(child)) { warning(source, 'La siguiente necesidad tiene cambios o está iniciada; no se modifica su fecha.'); return; }
      const c = change(child);
      c.values[7] = type;
      c.values[8] = nextDate;
      c.pendiente = true;
      writeMeta(child, { ...child.meta, tipo: type, suspendida: false, firma: metrogestionFirmaNecesidad_(c.values) });
    }
    if (!child) {
      const next = Array(17).fill('');
      [0, 1, 2, 3, 14].forEach(i => { next[i] = source.values[i]; });
      next[5] = type === 'LINDEP' ? 'TM' : cat === 'GESTIÓN' ? 'UPC' : source.values[5];
      next[6] = cat;
      next[7] = type;
      next[8] = nextDate;
      const childMeta = { origen: sourceId, generada: true, tipo: type, firma: metrogestionFirmaNecesidad_(next) };
      plan.nuevas.push({ despuesDe: source.row, values: next, nota: metrogestionNotaNecesidad_('', childMeta) });
    } else if (!own.length) {
      // Una fila manual exacta satisface el ciclo; no se toma control de ella.
      plan.reutilizadas += 1;
    }
    if (mDate !== false && (dates(source)?.m !== nextDate || !metrogestionEsFondoAmarillo_(source.colorM))) {
      const c = change(source);
      c.values[12] = nextDate;
      c.amarilloM = true;
    }
    if (child && !own.length) return;
    writeMeta(source, { ...meta, id: sourceId, dfm: source.dfm, matricula: metrogestionNormalizar_(source.values[1]), tipo: type, proxima: nextDate, fechaCierre: dates(source)?.k || dates(source)?.j || '' });
  };

  // Solo el último ciclo realizado de cada tipo/unidad inicia una renovación.
  // Los ciclos antiguos se conservan, sin generar cientos de vencimientos pasados.
  byUnit.forEach((list, dfm) => {
    if (!active.has(dfm)) return;
    const grouped = new Map();
    list.forEach(r => {
      if (r.invalid || !recurring.has(r.type)) return;
      const d = dates(r);
      if (!d) return;
      const completed = d.k || (metrogestionCierreUnico_(r.type) && d.j);
      if (!completed) return;
      if (!grouped.has(r.type)) grouped.set(r.type, []);
      grouped.get(r.type).push(r);
    });
    grouped.forEach((sources, type) => {
      sources.sort((a, b) => (b.dates.k || b.dates.j).localeCompare(a.dates.k || a.dates.j));
      const r = sources[0], d = r.dates;
      const newerReopened = list.some(other => other.meta.tipo === type && other.meta.proxima && other.meta.fechaCierre >= (d.k || d.j)
        && (other.type === 'ANULADA' || (!other.values[9] && !other.values[10])));
      if (newerReopened) { warning(r, 'Hay un ciclo posterior anulado o reabierto; no se regenera uno antiguo.'); return; }
      if (sources[1] && (sources[1].dates.k || sources[1].dates.j) === (d.k || d.j)) {
        warning(r, 'Dos cierres coinciden en el último ciclo; revisar el duplicado.'); return;
      }
      if ((d.k || d.j) > today) { warning(r, 'Fecha de realización o cierre futura.'); return; }
      if (!d.j || (type === 'LINDEP' && (!d.k || d.k < d.j))) { warning(r, 'Falta una realización o salida válida.'); return; }
      const cat = category(r);
      if (!cat) { warning(r, 'Falta confirmar la marca del frío en O para clasificar LKT.'); return; }
      const next = metrogestionCalcularProxima_(type, d);
      if (!next) { warning(r, 'Falta la próxima caducidad en M.'); return; }
      if (next <= (d.k || d.j)) { warning(r, 'La próxima fecha debe ser posterior a la realización.'); return; }
      if (['ATP', 'EXTINTOR'].includes(type) && !metrogestionEsFondoAmarillo_(r.colorM)) {
        warning(r, 'Confirma la caducidad indicada en M con fondo amarillo.'); return;
      }
      if (d.m && d.m !== next && d.m !== r.meta.proxima) {
        warning(r, 'M no coincide con la regla; se conserva para revisión.'); return;
      }
      linkNext(r, type, next, cat);
    });

    // Primer LINDEP: solo unidades con prueba de equipo de frío, sin ciclo previo.
    const hasCold = Boolean(fleetBrand(dfm)) || list.some(r => ['ATP', 'LKT', 'TMG'].includes(r.type));
    const alta = active.get(dfm);
    if (!hasCold || (list.some(r => r.type === 'LINDEP') && alta.meta.inicial !== 'LINDEP')) return;
    const d = dates(alta);
    if (!d?.i) { warning(alta, 'Falta matriculación para el primer LINDEP.'); return; }
    const next = metrogestionMoverAnos_(d.i, 5);
    alta.meta.inicial = 'LINDEP';
    linkNext(alta, 'LINDEP', next, 'TRÁMITE', false);
  });

  // Cierre seguro: nunca reemplaza una K ya escrita ni cierra pedido/entrada.
  rows.forEach(r => {
    if (r.invalid || !active.has(r.dfm)) return;
    if (r.type === 'LKT' && !r.values[9] && !r.values[10] && !r.values[4] && !metrogestionEsFondoAmarillo_(r.colorG)) {
      const cat = category(r);
      if (cat && metrogestionNormalizar_(r.values[6]) !== metrogestionNormalizar_(cat)) change(r).values[6] = cat;
    }
    const single = metrogestionCierreUnico_(r.type);
    if (!single && !metrogestionCierreFisico_(r.type) && !['LV', 'LAVADO'].includes(r.type)) return;
    // No repintar todo el histórico: solo filas aún abiertas (H blanca).
    if (!metrogestionEsFondoBlanco_(r.colorH)) return;
    const d = dates(r);
    if (!d?.j || d.j > today) return;
    if (!single && (!d.k || d.k > today)) return;
    if (d.k && d.k < d.j) { warning(r, 'K es anterior a J; no se sobrescribe.'); return; }
    const c = change(r);
    if (single && !d.k) { c.values[10] = d.j; c.cierre = true; }
    c.verde = true;
    c.amarilloM = c.amarilloM || metrogestionEsFondoAmarillo_(r.colorM);
  });
  plan.cambios = [...changes.values()].filter(c => c.verde || c.pendiente || c.anulada || c.amarilloM || c.nota !== (records.find(r => r.row === c.fila)?.note || '') || metrogestionFirmaNecesidad_(c.values) !== metrogestionFirmaNecesidad_(c.original));
  return plan;
}

function metrogestionLeerPlanNecesidades_(sheet) {
  const count = sheet.getLastRow();
  if (count < 2) return { cambios: [], nuevas: [], avisos: [], reutilizadas: 0 };
  const range = sheet.getRange(1, 1, count, 17);
  const values = range.getDisplayValues();
  const colors = range.getBackgrounds();
  const notes = sheet.getRange(1, 9, count, 1).getNotes();
  const records = values.slice(1).map((row, i) => ({ row: i + 2, values: row, note: notes[i + 1][0], colorH: colors[i + 1][7], colorM: colors[i + 1][12], colorG: colors[i + 1][6] }));
  const today = Utilities.formatDate(new Date(), 'Europe/Madrid', 'yyyy-MM-dd');
  return metrogestionPlanificarNecesidades_(records, today);
}

function metrogestionPreverNecesidades() {
  const sheet = SpreadsheetApp.openById(METROGESTION.spreadsheetId).getSheetByName(METROGESTION.sheetName);
  const plan = metrogestionLeerPlanNecesidades_(sheet);
  const escape = value => String(value || '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const rows = plan.nuevas.map(n => `<tr><td>${escape(n.values[0])}</td><td>${escape(n.values[7])}</td><td>${escape(n.values[8])}</td><td>Después de ${n.despuesDe}</td></tr>`).join('');
  const warnings = plan.avisos.map(w => `<li>Fila ${w.fila} · ${escape(w.dfm)} · ${escape(w.tipo)}: ${escape(w.motivo)}</li>`).join('');
  const html = `<html lang="es"><meta charset="utf-8"><style>body{font:14px sans-serif;padding:18px;color:#14283b}table{border-collapse:collapse;width:100%}td,th{padding:7px;border-bottom:1px solid #ddd;text-align:left}li{margin:8px 0}</style><h2>Próximas necesidades · Vista previa</h2><p>La hoja no se ha modificado.</p><p>${plan.nuevas.length} nuevas; ${plan.reutilizadas} ya existentes; ${plan.cambios.filter(c => c.cierre).length} cierres; ${plan.avisos.length} avisos.</p><table><tr><th>Unidad</th><th>Necesidad</th><th>Fecha</th><th>Origen</th></tr>${rows}</table><h3>Revisar</h3><ul>${warnings || '<li>Sin avisos.</li>'}</ul></html>`;
  SpreadsheetApp.getUi().showModalDialog(HtmlService.createHtmlOutput(html).setWidth(850).setHeight(600), 'Próximas necesidades');
}

function metrogestionPausarNecesidades() {
  const props = PropertiesService.getScriptProperties();
  const paused = props.getProperty('METROGESTION_NECESIDADES_PAUSADAS') === 'true';
  props.setProperty('METROGESTION_NECESIDADES_PAUSADAS', paused ? 'false' : 'true');
  SpreadsheetApp.getUi().alert(paused ? 'Reglas de próximas necesidades activadas.' : 'Reglas de próximas necesidades pausadas. La sincronización habitual continúa.');
}

function metrogestionPintarCierre_(sheet, row) {
  const g = sheet.getRange(row, 7).getBackground();
  const m = sheet.getRange(row, 13).getBackground();
  sheet.getRange(row, 1, 1, 17).setBackground('#d9ead3');
  if (metrogestionEsFondoAmarillo_(g)) sheet.getRange(row, 7).setBackground(g);
  if (metrogestionEsFondoAmarillo_(m)) sheet.getRange(row, 13).setBackground(m);
}

function metrogestionEjecutarPlanNecesidades_(sheet, plan, options) {
  const limits = options || { cambios: Infinity, nuevas: Infinity, deadline: Infinity };
  const applied = new Set();
  const changedParents = new Set(plan.cambios.map(c => c.fila));
  // Primero se actualizan las filas existentes; después se insertan las nuevas
  // de abajo arriba. Así ningún desplazamiento cambia la identidad del plan.
  plan.cambios.forEach(c => {
    if (applied.size >= limits.cambios || Date.now() >= limits.deadline) return;
    const current = sheet.getRange(c.fila, 1, 1, 17).getDisplayValues()[0];
    if (metrogestionFirmaNecesidad_(current) !== metrogestionFirmaNecesidad_(c.original)) {
      throw new Error(`La fila ${c.fila} cambió durante la planificación. Vuelve a sincronizar.`);
    }
    [6, 7, 8, 10, 12].forEach(i => {
      if (String(c.values[i]) === String(c.original[i])) return;
      if ([8, 10, 12].includes(i) && c.values[i]) {
        if (metrogestionFechaNecesidad_(c.values[i]) === metrogestionFechaNecesidad_(c.original[i])) return;
        sheet.getRange(c.fila, i + 1).setValue(metrogestionDate_(c.values[i])).setNumberFormat('dd/MM/yyyy');
      } else sheet.getRange(c.fila, i + 1).setValue(c.values[i]);
    });
    if (c.verde) metrogestionPintarCierre_(sheet, c.fila);
    if (c.pendiente) sheet.getRange(c.fila, 1, 1, 17).setBackground('#ffffff');
    if (c.anulada) sheet.getRange(c.fila, 1, 1, 17).setBackground('#eeeeee');
    if (c.amarilloM) sheet.getRange(c.fila, 13).setBackground('#ffff00');
    const noteCell = sheet.getRange(c.fila, 9);
    if (noteCell.getNote() !== c.nota) noteCell.setNote(c.nota);
    applied.add(c.fila);
  });
  const inserted = [];
  plan.nuevas.slice().sort((a, b) => b.despuesDe - a.despuesDe).forEach(n => {
    if (inserted.length >= limits.nuevas || Date.now() >= limits.deadline) return;
    // No crear una hija antes de guardar los cambios y la identidad del padre.
    if (changedParents.has(n.despuesDe) && !applied.has(n.despuesDe)) return;
    const parent = sheet.getRange(n.despuesDe, 1, 1, 17).getDisplayValues()[0];
    if (metrogestionNormalizar_(parent[0]) !== metrogestionNormalizar_(n.values[0])) {
      throw new Error(`Cambió la unidad de la fila ${n.despuesDe}; no se ha creado su próxima necesidad.`);
    }
    const parentId = metrogestionMetadatosNecesidad_(sheet.getRange(n.despuesDe, 9).getNote()).id;
    if (parentId !== metrogestionMetadatosNecesidad_(n.nota).origen) throw new Error(`Cambió el origen de la fila ${n.despuesDe}; vuelve a sincronizar.`);
    sheet.insertRowAfter(n.despuesDe);
    const target = n.despuesDe + 1;
    // La plantilla solo afecta A:Q. R/S pertenecen a ARRAYFORMULA.
    // Solo formato: un corte aquí nunca deja una copia de la fila realizada
    // ni de su identificador técnico en la fila recién insertada.
    sheet.getRange(n.despuesDe, 1, 1, 17).copyTo(sheet.getRange(target, 1, 1, 17), { formatOnly: true });
    const values = n.values.slice();
    values[8] = metrogestionDate_(values[8]);
    const range = sheet.getRange(target, 1, 1, 17);
    range.clearContent().clearNote().clearDataValidations().setValues([values]).setBackground('#ffffff');
    sheet.getRange(target, 9, 1, 3).setNumberFormat('dd/MM/yyyy');
    sheet.getRange(target, 9).setNote(n.nota);
    sheet.setRowHeight(target, sheet.getRowHeight(n.despuesDe));
    inserted.push(n.despuesDe);
  });
  const remaining = plan.cambios.length - applied.size + plan.nuevas.length - inserted.length;
  return { cierres: plan.cambios.filter(c => c.cierre && applied.has(c.fila)).length, renovacionesItv: plan.nuevas.filter(n => n.values[7] === 'ITV' && inserted.includes(n.despuesDe)).length, renovaciones: inserted.length, reutilizadas: plan.reutilizadas, avisos: plan.avisos, inserciones: inserted, cambiosAplicados: applied.size, restantes: remaining, pendiente: remaining > 0 };
}

function metrogestionAplicarReglaAdministrativa_(sheet, options) {
  if (PropertiesService.getScriptProperties().getProperty('METROGESTION_NECESIDADES_PAUSADAS') === 'true') {
    return { cierres: 0, renovaciones: 0, renovacionesItv: 0, reutilizadas: 0, avisos: [], inserciones: [], pausadas: true };
  }
  const plan = metrogestionLeerPlanNecesidades_(sheet);
  const result = metrogestionEjecutarPlanNecesidades_(sheet, plan, { cambios: METROGESTION_LOTES.cambios, nuevas: METROGESTION_LOTES.nuevas, deadline: options?.deadline || Date.now() + METROGESTION_LOTES.margenMs });
  if (plan.avisos.length) console.warn(JSON.stringify({ necesidades_por_revisar: plan.avisos }));
  return result;
}

// Cada llamada termina entre unidades de trabajo. No se conserva una fotografía
// de filas entre tandas: solo las órdenes originales y su confirmación pendiente.
const METROGESTION_LOTES = Object.freeze({ comandos: 3, cambios: 12, nuevas: 4, margenMs: 120000 });
const METROGESTION_PROGRESO = 'METROGESTION_CICLO';

function metrogestionLeerCiclo_() {
  const props = PropertiesService.getScriptProperties();
  const header = props.getProperty(METROGESTION_PROGRESO);
  if (!header) return null;
  const manifest = JSON.parse(header);
  if (!Number.isInteger(manifest.partes) || manifest.partes < 1 || manifest.partes > 24 || !/^[a-zA-Z0-9_-]+$/.test(manifest.generacion)) throw new Error('El avance guardado no es válido. No se ha reiniciado la sincronización.');
  let packed = '';
  for (let i = 0; i < manifest.partes; i++) {
    const part = props.getProperty(`${METROGESTION_PROGRESO}_${manifest.generacion}_${i}`);
    if (part === null) throw new Error('Falta una parte del avance guardado. No se ha reiniciado la sincronización.');
    packed += part;
  }
  if (metrogestionSha256_(packed) !== manifest.sha) throw new Error('El avance guardado está incompleto.');
  // Base64 conserva los bytes, pero no el tipo de contenido. Apps Script
  // necesita un MIME explícito para descomprimir el blob reconstruido.
  const compressed = Utilities.newBlob(Utilities.base64Decode(packed), 'application/gzip', 'metrogestion-ciclo.json.gz');
  const state = JSON.parse(Utilities.ungzip(compressed).getDataAsString('UTF-8'));
  if (state.hoja !== METROGESTION.spreadsheetId) throw new Error('El avance corresponde a otro archivo.');
  return state;
}

function metrogestionGuardarCiclo_(state) {
  const props = PropertiesService.getScriptProperties();
  const previous = JSON.parse(props.getProperty(METROGESTION_PROGRESO) || 'null');
  // Retirar fragmentos huérfanos de una escritura interrumpida, conservando
  // intacta la generación que todavía señala el manifiesto.
  Object.keys(props.getProperties()).filter(key => key.startsWith(METROGESTION_PROGRESO + '_') && (!previous || !key.startsWith(`${METROGESTION_PROGRESO}_${previous.generacion}_`))).forEach(key => props.deleteProperty(key));
  const json = Utilities.newBlob(JSON.stringify(state), 'application/json', 'metrogestion-ciclo.json');
  const packed = Utilities.base64Encode(Utilities.gzip(json, 'metrogestion-ciclo.json.gz').getBytes());
  const count = Math.ceil(packed.length / 8000);
  if (count > 24) throw new Error('La cola de sincronización es demasiado grande para guardar el avance.');
  const generation = Utilities.getUuid();
  const parts = {};
  for (let i = 0; i < count; i++) parts[`${METROGESTION_PROGRESO}_${generation}_${i}`] = packed.slice(i * 8000, (i + 1) * 8000);
  // El manifiesto cambia DESPUÉS de guardar todas las partes. Si hay un corte,
  // sigue disponible la última cola completa. Cada propiedad queda bajo 9 KB.
  props.setProperties(parts, false);
  props.setProperty(METROGESTION_PROGRESO, JSON.stringify({ generacion: generation, partes: count, sha: metrogestionSha256_(packed) }));
  Object.keys(props.getProperties()).filter(key => key.startsWith(METROGESTION_PROGRESO + '_') && !key.startsWith(`${METROGESTION_PROGRESO}_${generation}_`)).forEach(key => props.deleteProperty(key));
}

function metrogestionRespuestaCiclo_(state) {
  const pending = state.fase !== 'terminado';
  const message = pending
    ? (state.fase === 'comandos'
      ? `Sincronización en curso: ${state.confirmados} de ${state.totalComandos} órdenes guardadas. La siguiente tanda continuará automáticamente.`
      : `Próximas necesidades: ${state.creadas} creadas en este ciclo; ${state.restantes ?? 'pendientes de comprobar'} cambios por procesar. Continuando…`)
    : `${state.mensajeBase} ${state.confirmados} orden(es) confirmadas; ${state.cierres} cierre(s) y ${state.creadas} próxima(s) necesidad(es) creadas en este ciclo; ${state.avisos || 0} aviso(s) para revisar en «Vista previa de próximas necesidades».${state.pausadas ? ' Reglas predictivas pausadas.' : ''}`;
  const props = PropertiesService.getScriptProperties();
  props.setProperty('METROGESTION_ULTIMA_EJECUCION', new Date().toISOString());
  props.setProperty('METROGESTION_ULTIMO_RESULTADO', message);
  return { ciclo: state.id, pendiente: pending, mensaje: message };
}

function metrogestionEstadoHojaLote_(sheet) {
  const lastRow = sheet.getLastRow();
  return {
    values: sheet.getRange(1, 1, lastRow, 17).getDisplayValues(),
    notesA: sheet.getRange(1, 1, lastRow, 1).getNotes().map(r => String(r[0] || '')),
    notesE: sheet.getRange(1, 5, lastRow, 1).getNotes().map(r => String(r[0] || '')),
    cierresAdministrativos: [],
  };
}

function metrogestionProcesarOrdenesLote_(sheet, state, token, deadline) {
  const sheetState = metrogestionEstadoHojaLote_(sheet);
  const filterState = metrogestionSuspenderFiltro_(sheet);
  try {
    let processed = 0;
    while (state.comandos.length && processed < METROGESTION_LOTES.comandos && Date.now() < deadline) {
      const command = state.comandos[0];
      const confirmation = metrogestionAplicarComandos_(sheet, [command], sheetState, state.trabajos)[0];
      SpreadsheetApp.flush();
      // Confirmar antes de pasar a la siguiente orden evita repetir toda la
      // cola si se interrumpe después la generación predictiva. Los enlaces
      // se siguen resolviendo por UUID/clave, incluso si se insertan filas.
      metrogestionConfirmarComandos_(token, [confirmation]);
      state.comandos.shift();
      state.confirmados += 1;
      metrogestionGuardarCiclo_(state);
      processed += 1;
    }
    if (!state.comandos.length) { state.fase = 'necesidades'; state.trabajos = []; }
  } finally { metrogestionRestaurarFiltro_(sheet, filterState); }
}

function metrogestionEjecutarSincronizacion_(modo, expectedCycle) {
  const deadline = Date.now() + METROGESTION_LOTES.margenMs;
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) throw new Error('Ya hay otra tanda de sincronización en curso.');
  let state;
  try {
    state = metrogestionLeerCiclo_();
    if (expectedCycle && state?.id !== expectedCycle) throw new Error('Hay otro ciclo de sincronización. Cierra esta ventana y vuelve a abrir Sincronizar ahora.');
    if (expectedCycle && state?.fase === 'terminado') return metrogestionRespuestaCiclo_(state);
    const token = metrogestionLeerToken_();
    if (!token) throw new Error('No existe una clave de conexión en las Propiedades del script.');
    const book = SpreadsheetApp.openById(METROGESTION.spreadsheetId);
    if (book.getName() !== METROGESTION.spreadsheetName) throw new Error('No es el archivo MANTENIMIENTOS esperado.');
    const sheet = book.getSheetByName(METROGESTION.sheetName);
    if (!sheet) throw new Error('No existe la hoja MANTENIMENT.');
    if (!state || state.fase === 'terminado') {
      const { syncResult, trabajos } = metrogestionSolicitarCiclo_(sheet, modo, token);
      const commands = Array.isArray(syncResult.comandos_manteniment) ? syncResult.comandos_manteniment : [];
      state = { id: Utilities.getUuid(), hoja: METROGESTION.spreadsheetId, fase: commands.length ? 'comandos' : 'necesidades', comandos: commands, trabajos, totalComandos: commands.length, confirmados: 0, creadas: 0, cierres: 0, mensajeBase: syncResult.mensaje || 'Sincronización correcta.' };
      metrogestionGuardarCiclo_(state);
      // La lectura y el intercambio con Supabase tienen su propia ejecución.
      return metrogestionRespuestaCiclo_(state);
    }
    if (state.fase === 'comandos') {
      metrogestionProcesarOrdenesLote_(sheet, state, token, deadline);
    } else if (state.fase === 'necesidades') {
      const filterState = metrogestionSuspenderFiltro_(sheet);
      try {
        const result = metrogestionAplicarReglaAdministrativa_(sheet, { deadline });
        SpreadsheetApp.flush();
        state.creadas += result.renovaciones;
        state.cierres += result.cierres;
        state.avisos = result.avisos.length;
        state.pausadas = result.pausadas || false;
        state.restantes = result.restantes || 0;
        if (!result.pendiente) state.fase = 'terminado';
      } finally { metrogestionRestaurarFiltro_(sheet, filterState); }
    } else throw new Error('Fase de sincronización desconocida.');
    metrogestionGuardarCiclo_(state);
    return metrogestionRespuestaCiclo_(state);
  } catch (error) {
    const message = `ERROR${state ? ' en ' + state.fase : ''}: ${error.message}. El avance confirmado se conserva; puedes retomar con Sincronizar ahora.`;
    PropertiesService.getScriptProperties().setProperty('METROGESTION_ULTIMO_RESULTADO', message);
    throw error;
  } finally { lock.releaseLock(); }
}

function metrogestionContinuarSincronizacion(ciclo) {
  return metrogestionEjecutarSincronizacion_('manual', String(ciclo || ''));
}

function metrogestionReanudarProgramada() {
  const ciclo = PropertiesService.getScriptProperties().getProperty('METROGESTION_PROGRAMADA_CICLO');
  if (!ciclo) return;
  return metrogestionLanzarProgramada_(ciclo);
}

function metrogestionLanzarProgramada_(ciclo) {
  // Solo se usa cuando ya se está ejecutando la modalidad programada. No añade
  // una periodicidad nueva al abrir el menú manual.
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'metrogestionReanudarProgramada').forEach(t => ScriptApp.deleteTrigger(t));
  const result = metrogestionEjecutarSincronizacion_('programada', ciclo);
  const props = PropertiesService.getScriptProperties();
  if (result.pendiente) {
    props.setProperty('METROGESTION_PROGRAMADA_CICLO', result.ciclo);
    ScriptApp.newTrigger('metrogestionReanudarProgramada').timeBased().after(60000).create();
  } else props.deleteProperty('METROGESTION_PROGRAMADA_CICLO');
  return result;
}

function metrogestionSincronizarAhora() {
  const html = `<html lang="es"><meta charset="utf-8"><style>body{font:15px sans-serif;color:#17354a;padding:20px;line-height:1.6}button{padding:9px 18px;margin-top:12px}</style>
    <h2>Sincronizando MANTENIMENT</h2><p id="estado" role="status" aria-live="polite">Leyendo la hoja…</p>
    <p>Deja esta ventana abierta para continuar automáticamente. Si la cierras, podrás retomar desde <b>Sincronizar ahora</b>.</p>
    <button id="retomar" hidden>Reintentar</button><button onclick="google.script.host.close()">Cerrar</button>
    <script>
      let ciclo = '', ejecutando = false;
      const estado = document.getElementById('estado'), retomar = document.getElementById('retomar');
      function siguiente() {
        if (ejecutando) return;
        ejecutando = true; retomar.hidden = true;
        google.script.run.withSuccessHandler(function(r) {
          ejecutando = false; ciclo = r.ciclo; estado.textContent = r.mensaje;
          if (r.pendiente) setTimeout(siguiente, 300);
          else document.querySelector('h2').textContent = 'Sincronización terminada';
        }).withFailureHandler(function(e) {
          ejecutando = false; estado.textContent = e.message + ' El avance guardado se conserva.'; retomar.hidden = false;
        }).metrogestionContinuarSincronizacion(ciclo);
      }
      retomar.onclick = siguiente; siguiente();
    </script></html>`;
  SpreadsheetApp.getUi().showModalDialog(HtmlService.createHtmlOutput(html).setWidth(570).setHeight(350), 'Sincronizar MANTENIMENT');
}
// END MOTOR NECESIDADES
