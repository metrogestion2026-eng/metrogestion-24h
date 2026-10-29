# Editor completo de Hotel después de una continuidad

Esta ampliación cierra una limitación concreta de los ensayos anteriores: el
editor reenviaba todas las T y sus trabajos, pero el fixture de continuidad
rechazaba cualquier T con ID existente. Ahora se ejecuta la cadena de lectura,
normalización de catálogos y persistencia real del editor sobre datos sintéticos.

## Entorno y composición

`createEditorFixture` conserva `createContinuityFixture` íntegro: PostgreSQL
17.11 nativo, base nueva, socket Unix local sin TCP, migración congelada de
paradas independientes y las dos migraciones de continuidad/barrera. A
continuación carga `fixtures/editor-runtime.sql` y la migración
`20261029072758_alpha75_editor_timestamps_exactos.sql`.

El runtime añade **26 definiciones literales** obtenidas el 29/10/2026 mediante
consultas exclusivamente de catálogo y transacciones `BEGIN READ ONLY` /
`ROLLBACK`. Cada definición se comprueba por MD5 después de instalarla en la
base efímera. No se importan filas operativas, usuarios, claves ni sesiones.

La cadena ejercitada es:

1. Lectura pública `obtener_ficha_hotel_edicion_alpha72`, sus lectores privados
   Alpha72 y Alpha71 y `obtener_ficha_hotel_edicion`.
2. Guardado público Alpha73 y sus controles de identidad, Alpha72 candidato,
   Alpha71 real, normalización de catálogos, wrapper general y core real.
3. Guardado de T y trabajos existentes, control de sus versiones, propagación
   histórica, orden de T, reconciliación candidata y anotaciones manuales reales.
4. Recuperación pública real y lectura posterior desde otra conexión.

Las funciones y vistas modificadas por las migraciones anteriores se conservan;
no se reinstalan versiones antiguas después. Las dos funciones que protege la
migración de fechas reproducen también su owner `postgres` y sus ACL exactas.
Ese rol local se crea sin login si falta; no se modifican atributos de roles
preexistentes. Las restantes funciones conservan su definición literal y los
grants necesarios en el propietario sintético del harness.

Los catálogos y el usuario del editor son semillas explícitas. El catálogo
sintético de tipos usa `24H`, la forma creada por la RPC de asistencia, para
evitar una conversión artificial de código al guardar una nota. Se mantienen
las aserciones estrictas sobre los hechos. La versión de trabajos se incrementa
mediante el trigger real existente `tocar_actualizado_en_y_version`.

## Defecto reproducido y corrección

Con el runtime anterior, una entrada persistida como
`2026-10-28T11:00:37.123456` en Madrid, reenviada por el editor como
`2026-10-28T11:00`, provocaba el rechazo `23514` de la guarda de continuidad al
guardar una simple nota. La RPC completa lo reprodujo, y el inventario de PA,
T, trabajos, anotaciones, vínculos, reserva y colas quedó idéntico después del
rollback. Las guardas protegían correctamente el hecho original.

El parser anterior tampoco interpretaba el offset de una cadena ISO: usaba
`::timestamp AT TIME ZONE 'Europe/Madrid'`. Por tanto, enviar sin más la cadena
UTC original no era una solución válida. La migración nueva distingue fechas
con offset explícito de fechas locales heredadas y anuncia el contrato
`MG75-EDITOR-FECHAS-001` desde el lector público en la misma transacción. El
frontend conserva la cadena original de cada fecha que no se haya editado.

`editorPayload` usa JSON generado por PostgreSQL y conserva los seis dígitos
fraccionarios, sin convertir fechas mediante `Date`. Es un helper exclusivo de
las pruebas SQL; los recorridos de navegador emplean la serialización real del
producto. `timestampFix: false` y `timestampFormat: 'madrid'` se reservan para
reproducir el comportamiento anterior y las comprobaciones de instalación.

## Seis escenarios nativos

| Caso | Evidencia |
| --- | --- |
| ED01 | Guardar una anotación en el origen cedido con todas sus T existentes. La lectura anuncia el contrato; persisten microsegundos, fechas, asistencia, reserva, vínculo, propietario y las medias manuales propias de ambas PA. Otra conexión confirma una única anotación. |
| ED02 | Editar el diagnóstico de un trabajo existente y las observaciones de su T en destino. Se conservan los IDs y el número de filas; cambia la versión del trabajo y permanecen todos los hechos físicos. |
| ED03 | Guardar finalización y recogida reales desde el editor, recuperar mediante la RPC pública y añadir después una nota histórica. Las fechas de precisión completa, el origen y la liberación real se conservan. |
| ED04 | Otra sesión cambia un trabajo antes del guardado. El core rechaza su versión después de haber intentado actualizar PA y T; toda la operación se revierte. |
| ED05 | Alterar la entrada que fija el corte o enviar la identidad de otra PA se rechaza sin efectos parciales. |
| ED06 | Guardar el origen desde una copia histórica archivada cuando existen copias actuales. Se mantienen cuatro filas físicas, un solo vínculo y el propietario vigente; no se crea una reactivación adicional. |

El cambio de día de ED06 usa copias explícitas sintéticas. No certifica la RPC
operativa completa de rollover. Las pruebas de parser, cambio de hora,
compatibilidad, instalación y seguridad de la nueva migración se encuentran
en `alpha75-editor-timestamps.test.mjs`; su conteo es independiente de estos
seis escenarios.

## Ejecución

Primero se necesita el servidor dedicado descrito en
[`README-native-concurrency.md`](README-native-concurrency.md). El helper
rechaza DSN remotos, TCP, contraseñas y ubicaciones ajenas al directorio
dedicado. Cada invocación crea y elimina sólo su propia base efímera.

```bash
METROGESTION_LOCAL_PG_DSN='postgresql://metrogestion_test@localhost/postgres?host=/tmp/metrogestion-pg17-native/socket&port=55473' \
node --test --test-concurrency=1 tests/sql/alpha75-editor.test.mjs
```

`METROGESTION_EDITOR_REPORT` permite escribir un informe JSON local. El informe
incluye servidor, hashes del runtime/migraciones, resultado de cada escenario,
conservación de los centinelas sintéticos 2556/2637 y de las barreras y eliminación
de la base. La suite no presenta un rechazo de SQL, permiso o timeout imprevisto
como un resultado de dominio válido.

## Frontera de aceptación

Esta evidencia cubre el editor completo para los recorridos definidos y la
persistencia real de PA, T, trabajos y anotaciones que éstos necesitan. La
identidad, sesión, dispositivo, permisos y transporte Supabase/PostgREST siguen
siendo dobles controlados. No se valida JWT, RLS de usuarios reales ni el SDK.

La auditoría conserva el doble explícito de las suites anteriores; no se
certifica la escritura del registro de auditoría operativo. Documentos y
almacenamiento, importación de trabajos y servicios auxiliares mantienen sus
fronteras declaradas. Se usa la barrera candidata de MANTENIMENT, pero ninguna
hoja, Apps Script o servicio externo está conectado.

Se mantienen las restricciones de no desplegar, no fusionar y no abrir la
sincronización. El nombre del proyecto Supabase operativo no lo convierte en un
entorno de pruebas. La aceptación con sesión y dispositivo reales y con Metro
requiere su entorno autorizado.
