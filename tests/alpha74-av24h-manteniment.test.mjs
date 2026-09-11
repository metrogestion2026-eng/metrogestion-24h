import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const script = fs.readFileSync(
  new URL('../r1-alpha74/google-apps-script/sincronizar_manteniment.gs', import.meta.url),
  'utf8'
);
const migration = fs.readFileSync(
  new URL('../supabase/migrations/20260911130000_alpha74_av24h_hacia_manteniment.sql', import.meta.url),
  'utf8'
);

test('las paradas 24H envían una fila AV24H aunque no creen línea PARADA', () => {
  assert.match(migration, /manteniment_ajuste_24h/);
  assert.match(migration, /'designacion', 'AV24H'/);
  assert.match(migration, /jsonb_array_length\(v_trabajos\) = 0 and v_ajuste_24h is null/);
  assert.match(migration, /jsonb_set\(v_payload, '\{ajuste_24h\}', v_ajuste_24h/);
});

test('MANTENIMENT desvincula trabajos ordinarios y conserva PARADA y AV24H', () => {
  assert.match(script, /function metrogestionAplicarAjuste24h_/);
  assert.match(script, /designacion === 'PARADA' \|\| designacion === 'ANULADA'/);
  assert.match(script, /cell\.clearContent\(\)\.setNote\(metrogestionNotaSinTrabajo_\(note\)\)/);
  assert.match(script, /row\[6\] = adjustment\.tipo_trabajo \|\| 'AVERÍA'/);
  assert.match(script, /row\[7\] = adjustment\.designacion \|\| 'AV24H'/);
});

test('la fila AV24H recibe inicio y se colorea al recuperar', () => {
  assert.match(script, /row\[9\] = metrogestionDate_\(adjustment\.fecha_entrada\)/);
  assert.match(script, /row\[10\] = metrogestionDate_\(adjustment\.fecha_salida\)/);
  assert.match(script, /adjustment\.fecha_salida \? '#d9ead3' : '#ffffff'/);
  assert.match(script, /alpha74-2026\.09\.11\.31/);
});
