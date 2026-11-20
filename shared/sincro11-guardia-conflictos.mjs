/**
 * METROGES / SINCRO 11 — guardia conservadora de propuestas FUTURAS.
 * Módulo PURO para laboratorio. Sin Google, Drive, Supabase, red ni escrituras.
 *
 * Identidad: exclusivamente el VALOR de T (ID_FILA). Ninguna asociación por
 * número de fila, DFM, PA/PR, UUID de trabajo o fecha I/J/K.
 *
 * La fuente F2 es una comparación observada, NO prueba de quién editó. Toda
 * diferencia en MANTENIMENT se protege frente a propuestas remotas; incluso
 * sin diferencia la propuesta NO se autoriza: hace falta una revisión fresca,
 * autenticada y concreta fuera de este módulo.
 */

export const SINCRO11_GUARDIA_VERSION = 'sincro11-guardia-futuro-20261116.1';
export const SINCRO11_CORTE_UTC = '2026-11-15T23:00:00.000Z';
const ALLOWED_TYPES = new Set(['parada', 'trabajos', 'maestro']);
const MAX_PROPOSALS = 25000;
const MAX_PREVIEW = 100;
const requireValue = (cond, reason) => { if (!cond) throw new Error('SINCRO11: ' + reason); };

function idFila(v) {
  if (typeof v === 'number') return Number.isSafeInteger(v) && v > 0 ? v : null;
  if (typeof v === 'string' && /^[1-9]\d{0,14}$/.test(v)) {
    const n = Number(v);
    return Number.isSafeInteger(n) ? n : null;
  }
  return null;
}

function instante(s, name) {
  requireValue(typeof s === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(s), name + ' exige UTC completo');
  const ms = Date.parse(s);
  requireValue(Number.isFinite(ms) && new Date(ms).toISOString() === s, name + ' no es fecha válida');
  return ms;
}

function integer(v) { return Number.isSafeInteger(v) && v >= 0; }

function validarFuente(f2) {
  if (f2 === null || f2 === undefined) return null;
  requireValue(f2 && typeof f2 === 'object' && !Array.isArray(f2), 'informe F2 no es objeto');
  requireValue(f2.resultado === 'SOLO_LECTURA_FUTURA_NO_AUTORIZADA', 'informe F2 no es un cotejo F2');
  requireValue(f2.autoriza_sincronizar === false && f2.escritura_en_hojas === false && f2.escritura_en_backend === false,
    'informe F2 reclama facultades de escritura');
  requireValue(f2.origen_humano_acreditado === false && f2.fecha_exacta_de_edicion_acreditada === false,
    'F2 no acredita autor humano ni momento exacto');
  const base = instante(f2.fecha_referencia, 'fecha_referencia');
  const observation = instante(f2.fecha_observacion, 'fecha_observacion');
  requireValue(base >= instante(SINCRO11_CORTE_UTC, 'corte') && observation >= base,
    'F2 anterior al corte o con fechas invertidas');
  for (const key of ['filas_referencia','filas_actuales','altas_nuevas','cambios_observados','identidades_ausentes'])
    requireValue(integer(f2[key]), `contador F2 ${key} inválido`);
  requireValue(f2.filas_actuales === f2.filas_referencia + f2.altas_nuevas - f2.identidades_ausentes,
    'conteo de identidades F2 incoherente');
  requireValue(f2.cambios_observados <= Math.min(f2.filas_referencia, f2.filas_actuales),
    'cambios F2 exceden identidades compartidas');
  requireValue(typeof f2.lista_parcial === 'boolean', 'sin indicador de lista parcial F2');
  const fields = [['altas','altas_nuevas'],['cambios','cambios_observados'],['ausencias','identidades_ausentes']];
  const maps = new Map(), every = new Set();
  for (const [field, counter] of fields) {
    const list = f2[field];
    requireValue(Array.isArray(list) && list.length <= MAX_PREVIEW && list.length <= f2[counter],
      `lista F2 ${field} incompleta o excesiva`);
    if (!f2.lista_parcial) requireValue(list.length === f2[counter], `contador F2 ${counter} no coincide con lista`);
    const ids = new Set();
    for (const item of list) {
      const id = idFila(item?.id_fila);
      requireValue(id !== null, `ID_FILA F2 inválida en ${field}`);
      requireValue(!ids.has(id) && !every.has(id), `ID_FILA F2 duplicado o presente en dos categorías (${id})`);
      ids.add(id); every.add(id);
      const cls = item?.clase;
      const expected = field === 'altas' ? 'ALTA_NO_CONFIRMADA' :
        field === 'cambios' ? 'CONTENIDO_DISTINTO_PENDIENTE_DE_COTEJO' : 'AUSENCIA_REQUIERE_REVISION';
      requireValue(cls === expected, `clase de F2 inválida en ${field}`);
    }
    maps.set(field, ids);
  }
  return { maps, parcial: f2.lista_parcial, fecha: f2.fecha_observacion,
    cambios_observados: f2.cambios_observados, altas_nuevas: f2.altas_nuevas,
    identidades_ausentes: f2.identidades_ausentes };
}

/**
 * Entrada: salida auténticamente leída de metroSincro11F2Comparar(), o null
 * cuando F2 todavía no tiene referencia, más propuestas del laboratorio.
 *
 * Las propuestas TODAVÍA no tienen cadena de autenticación integrada con
 * Supabase; los campos tipo/UUID/revisión/huella no conceden permisos.
 * Se aceptan sólo para clasificar riesgos sin mostrar ningún payload.
 *
 * Cada salida mantiene `autoriza_sincronizar:false`. Un cotejo sin diferencia
 * NO prueba que la hoja siga igual en el instante de una escritura futura.
 */
export function clasificarConflictosSincro11({ informeF2 = null, propuestas = [] } = {}) {
  requireValue(Array.isArray(propuestas) && propuestas.length <= MAX_PROPOSALS, 'lote de propuestas inválido');
  const fuente = validarFuente(informeF2);
  const idsPropuestas = new Map();
  for (const p of propuestas) {
    const id = idFila(p?.id_fila);
    if (id !== null) idsPropuestas.set(id, (idsPropuestas.get(id) || 0) + 1);
  }
  const decisiones = [], recuento = Object.create(null);
  for (let i = 0; i < propuestas.length; i++) {
    const propuesta = propuestas[i];
    const id = idFila(propuesta?.id_fila);
    const tipo = ALLOWED_TYPES.has(propuesta?.tipo) ? propuesta.tipo : null;
    const uuid = typeof propuesta?.sync_id === 'string' &&
      /^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i.test(propuesta.sync_id);
    const revision = Number.isSafeInteger(propuesta?.revision) && propuesta.revision > 0;
    const hash = typeof propuesta?.payload_sha256 === 'string' && /^[a-f\d]{64}$/i.test(propuesta.payload_sha256);
    let motivo;
    // Orden de precedencia: fail-closed primero, luego protección de datos
    // observados, nunca un permiso deducido de falta de diferencias.
    if (id === null) motivo = 'SIN_ID_FILA_T';
    else if (idsPropuestas.get(id) > 1) motivo = 'PROPUESTAS_MULTIPLES_PARA_ID_FILA';
    else if (!fuente) motivo = 'SIN_REFERENCIA_F2';
    else if (fuente.parcial) motivo = 'INFORME_F2_PARCIAL';
    else if (fuente.maps.get('ausencias').has(id)) motivo = 'ID_FILA_AUSENTE_DE_MANTENIMENT';
    else if (fuente.maps.get('altas').has(id)) motivo = 'ID_FILA_NUEVA_EN_MANTENIMENT';
    else if (fuente.maps.get('cambios').has(id)) motivo = 'CAMBIO_LOCAL_OBSERVADO_EN_MANTENIMENT';
    else if (!tipo || !uuid || !revision || !hash) motivo = 'REFERENCIA_REMOTA_INCOMPLETA';
    else motivo = 'SIN_DIFERENCIA_OBSERVADA_REQUIERE_COTEJO_ACTUAL';
    // Ni un solo motivo autoriza aplicar una propuesta.
    const row = {
      indice_propuesta: i + 1, id_fila: id, tipo: tipo || 'NO_ACREDITADO',
      decision: 'RETENER_SIN_ESCRIBIR', motivo,
    };
    decisiones.push(row);
    recuento[motivo] = (recuento[motivo] || 0) + 1;
  }
  return {
    version: SINCRO11_GUARDIA_VERSION, modo: 'PRE-COTEJO_SINCRO11_SOLO_LECTURA',
    fuente: !fuente ? 'F2_NO_DISPONIBLE' : fuente.parcial ? 'F2_PARCIAL_NO_DECISORIO' : 'F2_COTEJO_NO_AUTORIZADO',
    fecha_observacion_f2: fuente?.fecha ?? null,
    propuestas_total: propuestas.length,
    propuestas_retenidas: decisiones.length,
    detalles: decisiones.slice(0, MAX_PREVIEW),
    lista_parcial: decisiones.length > MAX_PREVIEW,
    motivos: Object.fromEntries(Object.entries(recuento).sort(([a],[b])=>a.localeCompare(b))),
    // F2 no acredita quién modificó, no concede excepciones de prioridad.
    autor_humano_acreditado: false, prioridad_manual_respetada_por_retencion: true,
    expone_datos_privados: false, expone_payloads: false,
    permite_crear_T: false, permite_crear_PA: false,
    autoriza_sincronizar: false, escritura_en_hojas: false, escritura_en_backend: false,
    aviso: 'No se aplica ninguna orden. ID_FILA T es la única identidad. Si la hoja difiere, prevalece su estado actual y la propuesta queda retenida hasta cotejo real y autorización separada.'
  };
}