# Alpha75.25: asistencias 24H y paradas independientes

Estado: candidata en PR #90, sujeta a validación funcional. Esta corrección
implementa MG75-24H-PARADAS-SEPARADAS-002 para las nuevas operaciones y añade
MG75-CONTINUIDAD-SUSTITUCION-ENTRE-PA-001, aprobada por Metro el 29/10/2026.
La versión visible sigue siendo 75.25. No autoriza despliegue, fusión ni
sincronización.

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

La entrada real y confirmada al taller inicia el tramo de la nueva PA. Ese día
se imputa íntegramente a taller; el tramo de asistencia termina el día anterior,
incluso cuando el origen queda con cero días. La fecha procede de una T de
entrada ya guardada. El formulario exige seleccionar ambas PA, la entrada y
confirmar una previsión calculada por el servidor. Véase el
[criterio aprobado](alpha75-continuidad-sustitucion-propuesta.md).

El sustituto conserva su identidad histórica en ambas PA y tiene un único
propietario vigente. No se crea una recuperación intermedia, no se libera la
reserva durante el traspaso y no se completan otras T. La recuperación posterior
continúa siendo expresa y requiere los hitos reales del taller.

El reparto añade límites de imputación separados de las fechas físicas. Hotel,
Histórico, Panel y Listados leen esos límites y la propiedad vigente. Se
conservan las medias manuales propias de cada PA, los totales manuales y los
cierres ya fijados; los conflictos que impedirían conservarlos bloquean la
operación. Las unidades afectadas R quedan fuera de este traspaso: su cobro por
unidad conserva la regla existente. Un sustituto de reserva con código R sí
puede continuar cubriendo una unidad DFM.

La protección previa contra doble asignación continúa vigente. El traspaso
requiere una operación específica, atómica e idempotente; no se obtiene
editando por separado los campos de sustituto. No se crean PA retroactivas ni
se alteran fichas históricas. MANTENIMENT mantiene sus barreras y las PA
enlazadas no se exportan ni importan mediante el protocolo anterior.

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

Los módulos modificados para continuidad usan `75.25-continuidad-001`; los
módulos de asistencia que no cambian conservan `75.25-paradas-002`. El arranque
refresca el asistente compartido antes de cargarlo. Las extensiones se registran desde los
módulos de Alpha75; Alpha80test también los hereda al importar esa aplicación.
Las versiones sin adaptador, incluida Alpha76, mantienen su comportamiento.
La validación funcional futura deberá comenzar con una recarga completa.
El arranque y las cachés de Alpha80test no se validan como una entrega propia
en esta candidata.

## Verificación reproducible

Evidencia local acumulada, ampliada el 29/10/2026:

| Capa | Resultado | Alcance |
| --- | --- | --- |
| Frontend previo de paradas | 104 casos aprobados en el seguimiento anterior | Controladores, fechas, confirmación, reintentos y prioridades |
| Frontend de continuidad | 40 casos nuevos y 39 de seguridad/compatibilidad aprobados | Contrato, diálogo, cero días, propiedad, reintento y lector financiero |
| SQL con PGlite 0.3.16 / PostgreSQL 17.5 | 19 escenarios aprobados | Migración congelada PARADAS-002 y cascadas críticas en una sesión |
| PostgreSQL 17.11 nativo | 6 carreras previas conservadas | Dos sesiones de trabajo, observador y bloqueos reales bajo `READ COMMITTED` |
| Recuperación en PostgreSQL 17.11 nativo | 5 escenarios aprobados | RPC vigente, commit, lectura desde otra conexión y conservación de actuaciones |
| Núcleo de continuidad en PostgreSQL 17.11 | 13 escenarios aprobados | Vínculo, reparto, manuales, cierre físico, permisos, copias por seguimiento y rechazo de deriva de instalación |
| Concurrencia de continuidad en PostgreSQL 17.11 | 7 carreras aprobadas | Confirmación, reintento, rollback, otra asignación, recuperación y rollover con bloqueos observados |
| Barrera MANTENIMENT/TANCAMENT en PostgreSQL 17.11 | 13 escenarios aprobados | Entrega/ACK, legado, retención de ambas PA y snapshots, y tres carreras con el receptor |
| Navegador real y PostgreSQL 17.11 | 14 recorridos aprobados | Cuatro de asistencia, cinco de recuperación/Histórico y cinco de continuidad con cuatro lecturas reales |
| Arranque publicado y caché HTTP real | 4 escenarios aprobados | Index candidato, sesión nula, caché previa del asistente y lector financiero, y fallo de precarga |

También pasan los controles existentes de seguridad, sintaxis y construcción
pública. El control de publicación verifica cuatro casos y construye los
archivos estáticos. La aceptación funcional de Metro en el entorno autorizado sigue
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
excepciones. Los traspasos entre PA tienen sus escenarios específicos.
Preparación, matriz y límites:
[`tests/sql/README-native-concurrency.md`](../tests/sql/README-native-concurrency.md).

### Recuperación explícita

Cinco escenarios adicionales ejecutan la RPC vigente
`public.marcar_t_realizada_rapida` y comprueban los efectos después del commit
desde otra conexión. Recuperar una PA de taller independiente conserva
exactamente la 24H abierta del mismo vehículo y su PA. Una recuperación
expresamente aplicable en una PA24H tampoco cierra por sí sola la asistencia ni
realiza otras T. Este segundo escenario utiliza una modalidad manual declarada
en la semilla; no representa la modalidad predeterminada de una nueva 24H.

La recuperación registra la hora real del servidor, retira la PA seleccionada
y libera la disponibilidad de la reserva, conservando sus identificadores
históricos en la PA. Si la reserva tiene pendientes, queda disponible con
pendientes. Se conserva un trámite aún sin realizar incluso si se retira esa
PA; no se interpreta recuperación como finalización de todas sus T.

También se comprueban rechazos atómicos por versión antigua, repetición,
actor/dispositivo/administrador no válidos y modalidad que no requiere
recuperación. Las ramas de autorización de la RPC son reales, pero sus
identidades y helpers son sintéticos: no se acredita una sesión JWT/RLS.

El fixture específico sustituye siete dobles críticos por definiciones runtime
con huellas comprobadas. En particular, el helper real de liberación conserva
los campos históricos de sustitución; la simplificación anterior del fixture
no se utiliza para estos escenarios. La migración de producto permanece
intacta. Matriz, procedencia y límites:
[`tests/sql/README-native-recovery.md`](../tests/sql/README-native-recovery.md).

### Formularios y lecturas en navegador

Playwright 1.62.1 conduce un navegador Chromium real, con zona Europe/Madrid,
hacia un servidor HTTP de loopback que ejecuta la RPC pública en PostgreSQL
nativo. La ejecución local utiliza Google Chrome 156.0.8078.73. Se cargan los
controladores y formularios de la aplicación, el adaptador Alpha75, el diálogo
de seguimiento y los módulos reales de Hotel y Panel. Las vistas SQL de Hotel
proceden de las definiciones revisadas mediante lectura del catálogo.

Los cuatro recorridos iniciales comprueban:

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
se certifican con estos recorridos.

Otros cinco recorridos cargan los módulos completos de Hotel75, Histórico75 y
Panel, con su navegación inicial sintética. Ejercitan el botón real de
recuperación, sus dos pulsaciones y un rechazo del servidor por versión antigua.
El Histórico consulta la vista vigente `hotel_por_dia`, muestra las PA
independientes y la recuperación sin borrar otras T, y abre el detalle real de
la actuación con trabajos y notas manuales. La búsqueda global recorre más de
200 registros, exige una segunda página y filtra por DFM, PA, periodo, trabajo
y anotación. Las consultas de Histórico no generan escrituras y los centinelas
sintéticos de 2556/2637 permanecen idénticos.

No se prueban una sesión con RLS, PostgREST, sincronización, guardado del editor
completo ni resolución del aviso de datos pendientes de un marcado rápido.
La prueba es funcional; no constituye una aceptación visual del shell ni
sustituye la validación de Metro. Ejecución y límites:
[`tests/integration/README.md`](../tests/integration/README.md).

### Continuidad, contabilidad y barrera

Las dos migraciones del 29/10 añaden el registro privado de vínculos, las RPC
de previsión/confirmación, las guardas de hechos e identidad y las proyecciones
de imputación y propietario. Se conservan las fechas físicas, los snapshots
cerrados y la vista R. El historial de una copia antigua sigue reflejando su
estado de entonces; la propiedad vigente se presenta por separado.

Los escenarios nativos incluyen cambios concurrentes de versión/media, origen
ya recuperado, modalidad incompatible, totales manuales protegidos, cierre
físico, replay posterior y copias del seguimiento. La recuperación acreditada
no se puede mover a otra PA, sustituir por otra fecha ni reabrir con una copia
activa. Los casos ordinarios sin continuidad conservan su propietario y su
lectura anterior.

La barrera conserva entregas por revisión aparte de la outbox y valida sus
confirmaciones exactas. Todo seguimiento previo requiere reconciliación,
incluso si su última revisión estaba confirmada. No se presume que una cola
vacía esté libre de entregas anteriores. Una nueva PA se acredita por un
registro de nacimiento instalado por la migración, conservado en rollover.
PARADA tiene como máximo una entrega por revisión; una respuesta perdida deja
incertidumbre explícita. El ACK legado no firma una huella de cliente.

Las PA enlazadas retienen los intercambios incompatibles de PARADA y TANCAMENT;
los sobres exclusivamente de trabajos mantienen su flujo sin convertir su ACK
en recuperación física. Los flags globales permanecen cerrados. Las carreras
con el receptor y la confirmación exigen bloqueos reales observados y prueban
commit y rollback. Matrices, procedencia y límites:
[`README-native-continuity.md`](../tests/sql/README-native-continuity.md).

Cinco recorridos nuevos de navegador completan la evidencia: traspaso con
selección explícita y doble clic; origen cero; respuesta perdida y replay tras
recuperación posterior; previsión antigua rechazada; y recuperación desde
Hotel. Hotel, Panel, Listados e Histórico leen las vistas candidatas reales.
Las dos suites anteriores mantienen los dobles financieros vacíos que ya
tenían; esta nueva suite consulta las cifras SQL y los datos manuales exactos.

### Arranque y caché

La ampliación del 29/10 añade el guardado completo de Hotel y corrige la pérdida
de precisión al reenviar fechas no editadas. Seis escenarios SQL del editor,
ocho del parser y ocho recorridos de navegador ejercitan la persistencia real
de T, trabajos y anotaciones. La operación conserva microsegundos y las dos
horas repetidas del cambio de horario. Un contrato del lector bloquea el editor
ante un backend incompatible. Detalle, migración, evidencias y límites:
[`alpha75-editor-fechas-exactas-001.md`](alpha75-editor-fechas-exactas-001.md).

Un ensayo separado construye los archivos públicos y abre el index real de
Alpha75, sin sustituir su shell ni los controladores heredados. La frontera de
autenticación devuelve una sesión nula y rechaza llamadas de datos. El
arranque frío conserva la pantalla de identificación y mantiene oculta la
aplicación protegida.

Con la caché HTTP habilitada y en el mismo origen/contexto se almacena el
asistente Alpha34 anterior a PARADAS-002. Una lectura idéntica sin petición al
servidor acredita que estaba en caché. El index candidato renueva después ese
archivo incluso con un cuerpo retrasado; se verifica el SHA256 actual y que
el módulo anterior no se ejecuta. Ante una precarga HTTP 503, el cargador de
módulos obtiene la candidata mediante otra petición. Estos tres escenarios se
conservan. Un cuarto almacena el lector financiero anterior a CONTINUIDAD-001,
acredita la lectura desde caché y comprueba que el index candidato obtiene y
ejecuta el lector actual mediante la revisión `75.25-continuidad-001`.
Un quinto escenario acredita el editor previo en su URL real de caché y exige
la huella del editor corregido por la revisión `75.25-editor-fechas-001`.

El ensayo presupone que se recibe el index candidato. No acredita renovación
automática de un index anterior: `version-refresh` compara sólo la versión
visible 75.25, idéntica entre revisiones. Tampoco acredita cabeceras del
alojamiento desplegado, una sesión autenticada ni Alpha80test. La aceptación
futura debe comenzar con recarga completa y comprobación de revisión.
Comandos, procedencia y frontera:
[`tests/integration/README-boot-cache.md`](../tests/integration/README-boot-cache.md).

### Comprobación continua

El flujo de CI también comprueba seguridad, sintaxis JavaScript, privacidad,
paradas externas, exclusión de archivos internos y construcción pública. Un
segundo job ejecuta las seis carreras anteriores, cinco escenarios de
recuperación, las suites nativas de continuidad y barrera y las dos suites
nuevas del editor: 58 escenarios nativos en total. Ejecuta 22
recorridos funcionales de navegador y cinco escenarios de arranque en Ubuntu
24.04, con paquetes oficiales PostgreSQL fijados y verificados por SHA256.
El servidor admite únicamente su socket Unix dedicado, no escucha TCP y se
detiene al terminar. Las pruebas SQL no se conectan a Supabase ni ejecutan
sincronización. Los 44 escenarios nativos anteriores conservan su runtime de
continuidad; sólo los 14 nuevos del editor cargan el core completo y la nueva
migración de fechas. La matriz distingue ambos alcances.

No se declara aprobada toda la colección histórica del repositorio. La base de
la candidata ya presentaba expectativas incompatibles en
`alpha75-ultima-estancia-taller.test.mjs` y dos aserciones históricas de
`alpha75-manteniment-escritura-segura`; no forman parte de las pruebas nuevas
aprobadas. La comprobación obsoleta de caché de 2675 sí se actualiza porque esta
entrega modifica esa cadena de carga; sus tres casos funcionales se conservan.

## Aceptación funcional pendiente

Queda la aceptación con Metro en un entorno de prueba autorizado: sesión,
dispositivo y permisos reales, servicios externos y comprobación de la revisión
servida por el alojamiento. El guardado completo del editor ya tiene ocho
recorridos automatizados con persistencia SQL real y los límites documentados.
Altas, reintentos,
cierres, recuperación explícita, consultas de Histórico y arranque candidato
con caché previa ya tienen evidencia automatizada dentro de las fronteras
descritas; eso no autoriza instalarlos en el backend operativo. El criterio de
continuidad entre PA ya está aprobado y registrado. Su implementación y sus
pruebas forman parte de esta candidata, manteniendo pendiente la aceptación
con sesión y servicios reales en el entorno expresamente autorizado.

El preflight de instalación autenticado ya constaba como APTO; su alcance es
compatibilidad de instalación. El posterior ensayo de órdenes seguía NO APTO.
Esta corrección no cambia ninguna de esas conclusiones ni levanta sus barreras.
