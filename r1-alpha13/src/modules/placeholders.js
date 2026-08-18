import { clear, element, notice } from '../dom.js';

const TEXT = Object.freeze({
  t_programadas: ['T programadas', 'Se construirá sobre las T reales de Hotel, sin duplicar datos.'],
  reservas: ['Reservas', 'Se separarán las reservas libres de los movimientos activos manteniendo una sola fuente.'],
  talleres: ['Talleres', 'Cada teléfono tendrá su propia ficha con contacto, extensión, correo y observaciones.'],
  resumen: ['Panel', 'El diseño anterior queda retirado. Este módulo permanece en construcción.']
});

export function renderPlaceholder(container, moduleId) {
  clear(container);
  const [title, description] = TEXT[moduleId] || ['Módulo', 'En construcción.'];
  container.append(
    element('div', { className: 'module-heading' }, [
      element('div', {}, [
        element('h2', { text: title }),
        element('p', { className: 'muted', text: description })
      ])
    ]),
    notice('EN CONSTRUCCIÓN · No realiza lecturas ni modificaciones de datos.', 'warning')
  );
}
