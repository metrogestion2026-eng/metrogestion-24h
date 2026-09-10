import fs from 'node:fs';
import assert from 'node:assert/strict';

const migration = fs.readFileSync(
  new URL('../supabase/migrations/20260910090000_alpha74_recuperacion_rellena_recollit.sql', import.meta.url),
  'utf8'
);
const script = fs.readFileSync(
  new URL('../r1-alpha74/google-apps-script/sincronizar_manteniment.gs', import.meta.url),
  'utf8'
);

assert.match(
  migration,
  /when v_ficha\.retirado_hotel_activo[\s\S]*then coalesce\(v_sync\.fecha_corte, v_ficha\.fecha_retirado_hotel::date, v_ficha\.fecha_pizarra\)/
);
assert.match(
  migration,
  /when btrim\(coalesce\(v_sync\.tancament, ''\)\) <> '' then v_sync\.fecha_corte/
);
assert.match(migration, /perform app_private\.manteniment_encolar_parada\(v_item\.seguimiento_id\)/);
assert.match(script, /Al realizar la T final de recuperaci.n, tambi.n completa K si est. vac.a/);
assert.match(script, /else if \(fechaKIso && !fechaKActual\)/);
assert.match(script, /getRange\(rowNumber, 11\)\.setValue\(metrogestionDate_\(fechaKIso\)\)/);

console.log('OK: una recuperacion completa RECOLLIT aunque Q ya tenga TANCAMENT.');
