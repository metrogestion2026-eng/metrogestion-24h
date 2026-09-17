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
  const state = JSON.parse(Utilities.ungzip(Utilities.newBlob(Utilities.base64Decode(packed))).getDataAsString());
  if (state.hoja !== METROGESTION.spreadsheetId) throw new Error('El avance corresponde a otro archivo.');
  return state;
}

function metrogestionGuardarCiclo_(state) {
  const props = PropertiesService.getScriptProperties();
  const previous = JSON.parse(props.getProperty(METROGESTION_PROGRESO) || 'null');
  // Retirar fragmentos huérfanos de una escritura interrumpida, conservando
  // intacta la generación que todavía señala el manifiesto.
  Object.keys(props.getProperties()).filter(key => key.startsWith(METROGESTION_PROGRESO + '_') && (!previous || !key.startsWith(`${METROGESTION_PROGRESO}_${previous.generacion}_`))).forEach(key => props.deleteProperty(key));
  const packed = Utilities.base64Encode(Utilities.gzip(Utilities.newBlob(JSON.stringify(state))).getBytes());
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
