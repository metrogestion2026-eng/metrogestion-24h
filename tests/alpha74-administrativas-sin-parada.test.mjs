import fs from 'node:fs';
import assert from 'node:assert/strict';

const migration = fs.readFileSync(
  new URL('../supabase/migrations/20260910074500_alpha74_administrativas_sin_parada_ni_recuperacion.sql', import.meta.url),
  'utf8'
);

assert.match(migration, /if btrim\(coalesce\(v_ficha\.vehiculo_reserva, ''\)\) = '' then\s+return null/);
assert.match(migration, /delete from app_private\.manteniment_parada_outbox\s+where seguimiento_id = p_seguimiento_id/);
assert.match(migration, /v\.modalidad not in \('tramite','gestion'\)/);
assert.match(migration, /Trámite\/Gestión: no corresponde recuperación de ruta/);
assert.match(migration, /upper\(btrim\(w\.designacion\)\) in \('LKT','EXTINTOR'\)/);

console.log('Alpha74: trámite y gestión sin parada física ni recuperación.');
