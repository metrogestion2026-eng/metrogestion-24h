// v39 preview · ocultar movimientos ya recuperados de la pizarra activa.
// Las reservas libres se muestran únicamente en el bloque limpio de Reservas.
(() => {
  'use strict';
  if (window.__metrogestionV39ReserveFixLoaded) return;
  window.__metrogestionV39ReserveFixLoaded = true;

  let timer = null;

  const isReleasedMovementCard = card => {
    if (!card?.matches?.('article.hotel-unit')) return false;
    const reserveLine = String(card.querySelector('.hotel-reserve')?.textContent || '');
    if (!/Sustituido por reserva/i.test(reserveLine)) return false;

    const selectState = String(card.querySelector('.hotel-status-select')?.value || '').toLowerCase();
    const badgeReleased = [...card.querySelectorAll('.badge')].some(b => /Reserva libre/i.test(String(b.textContent || '')));
    return selectState === 'reserva_liberada' || badgeReleased;
  };

  const apply = () => {
    document.querySelectorAll('article.hotel-unit').forEach(card => {
      if (isReleasedMovementCard(card)) {
        card.dataset.v39ReleasedMovement = '1';
        card.style.display = 'none';
      }
    });

    // El contador antiguo de "Reservas libres" pertenece al modelo v36 basado en
    // registros de parada. En v39 lo sustituye el panel limpio calculado desde catálogo.
    document.querySelectorAll('.hotel-metric-filter[data-filter="free"]').forEach(metric => {
      metric.style.display = 'none';
    });
  };

  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(apply, 40);
  };

  const observer = new MutationObserver(schedule);
  observer.observe(document.documentElement, {childList:true, subtree:true});
  window.addEventListener('focus', schedule);
  document.addEventListener('click', schedule, true);
  schedule();
})();
