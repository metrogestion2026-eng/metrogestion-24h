# Alpha75.25 · ejecutor acotado de órdenes en Apps Script

Fecha: 29 de octubre de 2026. Documento técnico complementario de [la guía del hito](alpha75-ejecucion-sincronizacion-001.md).

Esta candidata modifica el ejecutor de Alpha75 y sus pruebas aisladas. La implementación y las verificaciones descritas aquí no despliegan Apps Script, no abren barreras de sincronización y no aplican órdenes a Google Sheets o Drive operativos. Alpha76 conserva su producto y sus once recorridos anteriores del gate de vehículos externos.

## Contrato y selección

| Elemento | Valor o regla |
| --- | --- |
| Versión de script conservada | `alpha75-2026.10.26.1` |
| Capacidad nueva | `MG75-EJECUCION-ORDEN-001` |
| Autorización | Acción `authorize`, protocolo `manteniment-ejecucion-v1` |
| Acuse nuevo | Acción `ack_execution`, protocolo `manteniment-acuse-ejecucion-v1` |
| Referencia exacta | `tipo`, `sync_id`, `revision`, `payload_sha256` |
| Tipos admitidos | `parada` y `trabajos` |
| Selección | Entre 1 y 200 referencias, introducidas manualmente y persistidas |

La selección es un límite local de ejecución. No es un permiso de escritura ni una apertura de barreras. Una revisión o huella nueva no hereda la selección de una anterior. No se selecciona automáticamente toda la cola recibida.

El menú **Seleccionar alcance exacto de órdenes** llama a `metrogestionSeleccionarAlcanceOrdenes()`. La validación y persistencia están en `metrogestionGuardarAlcanceOrdenes_(refs)`; la lectura estricta, en `metrogestionLeerAlcanceOrdenes_()`. No se puede sustituir el alcance de un ciclo pendiente ni seleccionar otro mientras exista un journal sin resolver.

La huella de payload procede del servidor y se conserva literalmente. No se sustituye por `SHA256(JSON.stringify(payload))`: la serialización canónica de PostgreSQL es distinta. Las huellas locales del plan y de la fotografía tienen otros campos y otros fines. Una cola legada sin la entrega y huella nuevas queda bloqueada para revisión.

## Recepción completa y bandeja durable

`metrogestionSolicitarCiclo_` mantiene completas las fotografías de activos, paradas, cierres de facturación, trabajos y pendientes. La selección no recorta ninguna de esas listas ni cambia el checksum de la fotografía. La nueva capacidad acompaña al payload de sincronización.

Antes de pedir una entrega se publica `METROGESTION_SOLICITUD_ENTREGA_V1`, con una referencia local de solicitud. Una respuesta correcta se conserva **íntegra**, antes de validar las órdenes o filtrar por la selección. La bandeja usa claves `METROGESTION_ENTREGA_V1:<UUID>`, partes comprimidas y una cabecera con huella. La cabecera se publica después de escribir todas las partes.

Esta retención es necesaria porque una revisión PARADA puede entregarse sólo una vez. Las órdenes recibidas y no seleccionadas permanecen disponibles para una selección posterior. También se conservan si falta en la respuesta una referencia que sí se había seleccionado. No se avanza ni se amplía el alcance por esa ausencia.

Cuando la bandeja ya contiene todas las referencias seleccionadas, un nuevo ciclo puede formarse desde ella sin repetir `sync`. Cada orden conserva su requisito de autorización actual antes de aplicarse. Si todas las referencias ya están confirmadas, comenzar de nuevo no consume entregas ajenas ni vuelve a escribirlas.

Si se pierde una respuesta o falla su persistencia antes de publicar una cabecera verificable, la solicitud queda incierta. El cliente no fuerza otra entrega ni vuelve a llamar a `sync` automáticamente. Si la cabecera íntegra ya estaba publicada y sólo faltaba cerrar la marca de solicitud, la respuesta se recupera de la bandeja.

## Una orden completa antes del primer efecto

La entrada de aplicación es `metrogestionProcesarOrdenesLote_`. Su secuencia es:

1. Comprobar la capacidad del ciclo, el alcance persistido y los journals existentes.
2. Leer la fotografía actual completa de las columnas operativas A:Q y los metadatos que usa el plan.
3. Ejecutar las reglas de la orden sobre una hoja en memoria mediante `metrogestionPlanificarOrdenCompleta_`.
4. Resolver toda su identidad y todos sus conflictos, incluidos el cierre anterior, la PARADA destino, las T, las notas y los enlaces de archivo.
5. Calcular el tamaño del recibo final previsto, incluidos los arrays de trabajos y una reserva para las referencias Drive.
6. Pedir `authorize` para esa referencia y payload originales, con un nonce nuevo.
7. Validar estrictamente protocolo, versiones, nonce, hoja, alcance, referencia, motivo y vigencia. Volver a leer hoja, plantilla y archivo Drive para descartar un plan que haya cambiado.
8. Guardar y releer el intento durable `aplicando`, antes incluso de suspender el filtro.
9. Aplicar las operaciones planificadas, restaurar el filtro y comprobar por lectura posterior el resultado.
10. Persistir el recibo `aplicado`, pedir el acuse exacto y sólo entonces avanzar la cola.

La función anterior `metrogestionAplicarComandos_` sólo acepta la hoja en memoria del plan. Las rutas de sincronización no la invocan sobre una hoja real.

Durante la planificación no se materializan `IMPORTRANGE`, no se suspenden filtros, no se insertan filas y no se crean carpetas. Tampoco se ejecuta la fase automática de próximas necesidades desde este alcance de órdenes. Un ciclo legado en esa fase conserva su referencia y se bloquea.

Un lote no es una transacción de varias órdenes. Si la primera ya se verificó y confirmó, un rechazo de la segunda conserva la primera confirmada. La segunda se rechaza antes de sus propios efectos.

## Identidad y datos manuales

La nota UUID no basta para acreditar una fila: debe concordar con su DFM, PA y clase de fila. Una nota copiada a otro vehículo o trabajo, varias notas técnicas en la misma celda o UUID duplicados no autorizan elegir la primera coincidencia.

El fallback por DFM/PA tampoco puede sustituir un UUID ajeno. El cierre del periodo anterior exige identidad compatible y un único tramo acreditado. La búsqueda de la PARADA destino considera el periodo antes de reutilizar una coincidencia única de DFM/PA.

Una PARADA manual del mismo DFM y fecha con `P-…` o una `PA-…` distinta obliga a revisar la identidad. El ejecutor no deduce una equivalencia ni inserta otra fila para sortear la ambigüedad.

Los trabajos nuevos o asignados se validan conjuntamente. Se rechazan UUID repetidos, identidad extranjera, asignaciones sin una fila actual inequívoca, fechas inexistentes y salidas anteriores a las entradas. Las filas existentes sólo completan huecos admitidos; los datos manuales incompatibles y las notas que no puedan conservarse sin conflicto detienen el plan completo.

### Sobre puro de trabajos

La entrega nueva normaliza su tipo exterior a `trabajos`. El payload puro admite únicamente:

```text
sync_id, seguimiento_id, numero_parada, solo_trabajos,
trabajos_asignados, trabajos_crear
```

No contiene DFM en la raíz. Para planificar, el cliente exige un DFM único y coherente entre todos los trabajos nuevos y todas las claves de los trabajos asignados. Ese DFM sólo se añade a una copia en memoria. `authorize` recibe exactamente el payload entregado y su huella original. Un sobre mixto con campos PARADA se rechaza.

## Archivo Drive

La fase de lectura resuelve los metadatos de la ruta de archivo del DFM, incluida la ubicación de intercambio. No crea carpetas para intentar completar una validación.

Una carpeta PARADA única puede reutilizarse. Si existen varias carpetas canónicas del mismo DFM/PA, un enlace existente puede acreditar inequívocamente una de ellas. Se conserva esa selección en planificación, revalidación y lectura posterior. Si los enlaces apuntan a varias candidatas canónicas distintas, o no permiten elegir entre candidatas duplicadas, la orden se bloquea antes de escribir. Tampoco se elige arbitrariamente un directorio `PARADAS` duplicado para crear una PA nueva.

Las T de un sobre puro protegido conservan sus enlaces de archivo: esa ruta no reorganiza Drive. La prueba positiva histórica de intercambio sigue comprobando esta conservación.

Un fallo al crear una carpeta o escribir un enlace después de comenzar la aplicación puede dejar efectos parciales. El journal conserva la referencia de la orden y las rutas previstas; el siguiente intento no crea otra carpeta ni repite el trabajo automáticamente.

## Journal y recuperación

El journal usa `METROGESTION_ORDEN_V1:<huella de referencia>`. Está separado del estado `METROGESTION_CICLO`. Guardar, terminar o reemplazar un ciclo normal no borra este journal ni la bandeja de entregas.

| Estado durable | Evidencia disponible | Comportamiento de un reintento |
| --- | --- | --- |
| Sin registro | Ningún intento durable de esa referencia | Planificar de nuevo y pedir otra autorización |
| `aplicando` | Referencia y plan persistidos; terminación no acreditada | Bloquear mutaciones y acuse; requiere revisión |
| `incierto` | Fallo durante efectos, restauración o lectura posterior | Bloquear mutaciones y acuse; conserva referencia |
| `aplicado` | Lectura posterior y confirmación canónica persistidas | Releer el resultado y repetir únicamente el acuse |
| `confirmado` | Servidor confirmó la referencia exacta | Avanzar la cola si faltaba ese paso; no repetir escritura ni acuse |

Un recibo legado `confirmacionPendiente` sin el nuevo journal verificable no habilita aplicación ni ACK. Tampoco se declara aplicada una orden sólo porque exista una fila parecida.

El ACK nuevo contiene la confirmación canónica durable y la huella de payload. Sus reintentos mantienen ese objeto idéntico y cambian el nonce de transporte. El cliente exige la respuesta correlacionada con nonce, hoja y referencia. Un `ok: true` legado o un acuse de otra orden conserva el recibo pendiente y no hace avanzar la cola.

El nonce correlaciona la respuesta; no convierte el journal cliente en un permiso persistido en el servidor. No se guarda ninguna autorización reutilizable. La autorización autoriza el comienzo de la orden durante su ventana de 30 segundos; el acuse acredita una aplicación ya verificada.

Si la fotografía completa cambia después de un recibo `aplicado`, incluso en otra celda de A:Q, el ACK automático se detiene para revisión. Esta decisión conservadora evita confirmar un resultado que ya no pueda acreditarse mediante el recibo disponible.

## Fotografías, fórmulas y límites reales

La huella previa incluye valores efectivos, display, fórmulas R1C1, notas, fondos, formatos numéricos, enlaces, validaciones y criterios del filtro. Una fórmula cuyo resultado cambia durante `authorize` invalida el plan aunque su texto siga igual. Las alturas de las filas utilizadas como plantilla se revalidan por separado.

La lectura posterior comprueba datos y metadatos previstos, filtro restaurado, alturas copiadas y carpetas resultantes. Para las fórmulas se comprueba la expresión R1C1, permitiendo el recálculo nativo de Google. Una inserción con referencias de fórmula entre filas que el plan no pueda acreditar falla antes de escribir; se admiten las referencias de la misma fila o de cabecera. Las fórmulas matriciales y las importaciones de A:Q no se materializan para forzar el paso. La copia de plantilla continúa limitada a A:Q, dejando R/S a su cálculo nativo.

Hay límites que estas comprobaciones no eliminan:

- **No existe una transacción conjunta Google Sheets/Drive.** Una excepción tras el primer efecto puede dejar cambios parciales. Se conserva la incertidumbre y no se promete rollback.
- **ScriptLock no bloquea a un colaborador que edita la hoja.** Entre la última lectura y una escritura existe una ventana de concurrencia. No hay CAS contra la edición nativa; una verificación posterior tampoco prueba por sí sola que ninguna edición intermedia haya sido sobrescrita. Un ensayo operativo necesitará una ventana de edición coordinada.
- **La autorización es una lectura actual del servidor.** No crea un bloqueo distribuido de la hoja ni una reserva irrevocable frente a cambios posteriores del backend.
- **La persistencia tiene cuotas.** El cliente limita cada recibo a 8 KB y verifica la intención durable antes del primer efecto. El almacenamiento global o las llamadas posteriores pueden agotarse; en ese caso el estado conservado exige revisión. No se borran automáticamente journals inciertos ni entregas pendientes para liberar espacio.
- **Las pruebas de Google usan una plataforma sintética con efectos observables.** Acreditan las decisiones y el protocolo del ejecutor, pero no sustituyen una prueba controlada de latencia, cuotas, permisos y fórmulas en Apps Script real. Ese ensayo no se ha ejecutado sobre la hoja operativa.

Referencias oficiales consultadas:

- [LockService](https://developers.google.com/apps-script/reference/lock/lock-service): alcance de los bloqueos entre ejecuciones del script.
- [Sheets batchUpdate](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets/batchUpdate): efectos de la colaboración sobre el estado final de una hoja.
- [Range](https://developers.google.com/apps-script/reference/spreadsheet/range): lectura y escritura de fórmulas, notas, formatos y texto enriquecido.
- [FilterCriteria](https://developers.google.com/apps-script/reference/spreadsheet/filter-criteria): getters nativos de criterios y colores usados en la huella del filtro.
- [Cuotas de Apps Script](https://developers.google.com/apps-script/guides/services/quotas): 9 KB por valor y 500 KB por almacén de propiedades en la documentación consultada; Google puede cambiar estos límites.

## Evidencia automatizada del cliente

| Suite | Evidencia principal |
| --- | --- |
| `tests/alpha75-sync-executor-adversarial.test.mjs` | 58 casos: identidad completa, conflictos tardíos, positivos de PARADA/T/rollover, autorización por orden, alcance exacto, fallos de red, incertidumbre durable, bandeja y rutas públicas |
| `tests/alpha75-sync-executor-client.test.mjs` | 16 casos: 200 referencias, publicación de selección interrumpida, fotos completas, fechas de trabajo nuevo, claves JSONB, color nativo de filtro, persistencia, Drive parcial, lectura posterior y ACK estricto |
| `tests/alpha75-paradas-externas.test.mjs` | 24 casos: once históricos Alpha76 intactos, once Alpha75 por el ejecutor nuevo y dos sobre archivo canónico acreditado o contradictorio |
| `tests/security-alpha75-preflight-client.test.mjs` | Once casos del diagnóstico independiente de solo lectura, conservado sin iniciar sincronización |

Las suites ejecutan el GS distribuido. El harness reemplaza únicamente plataformas de Google y HTTP por un estado sintético observable; no sustituye los validadores, planificadores o escritores del producto en los recorridos nuevos de Alpha75.

La guía del hito registra además las pruebas de PostgreSQL y del puente SQL→Edge→GS, sus revisiones y el estado de CI. Esta nota no registra datos operativos, claves ni payloads recuperados de la hoja real.
