import { element } from '../dom.js';
import {
  bindCheckbox, bindText, createCheckbox, createInput, createSelect,
  createTextarea, fieldLabel
} from './hotel-editor-utils.js';

export function renderMainSections(detail, markDirty) {
  const identification = element('section', { className: 'editor-section' }, [element('h3', { text: '1. Identificación y unidad' })]);
  const identificationGrid = element('div', { className: 'editor-grid' });
  const identificationFields = [
    ['Nº de parada', 'numero_parada'], ['Vehículo sustituido', 'vehiculo_sustituido'],
    ['Matrícula sustituido', 'matricula_sustituido'], ['Reserva', 'vehiculo_reserva'],
    ['Matrícula reserva', 'matricula_reserva'], ['Etiqueta reserva', 'etiqueta_reserva'],
    ['Tipo de unidad', 'tipo_unidad'], ['Marca', 'marca'], ['Tipo de motor', 'tipo_motor'],
    ['Modelo', 'modelo'], ['UPC', 'upc'], ['Teléfono', 'telefono']
  ];
  for (const [label, key] of identificationFields) {
    const control = createInput({ value: detail.ficha[key] || '' });
    bindText(control, detail.ficha, key, markDirty);
    identificationGrid.append(fieldLabel(label, control));
  }
  identification.append(identificationGrid);

  const operation = element('section', { className: 'editor-section' }, [element('h3', { text: '2. Situación operativa' })]);
  const operationGrid = element('div', { className: 'editor-grid' });
  const priority = createSelect(Array.from({ length: 6 }, (_, value) => [String(value), String(value)]), String(detail.ficha.prioridad ?? 5));
  bindText(priority, detail.ficha, 'prioridad', markDirty, Number);
  const stateOptions = detail.catalogos.estados
    .filter(item => !['anulado', 'reserva_liberada'].includes(item.codigo))
    .map(item => [item.codigo, item.nombre]);
  const state = createSelect(stateOptions, detail.ficha.estado === 'anulado' ? 'pendiente_taller' : detail.ficha.estado);
  bindText(state, detail.ficha, 'estado', markDirty);

  const simpleFields = [
    ['Lugar', 'lugar', 'text'], ['Fecha de parada', 'fecha_parada', 'date'],
    ['Entrada / movimiento', 'fecha_entrada', 'datetime-local'], ['Tipo de movimiento', 'tipo_movimiento', 'text'],
    ['INC', 'incidencia', 'text']
  ];
  operationGrid.append(fieldLabel('Prioridad', priority), fieldLabel('Estado', state));
  for (const [label, key, type] of simpleFields) {
    const control = createInput({ type, value: detail.ficha[key] || '' });
    bindText(control, detail.ficha, key, markDirty);
    operationGrid.append(fieldLabel(label, control));
  }
  const order = createInput({ type: 'number', min: 0, max: 9999, step: 1, value: detail.ficha.orden ?? 0 });
  bindText(order, detail.ficha, 'orden', markDirty, Number);
  operationGrid.append(fieldLabel('Orden visual', order));

  const longFields = [
    ['Causa / pendientes del sustituido', 'causa'], ['Pendientes propios de la reserva', 'trabajos_reserva'],
    ['Próximo previsto', 'proximo'], ['Observaciones', 'observaciones']
  ];
  const longGrid = element('div', { className: 'editor-grid editor-grid-two' });
  for (const [label, key] of longFields) {
    const control = createTextarea(detail.ficha[key] || '');
    bindText(control, detail.ficha, key, markDirty);
    longGrid.append(fieldLabel(label, control));
  }
  operation.append(operationGrid, longGrid);

  const controls = element('section', { className: 'editor-section' }, [element('h3', { text: '3. Sustitución, retirada y cancelación' })]);
  const temp = createCheckbox('Sustitución temporal activa', detail.ficha.sustitucion_temporal);
  const tempReason = createTextarea(detail.ficha.motivo_sustitucion_temporal || '');
  const tempLimit = createInput({ type: 'datetime-local', value: detail.ficha.fecha_limite_sustitucion || '' });
  bindText(tempReason, detail.ficha, 'motivo_sustitucion_temporal', markDirty);
  bindText(tempLimit, detail.ficha, 'fecha_limite_sustitucion', markDirty);
  const tempBox = element('div', { className: 'editor-conditional' }, [
    fieldLabel('Motivo del relevo temporal', tempReason), fieldLabel('Fecha límite', tempLimit)
  ]);

  const retired = createCheckbox('Retirar del Hotel activo, conservando el Histórico', detail.ficha.retirado_hotel_activo);
  bindCheckbox(retired.input, detail.ficha, 'retirado_hotel_activo', markDirty);
  const cancelled = createCheckbox('Cancelar ficha, sin borrarla físicamente', detail.ficha.cancelado);
  const cancellationReason = createTextarea(detail.ficha.motivo_cancelacion || '');
  bindText(cancellationReason, detail.ficha, 'motivo_cancelacion', markDirty);
  const cancellationBox = element('div', { className: 'editor-conditional' }, [
    fieldLabel('Motivo obligatorio de cancelación', cancellationReason)
  ]);

  const refresh = () => {
    tempBox.classList.toggle('hidden', !detail.ficha.sustitucion_temporal);
    cancellationBox.classList.toggle('hidden', !detail.ficha.cancelado);
    state.disabled = detail.ficha.cancelado;
  };
  bindCheckbox(temp.input, detail.ficha, 'sustitucion_temporal', markDirty, refresh);
  bindCheckbox(cancelled.input, detail.ficha, 'cancelado', markDirty, checked => {
    if (!checked && detail.ficha.estado === 'anulado') detail.ficha.estado = 'pendiente_taller';
    refresh();
  });
  controls.append(temp.label, tempBox, retired.label, cancelled.label, cancellationBox);
  refresh();
  return [identification, operation, controls];
}
