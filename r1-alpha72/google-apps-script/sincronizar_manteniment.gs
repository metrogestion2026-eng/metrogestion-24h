const METROGESTION = Object.freeze({
  spreadsheetId: '1PQE5VsjTvDFvQZcqedyQKIs3RbSySHFK4JPQXBD0XyU',
  spreadsheetName: 'MANTENIMIENTOS',
  sheetName: 'MANTENIMENT',
  syncUrl: 'https://aemoouldgguyjsxrfuwo.supabase.co/functions/v1/manteniment-sync-r1',
  scriptVersion: 'alpha71-2026.09.02.1',
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
    };
    payload.checksum = metrogestionSha256_(JSON.stringify({ filas: rows, paradas }));
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
    const confirmations = metrogestionAplicarComandos_(sheet, commands);
    if (confirmations.length) metrogestionConfirmarComandos_(token, confirmations);
    const message = [
      syncResult.mensaje || 'Sincronización correcta.',
      `${paradas.length} parada(s) leída(s) y ${confirmations.length} fila(s) aplicada(s).`
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
    16: 'ALBARÀ / ENTRADA',
  };
  Object.keys(expected).forEach(key => {
    const column = Number(key);
    if (metrogestionNormalizar_(headers[column]) !== expected[column]) {
      throw new Error(`La estructura de MANTENIMENT ha cambiado en la columna ${column + 1}. No se envía ningún dato.`);
    }
  });
}

function metrogestionNormalizar_(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().toUpperCase();
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

function metrogestionNumero_(value, label) {
  let text = String(value || '').replace(/\s/g, '');
  if (!text) return '';
  if (text.includes(',') && text.includes('.')) text = text.replaceAll('.', '').replace(',', '.');
  else text = text.replace(',', '.');
  const number = Number(text);
  if (!Number.isFinite(number) || number < 0) throw new Error(`${label} no contiene un número válido: ${value}`);
  return number;
}

function metrogestionLeerParadasVinculadas_(values, notes) {
  const result = [];
  for (let index = 1; index < values.length; index += 1) {
    const note = String(notes[index]?.[0] || '').trim();
    const match = note.match(/^METROGESTION_PARADA:([0-9a-f-]{36})$/i);
    if (!match) continue;
    const row = values[index];
    if (metrogestionNormalizar_(row[7]) !== 'PARADA') {
      throw new Error(`La fila vinculada ${index + 1} debe conservar MANTENIMENT = PARADA.`);
    }
    result.push({
      fila: index + 1,
      sync_id: match[1],
      dfm: row[0],
      matricula: row[1],
      tipo: row[2],
      upc: row[3],
      sustituto: row[6],
      estado: row[7],
      fecha_programada: metrogestionFechaIso_(row[8], `programada de la fila ${index + 1}`),
      fecha_parada: metrogestionFechaIso_(row[9], `de parada de la fila ${index + 1}`),
      fecha_k: metrogestionFechaIso_(row[10], `de recuperación o corte de la fila ${index + 1}`),
      dias_parada: metrogestionNumero_(row[11], `Los días de la fila ${index + 1}`),
      marca: row[14],
      km_facturables: metrogestionNumero_(row[15], `Los kilómetros de la fila ${index + 1}`),
      tancament: metrogestionNormalizar_(row[16]),
    });
  }
  return result;
}

function metrogestionAplicarComandos_(sheet, commands) {
  return commands.map(command => {
    if (command?.tipo === 'alta') return metrogestionAplicarComandoAlta_(sheet, command);
    const payload = command?.payload || {};
    const syncId = String(command?.sync_id || payload.sync_id || '').trim();
    if (!/^[0-9a-f-]{36}$/i.test(syncId)) throw new Error('Supabase devolvió una fila PARADA sin identificador válido.');
    let rowNumber = metrogestionBuscarFilaPorSyncId_(sheet, syncId);
    if (!rowNumber) rowNumber = metrogestionInsertarFilaParada_(sheet, payload);
    metrogestionEscribirFilaParada_(sheet, rowNumber, payload, syncId);
    return {
      tipo: 'parada',
      sync_id: syncId,
      revision: Number(command.revision),
      estado: 'aplicado',
      fila: rowNumber,
    };
  });
}

function metrogestionAplicarComandoAlta_(sheet, command) {
  const payload = command?.payload || {};
  const vehicleId = String(command?.vehiculo_id || payload.vehiculo_id || '').trim();
  if (!/^[0-9a-f-]{36}$/i.test(vehicleId)) throw new Error('Supabase devolvió un activo sin identificador válido.');
  let rowNumber = metrogestionBuscarFilaAlta_(sheet, payload);
  if (!rowNumber) rowNumber = metrogestionInsertarFilaAlta_(sheet);
  metrogestionEscribirFilaAlta_(sheet, rowNumber, payload, vehicleId);
  return {
    tipo: 'alta',
    vehiculo_id: vehicleId,
    revision: Number(command.revision),
    estado: 'aplicado',
    fila: rowNumber,
  };
}

function metrogestionBuscarFilaAlta_(sheet, payload) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return 0;
  const requested = Number(payload.fila || 0);
  if (requested >= 2 && requested <= lastRow) {
    const current = sheet.getRange(requested, 1, 1, 8).getDisplayValues()[0];
    if (metrogestionNormalizar_(current[0]) === metrogestionNormalizar_(payload.dfm)) return requested;
  }
  const values = sheet.getRange(2, 1, lastRow - 1, 8).getDisplayValues();
  const dfm = metrogestionNormalizar_(payload.dfm);
  const index = values.findIndex(row => metrogestionNormalizar_(row[0]) === dfm && metrogestionNormalizar_(row[7]) === 'ALTA');
  return index < 0 ? 0 : index + 2;
}

function metrogestionInsertarFilaAlta_(sheet) {
  const lastRow = sheet.getLastRow();
  const values = sheet.getRange(2, 1, Math.max(lastRow - 1, 1), 8).getDisplayValues();
  const exampleIndex = values.findIndex(row => metrogestionNormalizar_(row[7]) === 'ALTA');
  if (exampleIndex < 0) throw new Error('No existe una fila ALTA que pueda utilizarse como plantilla.');
  const exampleRow = exampleIndex + 2;
  sheet.insertRowAfter(lastRow);
  const targetRow = lastRow + 1;
  const lastColumn = Math.max(sheet.getLastColumn(), 17);
  sheet.getRange(exampleRow, 1, 1, lastColumn).copyTo(sheet.getRange(targetRow, 1, 1, lastColumn));
  sheet.getRange(targetRow, 1, 1, 17).clearContent().clearNote();
  sheet.setRowHeight(targetRow, sheet.getRowHeight(exampleRow));
  return targetRow;
}

function metrogestionEscribirFilaAlta_(sheet, rowNumber, payload, vehicleId) {
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
}

function metrogestionBuscarFilaPorSyncId_(sheet, syncId) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return 0;
  const notes = sheet.getRange(2, 1, lastRow - 1, 1).getNotes();
  const expected = `METROGESTION_PARADA:${syncId}`.toUpperCase();
  const index = notes.findIndex(item => String(item[0] || '').trim().toUpperCase() === expected);
  return index < 0 ? 0 : index + 2;
}

function metrogestionInsertarFilaParada_(sheet, payload) {
  const lastRow = sheet.getLastRow();
  const values = sheet.getRange(2, 1, Math.max(lastRow - 1, 1), 8).getDisplayValues();
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
  return targetRow;
}

function metrogestionDate_(iso) {
  const text = String(iso || '').trim();
  if (!text) return '';
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) throw new Error(`Supabase devolvió una fecha no válida: ${text}`);
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function metrogestionEscribirFilaParada_(sheet, rowNumber, payload, syncId) {
  const range = sheet.getRange(rowNumber, 1, 1, 17);
  const row = range.getValues()[0];
  row[0] = payload.dfm || '';
  row[1] = payload.matricula || '';
  row[2] = payload.tipo || '';
  row[3] = payload.upc || '';
  row[6] = payload.sustituto || '';
  row[7] = 'PARADA';
  row[8] = metrogestionDate_(payload.fecha_programada);
  row[9] = metrogestionDate_(payload.fecha_parada);
  row[10] = metrogestionDate_(payload.fecha_k);
  row[11] = payload.dias_parada ?? '';
  row[14] = payload.marca || '';
  row[15] = payload.km_facturables ?? '';
  row[16] = payload.tancament || '';
  range.setValues([row]);
  sheet.getRange(rowNumber, 9, 1, 3).setNumberFormat('dd/MM/yyyy');
  sheet.getRange(rowNumber, 12).setNumberFormat('0');
  sheet.getRange(rowNumber, 16).setNumberFormat('0.00');
  sheet.getRange(rowNumber, 1).setNote(`METROGESTION_PARADA:${syncId}`);
  const baseColour = '#d9e2e3';
  sheet.getRange(rowNumber, 1, 1, 17).setBackground(baseColour);
  sheet.getRange(rowNumber, 17).setBackground(
    payload.tancament && payload.tancament_supervisado !== true ? '#f4cccc' : baseColour
  );
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
