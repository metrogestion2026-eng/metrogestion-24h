import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration = fs.readFileSync(
  new URL('../supabase/migrations/20260909143000_alpha74_restaurar_importador_dfm.sql', import.meta.url),
  'utf8'
);

test('DFM delega en el importador Alpha74 vigente y no en la base histórica', () => {
  assert.match(migration, /manteniment_importar_trabajos_alpha74_base\(p_trabajos jsonb\)/);
  assert.match(migration, /designacion_norm in \('LKT', 'EXTINTOR'\) then 'tramite'/);
  assert.match(migration, /taller_norm = 'TM' then 'entrada_sin_recogida'/);
  assert.match(migration, /return app_private\.manteniment_importar_trabajos_alpha74_base\(v_trabajos\)/);
  assert.doesNotMatch(
    migration,
    /return app_private\.manteniment_importar_trabajos_base\(v_trabajos\)/
  );
});

test('la reconciliación automática realinea el catálogo visible sin relajar el editor', () => {
  assert.match(migration, /v_editor_save := current_setting\('app\.audit_origin'/);
  assert.match(migration, /v_reconciliacion_automatica/);
  assert.match(migration, /like 'manteniment-alpha74-%'/);
  assert.match(
    migration,
    /and v_reconciliacion_automatica\s+and v_codigo is null then\s+new\.estado_catalogo_codigo := new\.estado/
  );
  assert.match(
    migration,
    /raise exception 'El estado personalizado de la T no corresponde con su estado operativo'/
  );
});

console.log('Alpha74: importador DFM actual y catálogo visible automático protegidos.');
