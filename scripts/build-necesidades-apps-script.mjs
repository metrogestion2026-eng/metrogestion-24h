import fs from 'node:fs';
const root = new URL('../', import.meta.url);
const engine = ['shared/manteniment-necesidades.js', 'shared/manteniment-necesidades-adapter.js', 'shared/manteniment-sync-batches.js'].map(path => fs.readFileSync(new URL(path, root), 'utf8').trim()).join('\n\n');
for (const version of ['75']) {
  const path = new URL(`r1-alpha${version}/google-apps-script/sincronizar_manteniment.gs`, root);
  const source = fs.readFileSync(path, 'utf8');
  const start = '// BEGIN MOTOR NECESIDADES — generado; editar shared/manteniment-necesidades.js';
  const end = '// END MOTOR NECESIDADES';
  const generated = `${start}\n${engine}\n${end}`;
  const next = source.includes(start) ? source.replace(new RegExp(`${start}[\\s\\S]*?${end}`), generated) : `${source.trimEnd()}\n\n${generated}\n`;
  fs.writeFileSync(path, next);
}
