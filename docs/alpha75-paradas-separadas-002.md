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

Resultado local del 28/10/2026: 104 casos frontend seleccionados y 19 casos SQL
aprobados. También pasan los controles existentes de seguridad, sintaxis y
construcción pública. El control de publicación verifica cuatro casos y genera
946 archivos estáticos. La validación funcional de Metro sigue pendiente.

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

PGlite no reproduce dos sesiones PostgreSQL concurrentes. Los bloqueos de
asignación y petición requieren además un ensayo de concurrencia en un entorno
de prueba autorizado antes de aprobar el despliegue.

El flujo de CI también comprueba seguridad, sintaxis JavaScript, privacidad,
paradas externas, exclusión de archivos internos y construcción pública. Las
pruebas SQL no se conectan a Supabase ni ejecutan sincronización.

No se declara aprobada toda la colección histórica del repositorio. La base de
la candidata ya presentaba expectativas incompatibles en
`alpha75-ultima-estancia-taller.test.mjs` y dos aserciones históricas de
`alpha75-manteniment-escritura-segura`; no forman parte de las pruebas nuevas
aprobadas. La comprobación obsoleta de caché de 2675 sí se actualiza porque esta
entrega modifica esa cadena de carga; sus tres casos funcionales se conservan.

## Validación funcional pendiente

En un entorno de prueba autorizado deben comprobarse las nuevas altas y sus
reintentos, el cierre por traslado con reserva que continúa, la creación de la
PA de taller, la conservación de otras T y la recuperación explícita. Deben
contrastarse las lecturas de Asistencias, Hotel, Histórico y Panel.

El preflight de instalación autenticado ya constaba como APTO; su alcance es
compatibilidad de instalación. El posterior ensayo de órdenes seguía NO APTO.
Esta corrección no cambia ninguna de esas conclusiones ni levanta sus barreras.
