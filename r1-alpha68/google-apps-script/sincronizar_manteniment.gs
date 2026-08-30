const METROGESTION = Object.freeze({
  spreadsheetId: '1PQE5VsjTvDFvQZcqedyQKIs3RbSySHFK4JPQXBD0XyU',
  spreadsheetName: 'MANTENIMIENTOS',
  sheetName: 'MANTENIMENT',
  syncUrl: 'https://aemoouldgguyjsxrfuwo.supabase.co/functions/v1/manteniment-sync-r1',
  scriptVersion: 'alpha68-2026.08.30.1',
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
        fecha_alta: metrogestionFechaIso_(row[8]),
        asignacion: row[13],
        marca: row[14],
        bastidor: row[16],
      });
    }
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
    };
    payload.checksum = metrogestionSha256_(JSON.stringify(rows));
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
    const message = syncResult.mensaje || 'Sincronización correcta.';
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

function metrogestionFechaIso_(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  let match = text.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (match) return `${match[3]}-${match[2]}-${match[1]}`;
  match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) return text;
  throw new Error(`Fecha de ALTA no válida: ${text}`);
}

function metrogestionSha256_(text) {
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8);
  return digest.map(byte => (byte + 256).toString(16).slice(-2)).join('');
}
