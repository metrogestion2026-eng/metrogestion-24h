import { element } from '../../r1-alpha17/src/dom.js';
import { createInput } from '../../r1-alpha17/src/modules/hotel-editor-utils.js';

function normaliseCatalogueValue(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLocaleLowerCase('es-ES');
}

export function findCatalogueItem(catalogue, value) {
  const key = normaliseCatalogueValue(value);
  if (!key) return null;
  return (catalogue || []).find(item =>
    normaliseCatalogueValue(item.codigo ?? item.id) === key
    || normaliseCatalogueValue(item.nombre) === key
  ) || null;
}

function catalogueName(item) {
  return String(item?.nombre || item?.codigo || item?.id || '').trim();
}

function catalogueCode(item) {
  return String(item?.codigo ?? item?.id ?? '').trim();
}

function catalogueSearchText(item) {
  return normaliseCatalogueValue([
    catalogueName(item),
    catalogueCode(item),
    item?.poblacion,
    item?.direccion,
    item?.observaciones,
  ].filter(Boolean).join(' '));
}

export function createEditableCatalogueField(labelText, catalogue, value, {
  placeholder = 'Escribe para buscar o crear una opción',
  hint = 'Empieza a escribir para ver coincidencias. Si escribes un valor nuevo, quedará guardado en el listado al guardar la ficha.',
  onChange,
} = {}) {
  let items = Array.isArray(catalogue) ? catalogue : [];
  let activeIndex = -1;
  let visibleItems = [];
  const selected = findCatalogueItem(items, value);
  const inputId = `a71-catalogue-input-${crypto.randomUUID()}`;
  const listId = `a71-catalogue-list-${crypto.randomUUID()}`;
  const input = createInput({ value: selected?.nombre || value || '', placeholder });
  const listbox = element('div', {
    className: 'a71-catalogue-listbox',
    id: listId,
    role: 'listbox',
    'aria-label': `Sugerencias de ${labelText}`,
    hidden: ''
  });
  const combo = element('div', { className: 'a71-editable-catalogue' }, [input, listbox]);
  const label = element('label', { className: 'a71-catalogue-label', for: inputId, text: labelText });
  const field = element('div', { className: 'editor-field' }, [label, combo]);

  input.id = inputId;
  input.setAttribute('autocomplete', 'off');
  input.setAttribute('spellcheck', 'false');
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-controls', listId);
  input.setAttribute('aria-expanded', 'false');

  const sortedItems = () => items
    .slice()
    .sort((a, b) => {
      const orderA = Number.isFinite(Number(a?.orden)) ? Number(a.orden) : Number.MAX_SAFE_INTEGER;
      const orderB = Number.isFinite(Number(b?.orden)) ? Number(b.orden) : Number.MAX_SAFE_INTEGER;
      return orderA - orderB || catalogueName(a).localeCompare(catalogueName(b), 'es');
    });

  const setOpen = open => {
    const nextOpen = Boolean(open) && !input.disabled;
    listbox.hidden = !nextOpen;
    input.setAttribute('aria-expanded', String(nextOpen));
    if (!nextOpen) activeIndex = -1;
  };

  const choose = item => {
    const name = catalogueName(item);
    input.value = name;
    onChange?.(item, name);
    setOpen(false);
    input.focus({ preventScroll: true });
  };

  const setActive = index => {
    activeIndex = index;
    [...listbox.querySelectorAll('.a71-catalogue-option')].forEach((node, optionIndex) => {
      const active = optionIndex === index;
      node.classList.toggle('is-active', active);
      node.setAttribute('aria-selected', String(active));
      if (active) node.scrollIntoView({ block: 'nearest' });
    });
  };

  const filteredItems = () => {
    const query = normaliseCatalogueValue(input.value);
    if (!query) return [];
    return sortedItems()
      .filter(item => catalogueSearchText(item).includes(query))
      .slice(0, 15);
  };

  const renderOptions = ({ open = true } = {}) => {
    listbox.replaceChildren();
    visibleItems = filteredItems();
    activeIndex = -1;
    const typed = input.value.trim();

    if (!typed) {
      setOpen(false);
      return;
    }

    if (!visibleItems.length) {
      listbox.append(element('div', {
        className: 'a71-catalogue-empty',
        text: `“${typed}” es un valor nuevo. Se incorporará al listado cuando guardes la ficha.`
      }));
      setOpen(open);
      return;
    }

    visibleItems.forEach(item => {
      const name = catalogueName(item);
      const code = catalogueCode(item);
      const option = element('button', {
        className: 'a71-catalogue-option',
        type: 'button',
        role: 'option',
        'aria-selected': 'false'
      }, [
        element('span', { text: name }),
        code && normaliseCatalogueValue(code) !== normaliseCatalogueValue(name)
          ? element('small', { text: code })
          : null
      ]);
      option.addEventListener('mousedown', event => event.preventDefault());
      option.addEventListener('click', () => choose(item));
      listbox.append(option);
    });
    setOpen(open);
  };

  const rebuild = (nextItems = items, nextValue, replaceValue = false) => {
    items = Array.isArray(nextItems) ? nextItems : [];
    if (replaceValue) {
      const next = findCatalogueItem(items, nextValue);
      input.value = next?.nombre || nextValue || '';
    }
    if (!listbox.hidden) renderOptions();
  };

  const update = () => {
    const typed = input.value.trim();
    onChange?.(findCatalogueItem(items, typed), typed);
    renderOptions({ open: Boolean(typed) });
  };

  input.addEventListener('input', update);
  input.addEventListener('change', () => {
    const typed = input.value.trim();
    onChange?.(findCatalogueItem(items, typed), typed);
  });
  input.addEventListener('focus', () => {
    if (input.value.trim()) renderOptions({ open: true });
  });
  input.addEventListener('keydown', event => {
    if (event.key === 'ArrowDown') {
      if (listbox.hidden) renderOptions({ open: true });
      if (!visibleItems.length) return;
      event.preventDefault();
      setActive(Math.min(activeIndex + 1, visibleItems.length - 1));
    } else if (event.key === 'ArrowUp') {
      if (!visibleItems.length || listbox.hidden) return;
      event.preventDefault();
      setActive(Math.max(activeIndex - 1, 0));
    } else if (event.key === 'Enter' && activeIndex >= 0 && visibleItems[activeIndex]) {
      event.preventDefault();
      choose(visibleItems[activeIndex]);
    } else if (event.key === 'Escape' && !listbox.hidden) {
      event.stopPropagation();
      setOpen(false);
    }
  });

  combo.addEventListener('focusout', () => {
    window.setTimeout(() => {
      if (!combo.contains(document.activeElement)) setOpen(false);
    }, 0);
  });

  field.append(element('small', { className: 'muted', text: hint }));

  return {
    input,
    field,
    rebuild,
    setDisabled(disabled) {
      input.disabled = Boolean(disabled);
      if (disabled) setOpen(false);
    }
  };
}
