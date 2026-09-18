/* Motor puro de próximas necesidades. Se incluye en el Apps Script distribuido.
 * No usa reloj, red ni filas como identidad. La escritura vive en el adaptador.
 */
function metrogestionTipoNecesidad_(value) {
  const type = metrogestionNormalizar_(value).replace(/^ALTA /, '');
  return type === 'EXT' ? 'EXTINTOR' : type;
}

function metrogestionFechaNecesidad_(value) {
  if (!String(value || '').trim()) return '';
  const short = String(value).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  const normalized = short ? `${short[3].length === 2 ? '20' + short[3] : short[3]}-${short[2].padStart(2, '0')}-${short[1].padStart(2, '0')}` : value;
  const iso = metrogestionFechaIso_(normalized, 'necesidad');
  if (metrogestionFechaIsoDesdeDate_(metrogestionDate_(iso)) !== iso) {
    throw new Error('Fecha inexistente: ' + value);
  }
  return iso;
}

function metrogestionMarcaFrio_(value) {
  const marca = metrogestionNormalizar_(value);
  if (/(^|[^A-Z])CARRIER([^A-Z]|$)/.test(marca)) return 'CARRIER';
  if (/\b(THERMO KING|TERMO KING|THERMOKING|DAIKIN|HWASUNG|FRIGOBLOCK)\b/.test(marca)) return marca;
  return '';
}

function metrogestionCierreUnico_(type) {
  return ['ITV', '44TN', 'RT', 'TMG', 'LKT', 'SG', 'EXTINTOR', 'ATP', 'OTA'].includes(metrogestionTipoNecesidad_(type));
}

function metrogestionCierreFisico_(type) {
  return ['REPUESTOS', 'ACT', 'LINDEP', 'CV'].includes(metrogestionTipoNecesidad_(type));
}

function metrogestionMetadatosNecesidad_(note) {
  const line = String(note || '').split('\n').find(x => x.startsWith('METROGESTION_NECESIDAD:'));
  if (!line) return {};
  const meta = JSON.parse(line.slice('METROGESTION_NECESIDAD:'.length));
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) throw new Error('Nota de necesidad no válida');
  return meta;
}

function metrogestionNotaNecesidad_(note, meta) {
  const human = String(note || '').split('\n').filter(x => !x.startsWith('METROGESTION_NECESIDAD:')).join('\n').trim();
  return [human, 'METROGESTION_NECESIDAD:' + JSON.stringify(meta)].filter(Boolean).join('\n');
}

function metrogestionFirmaNecesidad_(values) {
  return JSON.stringify(values.slice(0, 17).map((value, i) => {
    if ([8, 9, 10, 12].includes(i) && value) {
      try { return metrogestionFechaNecesidad_(value); } catch (_) { /* dato manual */ }
    }
    return String(value || '').trim();
  }));
}

function metrogestionCalcularProxima_(type, dates) {
  switch (type) {
    case 'ITV': return metrogestionSiguienteCaducidadItv_(dates.i, dates.j);
    case 'RT': case 'TMG': return dates.j ? metrogestionMoverAnos_(dates.j, 2) : '';
    case 'LKT': return dates.j ? metrogestionMoverAnos_(dates.j, 1) : '';
    case 'SG': return dates.i ? metrogestionMoverAnos_(dates.i, 1) : '';
    case 'ATP': case 'EXTINTOR': return dates.m;
    case 'LINDEP': return dates.k ? metrogestionMoverAnos_(dates.k, 3) : '';
    default: return '';
  }
}

function metrogestionPlanificarNecesidades_(records, today) {
  const recurring = new Set(['ITV', 'RT', 'TMG', 'LKT', 'SG', 'ATP', 'EXTINTOR', 'LINDEP']);
  const plan = { cambios: [], nuevas: [], avisos: [], reutilizadas: 0 };
  const byUnit = new Map();
  const byOrigin = new Map();
  const ids = new Map();
  const changes = new Map();
  const warning = (r, message) => plan.avisos.push({ fila: r.row, dfm: r.dfm, tipo: r.type, motivo: message });
  const change = r => {
    if (!changes.has(r.row)) changes.set(r.row, { fila: r.row, original: r.values.slice(), values: r.values.slice(), nota: r.note || '', verde: false, amarilloM: false, cierre: false });
    return changes.get(r.row);
  };
  const rows = records.map(record => {
    const r = { ...record, values: record.values.slice(), dfm: metrogestionNormalizar_(record.values[0]), type: metrogestionTipoNecesidad_(record.values[7]), meta: {} };
    try { r.meta = metrogestionMetadatosNecesidad_(r.note); } catch (error) { r.invalid = true; warning(r, error.message); }
    if ((r.meta.dfm && r.meta.dfm !== r.dfm) || (r.meta.matricula && r.meta.matricula !== metrogestionNormalizar_(r.values[1])) || (r.meta.tipo && r.meta.tipo !== r.type && r.type !== 'ANULADA' && !(['ALTA', 'BAJA'].includes(r.type) && r.meta.inicial === 'LINDEP'))) {
      r.invalid = true; warning(r, 'La unidad o el tipo no coincide con su ciclo registrado.');
    }
    if (r.meta.id) {
      if (!ids.has(r.meta.id)) ids.set(r.meta.id, []);
      ids.get(r.meta.id).push(r);
    }
    if (r.meta.origen) {
      if (!byOrigin.has(r.meta.origen)) byOrigin.set(r.meta.origen, []);
      byOrigin.get(r.meta.origen).push(r);
    }
    if (!byUnit.has(r.dfm)) byUnit.set(r.dfm, []);
    byUnit.get(r.dfm).push(r);
    return r;
  });
  ids.forEach(list => {
    if (list.length > 1) list.forEach(r => { r.invalid = true; warning(r, 'Identificador de necesidad repetido; revisar las copias.'); });
  });

  const active = new Map();
  byUnit.forEach((list, dfm) => {
    const status = list.filter(r => ['ALTA', 'BAJA'].includes(metrogestionNormalizar_(r.values[7]))).sort((a, b) => b.row - a.row)[0];
    if (status && metrogestionNormalizar_(status.values[7]) === 'ALTA') active.set(dfm, status);
  });
  const fleetBrand = dfm => {
    const brands = [...new Set((byUnit.get(dfm) || []).map(r => metrogestionMarcaFrio_(r.values[14])).filter(Boolean))];
    const carriers = brands.filter(x => x === 'CARRIER');
    return carriers.length && brands.length > 1 ? '' : brands[0] || '';
  };
  const category = r => {
    if (r.type === 'SG') return 'GESTIÓN';
    if (r.type !== 'LKT') return 'TRÁMITE';
    const brand = metrogestionMarcaFrio_(r.values[14]) || fleetBrand(r.dfm);
    return brand ? (brand === 'CARRIER' ? 'TRÁMITE' : 'GESTIÓN') : '';
  };
  const dates = r => {
    if (r.dates) return r.dates;
    try {
      r.dates = { i: metrogestionFechaNecesidad_(r.values[8]), j: metrogestionFechaNecesidad_(r.values[9]), k: metrogestionFechaNecesidad_(r.values[10]), m: metrogestionFechaNecesidad_(r.values[12]) };
      return r.dates;
    } catch (error) { r.invalid = true; warning(r, error.message); return null; }
  };
  const currentSignature = r => metrogestionFirmaNecesidad_(r.values);
  const childEditable = child => !child.invalid && !child.values[4] && !child.values[9] && !child.values[10]
    && child.meta.generada === true && child.meta.firma === currentSignature(child);
  const writeMeta = (r, meta) => {
    r.meta = meta;
    const c = change(r);
    c.nota = metrogestionNotaNecesidad_(c.nota, meta);
  };

  // Anulación/reapertura de un origen: solo se retira su hija automática intacta.
  // Las hijas manuales, ya vinculadas o realizadas se conservan con un aviso.
  byOrigin.forEach((children, origin) => {
    const source = ids.get(origin)?.[0];
    if (!source || source.invalid) {
      children.forEach(child => warning(child, 'No se localiza un origen único; revisar antes de modificar.'));
      return;
    }
    const d = dates(source);
    const isInitial = source.meta.inicial === 'LINDEP';
    const closed = d && (isInitial ? active.has(source.dfm) : (d.k || (metrogestionCierreUnico_(source.type) && d.j)));
    if (source.type !== 'ANULADA' && active.has(source.dfm) && closed) return;
    children.forEach(child => {
      if (child.type === 'ANULADA' && child.meta.suspendida) return;
      if (!childEditable(child)) { warning(child, 'Origen anulado, reabierto o de baja; la siguiente necesidad tiene cambios y requiere revisión.'); return; }
      const c = change(child);
      c.values[7] = 'ANULADA';
      c.anulada = true;
      writeMeta(child, { ...child.meta, suspendida: true, tipo: child.type, firma: metrogestionFirmaNecesidad_(c.values) });
    });
  });

  const linkNext = (source, type, nextDate, cat, mDate) => {
    const meta = { ...source.meta };
    const sourceId = meta.id || `N:${source.dfm}:${type}:${metrogestionFirmaNecesidad_([source.dfm, source.values[1], '', '', '', '', '', type, source.values[8], source.values[9], source.values[10]])}`;
    // El ID se guarda en la nota de I y sobrevive a cambios de fechas o de fila.
    const own = byOrigin.get(sourceId) || [];
    const existing = (byUnit.get(source.dfm) || []).filter(r => r.row !== source.row && !r.invalid && r.type === type);
    const exact = existing.filter(r => dates(r)?.i === nextDate);
    const pending = existing.filter(r => { const d = dates(r); return d && !d.j && !d.k && r.type !== 'ANULADA'; });
    const candidates = own.length ? own : exact;
    if (candidates.length > 1) { warning(source, 'Más de una próxima necesidad coincide; no se crea otra.'); return; }
    let child = candidates[0];
    if (child && child.dfm !== source.dfm) { warning(source, 'La siguiente necesidad pertenece a otra unidad.'); return; }
    if (!child && pending.length) { warning(source, 'Ya existe una necesidad pendiente con otra fecha; revisar M y la fila pendiente.'); return; }
    if (child && child.meta.origen && child.meta.origen !== sourceId) { warning(source, 'La próxima necesidad ya pertenece a otro ciclo.'); return; }
    if (child && own.length && (child.type === 'ANULADA' || dates(child)?.i !== nextDate)) {
      if (!childEditable(child)) { warning(source, 'La siguiente necesidad tiene cambios o está iniciada; no se modifica su fecha.'); return; }
      const c = change(child);
      c.values[7] = type;
      c.values[8] = nextDate;
      c.pendiente = true;
      writeMeta(child, { ...child.meta, tipo: type, suspendida: false, firma: metrogestionFirmaNecesidad_(c.values) });
    }
    if (!child) {
      const next = Array(17).fill('');
      [0, 1, 2, 3, 14].forEach(i => { next[i] = source.values[i]; });
      next[5] = type === 'LINDEP' ? 'TM' : cat === 'GESTIÓN' ? 'UPC' : source.values[5];
      next[6] = cat;
      next[7] = type;
      next[8] = nextDate;
      const childMeta = { origen: sourceId, generada: true, tipo: type, firma: metrogestionFirmaNecesidad_(next) };
      plan.nuevas.push({ despuesDe: source.row, values: next, nota: metrogestionNotaNecesidad_('', childMeta) });
    } else if (!own.length) {
      // Una fila manual exacta satisface el ciclo; no se toma control de ella.
      plan.reutilizadas += 1;
    }
    if (mDate !== false && (dates(source)?.m !== nextDate || !metrogestionEsFondoAmarillo_(source.colorM))) {
      const c = change(source);
      c.values[12] = nextDate;
      c.amarilloM = true;
    }
    if (child && !own.length) return;
    writeMeta(source, { ...meta, id: sourceId, dfm: source.dfm, matricula: metrogestionNormalizar_(source.values[1]), tipo: type, proxima: nextDate, fechaCierre: dates(source)?.k || dates(source)?.j || '' });
  };

  // Solo el último ciclo realizado de cada tipo/unidad inicia una renovación.
  // Los ciclos antiguos se conservan, sin generar cientos de vencimientos pasados.
  byUnit.forEach((list, dfm) => {
    if (!active.has(dfm)) return;
    const grouped = new Map();
    list.forEach(r => {
      if (r.invalid || !recurring.has(r.type)) return;
      const d = dates(r);
      if (!d) return;
      const completed = d.k || (metrogestionCierreUnico_(r.type) && d.j);
      if (!completed) return;
      if (!grouped.has(r.type)) grouped.set(r.type, []);
      grouped.get(r.type).push(r);
    });
    grouped.forEach((sources, type) => {
      sources.sort((a, b) => (b.dates.k || b.dates.j).localeCompare(a.dates.k || a.dates.j));
      const r = sources[0], d = r.dates;
      const newerReopened = list.some(other => other.meta.tipo === type && other.meta.proxima && other.meta.fechaCierre >= (d.k || d.j)
        && (other.type === 'ANULADA' || (!other.values[9] && !other.values[10])));
      if (newerReopened) { warning(r, 'Hay un ciclo posterior anulado o reabierto; no se regenera uno antiguo.'); return; }
      if (sources[1] && (sources[1].dates.k || sources[1].dates.j) === (d.k || d.j)) {
        warning(r, 'Dos cierres coinciden en el último ciclo; revisar el duplicado.'); return;
      }
      if ((d.k || d.j) > today) { warning(r, 'Fecha de realización o cierre futura.'); return; }
      if (!d.j || (type === 'LINDEP' && (!d.k || d.k < d.j))) { warning(r, 'Falta una realización o salida válida.'); return; }
      const cat = category(r);
      if (!cat) { warning(r, 'Falta confirmar la marca del frío en O para clasificar LKT.'); return; }
      const next = metrogestionCalcularProxima_(type, d);
      if (!next) { warning(r, 'Falta la próxima caducidad en M.'); return; }
      if (next <= (d.k || d.j)) { warning(r, 'La próxima fecha debe ser posterior a la realización.'); return; }
      if (['ATP', 'EXTINTOR'].includes(type) && !metrogestionEsFondoAmarillo_(r.colorM)) {
        warning(r, 'Confirma la caducidad indicada en M con fondo amarillo.'); return;
      }
      if (d.m && d.m !== next && d.m !== r.meta.proxima) {
        warning(r, 'M no coincide con la regla; se conserva para revisión.'); return;
      }
      linkNext(r, type, next, cat);
    });

    // Primer LINDEP: solo unidades con prueba de equipo de frío, sin ciclo previo.
    const hasCold = Boolean(fleetBrand(dfm)) || list.some(r => ['ATP', 'LKT', 'TMG'].includes(r.type));
    const alta = active.get(dfm);
    if (!hasCold || (list.some(r => r.type === 'LINDEP') && alta.meta.inicial !== 'LINDEP')) return;
    const d = dates(alta);
    if (!d?.i) { warning(alta, 'Falta matriculación para el primer LINDEP.'); return; }
    const next = metrogestionMoverAnos_(d.i, 5);
    alta.meta.inicial = 'LINDEP';
    linkNext(alta, 'LINDEP', next, 'TRÁMITE', false);
  });

  // Cierre seguro: nunca reemplaza una K ya escrita ni cierra pedido/entrada.
  rows.forEach(r => {
    if (r.invalid || !active.has(r.dfm)) return;
    if (r.type === 'LKT' && !r.values[9] && !r.values[10] && !r.values[4] && !metrogestionEsFondoAmarillo_(r.colorG)) {
      const cat = category(r);
      if (cat && metrogestionNormalizar_(r.values[6]) !== metrogestionNormalizar_(cat)) change(r).values[6] = cat;
    }
    const single = metrogestionCierreUnico_(r.type);
    if (!single && !metrogestionCierreFisico_(r.type) && !['LV', 'LAVADO'].includes(r.type)) return;
    // No repintar todo el histórico: solo filas aún abiertas (H blanca).
    if (!metrogestionEsFondoBlanco_(r.colorH)) return;
    const d = dates(r);
    if (!d?.j || d.j > today) return;
    if (!single && (!d.k || d.k > today)) return;
    if (d.k && d.k < d.j) { warning(r, 'K es anterior a J; no se sobrescribe.'); return; }
    const c = change(r);
    if (single && !d.k) { c.values[10] = d.j; c.cierre = true; }
    c.verde = true;
    c.amarilloM = c.amarilloM || metrogestionEsFondoAmarillo_(r.colorM);
  });
  plan.cambios = [...changes.values()].filter(c => c.verde || c.pendiente || c.anulada || c.amarilloM || c.nota !== (records.find(r => r.row === c.fila)?.note || '') || metrogestionFirmaNecesidad_(c.values) !== metrogestionFirmaNecesidad_(c.original));
  return plan;
}
