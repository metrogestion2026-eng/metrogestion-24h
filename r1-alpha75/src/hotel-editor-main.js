import { element } from '../../r1-alpha17/src/dom.js';
import {
  bindCheckbox, bindText, createCheckbox, createInput,
  createTextarea, fieldLabel, makeNewStage
} from '../../r1-alpha17/src/modules/hotel-editor-utils.js';
import { createEditableCatalogueField } from './editable-catalogue.js';
import { deriveHotelOperationalState, hasStageDrivenSituation } from './hotel-operational-state.js?v=75.23-hf9';

function normaliseVehicleKey(value) {
  return String(value || '').replace(/\s+/g, '').trim().toUpperCase();
}

function exactVehicle(catalog, value) {
  const key = normaliseVehicleKey(value);
  if (!key) return null;
  const matches = catalog.filter(item =>
    normaliseVehicleKey(item.dfm) === key || normaliseVehicleKey(item.matricula) === key
  );
  return matches.length === 1 ? matches[0] : null;
}

function createVehicleList(catalog, id, valueKey = 'dfm') {
  const list = element('datalist', { id });
  catalog.forEach(item => {
    const parts = [item.dfm, item.matricula, item.marca, item.tipo_manteniment].filter(Boolean);
    list.append(element('option', { value: item[valueKey] || '', label: parts.join(' · ') }));
  });
  return list;
}

function setControl(controls, ficha, key, value) {
  ficha[key] = value ?? '';
  if (controls[key]) controls[key].value = value ?? '';
}

function normaliseOperationalCode(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLocaleLowerCase('es-ES');
}

function ensureSituationStage(detail, stateCode) {
  const normalized = normaliseOperationalCode(stateCode);
  if (!['gestion', 'tramite'].includes(normalized)) return null;

  const wantedType = normalized === 'gestion' ? 'GESTIÓN' : 'TRÁMITE';
  const wantedName = wantedType;

  const existing = (detail.etapas || []).find(stage =>
    !stage?.cancelado && normaliseOperationalCode(stage?.tipo_etapa) === normalized
  );
  if (existing) return existing;

  const reusable = (detail.etapas || []).find(stage =>
    !stage?.id
    && stage?.auto_situacion === true
    && !stage?.cancelado
    && !(stage?.trabajos || []).length
    && !stage?.fecha_prevista
    && !stage?.fecha_inicio_real
    && !stage?.fecha_fin_real
    && !stage?.fecha_real
  );

  const stage = reusable || makeNewStage(detail.etapas || []);
  stage.nombre = wantedName;
  stage.tipo_etapa = wantedType;
  stage.estado = 'pendiente';
  stage.estado_catalogo_codigo = 'pendiente';
  stage.auto_situacion = true;

  if (!reusable) detail.etapas.push(stage);
  return stage;
}

export function renderMainSections(detail, markDirty) {
  const catalog = Array.isArray(detail.catalogos.vehiculos) ? detail.catalogos.vehiculos : [];
  const masterAvailable = catalog.length > 0;
  const masterReadOnly = new Set(['etiqueta_reserva','tipo_unidad','marca','tipo_motor','modelo','upc','telefono']);
  const identification = element('section', { className: 'editor-section' }, [element('h3', { text: '1. Identificación y unidad' })]);
  const identificationGrid = element('div', { className: 'editor-grid' });
  const controls = {};
  const fields = [
    ['N.º de actuación', 'numero_parada'], ['Vehículo sustituido', 'vehiculo_sustituido'],
    ['Matrícula sustituido', 'matricula_sustituido'],
  ];
  for (const [label, key] of fields) {
    const control = createInput({ value: detail.ficha[key] || '', readOnly: masterAvailable && masterReadOnly.has(key) });
    controls[key] = control;
    bindText(control, detail.ficha, key, markDirty);
    identificationGrid.append(fieldLabel(label, control));
  }

  const modalityEditor = createEditableCatalogueField(
    'Modalidad operativa',
    detail.catalogos.modalidades_operativas || [],
    detail.ficha.modalidad_operativa || '',
    {
      placeholder: 'Sin seleccionar',
      hint: 'Déjalo vacío si existe un sustituto real. También puedes elegir o escribir una modalidad nueva.',
      onChange: (item, typed) => {
        detail.ficha.modalidad_operativa = item?.codigo || typed;
        if (['sin_sustitucion', 'reparado_en_ruta'].includes(item?.comportamiento)) {
          setControl(controls, detail.ficha, 'vehiculo_reserva', '');
          setControl(controls, detail.ficha, 'matricula_reserva', '');
          setControl(controls, detail.ficha, 'etiqueta_reserva', '');
        }
        markDirty();
      }
    }
  );
  modalityEditor.field.dataset.validationKey = 'ficha:modalidad_operativa';
  identificationGrid.append(modalityEditor.field);

  const substituteFields = [
    ['Sustituto real (RESERVA/FLOTA)', 'vehiculo_reserva'],
    ['Matrícula sustituto', 'matricula_reserva'], ['Etiqueta reserva', 'etiqueta_reserva'],
    ['TIPO / Configuración', 'tipo_unidad'], ['Marca', 'marca'], ['Tipo de motor', 'tipo_motor'],
    ['Modelo', 'modelo'], ['UPC', 'upc'], ['Teléfono del vehículo', 'telefono']
  ];
  for (const [label, key] of substituteFields) {
    const control = createInput({ value: detail.ficha[key] || '', readOnly: masterAvailable && masterReadOnly.has(key) });
    controls[key] = control;
    bindText(control, detail.ficha, key, markDirty);
    identificationGrid.append(fieldLabel(label, control));
  }

  if (catalog.length) {
    const fleetDfmListId = `hotel-vehicles-dfm-${crypto.randomUUID()}`;
    const fleetPlateListId = `hotel-vehicles-plate-${crypto.randomUUID()}`;
    const substituteDfmListId = `hotel-substitutes-dfm-${crypto.randomUUID()}`;
    const substitutePlateListId = `hotel-substitutes-plate-${crypto.randomUUID()}`;

    controls.vehiculo_sustituido.setAttribute('list', fleetDfmListId);
    controls.matricula_sustituido.setAttribute('list', fleetPlateListId);
    controls.vehiculo_reserva.setAttribute('list', substituteDfmListId);
    controls.matricula_reserva.setAttribute('list', substitutePlateListId);

    identification.append(
      createVehicleList(catalog, fleetDfmListId, 'dfm'),
      createVehicleList(catalog, fleetPlateListId, 'matricula'),
      createVehicleList(catalog, substituteDfmListId, 'dfm'),
      createVehicleList(catalog, substitutePlateListId, 'matricula')
    );

    const fillMain = source => {
      const value = source === 'matricula'
        ? controls.matricula_sustituido.value
        : controls.vehiculo_sustituido.value;
      const vehicle = exactVehicle(catalog, value);
      if (!vehicle) return;
      setControl(controls, detail.ficha, 'vehiculo_sustituido', vehicle.dfm);
      setControl(controls, detail.ficha, 'matricula_sustituido', vehicle.matricula);
      setControl(controls, detail.ficha, 'tipo_unidad', vehicle.tipo_manteniment || '');
      setControl(controls, detail.ficha, 'marca', vehicle.marca);
      setControl(controls, detail.ficha, 'tipo_motor', vehicle.tipo_motor);
      setControl(controls, detail.ficha, 'modelo', vehicle.modelo);
      setControl(controls, detail.ficha, 'upc', vehicle.upc);
      setControl(controls, detail.ficha, 'telefono', vehicle.telefono);
      markDirty();
    };

    const fillSubstitute = source => {
      const value = source === 'matricula'
        ? controls.matricula_reserva.value
        : controls.vehiculo_reserva.value;
      const vehicle = exactVehicle(catalog, value);
      if (!vehicle) return;
      setControl(controls, detail.ficha, 'vehiculo_reserva', vehicle.dfm);
      setControl(controls, detail.ficha, 'matricula_reserva', vehicle.matricula);
      setControl(controls, detail.ficha, 'etiqueta_reserva', vehicle.tipo_sustituto_catalogo === 'RESERVA' ? vehicle.etiqueta_reserva : '');
      markDirty();
    };

    controls.vehiculo_sustituido.addEventListener('change', () => fillMain('dfm'));
    controls.vehiculo_sustituido.addEventListener('blur', () => fillMain('dfm'));
    controls.matricula_sustituido.addEventListener('change', () => fillMain('matricula'));
    controls.matricula_sustituido.addEventListener('blur', () => fillMain('matricula'));
    controls.vehiculo_reserva.addEventListener('change', () => fillSubstitute('dfm'));
    controls.vehiculo_reserva.addEventListener('blur', () => fillSubstitute('dfm'));
    controls.matricula_reserva.addEventListener('change', () => fillSubstitute('matricula'));
    controls.matricula_reserva.addEventListener('blur', () => fillSubstitute('matricula'));
  }

  identification.append(identificationGrid,
    element('p', { className: 'muted', text: 'Fuente de datos maestros: Registro ↔ MANTENIMENT · ALTA. DFM/R identifica la familia; TIPO refleja la configuración (TR, 21/HA…). Los datos maestros se corrigen únicamente en Registro o ALTA.' }));

  const operation = element('section', { className: 'editor-section' }, [element('h3', { text: '2. Situación operativa' })]);
  const operationGrid = element('div', { className: 'editor-grid' });
  const priority = createInput({ type: 'number', min: 0, max: 5, step: 1, value: detail.ficha.prioridad ?? 5 });
  bindText(priority, detail.ficha, 'prioridad', markDirty, Number);
  const baseState = () => detail.ficha.estado === 'anulado' ? 'pendiente_taller' : detail.ficha.estado;
  const momentaryState = { codigo: 'sustitucion_momentanea', nombre: 'Sustitución momentánea', orden: -1 };
  const stateOptions = detail.catalogos.estados.filter(item => !['anulado', 'reserva_liberada', 'sustitucion_momentanea'].includes(item.codigo));
  const preEntryStateOptions = stateOptions.filter(item => ['planificado', 'pendiente_taller', 'tramite', 'gestion'].includes(item.codigo));
  const isNewFlow = detail.ficha.modelo_flujo_taller === 'entrada_hitos_v1';
  const initialStateOptions = isNewFlow && !hasStageDrivenSituation(detail.ficha, detail.etapas)
    ? preEntryStateOptions
    : stateOptions;
  const stateEditor = createEditableCatalogueField(
    'Situación operativa',
    detail.ficha.sustitucion_temporal ? [momentaryState, ...stateOptions] : initialStateOptions,
    detail.ficha.sustitucion_temporal ? 'sustitucion_momentanea' : baseState(),
    {
      placeholder: 'La situación se calcula desde las T',
      hint: 'Antes de programar la Entrada puedes elegir Pendiente de parar o Parado en espera de taller. En fichas nuevas, desde que programas la Entrada la situación se calcula con sus fechas y con la T siguiente.',
      onChange: (item, typed) => {
        detail.ficha.estado = item?.codigo || typed;
        const stage = ensureSituationStage(detail, detail.ficha.estado);
        markDirty();
        if (stage) detail.onStagesChanged?.(stage);
      }
    }
  );
  const syncOperationalState = () => {
    if (detail.ficha.sustitucion_temporal || detail.ficha.cancelado) return;
    const stageDriven = hasStageDrivenSituation(detail.ficha, detail.etapas);
    const nextState = deriveHotelOperationalState(detail.ficha, detail.etapas);
    if (nextState && nextState !== detail.ficha.estado) {
      detail.ficha.estado = nextState;
      markDirty();
    }
    const availableStates = isNewFlow && !stageDriven ? preEntryStateOptions : stateOptions;
    stateEditor.rebuild(availableStates, nextState || baseState(), true);
    stateEditor.setDisabled(isNewFlow && stageDriven);
  };
  syncOperationalState();
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
    ['Próximo previsto', 'proximo']
  ];
  const longGrid = element('div', { className: 'editor-grid editor-grid-two' });
  for (const [label, key] of longFields) {
    const control = createTextarea(detail.ficha[key] || '');
    bindText(control, detail.ficha, key, markDirty);
    longGrid.append(fieldLabel(label, control));
  }
  operation.append(operationGrid, longGrid);

  const editorControls = element('section', { className: 'editor-section' }, [element('h3', { text: '3. Sustitución, retirada y cancelación' })]);
  const temp = createCheckbox('Sustitución momentánea activa', detail.ficha.sustitucion_temporal);
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
    stateEditor.rebuild(
      detail.ficha.sustitucion_temporal
        ? [momentaryState, ...stateOptions]
        : (isNewFlow && !hasStageDrivenSituation(detail.ficha, detail.etapas) ? preEntryStateOptions : stateOptions),
      detail.ficha.sustitucion_temporal ? 'sustitucion_momentanea' : baseState(),
      true
    );
    stateEditor.setDisabled(detail.ficha.cancelado || detail.ficha.sustitucion_temporal || (isNewFlow && hasStageDrivenSituation(detail.ficha, detail.etapas)));
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
  const historyHelp = element('p', {
    className: 'muted',
    text: 'Al finalizar, la ficha sale del Hotel activo pero conserva el número de actuación, sus T, documentos y fechas en Histórico.'
  });
  editorControls.append(temp.label, tempBox, retired.label, cancelled.label, cancellationBox, syncTitle, syncGrid, supervised.label, syncHelp, historyHelp);
  refresh();
  return [identification, operation, editorControls, syncOperationalState];
}
