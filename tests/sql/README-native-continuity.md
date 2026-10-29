# Continuidad entre PA: pruebas nativas y barrera MANTENIMENT

Estas pruebas verifican MG75-CONTINUIDAD-SUSTITUCION-ENTRE-PA-001, aprobada por
Metro el 29/10/2026. Usan PostgreSQL 17.11 local, datos sintéticos y las RPC
públicas. No aplican migraciones en Supabase ni ejecutan Apps Script o una hoja.

## Instalación reproducida

`createContinuityFixture` crea una base nueva en el socket Unix dedicado. Carga
el runtime capturado, la migración congelada de paradas independientes, las
funciones de recuperación y las vistas de Hotel/Histórico/finanzas verificadas
por huella. Después aplica, en este orden:

1. `20261029060636_alpha75_continuidad_sustitucion_entre_pa.sql`: vínculo privado,
   previsión y confirmación, protecciones y proyecciones de imputación/propiedad.
2. `20261029060925_alpha75_continuidad_barrera_manteniment.sql`: procedencia de
   seguimientos, historial de entregas y confirmaciones y retención del protocolo
   de PARADA incompatible con los nuevos tramos.

La primera migración falla de forma cerrada hasta instalar la segunda. Ambas
comprueban las definiciones revisadas antes de modificarlas. La migración
PARADAS-002 conserva su SHA256
`60cfff3ae8fd99818d88748080073a100ab52582eb4bc8dbcf5c02b8ce548092`.

El helper no reinstala después las vistas antiguas. Los datos de actor,
dispositivo y permisos siguen siendo sintéticos; las guardas de las RPC son
reales, pero no constituyen una sesión Supabase Auth/RLS.

## Ejecución

Preparación del servidor dedicado y dependencias:
[README-native-concurrency.md](README-native-concurrency.md).

```bash
METROGESTION_LOCAL_PG_DSN='postgresql://metrogestion_test@localhost/postgres?host=/tmp/metrogestion-pg17-native/socket&port=55473' npm run test:continuity --prefix tests/sql
METROGESTION_LOCAL_PG_DSN='postgresql://metrogestion_test@localhost/postgres?host=/tmp/metrogestion-pg17-native/socket&port=55473' npm run test:continuity-concurrency --prefix tests/sql
METROGESTION_LOCAL_PG_DSN='postgresql://metrogestion_test@localhost/postgres?host=/tmp/metrogestion-pg17-native/socket&port=55473' npm run test:continuity-sync --prefix tests/sql
```

Cada suite elimina su base efímera en `finally`. El helper rechaza DSN remotos,
contraseñas, TCP y servidores distintos del PostgreSQL local dedicado.

## Núcleo: trece escenarios

| Caso | Evidencia exigida |
| --- | --- |
| C01 | Contexto, selección, confirmación y replay: un vínculo, mismo sustituto, PA/T originales conservadas. |
| C02 | Entrega y entrada en el mismo día: origen cero, día completo en destino, sin doble imputación. |
| C03 | Medias manuales distintas por PA conservadas; snapshot cerrado de TANCAMENT exacto. |
| C04 | Recuperación real del destino y replay posterior; reserva libre y asistencia abierta intacta. |
| C05 | Origen cedido no puede recuperar, retirarse, anularse, reasignarse ni cambiar hechos del corte. |
| C06 | Recuperación no anterior a entrada ni futura; no borrar, mover de PA, cambiar identidad, añadir una segunda recuperación o reabrir el hecho acreditado. |
| C07 | Guardado de notas a través del wrapper Alpha73 sin tratar la referencia histórica como doble asignación. |
| C08 | Rechazo de versiones antiguas, cambio de media tras previsualizar y reutilización de petición con otro contenido. |
| C09 | Bloqueo por totales manuales, cortes cerrados, modalidad incompatible, afectado R o falta de entrada real. |
| C10 | Propietario ordinario sin vínculo y estado/color de FLOTA en una pizarra histórica conservados. |
| C11 | Permisos mínimos de lectura/edición y dispositivo, y acceso privado al registro de vínculos. |
| C12 | Copias de rollover: una fila lógica por seguimiento, propietario efectivo coherente y ninguna copia activa que reabra una recuperación. |
| C13 | Deriva de una definición revisada: la instalación se rechaza antes de crear el registro de vínculos o sustituir las funciones. |

Las fechas proceden de hechos persistidos y se interpretan en Europe/Madrid.
Los periodos contables del fixture son ventanas sintéticas explícitas alrededor
de la fecha de ejecución; no dependen de estar lejos del primer día de mes.
Los negativos de cierre se preparan por separado. Las medias manuales no se
copian de una PA a otra y no se introduce una conversión nueva de TOP3.

## Concurrencia de continuidad: siete escenarios

| Caso | Operaciones enfrentadas y resultado |
| --- | --- |
| CR1 | Misma petición y actor: un commit y replay del mismo vínculo. |
| CR2 | Misma petición con contenido distinto: se conserva el primero y se rechaza el segundo. |
| CR3 | Rollback de la primera confirmación: la segunda puede confirmar sin hechos huérfanos. |
| CR4 | Continuidad y otra asignación que identifica al sustituto por matrícula: una sola propiedad vigente. |
| CR5 | Recuperación del origen primero: la continuidad posterior se rechaza. |
| CR6 | Continuidad primero: el origen ya cedido no puede recuperar ni liberar el destino. |
| CR7 | Rollover primero: los IDs de la pizarra anterior no permiten confirmar una previsión antigua. |

Seis casos observan bloqueo consultivo. En la carrera con recuperación, la RPC
rápida ya bloquea la PA antes de entrar en el trigger; se acredita la espera de
`transactionid`, el PID bloqueante y las entradas exactas de `pg_locks`. Cada
resultado se comprueba después del commit desde otra conexión.

## Entregas MANTENIMENT y TANCAMENT: trece escenarios

| Grupo | Evidencia exigida |
| --- | --- |
| SC1–SC3 | Instalación sin cambiar flags/colas; preflight compatible sin autorizar sincronización; todo legado bloqueado; identidad nueva acreditada por trigger aunque su fecha visible sea antigua. |
| SC4–SC6 | Entrega registrada antes de devolverla; ACK de revisión anterior aunque la outbox haya avanzado; replay exacto; rechazo de confirmación contradictoria; filtros que no inventan entregas. |
| SC7–SC9 | Ambas PA vinculadas conservan sus colas; no construyen ni reciben PARADA antigua; sobres exclusivamente de trabajos conservan su flujo; importaciones incompatibles retenidas con evidencia y otras PA preservadas. |
| SC10–SC12 | Carreras entrega/continuidad: commit de entrega bloquea el vínculo, commit del vínculo bloquea la entrega y rollback de entrega no deja una orden en vuelo ficticia. |
| SC13 | Importación TANCAMENT de ambos extremos retenida por sync_id o PA/DFM normalizados, con snapshots y cifras manuales protegidos frente a upsert y marca de ausencia; una fila ajena sigue importándose. |

Las carreras utilizan conexiones separadas y un observador que exige una espera
consultiva real, el PID bloqueante y la correspondencia de `pg_locks` antes de
permitir resolver la primera transacción. No se sustituyen con temporizadores
que sólo supongan el orden de ejecución.

### Qué acredita el protocolo y qué conserva como incertidumbre

El Apps Script legado confirma `sync_id`, revisión, tipo y fila. No firma ni
devuelve la huella del payload. El servidor conserva la huella y el contenido
entregado de cada revisión y comprueba su coherencia; eso no prueba por sí solo
que una hoja remota contenga los valores esperados.

PARADA se despacha como máximo una vez por revisión. Una respuesta perdida
antes de llegar al cliente deja una entrega incierta que requiere
reconciliación; no se presume que no ocurrió ni se vuelve a enviar una copia
que el ACK antiguo no puede distinguir. Las confirmaciones exactas repetidas
siguen siendo idempotentes. Los sobres de trabajos puros no alteran los hechos
físicos de PARADA.

Todo seguimiento existente antes de instalar la barrera queda pendiente de
reconciliación, incluso si su revisión actual figuraba confirmada. Esa
confirmación sólo acredita su revisión. La ausencia de outbox o un `creado_en`
reciente tampoco demuestra ausencia de entregas antiguas. Los seguimientos
nuevos se registran al nacer y sus copias de rollover conservan esa procedencia.

Estas decisiones mantienen la barrera; no resuelven datos históricos ni
autorizan reabrir sincronización. No se añade una acción que borre la evidencia
o fuerce una continuidad retenida.

## Frontera de aceptación

Los centinelas sintéticos 2556/2637, sus tareas y valores manuales, los flags y
las colas protegidas se comparan con las instantáneas anteriores. No se leen
filas operativas para sembrar estas bases. Las capturas fuente contienen
definiciones de catálogo, no registros de clientes.

El runtime auxiliar de catálogos, identidad y parte del editor está delimitado
en los fixtures. C07 prueba el wrapper y la conservación de notas; no acredita
todo el editor visual. La prueba de copias no equivale a certificar el job
operativo completo de rollover. Tampoco se certifican carga, todos los
intercalados, otros niveles de aislamiento, cambios simultáneos de catálogo,
otros consumidores de la cola, una sesión JWT real ni la hoja de Google.

Los cinco recorridos reales de navegador y las cuatro lecturas están descritos
en [README de integración](../integration/README.md). La aceptación con Metro,
el alojamiento y los servicios reales requiere un entorno autorizado. El
proyecto denominado `metrogestion-pruebas` es operativo y no se utiliza como
laboratorio para estas pruebas.
