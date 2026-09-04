const content = document.querySelector('#module-content');

function normalizeSearch(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function ensureStyle() {
  if (document.querySelector('#alpha70-history-search-style')) return;
  const style = document.createElement('style');
  style.id = 'alpha70-history-search-style';
  style.textContent = [
    '.alpha70-history-search-hidden{display:none!important}',
    '.alpha70-history-search-status{margin:0;padding:9px 11px;border-radius:10px;background:#eff6ff;color:#1e3a8a;font-weight:800}',
    '.alpha70-history-search-empty{margin:0}'
  ].join('');
  document.head.append(style);
}

function searchInput() {
  if (!content?.dataset.alpha55HistoryNative) return null;
  return content.querySelector('input[aria-label="Buscar en la pizarra histórica"]');
}

function ensureStatus(resultHost, cardsHost) {
  let status = resultHost.querySelector('[data-alpha70-history-search-status]');
  if (!status) {
    status = document.createElement('div');
    status.className = 'alpha70-history-search-status';
    status.dataset.alpha70HistorySearchStatus = '1';
    resultHost.insertBefore(status, cardsHost);
  }
  return status;
}

function applyHistorySearch(input = searchInput()) {
  if (!input || !content) return;
  input.placeholder = 'DFM, matrícula, parada, reserva, INC, T o documento';
  const cardsHost = content.querySelector('[data-history-cards]');
  const resultHost = cardsHost?.closest('[data-history-results]');
  if (!cardsHost || !resultHost) return;

  const query = normalizeSearch(input.value);
  const tokens = query.split(' ').filter(Boolean);
  const cards = Array.from(cardsHost.querySelectorAll('.hotel-card'));
  let visible = 0;

  cards.forEach(card => {
    const searchable = normalizeSearch(card.dataset.search || card.textContent);
    const matches = !tokens.length || tokens.every(token => searchable.includes(token));
    card.classList.toggle('alpha70-history-search-hidden', !matches);
    if (matches) visible += 1;
  });

  const status = ensureStatus(resultHost, cardsHost);
  const message = query
    ? `${visible} de ${cards.length} fichas · búsqueda: ${input.value.trim()}`
    : `${cards.length} ficha${cards.length === 1 ? '' : 's'} en esta pizarra`;
  if (status.textContent !== message) status.textContent = message;

  let empty = resultHost.querySelector('[data-alpha70-history-search-empty]');
  if (query && cards.length && visible === 0) {
    if (!empty) {
      empty = document.createElement('div');
      empty.className = 'notice warning alpha70-history-search-empty';
      empty.dataset.alpha70HistorySearchEmpty = '1';
      resultHost.append(empty);
    }
    const emptyMessage = `No hay ninguna ficha que coincida con “${input.value.trim()}”.`;
    if (empty.textContent !== emptyMessage) empty.textContent = emptyMessage;
  } else {
    empty?.remove();
  }
}

let refreshQueued = false;
function queueRefresh() {
  if (refreshQueued) return;
  refreshQueued = true;
  window.requestAnimationFrame(() => {
    refreshQueued = false;
    applyHistorySearch();
  });
}

ensureStyle();

content?.addEventListener('input', event => {
  if (event.target.matches('input[aria-label="Buscar en la pizarra histórica"]')) {
    applyHistorySearch(event.target);
  }
}, true);

content?.addEventListener('change', event => {
  if (event.target.matches('input[aria-label="Buscar en la pizarra histórica"]')) {
    applyHistorySearch(event.target);
  }
}, true);

if (content) {
  new MutationObserver(queueRefresh).observe(content, { childList: true, subtree: true });
}

queueRefresh();
