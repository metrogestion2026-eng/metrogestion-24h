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

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const UTF8 = new TextEncoder();

function xml(value) {
  return clean(value)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .slice(0, 32767)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function columnName(index) {
  let value = index + 1;
  let name = '';
  while (value) {
    value -= 1;
    name = String.fromCharCode(65 + (value % 26)) + name;
    value = Math.floor(value / 26);
  }
  return name;
}

function workbookSheetName(value) {
  return clean(value).replace(/[\\/*?:[\]]/g, ' ').slice(0, 31) || 'Listado';
}

function worksheetXml(headers, rows) {
  const values = [headers, ...rows];
  const columnCount = Math.max(1, ...values.map(row => row.length));
  const rowCount = Math.max(1, values.length);
  const widths = Array.from({ length: columnCount }, (_, column) => {
    const longest = Math.max(10, ...values.map(row => clean(row[column]).length));
    return Math.min(45, Math.max(10, longest + 2));
  });
  const sheetRows = values.map((row, rowIndex) => {
    const cells = Array.from({ length: columnCount }, (_, column) => {
      const reference = `${columnName(column)}${rowIndex + 1}`;
      return `<c r="${reference}" t="inlineStr" s="${rowIndex === 0 ? 1 : 2}"><is><t xml:space="preserve">${xml(row[column])}</t></is></c>`;
    }).join('');
    return `<row r="${rowIndex + 1}"${rowIndex === 0 ? ' ht="24" customHeight="1"' : ''}>${cells}</row>`;
  }).join('');
  const lastCell = `${columnName(columnCount - 1)}${rowCount}`;
  const columns = widths.map((width, index) =>
    `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`
  ).join('');
  const autoFilter = headers.length ? `<autoFilter ref="A1:${columnName(columnCount - 1)}${rowCount}"/>` : '';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <dimension ref="A1:${lastCell}"/>
  <sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
  <sheetFormatPr defaultRowHeight="18"/>
  <cols>${columns}</cols>
  <sheetData>${sheetRows}</sheetData>
  ${autoFilter}
</worksheet>`;
}

function little16(value) {
  return Uint8Array.of(value & 255, (value >>> 8) & 255);
}

function little32(value) {
  return Uint8Array.of(value & 255, (value >>> 8) & 255, (value >>> 16) & 255, (value >>> 24) & 255);
}

function joinBytes(parts) {
  const size = parts.reduce((total, part) => total + part.length, 0);
  const output = new Uint8Array(size);
  let offset = 0;
  parts.forEach(part => {
    output.set(part, offset);
    offset += part.length;
  });
  return output;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? (0xEDB88320 ^ (value >>> 1)) : (value >>> 1);
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let value = 0xFFFFFFFF;
  bytes.forEach(byte => { value = CRC_TABLE[(value ^ byte) & 255] ^ (value >>> 8); });
  return (value ^ 0xFFFFFFFF) >>> 0;
}

function zipDateTime(date = new Date()) {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

function zip(entries) {
  const localParts = [];
  const centralParts = [];
  const stamp = zipDateTime();
  let offset = 0;
  entries.forEach(({ name, text }) => {
    const filename = UTF8.encode(name);
    const data = UTF8.encode(text);
    const checksum = crc32(data);
    const localHeader = joinBytes([
      little32(0x04034B50), little16(20), little16(0x0800), little16(0),
      little16(stamp.time), little16(stamp.date), little32(checksum), little32(data.length), little32(data.length),
      little16(filename.length), little16(0), filename,
    ]);
    localParts.push(localHeader, data);
    centralParts.push(joinBytes([
      little32(0x02014B50), little16(20), little16(20), little16(0x0800), little16(0),
      little16(stamp.time), little16(stamp.date), little32(checksum), little32(data.length), little32(data.length),
      little16(filename.length), little16(0), little16(0), little16(0), little16(0), little32(0), little32(offset), filename,
    ]));
    offset += localHeader.length + data.length;
  });
  const central = joinBytes(centralParts);
  const end = joinBytes([
    little32(0x06054B50), little16(0), little16(0), little16(entries.length), little16(entries.length),
    little32(central.length), little32(offset), little16(0),
  ]);
  return joinBytes([...localParts, central, end]);
}

export function buildSpreadsheetXlsx(headers, rows, sheetName = 'Listado') {
  const title = workbookSheetName(sheetName);
  return zip([
    {
      name: '[Content_Types].xml',
      text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`,
    },
    {
      name: '_rels/.rels',
      text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`,
    },
    {
      name: 'xl/workbook.xml',
      text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="${xml(title)}" sheetId="1" r:id="rId1"/></sheets>
</workbook>`,
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`,
    },
    {
      name: 'xl/styles.xml',
      text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="2"><font><sz val="11"/><name val="Calibri"/><family val="2"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Calibri"/><family val="2"/></font></fonts>
  <fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF0B4778"/><bgColor indexed="64"/></patternFill></fill></fills>
  <borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FFD6DEE8"/></left><right style="thin"><color rgb="FFD6DEE8"/></right><top style="thin"><color rgb="FFD6DEE8"/></top><bottom style="thin"><color rgb="FFD6DEE8"/></bottom><diagonal/></border></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf></cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`,
    },
    { name: 'xl/worksheets/sheet1.xml', text: worksheetXml(headers, rows) },
  ]);
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
  const workbook = buildSpreadsheetXlsx(headers, rows, activeListLabel());
  const blob = new Blob([workbook], { type: XLSX_MIME });
  const url = URL.createObjectURL(blob);
  const date = new Date();
  const dateKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `metrogestion-${safeFilename(activeListLabel())}-${dateKey}.xlsx`;
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
    actionButton('⬇ Hoja de cálculo', 'Descarga un archivo Excel .xlsx compatible con Excel y Google Sheets', event => saveSpreadsheet(event.currentTarget))
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
