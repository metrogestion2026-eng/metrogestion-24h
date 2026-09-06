const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;
const MARGIN_X = 42;
const START_Y = 798;
const LEADING = 13;
const MAX_LINES_PER_PAGE = 54;
const MAX_CHARS_PER_LINE = 88;

const PDF_REPLACEMENTS = new Map([
  ['–', '-'], ['—', '-'], ['−', '-'], ['→', '->'], ['←', '<-'],
  ['“', '"'], ['”', '"'], ['‘', "'"], ['’', "'"], ['…', '...'],
  ['€', ' EUR'], ['✓', 'OK'], ['⚠', 'AVISO'], ['⏱', 'TIEMPO'], ['🚨', 'ALERTA'],
]);

function pdfText(value) {
  return Array.from(String(value ?? '').normalize('NFC'))
    .map(character => {
      if (PDF_REPLACEMENTS.has(character)) return PDF_REPLACEMENTS.get(character);
      return character.charCodeAt(0) <= 255 ? character : '?';
    })
    .join('');
}

function escapePdfString(value) {
  return pdfText(value)
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .replace(/[\r\n]+/g, ' ');
}

function wrapLine(value, maximum = MAX_CHARS_PER_LINE) {
  const source = pdfText(value).trim();
  if (!source) return [''];
  const words = source.split(/\s+/);
  const lines = [];
  let current = '';
  words.forEach(word => {
    if (word.length > maximum) {
      if (current) {
        lines.push(current);
        current = '';
      }
      for (let index = 0; index < word.length; index += maximum) lines.push(word.slice(index, index + maximum));
      return;
    }
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > maximum) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  });
  if (current) lines.push(current);
  return lines;
}

function detailLines(spec) {
  const raw = [
    `Metrogestión - ${spec.title || 'Panel'}`,
    `Generado: ${new Date().toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' })}`,
    `${spec.items?.length || 0} resultado(s)`,
    '',
  ];
  (spec.items || []).forEach((item, index) => {
    raw.push(`${index + 1}. ${item.title || '-'}`);
    if (item.meta) raw.push(item.meta);
    if (item.lastStage) raw.push(item.lastStage);
    if (item.note) raw.push(item.note);
    raw.push('');
  });
  return raw.flatMap(line => wrapLine(line));
}

function paginate(lines) {
  const pages = [];
  for (let index = 0; index < lines.length; index += MAX_LINES_PER_PAGE) {
    pages.push(lines.slice(index, index + MAX_LINES_PER_PAGE));
  }
  return pages.length ? pages : [['Metrogestión - Panel', 'Sin resultados']];
}

function pageStream(lines, pageNumber, pageCount) {
  const body = lines.map(line => `(${escapePdfString(line)}) Tj\nT*`).join('\n');
  return `BT\n/F1 9 Tf\n${MARGIN_X} ${START_Y} Td\n${LEADING} TL\n${body}\nET\nBT\n/F1 8 Tf\n${Math.round(PAGE_WIDTH / 2) - 28} 22 Td\n(Página ${pageNumber} de ${pageCount}) Tj\nET`;
}

function latin1Bytes(value) {
  const bytes = new Uint8Array(value.length);
  for (let index = 0; index < value.length; index += 1) bytes[index] = value.charCodeAt(index) & 0xff;
  return bytes;
}

function pdfBlob(spec) {
  const pages = paginate(detailLines(spec));
  const fontObject = 3 + pages.length * 2;
  const objects = [];
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  const pageReferences = pages.map((_, index) => `${3 + index * 2} 0 R`).join(' ');
  objects[2] = `<< /Type /Pages /Kids [${pageReferences}] /Count ${pages.length} >>`;
  pages.forEach((lines, index) => {
    const pageObject = 3 + index * 2;
    const contentObject = pageObject + 1;
    const stream = pageStream(lines, index + 1, pages.length);
    objects[pageObject] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 ${fontObject} 0 R >> >> /Contents ${contentObject} 0 R >>`;
    objects[contentObject] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  });
  objects[fontObject] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';

  let documentText = '%PDF-1.4\n%ÿÿÿÿ\n';
  const offsets = [];
  for (let index = 1; index < objects.length; index += 1) {
    offsets[index] = documentText.length;
    documentText += `${index} 0 obj\n${objects[index]}\nendobj\n`;
  }
  const xrefOffset = documentText.length;
  documentText += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let index = 1; index < objects.length; index += 1) {
    documentText += `${String(offsets[index]).padStart(10, '0')} 00000 n \n`;
  }
  documentText += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return new Blob([latin1Bytes(documentText)], { type: 'application/pdf' });
}

function safeFilename(value) {
  return pdfText(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'panel';
}

export function createDetailPdf(spec) {
  const date = new Date();
  const dateKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const filename = `metrogestion-${safeFilename(spec.title)}-${dateKey}.pdf`;
  const blob = pdfBlob(spec);
  const file = typeof File === 'function' ? new File([blob], filename, { type: 'application/pdf' }) : null;
  return { blob, file, filename };
}

export function downloadDetailPdf(pdf) {
  const url = URL.createObjectURL(pdf.blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = pdf.filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
