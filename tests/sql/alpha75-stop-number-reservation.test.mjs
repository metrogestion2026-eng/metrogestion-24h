import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createContinuityFixture } from './continuity-scenarios.mjs';
import { one } from './local-postgres-harness.mjs';

const MIGRATION = new URL(
  '../../supabase/migrations/20261108093000_alpha75_numero_parada_temporal.sql',
  import.meta.url,
);

const reserve = async (client, requestId) => (await one(
  client,
  'select public.reservar_numero_parada_nueva_ficha_alpha75($1) as value',
  [requestId],
)).value;

test(
  'el número visible se confirma al guardar y se reutiliza al cancelar',
  { timeout: 120000 },
  async () => {
    const fixture = await createContinuityFixture({ prefix: 'stop_number' });
    try {
      const migration = await readFile(MIGRATION, 'utf8');
      assert.ok(migration.includes('MG75-NUMERO-PARADA-TEMPORAL-001'));
      assert.match(migration, /create or replace function public\.reservar_numero_parada_nueva_ficha_alpha75[\s\S]*security definer/i);
      assert.match(migration, /create or replace function app_private\.asignar_numero_parada_nuevo\(\)[\s\S]*security definer/i);
      await fixture.admin.query(migration);

      const definerFlags = await fixture.admin.query(`select p.proname,p.prosecdef
        from pg_proc p join pg_namespace n on n.oid=p.pronamespace
        where n.nspname='public' and p.proname in (
          'reservar_numero_parada_nueva_ficha_alpha75',
          'renovar_numero_parada_nueva_ficha_alpha75',
          'liberar_numero_parada_nueva_ficha_alpha75',
          'crear_ficha_hotel_con_etapas_alpha75'
        ) order by p.proname`);
      assert.equal(definerFlags.rows.length, 4);
      assert.ok(definerFlags.rows.every(row => row.prosecdef === true));

      const firstClient = await fixture.connect('first');
      const secondClient = await fixture.connect('second');
      const otherActor = await fixture.connect('other_actor', {
        actor: '00000000-0000-4000-8000-000000000099',
      });
      const [first, second] = await Promise.all([
        reserve(firstClient, 'r1_stop_number_first'),
        reserve(secondClient, 'r1_stop_number_second'),
      ]);

      assert.equal(first.ok, true);
      assert.equal(second.ok, true);
      assert.notEqual(first.numero_parada, second.numero_parada);

      const repeated = await reserve(firstClient, 'r1_stop_number_first');
      assert.equal(repeated.token, first.token);
      assert.equal(repeated.numero_parada, first.numero_parada);
      assert.equal(repeated.reutilizada, true);

      const foreignRelease = (await one(
        otherActor,
        'select public.liberar_numero_parada_nueva_ficha_alpha75($1::uuid) as value',
        [first.token],
      )).value;
      assert.equal(foreignRelease.liberado, false,
        'otra sesión no puede liberar una reserva ajena');

      await assert.rejects(
        otherActor.query(
          'select public.crear_ficha_hotel($1::jsonb,$2) as value',
          [JSON.stringify({
            numero_parada: second.numero_parada,
            vehiculo_sustituido: 'TEST-ROBO-NUMERO',
            prioridad: 5,
            estado: 'pendiente_taller',
          }), 'r1_stop_number_foreign_steal'],
        ),
        /reservado por otra ficha en edición/,
        'un alta antigua tampoco puede apropiarse de un número reservado',
      );

      const released = (await one(
        firstClient,
        'select public.liberar_numero_parada_nueva_ficha_alpha75($1::uuid) as value',
        [first.token],
      )).value;
      assert.equal(released.liberado, true);
      assert.equal(released.numero_parada, first.numero_parada);

      const reused = await reserve(firstClient, 'r1_stop_number_reused');
      assert.equal(reused.numero_parada, first.numero_parada,
        'el número cancelado debe ser el primero que vuelve a asignarse');

      const payload = {
        numero_parada: reused.numero_parada,
        vehiculo_sustituido: 'TEST-NUMERO-RESERVADO',
        matricula_sustituido: 'TESTNUM',
        prioridad: 5,
        estado: 'pendiente_taller',
        modalidad_operativa: '',
        fecha_programada_parada: new Date().toISOString().slice(0, 10),
        observaciones: 'Fixture sintética del número provisional',
      };
      const created = (await one(
        firstClient,
        `select public.crear_ficha_hotel_con_etapas_alpha75(
           $1::jsonb, '[]'::jsonb, $2, $3::uuid
         ) as value`,
        [JSON.stringify(payload), 'r1_stop_number_reused', reused.token],
      )).value;

      assert.equal(created.ok, true);
      assert.equal(created.numero_parada, reused.numero_parada);
      assert.equal(created.numero_provisional_confirmado, true);

      const persisted = await one(
        fixture.admin,
        `select numero_parada
         from public.registros_hotel
         where id=$1::uuid`,
        [created.id],
      );
      assert.equal(persisted.numero_parada, reused.numero_parada);

      const leaseAfterSave = await one(
        fixture.admin,
        `select count(*)::int as count
         from app_private.numeros_parada_temporales_alpha75
         where token=$1::uuid`,
        [reused.token],
      );
      assert.equal(leaseAfterSave.count, 0);

      const afterSave = await reserve(firstClient, 'r1_stop_number_after_save');
      assert.notEqual(afterSave.numero_parada, reused.numero_parada,
        'un número confirmado nunca puede volver al fondo disponible');

      await fixture.admin.query(
        `update app_private.numeros_parada_temporales_alpha75
         set expira_en=clock_timestamp()-interval '1 minute'
         where token=$1::uuid`,
        [second.token],
      );
      const expiredReused = await reserve(secondClient, 'r1_stop_number_expired_reuse');
      assert.equal(expiredReused.numero_parada, second.numero_parada,
        'una edición abandonada por caducidad también debe reciclar su número');

      const active = await fixture.admin.query(
        `select numero_parada,count(*)::int as count
         from app_private.numeros_parada_temporales_alpha75
         group by numero_parada
         having count(*)>1`,
      );
      assert.deepEqual(active.rows, []);
    } finally {
      await fixture.destroy();
    }
  },
);
