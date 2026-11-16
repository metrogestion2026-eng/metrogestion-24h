/**
 * SINCRO 11 · Detector PURO de diferencias operativas futuras.
 * Candidato en aislamiento: sin Google, HTTP, Supabase, escrituras ni disparadores.
 * Identidad exclusivamente columna T (ID_FILA); no índice físico, PA ni DFM.
 * No interpreta fechas históricas I/J/K como fechas de edición.
 * Las fórmulas (y sus resultados recalculados) quedan fuera de diferencias
 * operativas; sus NOTAS sí se comparan. Esto NO modifica fórmulas existentes.
 * NUNCA autoriza una sincronización ni atribuye quién efectuó un cambio.
 * No consume, sustituye ni resella la base V1 ya sellada en Apps Script.
 */

export const CORTE_FUTURO_METROGES = '2026-11-15T23:00:00.000Z'; // 16/11/2026 00:00 en Madrid.
export const COLUMNAS = Object.freeze([
  'DFM','MATRI','TIPO','UPC/inc','EXP/M/GP/GC/GM','LUGAR/TALLER/TEL',
  'PEDIDO/NOTA/FIN CONTRA','MANTENIMENT','PROGRAMAT','FET','RECOLLIT',
  'VALOR / CONTROL','PROPER','ASSIGNAT','MARCA','KM / HORES',
  'ALBARÀ / ENTRADA','R','S','ID_FILA','U','V','W','X','Y','Z',
]);
const N = 26, INDICE_ID = 19;
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const letraColumna = idx => String.fromCharCode(65 + idx);

function marcaTemporal(value, etiqueta) {
  assert(typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value), `${etiqueta}: requiere hora UTC exacta`);
  const timestamp = Date.parse(value);
  assert(Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value, `${etiqueta}: fecha inválida`);
  return timestamp;
}

function leerId(value) {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value > 0 ? value : null;
  if (typeof value === 'string' && /^[1-9]\d{0,14}$/.test(value)) {
    const n = Number(value);
    return Number.isSafeInteger(n) && n > 0 ? n : null;
  }
  return null;
}

function valorCanonico(value) {
  if (value instanceof Date) {
    assert(Number.isFinite(value.getTime()), 'Fecha de celda inválida');
    return ['DATE', value.toISOString()];
  }
  if (value === null || value === undefined) return ['VACIO', ''];
  if (typeof value === 'number') {
    assert(Number.isFinite(value), 'Número de celda inválido');
    return ['NUMERO', value];
  }
  if (typeof value === 'boolean') return ['BOOLEANO', value];
  assert(typeof value === 'string', 'Valor de celda no admitido');
  return ['TEXTO', value];
}

function campo(row, i) {
  const formula = row.formulas[i];
  const note = row.notes[i];
  assert(formula == null || typeof formula === 'string', `Fórmula inválida en ${letraColumna(i)}`);
  assert(note == null || typeof note === 'string', `Nota inválida en ${letraColumna(i)}`);
  return {
    // IMPORTANTE: no se compara el texto =K123-J123+1 ni su resultado.
    dato: formula ? ['FORMULA_HISTORICA_NO_OPERATIVA'] : valorCanonico(row.values[i]),
    nota: note || '',
  };
}

function indexar(snapshot, nombre) {
  assert(snapshot && Array.isArray(snapshot.rows), `${nombre}: faltan filas`);
  const time = marcaTemporal(snapshot.capturada_en, `${nombre}.capturada_en`);
  assert(time >= marcaTemporal(CORTE_FUTURO_METROGES, 'corte'), `${nombre}: anterior al corte; no reconciliar históricos`);
  assert(snapshot.rows.length <= 25000, `${nombre}: lectura excesiva`);
  const index = new Map();
  for (const row of snapshot.rows) {
    assert(row && Array.isArray(row.values) && Array.isArray(row.formulas) && Array.isArray(row.notes), `${nombre}: fila incompleta`);
    assert(row.values.length === N && row.formulas.length === N && row.notes.length === N, `${nombre}: ancho distinto de 26`);
    const id = leerId(row.values[INDICE_ID]);
    assert(id !== null, `${nombre}: ID_FILA columna T ausente o inválida; ninguna escritura autorizada`);
    assert(!index.has(id), `${nombre}: ID_FILA ${id} duplicado; ninguna escritura autorizada`);
    index.set(id, {
      campos: row.values.map((_, i) => i === INDICE_ID ? null : campo(row,i)),
      id,
    });
  }
  return { index, time };
}

/**
 * Recibe DOS fotografías completas, obtenidas de lectura segura de Sheets.
 * No hay «evento» demostrado por una fecha operativa: solo cambios de contenido
 * entre ambas observaciones. Las diferencias se retienen para cotejo.
 *
 * salida: diffs SIN valores privados y SIN comandos de escritura o T/PA nuevas.
 */
export function auditarFuturoSoloLectura(base, actual) {
  const prev = indexar(base, 'base');
  const next = indexar(actual, 'actual');
  assert(next.time >= prev.time, 'La observación actual es anterior a la base');
  const altas = [], cambios = [], ausencias = [];
  let formulasIgnoradas = 0;
  for (const [id, row] of next.index) {
    const old = prev.index.get(id);
    if (!old) {
      altas.push({ id_fila:id, tipo:'IDENTIDAD_NUEVA_PENDIENTE_DE_COTEJO' });
      continue;
    }
    const columnas = [];
    for (let i = 0; i < N; i++) {
      if (i === INDICE_ID) continue;
      const before = old.campos[i], after = row.campos[i];
      const cambiosDeCampo = [];
      if (JSON.stringify(before.dato) !== JSON.stringify(after.dato)) cambiosDeCampo.push('DATO');
      if (before.nota !== after.nota) cambiosDeCampo.push('NOTA');
      if (cambiosDeCampo.length) columnas.push({columna: letraColumna(i),nombre: COLUMNAS[i],tipos:cambiosDeCampo});
      else if (before.dato[0] === 'FORMULA_HISTORICA_NO_OPERATIVA' && after.dato[0] === 'FORMULA_HISTORICA_NO_OPERATIVA') formulasIgnoradas++;
    }
    if (columnas.length) cambios.push({id_fila:id,tipo:'DIFERENCIA_OBSERVADA_NO_AUTORIZADA',columnas});
  }
  for (const [id] of prev.index) if (!next.index.has(id)) ausencias.push({id_fila:id,tipo:'IDENTIDAD_AUSENTE_REQUIERE_REVISION'});
  for (const list of [altas,cambios,ausencias]) list.sort((a,b)=>a.id_fila-b.id_fila);
  return {
    modo:'SINCRO11_CANDIDATA_SOLO_LECTURA',
    fecha_base:base.capturada_en, fecha_observacion:actual.capturada_en,
    filas_base:prev.index.size, filas_actuales:next.index.size,
    altas_pendientes:altas.length, cambios_pendientes:cambios.length,
    ausencias_pendientes:ausencias.length, formulas_excluidas_de_cotejo:formulasIgnoradas,
    altas,cambios,ausencias,
    cambios_con_autor_o_fecha_acreditados:0,
    permite_crear_T:false, permite_crear_PA:false,
    autoriza_sincronizar:false, escritura_en_hojas:false, escritura_en_backend:false,
    aviso:'Solo observaciones posteriores al corte; no se deduce cuándo ni quién editó. Cambios manuales prevalecen y requieren cotejo antes de una futura sincronización.'
  };
}