import { supabase } from '/r1-alpha17/src/supabase.js';
import '/r1-alpha34/src/app.js';
import '/r1-alpha75/src/assistance-situation.js?v=75.25-paradas-002';
import '/r1-alpha75/src/assistance-followup.js?v=75.25-paradas-002';
import { renderHotelCard } from '/r1-alpha75/src/hotel-card.js?v=75.23-hf28';
import { deriveHotelOperationalState } from '/r1-alpha75/src/hotel-operational-state.js?v=75.25-paradas-002';
import '/r1-alpha75/src/panel-native-hf23.js?v=75.25-editor-fechas-001';

const content = document.querySelector('#module-content');

async function showHotel() {
  const { data: rows, error } = await supabase.from('hotel_actual_detalle').select('*').order('orden');
  if (error) throw new Error(error.message);
  const { data: stages, error: stageError } = await supabase.from('etapas_hotel').select('*').order('posicion');
  if (stageError) throw new Error(stageError.message);
  const host = document.createElement('section');
  host.id = 'fixture-hotel';
  for (const row of rows) {
    const ownStages = stages.filter(stage => stage.registro_hotel_id === row.id);
    const card = renderHotelCard(row, ownStages, new Map(), [], {
      editMode: false, editableIds: new Set(), canEditDocuments: false,
      canAddNotes: false, canManageNotes: false, generatedCancellations: [],
    });
    // The actual editor's pure derivation is checked alongside the read view.
    // The card still receives the database view unchanged.
    card.dataset.derivedState = deriveHotelOperationalState({ ...row, modelo_flujo_taller: 'entrada_hitos_v1' }, ownStages);
    host.append(card);
  }
  content.replaceChildren(host);
}

async function showIncidents() {
  const { data, error } = await supabase.from('activaciones_24h').select('*').order('creado_en');
  if (error) throw new Error(error.message);
  const list = document.createElement('section');
  list.className = 'a50-list';
  for (const row of data) {
    const card = document.createElement('article');
    card.className = 'a50-card';
    card.dataset.activationId = row.id;
    const title = document.createElement('h3');
    title.className = 'a50-title';
    title.textContent = `DFM ${row.dfm} · Caso ${row.numero_caso}`;
    const state = document.createElement('span');
    state.className = 'a50-state';
    state.textContent = row.estado.toUpperCase();
    const meta = document.createElement('div');
    meta.className = 'a50-meta';
    meta.textContent = row.resultado;
    const actions = document.createElement('div');
    actions.className = 'a50-actions';
    card.append(title, state, meta, actions);
    list.append(card);
  }
  // The production followup observer identifies these cards from database rows,
  // attaches its real button, and constructs the complete real dialog.
  content.replaceChildren(list);
}

document.querySelector('#fixture-hotel-button').onclick = showHotel;
document.querySelector('#fixture-incidents-button').onclick = showIncidents;
window.__UI_FIXTURE_READY__ = true;
