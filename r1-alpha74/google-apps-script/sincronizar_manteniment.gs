const METROGESTION = Object.freeze({
  spreadsheetId: '1PQE5VsjTvDFvQZcqedyQKIs3RbSySHFK4JPQXBD0XyU',
  spreadsheetName: 'MANTENIMIENTOS',
  sheetName: 'MANTENIMENT',
  syncUrl: 'https://aemoouldgguyjsxrfuwo.supabase.co/functions/v1/manteniment-sync-r1',
  scriptVersion: 'alpha74-2026.09.06.12',
  tokenProperty: 'METROGESTION_SYNC_TOKEN',
  triggerHandler: 'metrogestionSincronizarProgramada',
});

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
    const confirmations = metrogestionAplicarComandos_(sheet, commands, sheetState);
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

function metrogestionLeerToken_() {
  return (PropertiesService.getScriptProperties().getProperty(METROGESTION.tokenProperty) || '').trim();
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
      km_facturables: metrogestionNumero_(row[15], `Los kilómetros de la fila ${index + 1}`, periodoAbierto),
      tancament: metrogestionNormalizar_(row[16]),
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

function metrogestionLeerTrabajos_(values, workNotes, workBackgrounds, fechaCorteIso) {
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
    if (!dfm || !designacion || ignored.has(designacion) || !String(row[8] || '').trim()) continue;
    const trabajoSyncId = metrogestionNotaTrabajoId_(workNotes[index]?.[0]);
    const numeroParada = String(row[4] || '').trim();
    const fechaNecesidad = metrogestionFechaIso_(row[8], `de necesidad de la fila ${index + 1}`);
    const fechaRealizada = metrogestionFechaIso_(row[9], `de realización de la fila ${index + 1}`);
    const vinculada = Boolean(trabajoSyncId || numeroParada);
    const pendienteFondoBlanco = metrogestionEsFondoBlanco_(workBackgrounds?.[index]?.[0]);

    // Las líneas históricas terminadas no vinculadas y las necesidades aún
    // lejanas no deben viajar en cada sincronización. Una línea ya vinculada
    // siempre se conserva para poder reflejar su realización o recogida.
    if (!vinculada && !pendienteFondoBlanco) continue;
    if (!vinculada && fechaRealizada) continue;
    if (!vinculada && fechaCorteIso && fechaNecesidad > fechaCorteIso) continue;
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
      fecha_necesidad: fechaNecesidad,
      fecha_realizada: fechaRealizada,
      fecha_recogida: metrogestionFechaIso_(row[10], `de recogida de la fila ${index + 1}`),
      pendiente_fondo_blanco: pendienteFondoBlanco,
    });
  }
  return result;
}

function metrogestionAplicarComandos_(sheet, commands, sheetState) {
  return commands.map(command => {
    if (command?.tipo === 'alta') return metrogestionAplicarComandoAlta_(sheet, command, sheetState);
    const payload = command?.payload || {};
    const syncId = String(command?.sync_id || payload.sync_id || '').trim();
    if (!/^[0-9a-f-]{36}$/i.test(syncId)) throw new Error('Supabase devolvió una fila PARADA sin identificador válido.');
    let rowNumber = metrogestionBuscarFilaPorSyncId_(sheet, syncId, sheetState);
    if (!rowNumber) rowNumber = metrogestionBuscarFilaParadaExistente_(sheet, payload, sheetState);
    const nuevaFila = !rowNumber;
    if (nuevaFila) rowNumber = metrogestionInsertarFilaParada_(sheet, payload, sheetState);
    metrogestionEscribirFilaParada_(sheet, rowNumber, payload, syncId, nuevaFila, sheetState);
    const assignedWorks = metrogestionAplicarAsignacionesTrabajos_(
      sheet,
      Array.isArray(payload.trabajos_asignados) ? payload.trabajos_asignados : [],
      payload.numero_parada,
      sheetState
    );
    return {
      tipo: 'parada',
      sync_id: syncId,
      revision: Number(command.revision),
      estado: 'aplicado',
      fila: rowNumber,
      trabajos_asignados: assignedWorks,
    };
  });
}

function metrogestionNotaConTrabajo_(note, syncId) {
  const lines = String(note || '').split(/\r?\n/)
    .filter(line => line && !/^METROGESTION_T:/i.test(line));
  lines.push(`METROGESTION_T:${syncId}`);
  return lines.join('\n');
}

function metrogestionBuscarFilaTrabajo_(sheet, assignment, usedRows, sheetState) {
  const lastRow = sheetState?.values?.length || sheet.getLastRow();
  const expectedKey = String(assignment?.clave_fila || '').trim();
  const requested = Number(assignment?.fila || 0);
  if (requested >= 2 && requested <= lastRow && !usedRows.has(requested)) {
    const row = sheetState?.values?.[requested - 1]
      || sheet.getRange(requested, 1, 1, 17).getDisplayValues()[0];
    if (metrogestionClaveFilaTrabajo_(row) === expectedKey) return requested;
  }
  const values = sheetState?.values?.slice(1)
    || sheet.getRange(2, 1, lastRow - 1, 17).getDisplayValues();
  const matches = [];
  values.forEach((row, index) => {
    const rowNumber = index + 2;
    if (!usedRows.has(rowNumber) && metrogestionClaveFilaTrabajo_(row) === expectedKey) matches.push(rowNumber);
  });
  if (!matches.length) throw new Error(`No se localiza la necesidad procedente de la fila ${requested || 'desconocida'}.`);
  matches.sort((a, b) => Math.abs(a - requested) - Math.abs(b - requested) || a - b);
  return matches[0];
}

function metrogestionAplicarAsignacionesTrabajos_(sheet, assignments, numeroParada, sheetState) {
  if (!assignments.length) return 0;
  const expectedStop = metrogestionNormalizar_(numeroParada).replace(/^PA-/, '');
  if (!expectedStop) throw new Error('No se pueden vincular T sin número de parada.');
  const usedRows = new Set();
  const planned = assignments.map(assignment => {
    const syncId = String(assignment?.trabajo_sync_id || '').trim();
    if (!/^[0-9a-f-]{36}$/i.test(syncId)) throw new Error('Supabase devolvió una T sin identificador válido.');
    const rowNumber = metrogestionBuscarFilaTrabajo_(sheet, assignment, usedRows, sheetState);
    usedRows.add(rowNumber);
    const currentStopValue = sheetState?.values?.[rowNumber - 1]?.[4]
      ?? sheet.getRange(rowNumber, 5).getDisplayValue();
    const currentStop = metrogestionNormalizar_(currentStopValue).replace(/^PA-/, '');
    if (currentStop && currentStop !== expectedStop) {
      throw new Error(`La fila ${rowNumber} ya pertenece a otra parada. No se ha reasignado.`);
    }
    return { rowNumber, syncId };
  });

  planned.forEach(({ rowNumber, syncId }) => {
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
  return planned.length;
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
  const lastColumn = Math.max(sheet.getLastColumn(), 17);
  sheet.getRange(exampleRow, 1, 1, lastColumn).copyTo(sheet.getRange(targetRow, 1, 1, lastColumn));
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
    `La parada ${payload.numero_parada} del DFM ${payload.dfm} mantiene varias filas igualmente válidas; no se ha creado ni modificado ninguna.`
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
  const lastColumn = Math.max(sheet.getLastColumn(), 17);
  sheet.getRange(altaRow, 1, 1, lastColumn).copyTo(sheet.getRange(targetRow, 1, 1, lastColumn));
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
    // MANTENIMENT gobierna I-K, L, P y Q, por lo que nunca se reescriben aquí.
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
