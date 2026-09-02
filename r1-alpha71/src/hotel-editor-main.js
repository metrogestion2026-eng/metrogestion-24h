import { element } from '../../r1-alpha17/src/dom.js';
import {
  bindCheckbox, bindText, createCheckbox, createInput, createSelect,
  createTextarea, fieldLabel
} from '../../r1-alpha17/src/modules/hotel-editor-utils.js';


function normaliseCatalogueValue(value) {
  return String(value ?? '').trim().toLocaleLowerCase('es-ES');
}

function findCatalogueItem(catalogue, value) {
  const key = normaliseCatalogueValue(value);
  if (!key) return null;
  return (catalogue || []).find(item =>
    normaliseCatalogueValue(item.codigo ?? item.id) === key
    || normaliseCatalogueValue(item.nombre) === key
  ) || null;
}

function createEditableCatalogueField(labelText, catalogue, value, {
  placeholder = 'Elige una opción o escribe una nueva',
  hint = 'Puedes elegir un valor existente o escribir uno nuevo. Se añadirá al listado al guardar.',
  onChange,
} = {}) {
  let items = Array.isArray(catalogue) ? catalogue : [];
  const selected = findCatalogueItem(items, value);
  const input = createInput({ value: selected?.nombre || value || '', placeholder });
  const listId = `a71-catalogue-${crypto.randomUUID()}`;
  const list = element('datalist', { id: listId });
  input.setAttribute('list', listId);
  input.setAttribute('autocomplete', 'off');
  input.setAttribute('spellcheck', 'false');

  const rebuild = (nextItems = items, nextValue, replaceValue = false) => {
    items = Array.isArray(nextItems) ? nextItems : [];
    list.replaceChildren();
    items
      .slice()
      .sort((a, b) => String(a.nombre || '').localeCompare(String(b.nombre || ''), 'es'))
      .forEach(item => list.append(element('option', {
        value: item.nombre || item.codigo || item.id,
        label: item.codigo && item.codigo !== item.nombre ? item.codigo : ''
      })));
    if (replaceValue) {
      const next = findCatalogueItem(items, nextValue);
      input.value = next?.nombre || nextValue || '';
    }
  };

  const update = () => {
    const typed = input.value.trim();
    onChange?.(findCatalogueItem(items, typed), typed);
  };
  input.addEventListener('input', update);
  input.addEventListener('change', update);
  rebuild(items, value, false);

  const field = fieldLabel(labelText, input);
  field.append(list, element('small', { className: 'muted', text: hint }));
  return { input, field, rebuild };
}

function exactVehicle(catalog, value) {
  const code = String(value || '').trim().toUpperCase();
  return catalog.find(item => String(item.dfm || '').trim().toUpperCase() === code) || null;
}

function createVehicleList(catalog, id) {
  const list = element('datalist', { id });
  catalog.forEach(item => {
    const parts = [item.dfm, item.matricula, item.marca, item.tipo_manteniment].filter(Boolean);
    list.append(element('option', { value: item.dfm, label: parts.join(' · ') }));
  });
  return list;
}

function setControl(controls, ficha, key, value) {
  ficha[key] = value ?? '';
  if (controls[key]) controls[key].value = value ?? '';
}

export function renderMainSections(detail, markDirty) {
  const catalog = Array.isArray(detail.catalogos.vehiculos) ? detail.catalogos.vehiculos : [];
  const identification = element('section', { className: 'editor-section' }, [element('h3', { text: '1. Identificación y unidad' })]);
  const identificationGrid = element('div', { className: 'editor-grid' });
  const controls = {};
  const fields = [
    ['Nº de parada', 'numero_parada'], ['Vehículo sustituido', 'vehiculo_sustituido'],
    ['Matrícula sustituido', 'matricula_sustituido'], ['Sustituto (RESERVA/FLOTA)', 'vehiculo_reserva'],
    ['Matrícula sustituto', 'matricula_reserva'], ['Etiqueta reserva', 'etiqueta_reserva'],
    ['Tipo de unidad', 'tipo_unidad'], ['Marca', 'marca'], ['Tipo de motor', 'tipo_motor'],
    ['Modelo', 'modelo'], ['UPC', 'upc'], ['Teléfono del vehículo', 'telefono']
  ];
  for (const [label, key] of fields) {
    const control = createInput({ value: detail.ficha[key] || '' });
    controls[key] = control;
    bindText(control, detail.ficha, key, markDirty);
    identificationGrid.append(fieldLabel(label, control));
  }

  if (catalog.length) {
    const fleetListId = `hotel-vehicles-${crypto.randomUUID()}`;
    const substituteListId = `hotel-substitutes-${crypto.randomUUID()}`;
    controls.vehiculo_sustituido.setAttribute('list', fleetListId);
    controls.vehiculo_reserva.setAttribute('list', substituteListId);
    identification.append(createVehicleList(catalog, fleetListId), createVehicleList(catalog, substituteListId));

    const fillMain = () => {
      const vehicle = exactVehicle(catalog, controls.vehiculo_sustituido.value);
      if (!vehicle) return;
      setControl(controls, detail.ficha, 'matricula_sustituido', vehicle.matricula);
      setControl(controls, detail.ficha, 'tipo_unidad', vehicle.categoria || (String(vehicle.dfm).startsWith('R') ? 'R' : 'DFM'));
      setControl(controls, detail.ficha, 'marca', vehicle.marca);
      setControl(controls, detail.ficha, 'tipo_motor', vehicle.tipo_motor);
      setControl(controls, detail.ficha, 'modelo', vehicle.modelo);
      setControl(controls, detail.ficha, 'upc', vehicle.upc);
      setControl(controls, detail.ficha, 'telefono', vehicle.telefono);
      markDirty();
    };
    const fillSubstitute = () => {
      const vehicle = exactVehicle(catalog, controls.vehiculo_reserva.value);
      if (!vehicle) return;
      setControl(controls, detail.ficha, 'matricula_reserva', vehicle.matricula);
      setControl(controls, detail.ficha, 'etiqueta_reserva', vehicle.tipo_sustituto_catalogo === 'RESERVA' ? vehicle.etiqueta_reserva : '');
      markDirty();
    };
    controls.vehiculo_sustituido.addEventListener('change', fillMain);
    controls.vehiculo_sustituido.addEventListener('blur', fillMain);
    controls.vehiculo_reserva.addEventListener('change', fillSubstitute);
    controls.vehiculo_reserva.addEventListener('blur', fillSubstitute);
  }

  identification.append(identificationGrid,
    element('p', { className: 'muted', text: 'Fuente de autocompletado: MANTENIMENT · ALTA. Todos los campos permanecen editables para unidades aún no dadas de alta.' }));

  const operation = element('section', { className: 'editor-section' }, [element('h3', { text: '2. Situación operativa' })]);
  const operationGrid = element('div', { className: 'editor-grid' });
  const priority = createInput({ type: 'number', min: 0, max: 5, step: 1, value: detail.ficha.prioridad ?? 5 });
  bindText(priority, detail.ficha, 'prioridad', markDirty, Number);
  const stateOptions = detail.catalogos.estados.filter(item => !['anulado', 'reserva_liberada'].includes(item.codigo));
  const stateEditor = createEditableCatalogueField(
    'Estado',
    stateOptions,
    detail.ficha.estado === 'anulado' ? 'pendiente_taller' : detail.ficha.estado,
    {
      placeholder: 'Elige un estado o escribe uno nuevo',
      hint: 'El estado nuevo quedará disponible en este listado al guardar.',
      onChange: (item, typed) => {
        detail.ficha.estado = item?.codigo || typed;
        markDirty();
      }
    }
  );
  const state = stateEditor.input;
  const simpleFields = [
    ['Lugar', 'lugar', 'text'], ['Fecha programada de parada', 'fecha_programada_parada', 'date'],
    ['Fecha real de parada', 'fecha_parada', 'date'],
    ['Entrada / movimiento', 'fecha_entrada', 'datetime-local'], ['Tipo de movimiento', 'tipo_movimiento', 'text'],
    ['INC', 'incidencia', 'text']
  ];
  operationGrid.append(fieldLabel('Prioridad', priority), stateEditor.field);
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

  const editorControls = element('section', { className: 'editor-section' }, [element('h3', { text: '3. Sustitución, retirada y cancelación' })]);
  const temp = createCheckbox('Sustitución temporal activa', detail.ficha.sustitucion_temporal);
  const tempReason = createTextarea(detail.ficha.motivo_sustitucion_temporal || '');
  const tempLimit = createInput({ type: 'datetime-local', value: detail.ficha.fecha_limite_sustitucion || '' });
  bindText(tempReason, detail.ficha, 'motivo_sustitucion_temporal', markDirty);
  bindText(tempLimit, detail.ficha, 'fecha_limite_sustitucion', markDirty);
  const tempBox = element('div', { className: 'editor-conditional' }, [fieldLabel('Motivo del relevo temporal', tempReason), fieldLabel('Fecha límite', tempLimit)]);
  const retired = createCheckbox('Retirar del Hotel activo, conservando el Histórico', detail.ficha.retirado_hotel_activo);
  bindCheckbox(retired.input, detail.ficha, 'retirado_hotel_activo', markDirty);
  const cancelled = createCheckbox('Cancelar ficha, sin borrarla físicamente', detail.ficha.cancelado);
  const cancellationReason = createTextarea(detail.ficha.motivo_cancelacion || '');
  bindText(cancellationReason, detail.ficha, 'motivo_cancelacion', markDirty);
  const cancellationBox = element('div', { className: 'editor-conditional' }, [fieldLabel('Motivo obligatorio de cancelación', cancellationReason)]);
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
  const syncTitle = element('h4', { text: 'MANTENIMENT · fila PARADA' });
  const syncGrid = element('div', { className: 'editor-grid' });
  const cutDate = createInput({ type: 'date', value: detail.ficha.manteniment_fecha_corte || '' });
  const closing = createInput({ value: detail.ficha.manteniment_tancament || '', placeholder: 'TANCAMENT 8' });
  const manualDays = createInput({ type: 'number', min: 0, step: 1, value: detail.ficha.manteniment_dias_parada_manual ?? '' });
  const manualKm = createInput({ type: 'number', min: 0, step: 0.01, value: detail.ficha.manteniment_km_facturables_manual ?? '' });
  bindText(cutDate, detail.ficha, 'manteniment_fecha_corte', markDirty);
  bindText(closing, detail.ficha, 'manteniment_tancament', markDirty, value => value.trim().toUpperCase());
  bindText(manualDays, detail.ficha, 'manteniment_dias_parada_manual', markDirty);
  bindText(manualKm, detail.ficha, 'manteniment_km_facturables_manual', markDirty);
  const supervised = createCheckbox('TANCAMENT revisado: retirar el fondo rosa', detail.ficha.manteniment_tancament_supervisado);
  bindCheckbox(supervised.input, detail.ficha, 'manteniment_tancament_supervisado', markDirty);
  syncGrid.append(
    fieldLabel('Fecha de corte mensual (K)', cutDate),
    fieldLabel('Cierre mensual (Q)', closing),
    fieldLabel('Días manuales (L, opcional)', manualDays),
    fieldLabel('Km facturables manuales (P, opcional)', manualKm)
  );
  const syncHelp = element('p', {
    className: 'muted',
    text: 'Con TANCAMENT, K es solo la fecha de corte de facturación y no recupera el vehículo. Sin TANCAMENT, la recuperación real continúa vinculada al cierre operativo de la ficha.'
  });
  editorControls.append(temp.label, tempBox, retired.label, cancelled.label, cancellationBox, syncTitle, syncGrid, supervised.label, syncHelp);
  refresh();
  return [identification, operation, editorControls];
}
