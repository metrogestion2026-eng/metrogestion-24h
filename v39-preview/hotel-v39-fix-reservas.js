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
    const hasLinkedFleet = /Sustituido por reserva/i.test(reserveLine);
    const selectState = String(card.querySelector('.hotel-status-select')?.value || '').toLowerCase();
    const badgeReleased = [...card.querySelectorAll('.badge')].some(b => /Reserva libre/i.test(String(b.textContent || '')));
    return hasLinkedFleet && (selectState === 'reserva_liberada' || badgeReleased);
  };

  const hideReleased = card => {
    if (!isReleasedMovementCard(card)) return;
    card.dataset.v39ReleasedMovement = '1';
    card.setAttribute('hidden','');
    card.style.setProperty('display','none','important');
  };

  const apply = () => {
    document.querySelectorAll('article.hotel-unit').forEach(hideReleased);
    document.querySelectorAll('.hotel-metric-filter[data-filter="free"]').forEach(metric => {
      metric.style.setProperty('display','none','important');
    });
  };

  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(apply, 20);
  };

  const observer = new MutationObserver(records => {
    for (const record of records) {
      if (record.type === 'childList') {
        record.addedNodes.forEach(node => {
          if (!(node instanceof Element)) return;
          if (node.matches?.('article.hotel-unit')) hideReleased(node);
          node.querySelectorAll?.('article.hotel-unit').forEach(hideReleased);
        });
      }
      if (record.type === 'attributes' && record.target instanceof Element && record.target.matches('article.hotel-unit')) {
        hideReleased(record.target);
      }
    }
    schedule();
  });
  observer.observe(document.documentElement, {childList:true, subtree:true, attributes:true, attributeFilter:['class','style','hidden']});

  // Defensa adicional frente a renders heredados que restituyan display después.
  setInterval(apply,500);
  window.addEventListener('focus', schedule);
  document.addEventListener('click', schedule, true);
  schedule();
})();
