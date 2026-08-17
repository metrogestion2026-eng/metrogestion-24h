import { clear, detail, element, notice } from '../dom.js';
import { supabase } from '../supabase.js';

const CLASS_LABELS = Object.freeze({
  movimiento_con_reserva: 'Movimiento con reserva',
  movimiento_sin_reserva: 'Movimiento sin reserva',
  reserva_libre: 'Reserva libre',
  reserva_sin_sustitucion_activa: 'Reserva en taller / sin flota asignada',
  fila_incompleta: 'Fila incompleta'
});

function metric(label, value) {
  return element('div', { className: 'metric' }, [
    element('strong', { text: value }),
    element('span', { className: 'muted', text: label })
  ]);
}

function formatDate(value) {
  if (!value) return '—';
  return new Date(`${value}T12:00:00`).toLocaleDateString('es-ES');
}

function renderStages(row) {
  const stages = Array.isArray(row.etapas_raw) ? row.etapas_raw.filter(Boolean) : [];
  const host = element('div', { className: 'import-stage-list' });

  if (!stages.length) {
    host.append(element('span', { className: 'muted', text: 'Sin T anotadas en la hoja.' }));
    return host;
  }

  stages.forEach(stage => {
    host.append(element('span', {
      className: 'import-stage-chip',
      text: `${stage.posicion}T · ${stage.texto}`
    }));
  });
  return host;
}

function renderRow(row) {
  const title = row.flota
    ? `${String(row.flota).startsWith('R') ? 'Semirremolque' : 'DFM'} ${row.flota}${row.matricula_flota ? ` · ${row.matricula_flota}` : ''}`
    : `Reserva ${row.reserva || '—'}${row.matricula_reserva ? ` · ${row.matricula_reserva}` : ''}`;

  const subtitle = row.flota && row.reserva
    ? `Reserva ${row.reserva}${row.matricula_reserva ? ` · ${row.matricula_reserva}` : ''}`
    : row.etiqueta_reserva || 'Sin etiqueta';

  const badges = element('div', { className: 'import-card-badges' }, [
    element('span', { className: `badge import-class ${row.clasificacion || ''}`, text: CLASS_LABELS[row.clasificacion] || row.clasificacion || 'Sin clasificar' }),
    element('span', { className: 'badge', text: `Fila ${row.source_row}` })
  ]);

  const head = element('div', { className: 'hotel-card-head' }, [
    element('div', {}, [
      element('h3', { text: title }),
      element('div', { className: 'muted', text: subtitle })
    ]),
    badges
  ]);

  const details = element('div', { className: 'detail-grid import-detail-grid' }, [
    detail('Nº de parada (columna L)', row.numero_parada),
    detail('Estado original', row.estado_raw),
    detail('Lugar', row.lugar),
    detail('UPC', row.upc),
    detail('Causa', row.causa),
    detail('Próximo', row.proximo),
    detail('Pendientes de la reserva', row.pendientes_reserva),
    detail('Modelo', row.modelo),
    detail('INC manual', row.incidencia_manual || 'Pendiente de rellenar')
  ]);

  const card = element('article', { className: 'card import-card', dataset: { classification: row.clasificacion || '' } }, [
    head,
    details,
    element('div', { className: 'import-stage-block' }, [
      element('strong', { text: 'T anotadas en la hoja' }),
      renderStages(row)
    ])
  ]);

  const warnings = Array.isArray(row.avisos) ? row.avisos.filter(Boolean) : [];
  if (warnings.length) {
    const warningList = element('ul', { className: 'import-warning-list' });
    warnings.forEach(message => warningList.append(element('li', { text: message })));
    card.append(element('div', { className: 'notice warning' }, [
      element('strong', { text: 'Revisar antes de aplicar:' }),
      warningList
    ]));
  }

  return card;
}

export async function renderHotelImportPreview(container) {
  clear(container);

  const heading = element('div', { className: 'module-heading' }, [
    element('div', {}, [
      element('h2', { text: 'Hotel real · Vista previa de importación' }),
      element('p', { className: 'muted', text: 'Instantánea separada para revisar el Hotel actualizado antes de incorporarlo a Metrogestión.' })
    ]),
    element('span', { className: 'badge', text: 'Solo administrador principal' })
  ]);

  const loading = notice('Cargando la instantánea controlada de Drive…', 'warning');
  container.append(heading, loading);

  const { data: imports, error: importError } = await supabase
    .from('importaciones_hotel_drive')
    .select('id,source_title,source_sheet,source_date,source_header_row,source_start_row,source_end_row,source_modified_at,estado,observaciones,creado_en')
    .order('source_date', { ascending: false })
    .order('creado_en', { ascending: false })
    .limit(1);

  if (importError || !imports?.length) {
    loading.remove();
    container.append(notice(importError?.message || 'No existe ninguna instantánea de Hotel preparada.', 'danger'));
    return;
  }

  const snapshot = imports[0];
  const { data: rows, error: rowsError } = await supabase
    .from('hotel_importacion_drive_previa')
    .select('*')
    .eq('importacion_id', snapshot.id)
    .order('source_row', { ascending: true });

  loading.remove();

  if (rowsError) {
    container.append(notice(`No se pudo leer la vista previa: ${rowsError.message}`, 'danger'));
    return;
  }

  const data = rows || [];
  const free = data.filter(row => row.clasificacion === 'reserva_libre').length;
  const movements = data.length - free;
  const stops = data.filter(row => row.numero_parada).length;
  const warnings = data.reduce((total, row) => total + (Array.isArray(row.avisos) ? row.avisos.filter(Boolean).length : 0), 0);

  container.append(
    notice('Esta vista no modifica Hotel, Histórico, Reservas ni producción. La columna L se interpreta exclusivamente como Parada / Nº de parada. El INC permanece separado y se rellenará manualmente, siempre vinculado a la parada.', 'success'),
    element('div', { className: 'import-source-card' }, [
      element('strong', { text: `${snapshot.source_title} · Hoja ${snapshot.source_sheet}` }),
      element('span', { text: `Pizarra del ${formatDate(snapshot.source_date)}` }),
      element('span', { text: `Filas ${snapshot.source_start_row}–${snapshot.source_end_row} · cabecera ${snapshot.source_header_row}` }),
      element('span', { text: `Estado: ${snapshot.estado}` })
    ]),
    element('div', { className: 'summary-grid' }, [
      metric('Filas capturadas', data.length),
      metric('Movimientos', movements),
      metric('Reservas libres', free),
      metric('Paradas numeradas', stops)
    ]),
    warnings === 0
      ? notice('✓ Comprobación inicial correcta: no hay números de parada duplicados ni avisos automáticos de formato.', 'success')
      : notice(`Hay ${warnings} aviso(s) que deben revisarse antes de aplicar la importación.`, 'warning')
  );

  const movementRows = data.filter(row => row.clasificacion !== 'reserva_libre');
  const freeRows = data.filter(row => row.clasificacion === 'reserva_libre');

  const movementHost = element('div', { className: 'grid import-list' });
  movementRows.forEach(row => movementHost.append(renderRow(row)));

  const freeHost = element('div', { className: 'grid import-list' });
  freeRows.forEach(row => freeHost.append(renderRow(row)));

  container.append(
    element('section', { className: 'import-section' }, [
      element('div', { className: 'import-section-heading' }, [
        element('h3', { text: `Movimientos y reservas en taller · ${movementRows.length}` }),
        element('span', { className: 'muted', text: 'Con o sin reserva sustituta' })
      ]),
      movementHost
    ]),
    element('section', { className: 'import-section' }, [
      element('div', { className: 'import-section-heading' }, [
        element('h3', { text: `Reservas libres · ${freeRows.length}` }),
        element('span', { className: 'muted', text: 'Separadas de los movimientos activos' })
      ]),
      freeHost
    ]),
    notice('Siguiente fase: definir y revisar la transformación de cada estado y cada T. Nada se aplicará al Hotel activo sin una validación expresa.', 'warning')
  );
}
