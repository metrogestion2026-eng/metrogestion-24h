import { renderHotel as renderBaseHotel } from '../../../r1-alpha17/src/modules/hotel.js';
import { openHotelCreate } from './hotel-create.js';

export async function renderHotel(container, access = { view: false, edit: false }) {
  await renderBaseHotel(container, access);
  if (!access.edit) return;

  const actions = container.querySelector('.hotel-heading-actions');
  const modeButton = container.querySelector('.hotel-mode-button');
  if (!actions || !modeButton) return;

  const addButton = document.createElement('button');
  addButton.type = 'button';
  addButton.className = 'button primary hidden';
  addButton.textContent = '＋ Añadir ficha';
  addButton.title = 'Crear una nueva ficha en la pizarra actual';

  const syncVisibility = () => {
    const editing = modeButton.classList.contains('primary');
    addButton.classList.toggle('hidden', !editing);
  };

  addButton.addEventListener('click', () => openHotelCreate({
    onSaved: async () => renderHotel(container, access)
  }));
  modeButton.addEventListener('click', syncVisibility);
  actions.prepend(addButton);
  syncVisibility();
}