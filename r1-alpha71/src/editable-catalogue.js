import { element } from '../../r1-alpha17/src/dom.js';
import { createInput } from '../../r1-alpha17/src/modules/hotel-editor-utils.js';

function normaliseCatalogueValue(value) {
  return String(value ?? '').trim().toLocaleLowerCase('es-ES');
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

/**
 * Campo de catálogo que conserva entrada libre y ofrece un listado explícito.
 * El botón propio evita depender de la presentación variable de <datalist>.
 */
export function createEditableCatalogueField(labelText, catalogue, value, {
  placeholder = 'Elige una opción o escribe una nueva',
  hint = 'Puedes elegir un valor existente o escribir uno nuevo. Se añadirá al listado al guardar.',
  onChange,
} = {}) {
  let items = Array.isArray(catalogue) ? catalogue : [];
  const selected = findCatalogueItem(items, value);
  const inputId = `a71-catalogue-input-${crypto.randomUUID()}`;
  const listId = `a71-catalogue-list-${crypto.randomUUID()}`;
  const input = createInput({ value: selected?.nombre || value || '', placeholder });
  const trigger = element('button', {
    className: 'a71-catalogue-trigger',
    type: 'button',
    title: `Mostrar listado de ${labelText}`,
    'aria-label': `Mostrar listado de ${labelText}`,
    'aria-controls': listId,
    'aria-expanded': 'false',
    text: '▾'
  });
  const listbox = element('div', {
    className: 'a71-catalogue-listbox',
    id: listId,
    role: 'listbox',
    'aria-label': `Listado de ${labelText}`,
    hidden: ''
  });
  const combo = element('div', { className: 'a71-editable-catalogue' }, [input, trigger, listbox]);
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
    trigger.setAttribute('aria-expanded', String(nextOpen));
    input.setAttribute('aria-expanded', String(nextOpen));
  };

  const choose = item => {
    const name = catalogueName(item);
    input.value = name;
    onChange?.(item, name);
    setOpen(false);
    // En móvil mantenemos el teclado cerrado después de elegir una opción.
    trigger.focus({ preventScroll: true });
  };

  const renderOptions = () => {
    listbox.replaceChildren();
    const ordered = sortedItems();
    if (!ordered.length) {
      listbox.append(element('div', { className: 'a71-catalogue-empty', text: 'No hay valores guardados todavía.' }));
      return;
    }
    ordered.forEach(item => {
      const name = catalogueName(item);
      const code = catalogueCode(item);
      const option = element('button', {
        className: 'a71-catalogue-option',
        type: 'button',
        role: 'option',
        'aria-selected': String(findCatalogueItem([item], input.value) !== null)
      }, [
        element('span', { text: name }),
        code && normaliseCatalogueValue(code) !== normaliseCatalogueValue(name)
          ? element('small', { text: code })
          : null
      ]);
      option.addEventListener('click', () => choose(item));
      listbox.append(option);
    });
  };

  const rebuild = (nextItems = items, nextValue, replaceValue = false) => {
    items = Array.isArray(nextItems) ? nextItems : [];
    if (replaceValue) {
      const next = findCatalogueItem(items, nextValue);
      input.value = next?.nombre || nextValue || '';
    }
    renderOptions();
  };

  const update = () => {
    const typed = input.value.trim();
    onChange?.(findCatalogueItem(items, typed), typed);
    if (!listbox.hidden) renderOptions();
  };
  input.addEventListener('input', update);
  input.addEventListener('change', update);
  input.addEventListener('keydown', event => {
    if (event.key === 'ArrowDown' && listbox.hidden) {
      event.preventDefault();
      renderOptions();
      setOpen(true);
    } else if (event.key === 'Escape' && !listbox.hidden) {
      event.stopPropagation();
      setOpen(false);
    }
  });
  input.addEventListener('focus', () => setOpen(false));
  trigger.addEventListener('click', () => {
    renderOptions();
    setOpen(listbox.hidden);
  });
  combo.addEventListener('focusout', () => {
    window.setTimeout(() => {
      if (!combo.contains(document.activeElement)) setOpen(false);
    }, 0);
  });

  const help = element('small', { className: 'muted', text: hint });
  field.append(help);
  rebuild(items, value, false);

  return {
    input,
    field,
    rebuild,
    setDisabled(disabled) {
      input.disabled = Boolean(disabled);
      trigger.disabled = Boolean(disabled);
      if (disabled) setOpen(false);
    }
  };
}
