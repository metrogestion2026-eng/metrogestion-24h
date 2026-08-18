import { clear, detail, element, notice } from '../dom.js';
import { supabase } from '../supabase.js';

const STATE_LABELS = Object.freeze({
  planificado: 'Pendiente de parar',
  pendiente_taller: 'Pendiente de taller',
  en_taller: 'Realizando trabajos en taller',
  terminado_pendiente_recogida: 'Pendiente de recoger',
  recogido_pendiente_ruta: 'Pendiente de recuperar',
  reserva_liberada: 'Reserva libre',
  asistencia_24h: 'Asistencia 24H activa'
});

function metric(label, value) {
  return element('div', { className: 'metric' }, [
    element('strong', { text: value }),
    element('span', { className: 'muted', text: label })
  ]);
}

function title(row) {
  if (row.flota) return `${String(row.flota).startsWith('R') ? 'Semirremolque' : 'DFM'} ${row.flota}${row.matricula_flota ? ` · ${row.matricula_flota}` : ''}`;
  return `Reserva ${row.reserva || '—'}${row.matricula_reserva ? ` · ${row.matricula_reserva}` : ''}`;
}

function renderCard(row) {
  const card = element('article', {
    className: `card visual-card visual-bg-${row.fondo_propuesto || 'blanco'}${row.trazo_marron_propuesto ? ' visual-outline-brown' : ''}`
  }, [
    element('div', { className: 'hotel-card-head' }, [
      element('div', {}, [
        element('h3', { text: title(row) }),
        element('div', { className: 'muted', text: row.numero_parada ? `Parada ${row.numero_parada}` : 'Reserva libre · sin parada activa' })
      ]),
      element('div', { className: 'visual-badges' }, [
        element('span', { className: 'badge', text: STATE_LABELS[row.estado_visual_propuesto] || row.estado_visual_nombre || row.estado_visual_propuesto || '—' }),
        element('span', { className: 'badge', text: `Fondo: ${row.fondo_nombre || row.fondo_propuesto || '—'}` }),
        row.trazo_marron_propuesto ? element('span', { className: 'badge outline-badge', text: 'Trazo marrón' }) : null
      ])
    ]),
    element('div', { className: 'detail-grid' }, [
      detail('Estado', STATE_LABELS[row.estado_visual_propuesto] || row.estado_visual_nombre),
      detail('Fondo', row.fondo_nombre || row.fondo_propuesto),
      detail('Trazo', row.trazo_marron_propuesto ? 'Marrón' : 'Sin trazo marrón'),
      detail('Reserva', row.reserva),
      detail('Sustituye temporalmente a', row.dfm_sustituido_por_esta_flota),
      detail('Parada sustituida', row.parada_sustituida_por_esta_flota)
    ]),
    element('div', { className: 'visual-rule', text: row.regla_visual_aplicada || '' })
  ]);

  if (row.observaciones_revision) {
    card.append(element('div', { className: 'visual-notes' }, [
      element('strong', { text: 'Anotación validada' }),
      element('p', { text: row.observaciones_revision })
    ]));
  }
  return card;
}

export async function renderHotelVisualPreview(container) {
  clear(container);
  const loading = notice('Calculando estado, fondo y trazo desde las anotaciones validadas…', 'warning');
  container.append(
    element('div', { className: 'module-heading' }, [
      element('div', {}, [
        element('h2', { text: 'Hotel real · Estados y colores' }),
        element('p', { className: 'muted', text: 'Vista previa de la presentación operativa. Estado, fondo y trazo se calculan por separado.' })
      ]),
      element('span', { className: 'badge', text: 'Solo lectura · administrador principal' })
    ]),
    loading
  );

  const { data, error } = await supabase
    .from('hotel_importacion_presentacion_previa')
    .select('*')
    .order('source_row', { ascending: true });

  loading.remove();
  if (error) {
    container.append(notice(`No se pudo cargar la presentación: ${error.message}`, 'danger'));
    return;
  }

  const rows = data || [];
  const count = code => rows.filter(r => r.fondo_propuesto === code).length;
  const outlines = rows.filter(r => r.trazo_marron_propuesto).length;

  container.append(
    notice('Esta pantalla no modifica Hotel, Reservas, Histórico ni producción. El color de fondo refleja el estado operativo; el trazo marrón es independiente y puede coexistir con cualquier fondo.', 'success'),
    element('div', { className: 'visual-legend' }, [
      element('span', { className: 'visual-legend-item bg-white', text: 'Blanco · Pendiente de taller' }),
      element('span', { className: 'visual-legend-item bg-yellow', text: 'Amarillo · Pendiente de parar' }),
      element('span', { className: 'visual-legend-item bg-purple', text: 'Lila · En taller' }),
      element('span', { className: 'visual-legend-item bg-blue', text: 'Azul · Pendiente de recoger' }),
      element('span', { className: 'visual-legend-item bg-orange', text: 'Calabaza · Pendiente de recuperar' }),
      element('span', { className: 'visual-legend-item bg-green', text: 'Verde · Reserva libre' }),
      element('span', { className: 'visual-legend-item bg-brown', text: 'Marrón · Flota sustituyendo otra flota' }),
      element('span', { className: 'visual-legend-item brown-outline', text: 'Trazo marrón · Reparación sin sustitución' })
    ]),
    element('div', { className: 'summary-grid' }, [
      metric('Blanco', count('blanco')),
      metric('Amarillo', count('amarillo')),
      metric('Lila', count('lila')),
      metric('Azul', count('azul'))
    ]),
    element('div', { className: 'summary-grid' }, [
      metric('Calabaza', count('calabaza')),
      metric('Verde', count('verde')),
      metric('Marrón', count('marron')),
      metric('Con trazo marrón', outlines)
    ])
  );

  const host = element('div', { className: 'grid visual-list' });
  rows.forEach(row => host.append(renderCard(row)));
  container.append(host, notice('Siguiente paso: validar esta representación visual antes de llevar estas reglas al Hotel activo.', 'warning'));
}
