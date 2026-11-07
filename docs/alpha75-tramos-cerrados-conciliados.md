# MG75-TRAMOS-CERRADOS-001: conciliación privada de episodios cerrados

## Estado y alcance

Candidata revisada: instalación del mecanismo y aplicación a un episodio son operaciones separadas. Consultar la bitácora del proyecto para conocer el estado de publicación, instalación y conciliaciones concretas.

Esta candidata permite acreditar deliberadamente un episodio histórico cerrado y corregir únicamente su contexto privado del último tramo. La migración instala el mecanismo; no selecciona ni concilia casos, no resuelve revisiones de identidad y no libera ninguna orden. No contiene identificadores de vehículos operativos.

La identidad correcta de una recepción no demuestra que una propuesta antigua de salida sea correcta. El generador puede seguir utilizando un contexto contaminado o avanzar automáticamente de TANCAMENT aunque el episodio ya esté cerrado. La candidata conserva la propuesta antigua como evidencia **retenida y no aplicada**, corrige el contexto con los valores literales acreditados y establece una retención duradera de ese seguimiento/UUID.

Archivos:

- `supabase/migrations/20261107180728_alpha75_tramos_cerrados_conciliados.sql`.
- `tests/sql/alpha75-tramos-cerrados-conciliados.test.mjs`.

Depende de la migración de identidad `20261107135502_alpha75_sincro_identidad_pa_tramos.sql` y de los contratos exactos del runtime comprobados en el preflight. El cambio de sellos de maestro se revisa por separado.

## Evidencia exigida

La previsualización exige una solicitud privada con diez claves:

| Clave | Contenido |
| --- | --- |
| `protocolo` | `MG75-TRAMOS-CERRADOS-001` |
| `request_id` | Identificador único de la operación deliberada |
| `seguimiento_id`, `sync_id` | Pareja canónica exacta del episodio |
| `fuentes` | Dos referencias `{revision_id, payload_sha256}`: PARADAS y CIERRES completos |
| `id_filas` | Todos los ID_FILA del episodio en el conjunto acreditado de las dos fuentes, sin duplicados |
| `ultimo_id_fila` | Último tramo cerrado, seleccionado explícitamente y comprobado por sus fechas |
| `ejecucion_referencia` | Ejecución existente, correcta, con origen `google_apps_script` |
| `evidencia_operador` | Atestación explícita descrita abajo |
| `motivo` | Justificación de 20 a 2000 caracteres |

Las fuentes acreditadas son las revisiones privadas, sus hashes recalculados, sus payloads completos y las filas contrastadas con la identidad canónica. Se incluyen las revisiones globales de identidad y las revisiones de tramos cuyo productor guarda el bloque PARADAS completo, aunque su `contexto` nombre un UUID. Una nueva revisión elegible del mismo bloque, con otra huella y recepción posterior, invalida la fuente antigua. Una revisión diagnóstica con el mismo contenido no se interpreta como otra fotografía.

Para cada fila relevante se comprueba estado PARADA, ID_FILA entero válido y único dentro del bloque completo, PA/DFM/matrícula concordantes y ausencia de UUID contradictorio. Todas las filas vinculadas del episodio deben existir idénticas en ambos bloques. Una omisión no se oculta mediante la unión de dos fotografías. CIERRES puede aportar filas históricas sin UUID: solo se admiten mediante la coincidencia completa y única de PA/DFM/matrícula, manteniendo vacío el UUID original de la fila en la evidencia. No se escribe ninguna nota en la hoja.

Todos los tramos del episodio deben tener J y K válidas, K igual o posterior a J, Q con formato TANCAMENT, importes no negativos y días enteros. Se rechazan tramos solapados, ID_FILA incompletos, una selección que no sea el último tramo y un sustituto final distinto de la referencia de Hotel. I es fecha programada y J es inicio real del tramo: **J anterior a I es válido**. El mecanismo no recalcula días ni kilómetros a partir del calendario; conserva los valores manuales y distingue P vacío de P igual a cero.

La ficha se selecciona con el orden vigente del generador: pizarra en curso, fecha de pizarra, actualización e ID. Debe estar recuperada o con reserva liberada, retirada del Hotel activo y no cancelada. Archivar una pizarra o cerrar la contabilidad no basta. Una copia posterior reabierta impide conciliar usando una anterior cerrada. No se admiten seguimientos con continuidad de sustitución.

La outbox debe existir para la pareja exacta, estar `retenida_manual`, no tener `confirmado_en` y contener una PARADA, también si incluye trabajos. Una propuesta mixta se conserva íntegra: no se convierte en una orden de solo trabajos ni se acreditan trabajos nuevos por esta operación.

## Referencia de ejecución y ventana atestada

El checksum de una ejecución de recepción puede cubrir cinco feeds. Esta candidata no reconstruye ese checksum con un solo bloque ni infiere un vínculo criptográfico por proximidad de horas. Almacena la ejecución completa como **referencia contextual declarada**, validando su existencia, estado y origen. La acreditación directa de datos procede de las revisiones privadas completas y sus hashes.

`evidencia_operador` debe contener:

- `tipo: "atestacion_sql_privada"`.
- `cliente_sin_ejecucion_pendiente: true` y `cliente_inactivo: true`.
- `barreras_sostenidas: true`.
- `barreras_sostenidas_desde` y `observado_en`, ambas horas UTC explícitas terminadas en `Z`.
- `alcance_fuente_completo_revisado: true`.
- `evidencia_sha256`, huella de la evidencia revisada, y `referencia`, descripción que permita localizarla.

La diferencia entre ambas horas debe ser de al menos 35 segundos y `observado_en` no puede estar en el futuro. Se conserva la atestación completa, junto con el usuario SQL real. Estas comprobaciones validan forma y duración declaradas; **no prueban automáticamente que las barreras o el cliente permanecieran así durante todo el intervalo**.

La autorización actual es una función de lectura con validez de 30 segundos; no existe un registro persistido de concesiones que permita demostrar su ausencia o revocarlas. Por eso el procedimiento requiere acreditar que las barreras de salida permanecieron cerradas y el cliente estuvo quieto durante esa ventana y continúa quieto hasta terminar la operación. Una orden ya autorizada o en ejecución no se cancela por conciliar. Si se desconoce si continúa una ejecución, se debe aclarar su resultado antes de aplicar; no se inventa un ACK ni se declara que no hubo efectos.

No hay `pg_sleep`, espera automática, nuevo canal de revocación ni autorización de cliente añadida. La captura de una recepción sin órdenes sirve como parte de la referencia operativa, no como prueba criptográfica del intervalo.

Una autorización para instalar el esquema no acredita por sí misma que el cliente esté inactivo ni autoriza a inventar esa atestación. Los valores sintéticos del fixture no son evidencia operativa reutilizable. Los casos protegidos y las retenciones de identidad continúan protegidos hasta una decisión específica basada en sus hechos.

## Previsualización y aplicación acotada

Las dos funciones nuevas se invocan solo desde SQL privado:

- `app_private.previsualizar_tramo_cerrado_manteniment_alpha75(jsonb)` devuelve `prevision` y `huella_prevision`. No escribe ni encola.
- `app_private.aplicar_tramo_cerrado_manteniment_alpha75(jsonb)` recibe la misma solicitud y añade `huella_prevision`. Exige una transacción `SERIALIZABLE` y las barreras `solo_lectura_manual_protegida=true`, `escritura_segura_manual=false`.

Secuencia operativa revisable, sin casos preseleccionados:

1. Mantener la salida protegida y acreditar la ventana y el cliente inactivo. Revisar las fuentes completas y los ID_FILA del episodio, su cierre operativo, contexto y propuesta antigua.
2. Obtener la previsualización privada. Examinar identidad, todos los tramos, el último ID_FILA, contexto anterior/aceptado, propuesta mixta, todas las copias de Hotel, entregas/ACK y procedencia. Guardar exactamente la solicitud y la huella revisadas.
3. En una transacción `SERIALIZABLE`, aplicar esa solicitud y huella. La función toma el bloqueo asesor compartido por el protocolo, bloquea configuración y evidencias, contexto y outbox, vuelve a previsualizar y exige igualdad CAS. Cualquier cambio relevante exige revisar de nuevo; no se reintenta ciegamente con una huella nueva.
4. Verificar dentro de la misma transacción el recibo, el contexto exacto y la outbox retenida. Confirmar solo la operación revisada. Un error revierte la operación completa.
5. Mantener la resolución de retenciones de identidad y la autorización de futuras salidas como operaciones distintas, con alcance y evidencia propios. Esta candidata no elimina las retenciones globales ni realiza barridos contables.

La previsualización incluye los registros completos de fuente, contexto, outbox, Hotel/pizarras, entregas y procedencia, además de la atestación y referencia de ejecución. El registro inmutable almacena esa fotografía, su huella CAS y su propia huella de evidencia. Una repetición del `request_id` o del episodio ya conciliado se rechaza: se conserva el recibo existente, no se sustituye ni se reaplica.

Dentro de la aplicación solo se cambian estos campos de `manteniment_parada_sync`:

| Campo | Valor aceptado |
| --- | --- |
| `fecha_programada_parada` | I del último tramo |
| `fecha_inicio_tramo` | J del último tramo |
| `fecha_corte` | K del último tramo |
| `tancament` | Q literal del último tramo |
| `dias_parada_manual` | Días literales o NULL |
| `km_facturables_manual` | Kilómetros literales o NULL |
| `calculo_periodo_automatico` | `false` |
| `actualizado_en` | Hora de la operación |

Permanecen intactos la fecha original de parada, la fila física histórica, el último payload confirmado, la supervisión y su actor/hora, Hotel, etapas T, activaciones, reservas, entregas, ACK, fuentes y contabilidad. La función comprueba que el contexto completo resultante equivale exactamente al aceptado. No se sustituye J del último tramo por la fecha original de Hotel.

En la outbox solo se mantiene `retenida_manual` y se actualizan su hora y motivo, que contiene la huella de conciliación. Payload, revisión, identidad, intentos y confirmaciones se preservan. La propuesta antigua no se borra ni se marca confirmada.

## Retención duradera y seguridad

El registro se inserta antes de actualizar el contexto. Así el trigger real de encolado ya encuentra la retención cuando se ejecuta. El generador devuelve NULL para el episodio conciliado; el predicado de retención existente incorpora esa misma evidencia. Encolado, entrega y nueva autorización quedan bloqueados aunque una operación posterior resuelva las revisiones de identidad.

Los triggers impiden borrar o modificar el registro de evidencia, borrar o cambiar los campos aceptados del contexto y borrar, trasladar, confirmar o reemplazar la outbox. En UPDATE se consultan **OLD y NEW**; cambiar simultáneamente seguimiento y UUID no permite escapar. Una reapertura posterior de Hotel mantiene la retención y exige revisión explícita; esta candidata no añade una vía de desconciliación.

Las funciones nuevas son de invocador, con `search_path` acotado. Se revocan permisos de PUBLIC, anon, authenticated y service_role. La tabla privada tiene RLS y los mismos roles carecen de acceso. No hay RPC público nuevo. Se preservan OID, propietario, ACL, volatilidad y configuración de las funciones existentes modificadas. Los hashes del preflight rechazan un runtime diferente en vez de parchearlo por aproximación.

La inmutabilidad se aplica a las operaciones ordinarias bajo estas guardas; no pretende impedir que un administrador de base con privilegios de DDL modifique deliberadamente la infraestructura. Tampoco sustituye el control operativo del cliente o la revisión de los hechos aportados por el operador.

## Verificación local y límites

Comando ejecutado:

```sh
METROGESTION_SQL_ENGINE=pglite node --test tests/sql/alpha75-tramos-cerrados-conciliados.test.mjs
```

Resultado: **12/12 pruebas SQL pasan en PGlite 0.3.16**, sin fallos ni omisiones. Se ejecutan migraciones y funciones SQL reales sobre tablas sintéticas; el harness conserva sus dobles declarados para autenticación, importación de maestro y trabajos no relacionados. Se incorpora el cuerpo literal del trigger real de encolado del contexto, ausente en el fixture compartido.

Las pruebas cubren instalación sin mutación operativa, privacidad, rollover histórico tipo R1488, días/km no calendarios, P nulo frente a cero, I posterior a J, completitud por T, omisiones y contradicciones entre fuentes, duplicados, solapamientos, CAS de contexto/cola/fuente, fuente superada, copia archivada activa, copia nueva reabierta, reapertura posterior, inmutabilidad y traslado simultáneo de IDs, permanencia de la retención tras resolver identidad, denegación de entrega y autorización, UUID ausente, ambigüedad, barreras y atestación. Se comparan Hotel/T/ACK y demás inventario; los centinelas sintéticos 2556, 2637 y 2731 se conservan.

El intento coordinado de PostgreSQL nativo no pudo crear sockets en este entorno. **No se ha verificado concurrencia real de varias sesiones, contención de bloqueos ni comportamiento SSI nativo.** PGlite no sustituye esa evidencia. Las pruebas tampoco representan una ejecución de Apps Script, escritura en Sheets, validación visual de la aplicación o despliegue. No se ejecutó la conciliación sobre ningún caso operativo ni se abrieron barreras remotas.
