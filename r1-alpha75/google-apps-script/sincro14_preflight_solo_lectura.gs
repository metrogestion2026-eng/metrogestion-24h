/**
 * SINCRO 14 · DIAGNÓSTICO SEGURO DEL APPS SCRIPT REAL
 * Añadir como archivo NUEVO .gs al proyecto actualmente instalado.
 * Ejecutar SOLO metroSincro14PreflightSoloLectura.
 * No crea activadores, no modifica T ni REGISTRO_FILAS, no emite órdenes,
 * no contiene tokens, no envía datos a Supabase ni cambia permisos.
 */
function metroSincro14PreflightSoloLectura() {
  const ID = '1PQE5VsjTvDFvQZcqedyQKIs3RbSySHFK4JPQXBD0XyU';
  const ss = SpreadsheetApp.openById(ID);
  const hoja = ss.getSheetByName('MANTENIMENT');
  const registro = ss.getSheetByName('REGISTRO_FILAS');
  if (!hoja || !registro) throw new Error('S14: faltan las pestañas originales.');
  const ultima = hoja.getLastRow();
  const tRange = ultima >= 2 ? hoja.getRange(2, 20, ultima - 1, 1) : null;
  const tValues = tRange ? tRange.getValues() : [];
  const tFormulas = tRange ? tRange.getFormulas() : [];
  const cont = registro.getRange('H2').getValue();
  const num = v => typeof v === 'number' && Number.isSafeInteger(v) && v > 0;
  if (!num(cont)) throw new Error('S14: contador H2 no es entero positivo.');
  const rv = registro.getLastRow() >= 2
    ? registro.getRange(2, 1, registro.getLastRow() - 1, 5).getValues()
    : [];
  const rg = new Map();
  let registroDuplicado = 0, registroInvalido = 0, activos = 0, borrados = 0;
  rv.forEach(r => {
    if (!num(r[0]) || rg.has(r[0])) {
      if (!num(r[0])) registroInvalido++;
      else registroDuplicado++;
      return;
    }
    const status = String(r[1] || '').toUpperCase().trim();
    rg.set(r[0], status);
    if (status === 'ACTIVA') activos++;
    if (status === 'BORRADA') borrados++;
  });
  const presentes = new Set();
  let sinId = 0, repetidos = 0, invalidos = 0, sinRegistro = 0;
  tValues.forEach((r, i) => {
    const id = r[0];
    if (id === '' || id === null) sinId++;
    else if (tFormulas[i][0] || !num(id)) invalidos++;
    else if (presentes.has(id)) repetidos++;
    else {
      presentes.add(id);
      if (rg.get(id) !== 'ACTIVA') sinRegistro++;
    }
  });
  const ausentes = [...rg].filter(([id, status]) =>
    status === 'ACTIVA' && !presentes.has(id)).length;
  const propietarios = ['metrogestionIdentidadFilasCambio',
    'metrogestionIdentidadFilasEdicion',
    'metrogestionVigilarIdentidadSoloLectura'];
  const triggers = ScriptApp.getProjectTriggers()
    .map(t => ({funcion: t.getHandlerFunction(),
      tipo: String(t.getEventType()),
      origen: String(t.getTriggerSource())}));
  const own = propietarios.map(name => ({nombre: name,
    cantidad: triggers.filter(t => t.funcion === name).length}));
  const protectedT = hoja.getProtections(SpreadsheetApp.ProtectionType.RANGE)
    .filter(p => {
      const r = p.getRange();
      return r.getColumn() <= 20 && r.getLastColumn() >= 20
        && r.getRow() <= 2 && r.getLastRow() >= hoja.getMaxRows();
    })
    .map(p => {
      const editores = [];
      try { p.getEditors().forEach(u => editores.push(u.getEmail())); }
      catch (e) { editores.push('NO_VERIFICABLE'); }
      return {advertencia: p.isWarningOnly(), permiteEditarUsuarioActual: p.canEdit(),
        editores: editores.sort()};
    });
  const cuenta = Session.getEffectiveUser().getEmail();
  const bloqueador = LockService.getDocumentLock();
  const props = PropertiesService.getScriptProperties();
  const limpio = sinId === 0 && repetidos === 0 && invalidos === 0
    && sinRegistro === 0 && ausentes === 0 && registroDuplicado === 0
    && registroInvalido === 0 && presentes.size === activos;
  const reporte = {
    modo: 'SOLO_LECTURA_SIN_SINCRO',
    spreadsheetCorrecto: ss.getId() === ID,
    versionLocal: (typeof METROGESTION !== 'undefined'
      ? String(METROGESTION.buildVersion || '') : 'NO_DETECTADA'),
    cuentaEfectiva: cuenta || 'NO_ACREDITADA',
    documentoBloqueable: Boolean(bloqueador),
    actives: activos, registradasBorradas: borrados,
    idsPresentes: presentes.size, sinId, repetidos, invalidos,
    sinRegistro, ausentes, registroDuplicado, registroInvalido,
    ultimoIdEmitido: cont, rowCount: hoja.getMaxRows(),
    proteccionesT: protectedT,
    triggersVisiblesCuentaActual: own,
    ultimoErrorId: props.getProperty('METROGESTION_ID_FILA_ULTIMO_ERROR') || '',
    escrituraMantenimentAutorizada: false,
    sincronizacionAutorizada: false,
    preflightCorrecto: limpio && protectedT.some(p => !p.advertencia)
      && Boolean(bloqueador) && Boolean(cuenta)
  };
  console.log('SINCRO 14 PREFLIGHT: ' + JSON.stringify(reporte, null, 2));
  return reporte;
}
