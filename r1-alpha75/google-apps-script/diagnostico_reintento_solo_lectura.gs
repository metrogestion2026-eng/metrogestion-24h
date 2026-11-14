// Añadir como archivo independiente al proyecto vinculado. No ejecuta SINCRO.
// Solo resume estado; no concede autorización ni verifica datos de la hoja.
function metrogestionComprobarReintentoSoloLectura() {
  const report = { diagnostico: 'reintento_solo_lectura_v1', solo_lectura: true };
  const inspect = (code, read) => { try { return read(); } catch (_) { return { error: code }; } };
  const version = value => typeof value === 'string'
    && /^(?:alpha75-[0-9.]+|MG75-EJECUCION-ORDEN-\d+)$/.test(value) ? value : null;
  const uuid = value => typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value) ? value : null;
  const reference = value => {
    const r = metrogestionReferenciaOrden_(value);
    return { tipo: r.tipo, sync_id: r.sync_id, revision: r.revision, payload_sha256: r.payload_sha256 };
  };
  report.versiones = inspect('CONFIG_NO_LEGIBLE', () => ({
    build: version(METROGESTION.buildVersion), script: version(METROGESTION.scriptVersion),
    ejecutor: version(METROGESTION.executorVersion),
  }));
  report.estado = inspect('PROPIEDADES_NO_LEGIBLES', () => {
    const props = PropertiesService.getScriptProperties();
    const state = {};
    state.ciclo = inspect('CICLO_NO_VERIFICABLE', () => {
      const c = metrogestionLeerCiclo_(); // Getter revisado: lectura, hash y descompresión.
      if (!c) return { presente: false };
      const commands = Array.isArray(c.comandos) ? c.comandos : [];
      return { presente: true, integridad: 'verificada', id: uuid(c.id),
        fase: ['comandos', 'terminado'].includes(c.fase) ? c.fase : 'otra_o_legada',
        version: version(c.version), ejecutor: version(c.version_ejecucion),
        comandos: commands.length, referencias: commands.slice(0, 200).map(reference),
        referencias_omitidas: Math.max(0, commands.length - 200),
        confirmacion_pendiente: Boolean(c.confirmacionPendiente) };
    });
    state.alcance = inspect('ALCANCE_NO_VERIFICABLE', () => {
      const refs = metrogestionLeerAlcanceOrdenes_(); // Getter revisado, sin efectos.
      return { presente: refs !== null, referencias: (refs || []).map(reference) };
    });
    state.solicitud_entrega = inspect('SOLICITUD_NO_LEGIBLE', () => {
      const raw = props.getProperty('METROGESTION_SOLICITUD_ENTREGA_V1');
      if (!raw) return { presente: false };
      const saved = JSON.parse(raw), id = uuid(saved.request_id);
      if (!id || saved.spreadsheet_id !== METROGESTION.spreadsheetId
          || saved.version_ejecucion !== METROGESTION.executorVersion) throw new Error();
      return { presente: true, request_id: id,
        cabecera_entrega_presente: props.getProperty('METROGESTION_ENTREGA_V1:' + id) !== null,
        integridad_entrega: 'no_comprobada' };
    });
    state.diarios = inspect('DIARIOS_NO_LEGIBLES', () => {
      // Enumerar nombres no lee valores ajenos: nunca usar getProperties().
      const keys = props.getKeys().filter(key => key.startsWith('METROGESTION_ORDEN_V1:'));
      const counts = { aplicando: 0, aplicado: 0, incierto: 0, confirmado: 0, error: 0 };
      const items = [];
      keys.forEach(key => {
        const item = inspect('DIARIO_NO_VERIFICABLE', () => {
          if (!/^METROGESTION_ORDEN_V1:[0-9a-f]{64}$/.test(key)) throw new Error();
          const raw = JSON.parse(props.getProperty(key)), ref = reference(raw.referencia);
          if (metrogestionClaveJournalOrden_(ref) !== key) throw new Error();
          const saved = metrogestionLeerJournalOrden_(ref); // Getter revisado, sin efectos.
          return { estado: saved.estado, referencia: ref };
        });
        counts[item.error ? 'error' : item.estado] += 1;
        if (item.estado !== 'confirmado' && items.length < 100) items.push(item);
      });
      return { total: keys.length, estados: counts, pendientes: items,
        pendientes_omitidos: Math.max(0, keys.length - counts.confirmado - items.length) };
    });
    return state;
  });
  report.activadores = inspect('ACTIVADORES_NO_LEGIBLES', () => {
    const counts = { metrogestionSincronizarProgramada: 0,
      metrogestionReanudarProgramada: 0, metrogestionIdentidadFilasCambio: 0 };
    ScriptApp.getProjectTriggers().forEach(trigger => {
      const name = trigger.getHandlerFunction();
      if (Object.prototype.hasOwnProperty.call(counts, name)) counts[name] += 1;
    });
    return { alcance: 'solo_usuario_ejecutor', cantidades: counts };
  });
  // Separar referencias evita truncar una selección larga en una línea de log.
  const compact = JSON.parse(JSON.stringify(report));
  if (compact.estado?.ciclo?.referencias) compact.estado.ciclo.referencias = compact.estado.ciclo.referencias.length;
  if (compact.estado?.alcance?.referencias) compact.estado.alcance.referencias = compact.estado.alcance.referencias.length;
  if (compact.estado?.diarios?.pendientes) compact.estado.diarios.pendientes = compact.estado.diarios.pendientes.length;
  Logger.log(JSON.stringify(compact));
  (report.estado?.ciclo?.referencias || []).forEach(ref => Logger.log(JSON.stringify({ ciclo: ref })));
  (report.estado?.alcance?.referencias || []).forEach(ref => Logger.log(JSON.stringify({ alcance: ref })));
  (report.estado?.diarios?.pendientes || []).forEach(item => Logger.log(JSON.stringify({ diario: item })));
  return report;
}
