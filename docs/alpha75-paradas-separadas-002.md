# Alpha75.25: asistencias 24H y paradas independientes

Estado: candidata en PR #90, sujeta a validación funcional. Esta corrección
implementa MG75-24H-PARADAS-SEPARADAS-002 para las nuevas operaciones. La versión
visible sigue siendo 75.25. No autoriza despliegue, fusión ni sincronización.

## Comportamiento previsto

- Una nueva asistencia crea una PA propia, aunque ya exista una ficha del mismo
  vehículo. Un reintento de la misma petición conserva la asistencia y su PA.
- El taller posterior se registra mediante otra alta, con su propia PA. El
  resultado «Trasladado a taller» no genera automáticamente nuevas T.
- «Asistencia 24H finalizada» acredita el fin de esa actuación, con sus fechas y
  horas reales. Puede conservar como resultado el traslado o la necesidad de
  sustitución; no convierte esos resultados en reparación.
- El cierre actualiza únicamente la T24H identificada sin ambigüedad. Las demás
  T, la identidad de la parada, las fechas ya acreditadas y los datos manuales
  se conservan. Una discrepancia se devuelve para revisión.
- La PA de una asistencia terminada puede mostrar «Realizada» sin retirada ni
  recuperación. Las actuaciones y estancias físicas pendientes tienen prioridad.
- Finalizar la asistencia no libera el sustituto. Recuperar explícitamente un
  vehículo conserva su propio flujo y no cierra por sí solo la asistencia.
- El formulario exige confirmación del servidor sobre identidad, estado y
  resultado antes de anunciar el cierre. Un error conserva el borrador.
- Al elegir el resultado explícito «Trasladado a taller», la casilla de traslado
  refleja también esa elección y el borrador conserva el mismo hecho. Este
  ajuste está limitado al adaptador de Alpha75.

## Sustitución que continúa

La candidata impide asignar de nuevo el mismo sustituto a otra PA activa cuando
alguna de las dos corresponde a una 24H. Permite crear la PA de taller sin
duplicar esa asignación. Conserva la imputación existente y no inventa una fecha
de recuperación o un corte de días/km.

El reparto explícito de una sustitución continua entre varias PA sigue pendiente
de una solución de tramos. Esta protección no constituye esa solución, ni
recalcula facturación, cierres contables o medias. Tampoco transforma fichas
históricas ni crea PA retroactivas.

## Migración y compatibilidad

La migración `20261028174243_alpha75_24h_paradas_independientes.sql` se prepara
contra las definiciones operativas revisadas el 28/10/2026, que incluyen los
núcleos SIT-24H-001 y REC-001. Comprueba sus huellas antes de modificar funciones
y conserva propietario, permisos, modo de seguridad y configuración. Una deriva
aborta toda la transacción; requiere revisión, no retirar la comprobación.

El repositorio contiene migraciones históricas con definiciones anteriores a
esas versiones operativas. No se debe asumir que reproducir todos esos archivos
en orden genera la misma base. La nueva migración integra las protecciones de
taller activo de la candidata sin sustituir los núcleos actuales por sus
predecesores. No contiene reparación ni recálculo masivo de datos existentes.

La idempotencia de altas utiliza una tabla privada con actor, identificador de
petición, huella SHA-256 e identidad creada. No guarda el contenido del
formulario. Una petición repetida con otro contenido se rechaza. La protección
frente a doble asignación serializa las identidades del sustituto conocidas por
DFM y matrícula.

Los recursos de la candidata usan `75.25-paradas-002`, y el arranque refresca el
asistente compartido antes de cargarlo. Las extensiones se registran desde los
módulos de Alpha75; Alpha80test también los hereda al importar esa aplicación.
Las versiones sin adaptador, incluida Alpha76, mantienen su comportamiento.
La validación funcional futura deberá comenzar con una recarga completa.
El arranque y las cachés de Alpha80test no se validan como una entrega propia
en esta candidata.

## Verificación reproducible

Resultado local del 28/10/2026:

| Capa | Resultado | Alcance |
| --- | --- | --- |
| Frontend seleccionado | 104 casos aprobados | Controladores, fechas, confirmación, reintentos y prioridades |
| SQL con PGlite 0.3.16 / PostgreSQL 17.5 | 19 escenarios aprobados | Reglas de negocio y cascadas críticas en una sesión |
| PostgreSQL 17.11 nativo | 6 carreras aprobadas | Dos sesiones de trabajo, observador y bloqueos reales bajo `READ COMMITTED` |
| Navegador real y PostgreSQL 17.11 | 4 recorridos aprobados | Formularios reales, RPC pública, Hotel y Panel con transporte local |

También pasan los controles existentes de seguridad, sintaxis y construcción
pública. El control de publicación verifica cuatro casos y genera 946 archivos
estáticos. La aceptación funcional de Metro en el entorno autorizado sigue
pendiente.

Los casos frontend ejecutan los controladores del asistente y del diálogo con
respuestas y DOM sintéticos. Cubren finalización independiente, fechas, resultado,
confirmación del servidor, doble clic, reintento y prioridades de tareas.

```sh
node --test tests/alpha75-24h-independent-close.test.mjs tests/alpha75-24h-followup-close.test.mjs tests/alpha75-24h-parada-completada.test.mjs tests/alpha75-24h-wizard-close.test.mjs
npm ci --prefix tests/sql --ignore-scripts --no-fund --no-audit
npm test --prefix tests/sql
```

El entorno SQL usa PGlite 0.3.16 (PostgreSQL 17.5) con datos completamente
sintéticos y las definiciones de funciones revisadas. El backend de referencia
usa PostgreSQL 17.6. Los dobles de servicios auxiliares se identifican en los
fixtures. Las pruebas locales no certifican una instalación ni una sesión
completa en la aplicación operativa.

### Concurrencia nativa

La limitación de PGlite se complementa con seis carreras sobre PostgreSQL 17.11
nativo. Cada caso utiliza tres conexiones distintas a una base sintética nueva:
A conserva una transacción abierta, B intenta la operación conflictiva y el
observador acredita la espera de B antes de permitir el commit o rollback de A.
Se exige `wait_event='advisory'`, el PID de A en `pg_blocking_pids(B)` y la
coincidencia entre el bloqueo concedido a A y el solicitado por B en `pg_locks`.

Se comprueban el reintento idéntico, la misma petición con contenido diferente,
la reversión del primer alta, la asignación por DFM frente a matrícula, la
reversión de la primera asignación y la reactivación de una PA retirada que
conserva un sustituto ya asignado. No quedan PA, T, activaciones ni peticiones
huérfanas. En los tres casos de sustitución la reserva termina ocupada.

Los centinelas sintéticos de 2556/2637, las demás T, los valores manuales y la
barrera de sincronización permanecen idénticos. Se confirma también la
eliminación de la base efímera. La migración no necesitó modificaciones y
mantiene su SHA256:

```text
60cfff3ae8fd99818d88748080073a100ab52582eb4bc8dbcf5c02b8ce548092
```

Esta evidencia cubre las seis carreras bajo `READ COMMITTED`; no certifica
otros niveles de aislamiento, carga, cambios simultáneos del catálogo,
rollover ni todos los intercalados posibles. La continuidad del mismo
seguimiento y las paradas de taller sin relación con 24H conservan sus
excepciones. Preparación, matriz y límites:
[`tests/sql/README-native-concurrency.md`](../tests/sql/README-native-concurrency.md).

### Formularios y lecturas en navegador

Playwright 1.62.1 conduce un navegador Chromium real, con zona Europe/Madrid,
hacia un servidor HTTP de loopback que ejecuta la RPC pública en PostgreSQL
nativo. La ejecución local utiliza Google Chrome 156.0.8078.73. Se cargan los
controladores y formularios de la aplicación, el adaptador Alpha75, el diálogo
de seguimiento y los módulos reales de Hotel y Panel. Las vistas SQL de Hotel
proceden de las definiciones revisadas mediante lectura del catálogo.

Los cuatro recorridos comprueban:

1. Alta completa, doble clic, PA independiente de un taller previo, rechazo de
   fin anterior al inicio y cierre por traslado sin afirmar reparación.
2. Cierre desde el diálogo de seguimiento con sustitución pendiente, reserva
   ocupada sin recuperación, nueva PA de taller y rechazo de doble asignación.
3. Respuesta HTTP perdida después del commit y reintento del usuario con la
   misma petición, payload e identidad, sin duplicar el alta.
4. Rechazo real de PostgreSQL ante dos T24H ambiguas, conservando el diálogo,
   el borrador y la asistencia abierta.

Las lecturas posteriores contrastan estado, sustituto y contadores de Hotel y
Panel con la base. Se exige conservar los centinelas, no intentar conexiones
externas y no producir errores JavaScript sin capturar. Las fechas SQL `DATE`
se transportan como texto de PostgreSQL, y se comprueba que la fecha del
formulario coincide con la guardada.

El shell, la autenticación y el transporte Supabase/PostgREST tienen dobles
locales declarados. Facturación y documentos utilizan respuestas vacías y no
se certifican con estos recorridos. Tampoco se prueban una sesión con RLS,
Histórico completo, sincronización, publicación, cachés ni el arranque integral
de la aplicación. La prueba es funcional; no constituye una aceptación visual
del shell ni sustituye la validación de Metro. Ejecución y límites:
[`tests/integration/README.md`](../tests/integration/README.md).

### Comprobación continua

El flujo de CI también comprueba seguridad, sintaxis JavaScript, privacidad,
paradas externas, exclusión de archivos internos y construcción pública. Un
segundo job ejecuta las seis carreras y los cuatro recorridos de navegador en
Ubuntu 24.04, con paquetes oficiales PostgreSQL fijados y verificados por SHA256.
El servidor admite únicamente su socket Unix dedicado, no escucha TCP y se
detiene al terminar. Las pruebas SQL no se conectan a Supabase ni ejecutan
sincronización.

No se declara aprobada toda la colección histórica del repositorio. La base de
la candidata ya presentaba expectativas incompatibles en
`alpha75-ultima-estancia-taller.test.mjs` y dos aserciones históricas de
`alpha75-manteniment-escritura-segura`; no forman parte de las pruebas nuevas
aprobadas. La comprobación obsoleta de caché de 2675 sí se actualiza porque esta
entrega modifica esa cadena de carga; sus tres casos funcionales se conservan.

## Aceptación funcional pendiente

Queda la aceptación con Metro en un entorno de prueba autorizado: sesión y
permisos reales, arranque y cachés, recuperación explícita y lectura completa de
Asistencias, Hotel, Histórico y Panel. Las altas, reintentos y cierres descritos
ya tienen evidencia automatizada en navegador y PostgreSQL nativos; eso no
autoriza instalarlos en el backend operativo. El reparto de una sustitución
continua entre distintas PA sigue pendiente de la solución explícita de tramos.

El preflight de instalación autenticado ya constaba como APTO; su alcance es
compatibilidad de instalación. El posterior ensayo de órdenes seguía NO APTO.
Esta corrección no cambia ninguna de esas conclusiones ni levanta sus barreras.
