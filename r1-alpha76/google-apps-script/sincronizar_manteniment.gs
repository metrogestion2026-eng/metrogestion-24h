const METROGESTION = Object.freeze({
  spreadsheetId: '1PQE5VsjTvDFvQZcqedyQKIs3RbSySHFK4JPQXBD0XyU',
  spreadsheetName: 'MANTENIMIENTOS',
  sheetName: 'MANTENIMENT',
  archivoFlotaFolderId: '1dh2MBTf3KctAh6KvaisAWa-F895ta7YO',
  syncUrl: 'https://aemoouldgguyjsxrfuwo.supabase.co/functions/v1/manteniment-sync-r1',
  scriptVersion: 'alpha75-2026.09.11.8',
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

function metrogestionSincronizarAhora() {
  const ui = SpreadsheetApp.getUi();
  try {
    const result = metrogestionEjecutarSincronizacion_('manual');
    ui.alert(result.mensaje || 'Sincronización completada.');
  } catch (error) {
    ui.alert(`No se pudo sincronizar: ${error.message}`);
    throw error;
  }
}

function metrogestionSincronizarProgramada() {
  metrogestionEjecutarSincronizacion_('programada');
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

function metrogestionEjecutarSincronizacion_(modo) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) throw new Error('Ya hay otra sincronización en curso.');
  try {
    const token = metrogestionLeerToken_();
    if (!token) throw new Error('No existe una clave de conexión en las Propiedades del script.');
    const spreadsheet = SpreadsheetApp.openById(METROGESTION.spreadsheetId);
    if (spreadsheet.getName() !== METROGESTION.spreadsheetName) {
      throw new Error('El script no está vinculado al archivo MANTENIMIENTOS esperado.');
    }
    const sheet = spreadsheet.getSheetByName(METROGESTION.sheetName);
    if (!sheet) throw new Error('No existe la hoja MANTENIMENT.');
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
      metrogestionFechaCorteTrabajos_()
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
    const commands = Array.isArray(syncResult.comandos_manteniment) ? syncResult.comandos_manteniment : [];
    // Reutilizamos la fotografía ya leída. Así, cada orden no vuelve a recorrer
    // las más de siete mil filas de MANTENIMENT.
    const sheetState = {
      values: values.map(row => row.slice()),
      notesA: notes.map(row => String(row?.[0] || '')),
      notesE: workNotes.map(row => String(row?.[0] || '')),
    };
    // Google Sheets impide escribir o insertar sobre filas ocultas por un filtro
    // básico. Conservamos el filtro, lo retiramos solo durante las escrituras y
    // lo restauramos siempre, también si una orden produce un error.
    const filterState = commands.length ? metrogestionSuspenderFiltro_(sheet) : null;
    let confirmations;
    try {
      confirmations = metrogestionAplicarComandos_(sheet, commands, sheetState, trabajos);
    } finally {
      metrogestionRestaurarFiltro_(sheet, filterState);
    }
    if (confirmations.length) metrogestionConfirmarComandos_(token, confirmations);
    const assignedWorks = confirmations.reduce((total, item) => total + Number(item.trabajos_asignados || 0), 0);
    const message = [
      syncResult.mensaje || 'Sincronización correcta.',
      `${paradas.length} parada(s) y ${trabajos.length} necesidad(es) leída(s); ${confirmations.length} comando(s) y ${assignedWorks} asignación(es) aplicados.`
    ].join(' ');
    const props = PropertiesService.getScriptProperties();
    props.setProperty('METROGESTION_ULTIMA_EJECUCION', generatedAt.toISOString());
    props.setProperty('METROGESTION_ULTIMO_RESULTADO', message);
    return { ...syncResult, mensaje: message };
  } catch (error) {
    const props = PropertiesService.getScriptProperties();
    props.setProperty('METROGESTION_ULTIMA_EJECUCION', new Date().toISOString());
    props.setProperty('METROGESTION_ULTIMO_RESULTADO', `ERROR: ${error.message}`);
    throw error;
  } finally {
    lock.releaseLock();
  }
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

function metrogestionClaveFilaTrabajo_(row) {
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
    metrogestionNormalizar_(row[6]),
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

function metrogestionLeerTrabajos_(values, workNotes, workBackgrounds, priorityBackgrounds, fechaCorteIso) {
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
    const numeroParada = String(row[4] || '').trim();
    const fechaNecesidad = metrogestionFechaIso_(row[8], `de necesidad de la fila ${index + 1}`);
    const fechaRealizada = metrogestionFechaIso_(row[9], `de realización de la fila ${index + 1}`);
    // Solo la nota técnica confirma que la necesidad ya está vinculada. Tener
    // un número en E no convierte una línea histórica realizada en pendiente.
    const vinculada = Boolean(trabajoSyncId);
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
    if (!vinculada && fechaRealizada) continue;
    if (!vinculada && !prioridadFondoAmarillo && fechaCorteIso && fechaNecesidad > fechaCorteIso) continue;
    result.push({
      fila: index + 1,
      trabajo_sync_id: trabajoSyncId,
      clave_fila: metrogestionClaveFilaTrabajo_(row),
      dfm: row[0],
      matricula: row[1],
      numero_parada: numeroParada,
      taller: row[5],
      tipo_trabajo: row[6],
      designacion: row[7],
      marca_vehiculo: row[14],
      marca_equipo: row[16],
      fecha_necesidad: fechaNecesidad,
      fecha_realizada: fechaRealizada,
      fecha_recogida: metrogestionFechaIso_(row[10], `de recogida de la fila ${index + 1}`),
      pendiente_fondo_blanco: pendienteFondoBlanco,
      prioridad_fondo_amarillo: prioridadFondoAmarillo,
    });
  }
  return result;
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
  const currentUrls = matchingRows.map(rowNumber => {
    const richText = sheet.getRange(rowNumber, 5).getRichTextValue();
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

function metrogestionTrabajoActual_(assignment, currentWorks) {
  const works = Array.isArray(currentWorks) ? currentWorks : [];
  const expectedKey = String(assignment?.clave_fila || '').trim();
  return works.find(work => String(work?.clave_fila || '').trim() === expectedKey) || null;
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
    const currentWork = metrogestionTrabajoActual_(assignment, currentWorks);
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
      if (cached) cached[9] = fechaEntradaIso;
    }

    if (fechaSalidaIso && !(revertThisWork && reversion?.limpiar_fecha_salida === true)) {
      const currentExit = String(cached?.[10] ?? sheet.getRange(item.rowNumber, 11).getDisplayValue()).trim();
      if (!currentExit) sheet.getRange(item.rowNumber, 11).setValue(metrogestionDate_(fechaSalidaIso));
      sheet.getRange(item.rowNumber, 11).setNumberFormat('dd/MM/yyyy');
      sheet.getRange(item.rowNumber, 1, 1, 17).setBackground('#d9ead3');
      if (cached) cached[10] = fechaSalidaIso;
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
    // MANTENIMENT sigue gobernando I, J, L y P. Q conserva cualquier valor
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
    cached[14] = payload.marca || '';
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
