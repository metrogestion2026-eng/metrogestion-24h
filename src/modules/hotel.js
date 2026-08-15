import { clear, detail, element, notice } from '../dom.js';
import { supabase } from '../supabase.js';

const STATE_LABELS = Object.freeze({
  planificado: 'Pendiente de parar',
  pendiente_taller: 'Pendiente de taller',
  pendiente_diagnostico: 'Pendiente de diagnóstico',
  pendiente_autorizacion: 'Pendiente de autorización',
  en_taller: 'En taller',
  pendiente_repuestos: 'Pendiente de repuestos',
  terminado_pendiente_recogida: 'Terminado, pendiente de recoger',
  recogido_pendiente_ruta: 'Recogido, recuperar ruta',
  reserva_liberada: 'Reserva libre',
  anulado: 'Anulado'
});

function vehicleLabel(row) {
  if (row.dfm) return `${String(row.dfm).startsWith('R') ? 'Semirremolque' : 'DFM'} ${row.dfm}${row.matricula ? ` · ${row.matricula}` : ''}`;
  return `Reserva ${row.reserva || '—'}${row.matricula_reserva ? ` · ${row.matricula_reserva}` : ''}`;
}

function metric(label, value) {
  return element('div', { className: 'metric' }, [
    element('strong', { text: value }),
    element('span', { className: 'muted', text: label })
  ]);
}

function renderCard(row) {
  const head = element('div', { className: 'hotel-card-head' }, [
    element('div', {}, [
      element('h3', { text: vehicleLabel(row) }),
      element('div', { className: 'muted', text: row.reserva ? `Reserva ${row.reserva}${row.matricula_reserva ? ` · ${row.matricula_reserva}` : ''}` : 'Sin reserva asignada' })
    ]),
    element('div', {}, [
      element('span', { className: 'badge', text: `Prioridad ${row.prioridad ?? '—'}` }),
      document.createTextNode(' '),
      element('span', { className: 'badge', text: STATE_LABELS[row.estado] || row.estado || 'Sin estado' })
    ])
  ]);

  const details = element('div', { className: 'detail-grid' }, [
    detail('Nº de parada', row.numero_parada),
    detail('Lugar', row.lugar),
    detail('UPC', row.upc),
    detail('Causa / pendientes', row.causa),
    detail('INC', row.incidencia),
    detail('Próximo previsto', row.proximo),
    detail('T realizadas', `${row.t_realizadas ?? 0} de ${row.total_t ?? 0}`),
    detail('T pendientes', row.t_pendientes ?? 0),
    detail('Última actualización', row.actualizado_en ? new Date(row.actualizado_en).toLocaleString('es-ES') : '—')
  ]);

  return element('article', { className: 'card hotel-card', dataset: { state: row.estado || '' } }, [head, details]);
}

export async function renderHotel(container) {
  clear(container);
  const heading = element('div', { className: 'module-heading' }, [
    element('div', {}, [
      element('h2', { text: 'Hotel · Pizarra actual' }),
      element('p', { className: 'muted', text: 'Una única interfaz para todos los perfiles. Esta primera base es de lectura y no modifica datos.' })
    ]),
    element('span', { className: 'badge', text: 'Fuente: hotel_actual_v39' })
  ]);

  const status = notice('Cargando la pizarra actual…', 'warning');
  container.append(heading, status);

  const { data, error } = await supabase
    .from('hotel_actual_v39')
    .select('*')
    .order('orden', { ascending: true });

  status.remove();

  if (error) {
    container.append(notice(`No se pudo cargar Hotel: ${error.message}`, 'danger'));
    return;
  }

  const rows = data || [];
  const active = rows.filter(row => !['reserva_liberada', 'anulado'].includes(row.estado)).length;
  const workshop = rows.filter(row => ['pendiente_diagnostico', 'pendiente_autorizacion', 'en_taller', 'pendiente_repuestos'].includes(row.estado)).length;
  const ready = rows.filter(row => row.estado === 'terminado_pendiente_recogida').length;
  const planned = rows.filter(row => row.estado === 'planificado').length;

  container.append(
    element('div', { className: 'summary-grid' }, [
      metric('Movimientos activos', active),
      metric('En gestión de taller', workshop),
      metric('Terminados para recoger', ready),
      metric('Pendientes de parar', planned)
    ])
  );

  const list = element('div', { className: 'grid' });
  if (!rows.length) list.append(notice('No hay registros visibles en la pizarra actual.', 'success'));
  else rows.forEach(row => list.append(renderCard(row)));
  container.append(list);
}
