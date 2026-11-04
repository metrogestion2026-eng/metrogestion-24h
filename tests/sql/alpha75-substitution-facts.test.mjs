import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  createContinuityFixture,
  seedContinuityPair,
  confirmContinuity,
} from './continuity-scenarios.mjs';
import { FIXTURE_ACTOR, one } from './local-postgres-harness.mjs';

const MIGRATION = new URL(
  '../../supabase/migrations/20261104170000_alpha75_sustitucion_vigente_por_hechos.sql',
  import.meta.url,
);

test(
  'PostgreSQL distingue una sustitución abierta de una cabecera histórica',
  { timeout: 120000 },
  async () => {
    const fixture = await createContinuityFixture({ prefix: 'sub_facts' });
    try {
      const db = fixture.admin;
      const migration = await readFile(MIGRATION, 'utf8');
      assert.ok(migration.length > 1000, 'La migración factual no está completa');

      const pair = await seedContinuityPair(db, { tag: 'FACTS' });
      await confirmContinuity(db, pair);

      // La continuidad explícita debe seguir acreditando la sustitución incluso
      // si se elimina de la prueba la T automática pendiente. No se modifican
      // datos operativos reales: toda la fixture es local y sintética.
      await db.query('BEGIN');
      try {
        await db.query("SELECT set_config('app.clonando_pizarra','1',true)");
        await db.query(
          `UPDATE public.etapas_hotel
           SET cancelado=true,estado='anulada',estado_catalogo_codigo='anulada'
           WHERE id=$1`,
          [pair.recovery.id],
        );
        await db.query('COMMIT');
      } catch (error) {
        await db.query('ROLLBACK');
        throw error;
      }

      const board = await one(
        db,
        `SELECT id FROM public.pizarras
         WHERE estado='en_curso' ORDER BY fecha DESC,id DESC LIMIT 1`,
      );

      await db.query('BEGIN');
      let historical;
      let operational;
      try {
        await db.query("SELECT set_config('app.clonando_pizarra','1',true)");

        historical = await one(
          db,
          `INSERT INTO public.registros_hotel(
             pizarra_id,seguimiento_id,numero_parada,
             vehiculo_sustituido,matricula_sustituido,
             vehiculo_reserva,matricula_reserva,tipo_sustituto,
             estado,tipo_movimiento,fecha_parada,causa,observaciones,
             creado_por,modificado_por
           ) VALUES(
             $1,gen_random_uuid(),'SYN-HIST-001',
             'TEST-HIST','MATHIST','TEST-FLOTA-HIST','MATSUBHIST','FLOTA',
             'realizada','24H',CURRENT_DATE-2,
             'Cabecera histórica sin obligación abierta',
             'Fixture local de sustitución ya finalizada',$2,$2
           )
           RETURNING id,seguimiento_id,vehiculo_reserva,matricula_reserva`,
          [board.id, FIXTURE_ACTOR],
        );
        await db.query(
          `INSERT INTO public.etapas_hotel(
             registro_hotel_id,seguimiento_id,nombre,posicion,estado,
             estado_catalogo_codigo,tipo_etapa,fecha_inicio_real,
             fecha_fin_real,fecha_real,observaciones,creado_por,modificado_por
           ) VALUES(
             $1,gen_random_uuid(),'24H sintética finalizada',1,'realizada',
             'realizada','24H',clock_timestamp()-interval '2 days',
             clock_timestamp()-interval '1 day',clock_timestamp()-interval '1 day',
             'No existe recuperación ni liberación pendiente',$2,$2
           )`,
          [historical.id, FIXTURE_ACTOR],
        );

        operational = await one(
          db,
          `INSERT INTO public.registros_hotel(
             pizarra_id,seguimiento_id,numero_parada,
             vehiculo_sustituido,matricula_sustituido,
             vehiculo_reserva,matricula_reserva,tipo_sustituto,
             estado,tipo_movimiento,fecha_parada,causa,observaciones,
             creado_por,modificado_por
           ) VALUES(
             $1,gen_random_uuid(),'SYN-ACT-001',
             'TEST-ACT','MATACT','TEST-RES-ACT','MATSUBACT','RESERVA',
             'pendiente_taller','REPARACIÓN',CURRENT_DATE-1,
             'Sustitución con liberación pendiente',
             'Fixture local de sustitución vigente',$2,$2
           )
           RETURNING id,seguimiento_id,vehiculo_reserva,matricula_reserva`,
          [board.id, FIXTURE_ACTOR],
        );
        await db.query(
          `INSERT INTO public.etapas_hotel(
             registro_hotel_id,seguimiento_id,nombre,posicion,estado,
             estado_catalogo_codigo,tipo_etapa,accion_sistema,
             observaciones,creado_por,modificado_por
           ) VALUES(
             $1,gen_random_uuid(),'Recuperar ruta y liberar reserva',90,
             'pendiente','pendiente','recuperar_ruta','recuperar_y_liberar',
             'Obligación operativa sintética todavía abierta',$2,$2
           )`,
          [operational.id, FIXTURE_ACTOR],
        );

        await db.query('COMMIT');
      } catch (error) {
        await db.query('ROLLBACK');
        throw error;
      }

      await db.query(migration);

      const facts = await one(
        db,
        `SELECT
           app_private.evidencia_sustitucion_vigente_alpha75($1) AS historica_evidencia,
           app_private.sustitucion_vigente_por_hechos_alpha75($1) AS historica_vigente,
           app_private.evidencia_sustitucion_vigente_alpha75($2) AS operativa_evidencia,
           app_private.sustitucion_vigente_por_hechos_alpha75($2) AS operativa_vigente,
           app_private.evidencia_sustitucion_vigente_alpha75($3) AS continuidad_evidencia,
           app_private.sustitucion_vigente_por_hechos_alpha75($3) AS continuidad_vigente`,
        [historical.id, operational.id, pair.destination.id],
      );

      assert.equal(facts.historica_evidencia, '');
      assert.equal(facts.historica_vigente, false);
      assert.equal(
        facts.operativa_evidencia,
        'recuperacion_o_liberacion_pendiente',
      );
      assert.equal(facts.operativa_vigente, true);
      assert.equal(
        facts.continuidad_evidencia,
        'continuidad_confirmada_sin_recuperacion',
      );
      assert.equal(facts.continuidad_vigente, true);

      const metadata = await one(
        db,
        `SELECT
           app_private.metadatos_continuidad_alpha75($1)->>'sustitucion_vigente'
             AS historica,
           app_private.metadatos_continuidad_alpha75($2)->>'sustitucion_vigente'
             AS operativa`,
        [historical.seguimiento_id, operational.seguimiento_id],
      );
      assert.equal(metadata.historica, 'false');
      assert.equal(metadata.operativa, 'true');

      // Una recuperación física real termina también una continuidad explícita.
      // El cierre de la ficha se guarda en la misma transacción para respetar
      // el invariante que impide una recuperación realizada en una ficha activa.
      await db.query('BEGIN');
      try {
        await db.query("SELECT set_config('app.clonando_pizarra','1',true)");
        await db.query(
          `INSERT INTO public.etapas_hotel(
             registro_hotel_id,seguimiento_id,nombre,posicion,estado,
             estado_catalogo_codigo,tipo_etapa,accion_sistema,
             fecha_inicio_real,fecha_fin_real,fecha_real,
             observaciones,creado_por,modificado_por
           ) VALUES(
             $1,gen_random_uuid(),'Recuperación sintética acreditada',99,
             'realizada','realizada','recuperar_ruta','recuperar_y_liberar',
             clock_timestamp()-interval '3 minutes',
             clock_timestamp()-interval '2 minutes',
             clock_timestamp()-interval '1 minute',
             'Hecho físico sintético que finaliza la continuidad',$2,$2
           )`,
          [pair.destination.id, FIXTURE_ACTOR],
        );
        await db.query(
          `UPDATE public.registros_hotel
           SET estado='recuperado',
               retirado_hotel_activo=true,
               fecha_retirado_hotel=clock_timestamp(),
               modificado_por=$2
           WHERE id=$1`,
          [pair.destination.id, FIXTURE_ACTOR],
        );
        await db.query('COMMIT');
      } catch (error) {
        await db.query('ROLLBACK');
        throw error;
      }

      const recovered = await one(
        db,
        `SELECT
           app_private.evidencia_sustitucion_vigente_alpha75($1) AS evidencia,
           app_private.sustitucion_vigente_por_hechos_alpha75($1) AS vigente`,
        [pair.destination.id],
      );
      assert.equal(recovered.evidencia, '');
      assert.equal(recovered.vigente, false);

      const preserved = await one(
        db,
        `SELECT vehiculo_reserva,matricula_reserva
         FROM public.registros_hotel WHERE id=$1`,
        [historical.id],
      );
      assert.equal(preserved.vehiculo_reserva, 'TEST-FLOTA-HIST');
      assert.equal(preserved.matricula_reserva, 'MATSUBHIST');
    } finally {
      await fixture.destroy();
    }
  },
);
