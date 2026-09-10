import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration = fs.readFileSync(
  new URL('../supabase/migrations/20260910081500_alpha74_fechas_administrativas_sin_parada.sql', import.meta.url),
  'utf8'
);
const script = fs.readFileSync(
  new URL('../r1-alpha74/google-apps-script/sincronizar_manteniment.gs', import.meta.url),
  'utf8'
);

assert.match(migration, /set fecha_realizada = v_fecha,\s+fecha_recogida = v_fecha/);
assert.match(migration, /th\.etapa_hotel_id = new\.id/);
assert.match(migration, /'solo_trabajos', true/);
assert.match(migration, /'numero_parada', 'PA-' \|\| v_numero_parada/);
assert.match(migration, /perform app_private\.manteniment_encolar_parada\(v_seguimiento_id\)/);
assert.match(script, /if \(payload\.solo_trabajos === true\)/);
assert.match(script, /tipo: 'trabajos'/);

const branchStart = script.indexOf('if (payload.solo_trabajos === true)');
const branchEnd = script.indexOf('let rowNumber =', branchStart);
const trabajosBranch = script.slice(branchStart, branchEnd);
assert.match(trabajosBranch, /metrogestionAplicarAsignacionesTrabajos_/);
assert.doesNotMatch(trabajosBranch, /metrogestionInsertarFilaParada_/);
assert.doesNotMatch(trabajosBranch, /metrogestionEscribirFilaParada_/);

console.log('Alpha74: las T administrativas cierran su fila sin crear PARADA.');
