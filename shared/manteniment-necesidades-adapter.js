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
