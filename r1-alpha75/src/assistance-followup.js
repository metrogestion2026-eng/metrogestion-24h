import { supabase } from '../../r1-alpha17/src/supabase.js';

const content = document.querySelector('#module-content');
let patching = false;

function ensureStyle() {
  if (document.querySelector('#alpha74-assistance-followup-style')) return;
  const style = document.createElement('style');
  style.id = 'alpha74-assistance-followup-style';
  style.textContent = `
    .a74-follow-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
    .a74-follow-grid label{display:grid;gap:5px;font-weight:700}
    .a74-follow-grid input,.a74-follow-grid select,.a74-follow-grid textarea{width:100%;box-sizing:border-box;min-height:44px;padding:9px 10px;border:1px solid #aebdca;border-radius:10px;background:#fff;font:inherit}
    .a74-follow-grid textarea{min-height:90px}.a74-follow-wide{grid-column:1/-1}
    .a74-follow-check{display:flex!important;grid-template-columns:auto 1fr!important;align-items:center;gap:9px;padding:10px;border:1px solid #dbe5ec;border-radius:10px;font-weight:600!important}
    .a74-follow-check input{width:20px!important;height:20px;min-height:0!important}
    .a74-follow-actions{display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap}
    .a74-follow-note{padding:10px 12px;border-radius:10px;background:#eff6ff;color:#1e3a8a}
    .a74-follow-success{padding:8px 10px;border-radius:9px;background:#f0fdf4;color:#166534}
    @media(max-width:700px){.a74-follow-grid{grid-template-columns:1fr}.a74-follow-wide{grid-column:auto}.a74-follow-actions .button{flex:1 1 150px}}
  `;
  document.head.append(style);
}

function field(label, value = '', type = 'text') {
  const holder = document.createElement('label');
  holder.append(document.createTextNode(label));
  const input = document.createElement(type === 'textarea' ? 'textarea' : 'input');
  if (type !== 'textarea') input.type = type;
  input.value = value ?? '';
  holder.append(input);
  return [holder, input];
}

function check(label, checked = false) {
  const holder = document.createElement('label');
  holder.className = 'a74-follow-check';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = Boolean(checked);
  holder.append(input, document.createTextNode(label));
  return [holder, input];
}

function select(label, options, value) {
  const holder = document.createElement('label');
  holder.append(document.createTextNode(label));
  const input = document.createElement('select');
  options.forEach(([key, text]) => input.append(new Option(text, key)));
  input.value = value || options[0][0];
  holder.append(input);
  return [holder, input];
}

function requestId() {
  return `a74_24h_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

function normalize(value) {
  return String(value || '').trim().toLocaleUpperCase('es-ES');
}

function identityFromCard(card) {
  const title = card.querySelector('.a50-title')?.textContent || '';
  return {
    dfm: normalize(title.match(/DFM\s+([^·]+)/i)?.[1]),
    caseNumber: normalize(title.match(/Caso\s+(.+)$/i)?.[1]),
  };
}

function findFleetVehicle(fleet, value) {
  const key = normalize(value).replace(/^DFM\s*/, '').split('·')[0].trim();
  return fleet.find(vehicle => normalize(vehicle.dfm) === key) || null;
}

function openFollowup(row, card, fleet = []) {
  const overlay = document.createElement('div');
  overlay.className = 'a50-modal';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', `Continuar seguimiento 24H del DFM ${row.dfm}`);
  const modal = document.createElement('section');
  modal.className = 'a50-modal-card';
  const title = document.createElement('h3');
  title.textContent = `Seguimiento 24H · DFM ${row.dfm} · ${row.numero_caso || 'sin número'}`;
  const note = document.createElement('div');
  note.className = 'a74-follow-note';
  note.textContent = 'Si se confirma traslado en grúa, indica el taller: la parada creará automáticamente Entrada y Recogida.';
  const grid = document.createElement('div');
  grid.className = 'a74-follow-grid';

  const [activationDateLabel, activationDate] = field('Fecha real de activación', String(row.fecha_activacion || '').slice(0, 10), 'date');
  const [activationTimeLabel, activationTime] = field('Hora real de activación', String(row.hora_activacion || '').slice(0, 5), 'time');
  const [arrivedLabel, arrived] = check('Técnico llegado', row.tecnico_llegado);
  const [arrivalLabel, arrival] = field('Hora real de llegada', String(row.hora_llegada || '').slice(0, 5), 'time');
  const [diagnosisCheckLabel, diagnosisCheck] = check('Diagnóstico confirmado', row.diagnostico_confirmado);
  const [diagnosisLabel, diagnosis] = field('Diagnóstico', row.diagnostico || '', 'textarea');
  const [currentStateLabel, currentState] = select('Situación actual', [
    ['en_curso', 'En curso'],
    ['pendiente_diagnostico', 'Pendiente de diagnóstico'],
    ['pendiente_presupuesto', 'Pendiente de presupuesto'],
    ['pendiente_autorizacion', 'Pendiente de autorización'],
    ['pendiente_repuestos', 'Pendiente de repuestos'],
    ['en_reparacion', 'En reparación'],
  ], row.estado_seguimiento || 'en_curso');
  const [resultLabel, result] = select('Resultado', [
    ['seguimiento_abierto', 'Seguimiento abierto'],
    ['operativo_reparado', 'Reparado en carretera / operativo'],
    ['trasladado_taller', 'Trasladado en grúa a taller'],
    ['necesita_sustitucion', 'Necesita sustitución'],
  ], row.resultado);
  const [workshopLabel, workshop] = field('Taller de traslado', row.taller_traslado || row.proveedor || '');
  const [operationalLabel, operational] = check('Vehículo operativo y reparación finalizada', row.estado_operativo_confirmado);
  const [finishLabel, finish] = field('Hora de fin de reparación', String(row.hora_fin_reparacion || '').slice(0, 5), 'time');
  const [substituteDfmLabel, substituteDfm] = field('DFM del vehículo sustituto', row.vehiculo_sustituto || '');
  const [substitutePlateLabel, substitutePlate] = field('Matrícula del vehículo sustituto', row.matricula_sustituto || '');
  const substituteList = document.createElement('datalist');
  substituteList.id = `a74-substitute-fleet-${String(row.id || 'case').replace(/[^a-z0-9_-]/gi, '')}`;
  fleet.forEach(vehicle => substituteList.append(new Option(
    `${vehicle.matricula || 'Sin matrícula'} · ${vehicle.marca || ''}`,
    String(vehicle.dfm || '')
  )));
  substituteDfm.setAttribute('list', substituteList.id);
  substituteDfm.placeholder = 'Escribe el DFM completo';
  const [reasonLabel, reason] = field('Anotación del seguimiento', '', 'textarea');
  diagnosisLabel.classList.add('a74-follow-wide');
  reasonLabel.classList.add('a74-follow-wide');
  grid.append(activationDateLabel, activationTimeLabel, currentStateLabel, arrivedLabel, arrivalLabel, diagnosisCheckLabel, diagnosisLabel, resultLabel, workshopLabel, substituteDfmLabel, substitutePlateLabel, operationalLabel, finishLabel, reasonLabel);

  const error = document.createElement('div');
  error.className = 'h24-status danger';
  error.hidden = true;
  const actions = document.createElement('div');
  actions.className = 'a74-follow-actions';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'button secondary';
  cancel.textContent = 'Cancelar';
  const save = document.createElement('button');
  save.type = 'button';
  save.className = 'button primary';
  save.textContent = 'Guardar seguimiento';
  actions.append(cancel, save);
  modal.append(title, note, grid, substituteList, error, actions);
  overlay.append(modal);
  document.body.append(overlay);

  const syncVisibility = () => {
    const transfer = result.value === 'trasladado_taller';
    const repaired = result.value === 'operativo_reparado';
    workshopLabel.hidden = !transfer;
    substituteDfmLabel.hidden = result.value !== 'necesita_sustitucion';
    substitutePlateLabel.hidden = result.value !== 'necesita_sustitucion';
    operationalLabel.hidden = !repaired;
    finishLabel.hidden = !repaired;
    if (transfer) operational.checked = false;
  };
  syncVisibility();
  result.onchange = syncVisibility;
  const autofillSubstitute = () => {
    const vehicle = findFleetVehicle(fleet, substituteDfm.value);
    if (!vehicle) return;
    substituteDfm.value = String(vehicle.dfm || '').trim();
    substitutePlate.value = String(vehicle.matricula || '').trim().toUpperCase();
  };
  substituteDfm.addEventListener('input', autofillSubstitute);
  substituteDfm.addEventListener('change', autofillSubstitute);
  substituteDfm.addEventListener('blur', autofillSubstitute);
  cancel.onclick = () => overlay.remove();
  overlay.addEventListener('click', event => {
    if (event.target === overlay) overlay.remove();
  });

  save.onclick = async () => {
    const fail = message => {
      error.textContent = message;
      error.hidden = false;
    };
    error.hidden = true;
    if (!activationDate.value) return fail('Indica la fecha real de activación.');
    if (!activationTime.value) return fail('Indica la hora real de activación.');
    if (arrived.checked && !arrival.value) return fail('Indica la hora real de llegada del técnico.');
    if (diagnosisCheck.checked && !diagnosis.value.trim()) return fail('Escribe el diagnóstico confirmado.');
    if (result.value === 'trasladado_taller' && !workshop.value.trim()) return fail('Indica el taller al que lo lleva la grúa.');
    if (result.value === 'necesita_sustitucion' && !substituteDfm.value.trim() && !substitutePlate.value.trim()) return fail('Indica el DFM o la matrícula del vehículo sustituto.');
    if (result.value === 'operativo_reparado' && !operational.checked) return fail('Confirma que el vehículo está operativo y reparado.');
    if (result.value === 'operativo_reparado' && !finish.value) return fail('Indica la hora de fin de reparación.');

    save.disabled = true;
    const payload = {
      dfm: String(row.dfm || ''),
      matricula: row.matricula || '',
      averia: row.averia || 'Seguimiento de asistencia 24H',
      numero_caso: row.numero_caso || '',
      fecha_activacion: activationDate.value,
      hora_activacion: activationTime.value,
      eta_tecnico: String(row.eta_tecnico || '').slice(0, 5),
      proveedor: row.proveedor || '',
      tecnico_llegado: String(arrived.checked),
      hora_llegada: arrival.value,
      diagnostico_confirmado: String(diagnosisCheck.checked),
      diagnostico: diagnosis.value.trim(),
      trasladado_taller: String(result.value === 'trasladado_taller'),
      taller_traslado: result.value === 'trasladado_taller' ? workshop.value.trim() : '',
      estado_operativo_confirmado: String(result.value === 'operativo_reparado' && operational.checked),
      hora_fin_reparacion: result.value === 'operativo_reparado' ? finish.value : '',
      estado_seguimiento: currentState.value,
      vehiculo_sustituto: substituteDfm.value.trim(),
      matricula_sustituto: substitutePlate.value.trim().toUpperCase(),
      resultado: result.value,
      seguimiento_nota: reason.value.trim(),
    };
    const { error: saveError } = await supabase.rpc('guardar_activacion_24h', {
      p_id: row.id,
      p_payload: payload,
      p_request_id: requestId(),
    });
    if (saveError) {
      save.disabled = false;
      return fail(`No se pudo guardar: ${saveError.message}`);
    }

    const state = card.querySelector('.a50-state');
    const meta = card.querySelector('.a50-meta');
    const closed = result.value === 'operativo_reparado';
    if (state) {
      state.textContent = closed ? 'CERRADA' : 'ABIERTA';
      state.classList.toggle('closed', closed);
    }
    if (meta) meta.textContent = `${meta.textContent.split(' · ')[0]} · ${result.options[result.selectedIndex].text}`;
    const oldSuccess = card.querySelector('.a74-follow-success');
    oldSuccess?.remove();
    const success = document.createElement('div');
    success.className = 'a74-follow-success';
    success.textContent = result.value === 'trasladado_taller'
      ? 'Traslado guardado. Entrada y Recogida de taller creadas en la parada.'
      : 'Seguimiento 24H guardado correctamente.';
    card.querySelector('.a50-actions')?.after(success);
    overlay.remove();
  };
}

async function patchIncidentCards() {
  if (patching || !content?.querySelector('.a50-list')) return;
  const cards = [...content.querySelectorAll('.a50-card')].filter(card =>
    card.querySelector('.a50-state')?.textContent?.trim() === 'ABIERTA'
    && !card.querySelector('[data-a74-followup]')
  );
  if (!cards.length) return;
  patching = true;
  try {
    const [{ data, error }, { data: fleet, error: fleetError }] = await Promise.all([
      supabase.from('activaciones_24h').select(
        'id,dfm,matricula,averia,numero_caso,fecha_activacion,hora_activacion,eta_tecnico,proveedor,tecnico_llegado,hora_llegada,diagnostico_confirmado,diagnostico,trasladado_taller,taller_traslado,estado_operativo_confirmado,hora_fin_reparacion,estado_seguimiento,vehiculo_sustituto,matricula_sustituto,resultado,estado,creado_en'
      ).eq('estado', 'abierta').order('creado_en', { ascending: false }),
      supabase.from('vehiculos').select('id,dfm,matricula,marca').eq('activo', true).order('dfm'),
    ]);
    if (error || fleetError) return;
    cards.forEach(card => {
      const identity = identityFromCard(card);
      const matches = (data || []).filter(row => normalize(row.dfm) === identity.dfm
        && (!identity.caseNumber || normalize(row.numero_caso) === identity.caseNumber));
      if (matches.length !== 1) return;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'button primary compact';
      button.dataset.a74Followup = '1';
      button.textContent = '➡️ Continuar seguimiento 24H';
      button.onclick = event => {
        event.preventDefault();
        event.stopPropagation();
        openFollowup(matches[0], card, fleet || []);
      };
      card.querySelector('.a50-actions')?.prepend(button);
    });
  } finally {
    patching = false;
  }
}

ensureStyle();
if (content) new MutationObserver(() => patchIncidentCards()).observe(content, { childList: true, subtree: true });
patchIncidentCards();
