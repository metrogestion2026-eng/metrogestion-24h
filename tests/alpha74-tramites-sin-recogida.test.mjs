import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration = fs.readFileSync(
  new URL('../supabase/migrations/20260909093000_alpha74_tramites_sin_recogida.sql', import.meta.url),
  'utf8'
);

test('TRÁMITE manda sobre F y LKT/EXTINTOR se consideran siempre trámites', () => {
  assert.match(
    migration,
    /v_modalidad := case\s+when v_group\.designacion_norm in \('LKT', 'EXTINTOR'\) then 'tramite'[\s\S]*?tipo_norm[\s\S]*?'%TRAMITE%' then 'tramite'[\s\S]*?taller_norm = 'TM'/
  );
});

test('TM mantiene entrada con trabajos y omite la recogida', () => {
  assert.match(migration, /when v_group\.taller_norm = 'TM' then 'entrada_sin_recogida'/);
  assert.match(migration, /modalidad in \('taller', 'entrada_sin_recogida'\)/);
  assert.match(migration, /if v_visit_stage\.modalidad = 'taller' then\s+select e\.id into v_pickup_id/);
  assert.doesNotMatch(migration, /if v_visit_stage\.modalidad in \('taller', 'entrada_sin_recogida'\) then\s+select e\.id into v_pickup_id/);
});

test('la protección impide regenerar recogidas de TM y trámites', () => {
  assert.match(migration, /create or replace function app_private\.etapa_manteniment_sin_recogida_alpha74/);
  assert.match(migration, /before insert on public\.etapas_hotel/);
  assert.match(migration, /and app_private\.etapa_manteniment_sin_recogida_alpha74\(new\.etapa_origen_id\)/);
  assert.match(migration, /return null;/);
});

test('la reparación de datos unifica LKT y solo anula recogidas pendientes incorrectas', () => {
  assert.match(migration, /Unifica un LKT generado con la única T LKT ya existente/);
  assert.match(migration, /set etapa_hotel_id = x\.legado_id/);
  assert.match(migration, /motivo_cancelacion = 'T duplicada al interpretar LKT como Gestión/);
  assert.match(migration, /pickup\.estado <> 'realizada'/);
  assert.match(migration, /TM y los trámites LKT\/EXTINTOR no generan recogida/);
});

console.log('Alpha74: TM, LKT y EXTINTOR quedan sin recogida y LKT no se duplica.');
