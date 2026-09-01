import { createDetailPdf, downloadDetailPdf } from './panel-pdf.js';

const nav = document.querySelector('#module-nav');
const content = document.querySelector('#module-content');
const ACTIONS_FLAG = 'a70ListadosActions';

function clean(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function visibleTable() {
  const tables = [...(content?.querySelectorAll('.a50-table, .alpha30-table, .listados-table, table') || [])];
  return tables.reverse().find(table => !table.hidden && !table.closest('[hidden]')) || null;
}

function activeListLabel() {
  const active = content?.querySelector('.a50-list-tabs .active, .alpha30-tabs .active, [role="tab"][aria-selected="true"]');
  return clean(active?.textContent).replace(/^[^\p{L}\p{N}]+/u, '') || 'Listado';
}

function currentFilters() {
  const filters = [];
  content?.querySelectorAll('.a50-filters label, .alpha30-filters label, .listados-filters label').forEach(label => {
    const field = label.querySelector('input, select');
    if (!field) return;
    const labelText = clean([...label.childNodes]
      .filter(node => node !== field)
      .map(node => node.textContent)
      .join(' '));
    const value = field.tagName === 'SELECT'
      ? clean(field.selectedOptions?.[0]?.textContent || field.value)
      : clean(field.value);
    if (labelText && value) filters.push(`${labelText}: ${value}`);
  });
  return filters;
}

export function buildListadosSpec(headers, rows, { listLabel = 'Listado', filters = [] } = {}) {
  const safeHeaders = headers.map(clean);
  const items = rows.map((cells, index) => {
    const values = cells.map(clean);
    const pairs = values
      .map((value, column) => value ? `${safeHeaders[column] || `Campo ${column + 1}`}: ${value}` : '')
      .filter(Boolean);
    return {
      title: pairs.slice(0, 3).join(' · ') || `Registro ${index + 1}`,
      meta: pairs.slice(3, 6).join(' · '),
      note: pairs.slice(6).join(' · '),
    };
  });
  return {
    title: `Listados · ${clean(listLabel) || 'Listado'}`,
    subtitle: filters.length ? filters.map(clean).filter(Boolean).join(' · ') : `${items.length} resultado(s)`,
    items,
  };
}

function currentSpec() {
  const { headers, rows } = currentTableData();
  return buildListadosSpec(headers, rows, { listLabel: activeListLabel(), filters: currentFilters() });
}

function currentTableData() {
  const table = visibleTable();
  if (!table) return { headers: [], rows: [] };
  return {
    headers: [...table.querySelectorAll('thead th')].map(cell => clean(cell.textContent)),
    rows: [...table.querySelectorAll('tbody tr')].map(row =>
      [...row.querySelectorAll('th, td')].map(cell => clean(cell.textContent))
    ),
  };
}

function spreadsheetCell(value) {
  const raw = clean(value);
  const safe = /^[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return `"${safe.replace(/"/g, '""')}"`;
}

export function buildSpreadsheetCsv(headers, rows) {
  return [headers, ...rows]
    .map(row => row.map(spreadsheetCell).join(';'))
    .join('\r\n');
}

function safeFilename(value) {
  return clean(value)
    .toLocaleLowerCase('es-ES')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'listado';
}

function saveSpreadsheet(button) {
  const original = button.textContent;
  const { headers, rows } = currentTableData();
  const csv = `\uFEFF${buildSpreadsheetCsv(headers, rows)}`;
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const date = new Date();
  const dateKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `metrogestion-${safeFilename(activeListLabel())}-${dateKey}.csv`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  button.textContent = '✓ Hoja guardada';
  window.setTimeout(() => { button.textContent = original; }, 1800);
}

function printListados() {
  const previousTitle = document.title;
  const label = activeListLabel();
  document.title = `Metrogestión - Listados - ${label}`;
  try {
    window.print();
  } finally {
    document.title = previousTitle;
  }
}

function saveListados(button) {
  const original = button.textContent;
  downloadDetailPdf(createDetailPdf(currentSpec()));
  button.textContent = '✓ PDF guardado';
  window.setTimeout(() => { button.textContent = original; }, 1800);
}

async function shareListados(button) {
  const original = button.textContent;
  const pdf = createDetailPdf(currentSpec());
  try {
    const canShareFile = pdf.file && navigator.share
      && (typeof navigator.canShare !== 'function' || navigator.canShare({ files: [pdf.file] }));
    if (canShareFile) {
      await navigator.share({ title: `Metrogestión · ${currentSpec().title}`, files: [pdf.file] });
      button.textContent = '✓ PDF compartido';
    } else {
      downloadDetailPdf(pdf);
      button.textContent = '✓ PDF descargado';
    }
  } catch (error) {
    if (error?.name === 'AbortError') return;
    downloadDetailPdf(pdf);
    button.textContent = '✓ PDF descargado';
  } finally {
    window.setTimeout(() => { button.textContent = original; }, 1800);
  }
}

function actionButton(text, title, handler) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'button secondary compact';
  button.textContent = text;
  button.title = title;
  button.addEventListener('click', handler);
  return button;
}

function listadosView() {
  const heading = [...(content?.querySelectorAll('h2') || [])]
    .find(node => clean(node.textContent).toLocaleLowerCase('es-ES') === 'listados');
  return heading?.closest('section') || null;
}

function ensureActions() {
  const view = listadosView();
  if (!view || view.dataset[ACTIONS_FLAG] === '1') return;

  let actions = view.querySelector('.alpha30-controls, .listados-controls, [data-a70-listados-actions]');
  if (!actions) {
    actions = document.createElement('div');
    actions.className = 'a70-listados-actions';
    actions.dataset.a70ListadosActions = '1';
    const heading = [...view.querySelectorAll('h2')]
      .find(node => clean(node.textContent).toLocaleLowerCase('es-ES') === 'listados');
    const head = heading?.parentElement;
    if (head) head.after(actions);
    else view.prepend(actions);
  }

  const existingPrint = [...actions.querySelectorAll('button')]
    .find(button => /imprimir/i.test(button.textContent || ''));
  if (existingPrint) {
    existingPrint.classList.remove('primary');
    existingPrint.classList.add('secondary', 'compact');
  } else {
    actions.append(actionButton('🖨 Imprimir', 'Imprime el listado visible', printListados));
  }

  actions.append(
    actionButton('⬇ Guardar PDF', 'Descarga el listado visible como archivo PDF', event => saveListados(event.currentTarget)),
    actionButton('↗ Compartir PDF', 'Comparte el PDF como archivo adjunto, nunca como enlace', event => shareListados(event.currentTarget)),
    actionButton('⬇ Hoja de cálculo', 'Descarga el listado visible para Excel o Google Sheets', event => saveSpreadsheet(event.currentTarget))
  );
  view.dataset[ACTIONS_FLAG] = '1';
}

function ensureStyle() {
  if (document.querySelector('#alpha70-listados-export-style')) return;
  const style = document.createElement('style');
  style.id = 'alpha70-listados-export-style';
  style.textContent = `
    .a70-listados-actions,.alpha30-controls,.listados-controls{display:flex;gap:8px;align-items:center;justify-content:flex-end;flex-wrap:wrap}
    @media(max-width:620px){.a70-listados-actions .button,.alpha30-controls .button,.listados-controls .button{width:100%}}
    @media print{.a70-listados-actions{display:none!important}}
  `;
  document.head.append(style);
}

ensureStyle();

if (content) {
  new MutationObserver(ensureActions).observe(content, { childList: true, subtree: true });
  ensureActions();
}

nav?.addEventListener('click', () => queueMicrotask(ensureActions), true);
