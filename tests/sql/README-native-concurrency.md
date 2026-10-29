# Concurrencia nativa de PARADAS-SEPARADAS-002

Este ensayo ejecuta la candidata SQL congelada en **PostgreSQL 17 nativo**, con dos conexiones de trabajo y una tercera conexión que observa los bloqueos. Complementa la suite de PGlite, que prueba las reglas de negocio en una sesión.

No despliega la candidata, importa datos operativos ni habilita sincronización. El runner crea una base sintética nueva, comprueba los escenarios y elimina únicamente esa base al terminar. La migración se mantiene sin cambios mientras se investiga la concurrencia.

Desde el 29/10/2026, estas seis regresiones cargan la candidata completa mediante
`createContinuityFixture`: la migración PARADAS-002 conserva sus bytes y se
aplican después las dos migraciones de continuidad. No se reinstalan funciones
ni vistas anteriores después de ellas. Las siete carreras nuevas del traspaso
y las tres de la barrera se documentan en
[README-native-continuity.md](README-native-continuity.md).

## Preparación y ejecución

Dependencias del repositorio: Node 24 y `pg@8.16.3`, fijado en `tests/sql/package-lock.json`. Instalar con:

```bash
npm ci --prefix tests/sql
```

Debe existir un PostgreSQL 17 local dedicado a estas pruebas, con esta disposición:

| Parámetro | Valor requerido |
| --- | --- |
| Directorio del servidor | Bajo `/tmp/metrogestion-pg17-native` |
| Directorio de datos usado en la validación | `/tmp/metrogestion-pg17-native/data` |
| Socket usado en la validación | `/tmp/metrogestion-pg17-native/socket` |
| Puerto usado en la validación | `55473` |
| Usuario de pruebas | `metrogestion_test` |
| Base de administración | `postgres` |
| Transporte | Socket Unix, sin contraseña |
| `listen_addresses` | Cadena vacía; TCP deshabilitado |
| Permisos del usuario local | Crear/eliminar bases efímeras y cargar el esquema sintético; no se usan credenciales operativas |

Ejecutar desde la raíz del repositorio:

```bash
METROGESTION_LOCAL_PG_DSN='postgresql://metrogestion_test@localhost/postgres?host=/tmp/metrogestion-pg17-native/socket&port=55473' \
METROGESTION_CONCURRENCY_REPORT='/tmp/metrogestion-native-concurrency-report.json' \
node tests/sql/alpha75-24h-concurrency.test.mjs
```

`METROGESTION_CONCURRENCY_REPORT` es opcional. Si se indica, debe terminar en `.json`. El resultado se determina por el código de salida del proceso y el informe de esa ejecución. El informe incluye la versión del servidor, la huella de la migración, los PID, los bloqueos observados, los resultados o errores de negocio, los inventarios sintéticos finales y la confirmación de eliminación de la base temporal.

El hostname `localhost` del ejemplo es un marcador del formato URL. La conexión efectiva usa exclusivamente el parámetro `host`, que debe ser un socket Unix dentro del directorio local dedicado. El helper no pasa la cadena de conexión original a `pg`.

## Controles del entorno

`local-postgres-harness.mjs` valida el destino antes de crear una base:

- Rechaza direcciones TCP, incluidas direcciones de loopback, contraseñas en el DSN, bases iniciales diferentes de `postgres`, otros usuarios y parámetros de conexión adicionales.
- Resuelve la ruta real del socket y confirma que está dentro del directorio local dedicado.
- Comprueba PostgreSQL 17, `inet_server_addr() IS NULL`, `listen_addresses=''`, usuario de pruebas, directorio de datos local y que el servidor no está en recuperación.
- Establece explícitamente transporte, codificación, opciones y proveedor de contraseña; no utiliza credenciales de `PGPASSWORD` o `pgpass`.
- Genera un nombre imprevisible con el prefijo `metrogestion_test_`. Nunca reutiliza una base existente.
- Comprueba la huella SHA256 de la migración congelada antes de instalarla:

```text
60cfff3ae8fd99818d88748080073a100ab52582eb4bc8dbcf5c02b8ce548092
```

La carga reutiliza `fixtures/setup.sql`, `../fixtures/alpha75-24h-paradas-baseline.sql`, `fixtures/triggers.sql` y la migración. `fixtures/concurrency-history.sql` añade los mismos tipos de centinelas sintéticos de 2556/2637: identidad, otras T, lugar, sustitución, valores manuales de días/km y barrera de sincronización pausada.

Los roles `anon`, `authenticated` y `service_role` son globales al clúster. El helper los crea solo si faltan y no modifica atributos o permisos de roles existentes. Esto permite que una prueba de UI y la prueba de concurrencia usen bases independientes en el mismo servidor local. Los roles permanecen en ese clúster de pruebas al eliminar una base.

## Cómo se acredita la carrera

Cada escenario utiliza dos instancias distintas de `pg.Client`. Cada transacción conserva su conexión durante todos sus comandos. Se comprueban PID distintos para A, B y el observador; las tres conexiones deben pertenecer a la misma base efímera.

1. A y B inician explícitamente transacciones `READ COMMITTED` y confirman el mismo `auth.uid()` sintético, no nulo.
2. A ejecuta la operación y mantiene su transacción abierta.
3. B inicia la operación conflictiva y queda pendiente.
4. El observador exige conjuntamente `wait_event_type='Lock'`, `wait_event='advisory'`, el PID de A en `pg_blocking_pids(B)` y un bloqueo consultivo no concedido de B que coincide con uno concedido a A en `pg_locks`.
5. Solo después de obtener esa evidencia se permite el `COMMIT` o `ROLLBACK` de A.
6. Se comprueba el resultado de B, se confirma o revierte su transacción y se inspeccionan los registros persistidos.

El intervalo de 20 ms entre consultas del observador limita su carga; transcurrir ese tiempo no acredita ninguna carrera. Tampoco se acepta como éxito una finalización anticipada de B, un timeout, un deadlock, un error de permisos o una violación única inesperada.

La comprobación inicial exige que `guardar_activacion_24h` y `proteger_sustitucion_paradas002` conserven volatilidad `VOLATILE`. Cada transacción confirma su aislamiento real. Así se prueba la visibilidad del cambio confirmado por A dentro de la operación que B ya había empezado.

## Escenarios

| Caso | Carrera | Resultado exigido |
| --- | --- | --- |
| RC1 | Mismo actor, petición y payload; A confirma | B espera y devuelve el mismo UUID, `reutilizada=true` y la misma versión; una activación, una PA, una T y una petición |
| RC2 | Mismo actor y petición, payload diferente; A confirma | B espera y recibe el error de negocio `P0001` de PARADAS-002; el contenido original se conserva y no aparece una segunda fila |
| RC3 | Mismo actor, petición y payload; A revierte | B espera y crea una única activación válida; no queda la activación ni la petición de A |
| RC4 | A asigna por DFM en 24H y B intenta asignar por matrícula en taller | B espera y recibe `23514` de PARADAS-002; queda una asignación. El taller puede crearse con otra PA sin copiar el sustituto |
| RC5 | A asigna en taller y revierte; B espera para asignar por matrícula en 24H | B obtiene la asignación; no quedan la PA de A ni filas huérfanas de la carrera |
| RC6 | A asigna en 24H y B reactiva una PA retirada que conserva ese sustituto | B espera y recibe `23514`; la PA retirada conserva exactamente sus datos y solo A mantiene la asignación activa |

Los tres casos de sustitución comprueban además que la reserva termina `ocupada`. Todos los casos inspeccionan activaciones, PA, T y peticiones, y verifican que los centinelas históricos, los valores manuales y la barrera de sincronización siguen idénticos.

Los huecos de secuencia producidos por una transacción revertida son válidos. Las pruebas exigen ausencia de filas huérfanas y unicidad de identidad, seguimiento y número de PA persistidos; no exigen numeración consecutiva.

## Uso del helper desde otra prueba local

```js
import { createLocalFixture } from './local-postgres-harness.mjs';

const fixture = await createLocalFixture({ prefix: 'ui' });
try {
  // admin y observer apuntan a la base efímera, no a postgres.
  const worker = await fixture.connect('ui');
  const result = await worker.query(
    'SELECT public.guardar_activacion_24h(NULL,$1::jsonb,$2)',
    [JSON.stringify(payloadSintetico), 'peticion_sintetica_001'],
  );
  await fixture.close(worker);
} finally {
  await fixture.destroy();
}
```

El helper devuelve `dbName`, `admin`, `observer`, `connectionConfig`, `connect`, `close`, `destroy`, `protectedBefore` y `metadata`. `connect()` establece el actor sintético `00000000-0000-4000-8000-000000000001` en cada conexión. Quien necesite una transacción debe iniciarla y terminarla expresamente.

En una salida excepcional se libera primero A, antes de esperar o revertir B. Después se cierran las conexiones y se elimina únicamente la base cuyo nombre generó esa invocación. El campo `passed` del informe solo puede ser verdadero si pasan los seis casos, permanecen intactos los centinelas finales y se confirma la eliminación de la base.

## Alcance de la evidencia

La prueba nativa valida estas seis carreras concretas bajo `READ COMMITTED`. No es una prueba de carga, un ensayo de todos los intercalados posibles ni una certificación de otros niveles de aislamiento.

Se conserva la frontera del fixture anterior: autenticación, auditoría, documentos, parte del editor y servicios externos de sincronización tienen dobles delimitados. La RPC pública y las funciones de la candidata, sus bloqueos y las cascadas críticas de reserva/coherencia se ejecutan en PostgreSQL real. No se prueba aquí PostgREST ni la UI del navegador.

No se modifica ni deduce una continuidad de facturación entre PA. La segunda imputación ambigua se rechaza; una nueva PA sin esa segunda asignación sigue estando permitida.

Referencias técnicas: [transacciones de node-postgres](https://node-postgres.com/features/transactions), [funciones de información y bloqueos de PostgreSQL 17](https://www.postgresql.org/docs/17/functions-info.html) y [vista pg_locks](https://www.postgresql.org/docs/17/view-pg-locks.html).
