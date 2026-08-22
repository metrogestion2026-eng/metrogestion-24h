import { renderHotel as renderBaseHotel } from '../../../r1-alpha17/src/modules/hotel.js';
import { supabase } from '../../../r1-alpha17/src/supabase.js';
import { openHotelCreate } from '../../../r1-alpha20/src/modules/hotel-create.js';
import { openHotelEditor } from './hotel-editor.js';

export async function renderHotel(container, access = { view: false, edit: false }) {
  await renderBaseHotel(container, access);
  if (!access.edit) return;

  const { data: rows } = await supabase.from('hotel_actual_detalle').select('id').order('orden', { ascending: true });
  const ids = (rows || []).map(row => row.id);

  const tagEditorButtons = () => {
    container.querySelectorAll('.hotel-card').forEach((card, index) => {
      const button = card.querySelector('.hotel-open-editor');
      if (button && ids[index]) button.dataset.registroId = ids[index];
    });
  };
  const observer = new MutationObserver(tagEditorButtons);
  observer.observe(container, { childList: true, subtree: true });
  tagEditorButtons();

  if (container.__alpha24EditorHandler) container.removeEventListener('click', container.__alpha24EditorHandler, true);
  const captureEditor = event => {
    const button = event.target.closest?.('.hotel-open-editor[data-registro-id]');
    if (!button || !container.contains(button)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    openHotelEditor(button.dataset.registroId, { onSaved: async () => renderHotel(container, access) });
  };
  container.__alpha24EditorHandler = captureEditor;
  container.addEventListener('click', captureEditor, true);

  const actions = container.querySelector('.hotel-heading-actions');
  const modeButton = container.querySelector('.hotel-mode-button');
  if (!actions || !modeButton) return;

  const addButton = document.createElement('button');
  addButton.type = 'button';
  addButton.className = 'button primary hidden';
  addButton.textContent = '＋ Añadir ficha';
  addButton.title = 'Crear una nueva ficha en la pizarra actual';
  addButton.addEventListener('click', () => openHotelCreate({ onSaved: async () => renderHotel(container, access) }));

  const syncVisibility = () => addButton.classList.toggle('hidden', !modeButton.classList.contains('primary'));
  modeButton.addEventListener('click', syncVisibility);
  actions.prepend(addButton);
  syncVisibility();
}