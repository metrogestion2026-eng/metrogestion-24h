# Alpha75.25 · ejecución acotada de órdenes de sincronización

29/10/2026 · ampliación de compatibilidad 31/10/2026 ·
**MG75-EJECUCION-ORDEN-001** · candidata de la PR #90.

## Alcance aprobado

Esta corrección continúa la sincronización de **75.25**. El entorno operativo
de referencia es `metrogestion-pruebas`; el laboratorio del PC corresponde a
80. Preparar ese laboratorio no es un requisito de esta corrección.

Se conserva la protección de las entradas manuales y de las identidades de
PARADA y T. Una ambigüedad requiere revisión: el ejecutor no decide que dos
números de parada diferentes son equivalentes ni crea otra fila para eludir
una posible coincidencia manual. La selección de órdenes no recorta la
fotografía de MANTENIMENT que recibe el servidor.

## Defectos reproducidos en la candidata anterior

El Apps Script anterior podía cerrar la K de un periodo anterior antes de
descubrir un conflicto en la misma orden. También admitía el fallback DFM/PA
sobre una fila con otro UUID, daba por válida la primera T con un UUID sin
comprobar toda su identidad y podía ignorar UUID repetidos en el payload.

Además, una cola guardada con la misma versión de script se reanudaba sin
consultar de nuevo al servidor. Limitar el lote a una orden reducía su tamaño,
pero no fijaba qué identidad, revisión y payload podían ejecutarse. Una
interrupción después del primer efecto podía dejar una escritura parcial y
permitir repetirla al arrancar de nuevo.

La suite adversarial ejecuta el archivo `.gs` distribuido completo. Sustituye
únicamente las plataformas Sheets, Drive, Properties y HTTP por objetos
sintéticos observables; no reemplaza el escritor, el selector o el planificador
del producto. La reproducción anterior se conserva separada de la verificación
de la corrección.

## Protocolo de una orden

La unidad de validación y de confirmación es una orden. Si una primera orden
ya está confirmada y la segunda se rechaza, la primera permanece confirmada.
No se promete rollback de un lote entero.

1. Una selección manual y finita fija `tipo`, `sync_id`, `revision` y
   `payload_sha256`. No hay selección automática de toda la cola ni ampliación
   automática a una revisión posterior.
2. El cliente obtiene una fotografía de la hoja y construye en memoria el
   plan completo de la orden. Comprueba identidades, duplicados, contenido
   manual, periodo anterior, trabajos y dependencias de Drive antes de escribir.
3. El servidor resuelve una autorización fresca para esa referencia exacta,
   su payload completo, la hoja, el cliente, la selección y un `request_id`
   nuevo. La autorización sólo sirve para ese intento y caduca en 30 segundos.
4. El cliente vuelve a comprobar la fotografía antes de aplicar el plan.
   Persiste la intención de aplicación antes del primer efecto externo.
5. Después de aplicar, vacía las escrituras pendientes y comprueba el resultado
   leído. Conserva un recibo que permite distinguir lo aplicado de lo incierto.
6. La confirmación usa el recibo exacto. Si se pierde su respuesta, el siguiente
   intento repite únicamente el acuse; no vuelve a escribir la orden en la hoja.

La entrega y la selección tienen ciclos distintos. La respuesta íntegra del
servidor se conserva antes de elegir qué órdenes ejecutar: las no seleccionadas
permanecen disponibles para una selección explícita posterior. Es necesario
porque la barrera sólo entrega PARADA una vez por revisión. Una nueva selección
no exige volver a entregar la misma orden ni supone que pueda ejecutarse sin
una autorización actual. Una respuesta de entrega perdida antes de conservarla
sigue requiriendo reconciliación; la autorización no la reconstruye ni fuerza
otra entrega.

Antes de solicitar una entrega se guarda su referencia local. Si no llega a
conservarse una respuesta íntegra verificable, esa marca impide iniciar nuevas
solicitudes, incluso cuando queden otras entregas antiguas disponibles. Un
manifiesto completo de la misma solicitud permite cerrar únicamente la marca
local que faltaba. Si todas las referencias seleccionadas ya están confirmadas,
volver a iniciar ese alcance no solicita sincronización ni consume entregas
nuevas.

El transporte anterior denomina `parada` también a sobres exclusivamente de
trabajos. La nueva salida del servidor normaliza su tipo exterior para la
referencia de ejecución y conserva íntegros el payload, su huella y el orden
de las entregas. El cliente deriva una identidad inequívoca de los trabajos
cuando falta en la raíz del sobre; ese dato de planificación se mantiene fuera
del payload autorizado.

Una validación rechazada antes de aplicar deja la hoja intacta. Un fallo a
partir de la intención de aplicación se trata conservadoramente como resultado
incierto. Ese bloqueo sobrevive a otra ejecución y a un reinicio ordinario del
ciclo. No se inventa un recibo para colas o acuses antiguos que carezcan de la
nueva evidencia.

El ciclo acotado no materializa IMPORTRANGE ni ejecuta la preparación de
necesidades como efecto previo a la autorización. Las fórmulas que no pueden
acreditarse de forma segura al insertar o copiar filas requieren revisión;
el planificador no simula el motor de cálculo de Google Sheets.

## Comprobación del servidor

Se conserva `version_script = alpha75-2026.10.26.1` como versión del transporte
existente y se incorpora una capacidad obligatoria distinta:
`version_ejecucion = MG75-EJECUCION-ORDEN-001`. La recepción de sincronización
exige esa capacidad antes de entrar en el receptor que produce efectos. La
guarda se instala tanto en Edge como en el wrapper SQL.

La autorización es una función de lectura. Comprueba la autenticación actual,
la configuración de protección, la compatibilidad acreditada por preflight y
las huellas del wrapper, receptor, guarda de capacidad y normalizador de
entregas, la hoja, la versión,
la selección y la orden pendiente en outbox y entregas. La
igualdad del payload se valida también como JSONB contra los datos guardados;
una huella aportada por el cliente no sustituye esa comparación.

La huella de entrega es una referencia opaca calculada por el servidor. El
transporte JSON puede representar `300.00` como `300`; la igualdad JSONB permite
esa equivalencia sin admitir otro importe. No se vuelve a calcular la huella
sobre la representación que reconstruye JavaScript.

Para autorizar ejecución, el servidor exige expresamente:

| Configuración | Valor requerido para ejecutar |
| --- | --- |
| `solo_lectura_manual_protegida` | `false` |
| `escritura_segura_manual` | `true` |
| `pausa_importacion_identidad` | `false` |

La migración no cambia esos valores. La lectura operativa del 29/10/2026 a las
19:29:38 de Madrid seguía mostrando `true / false / true`; por tanto, la
autorización debe denegar ejecución en ese estado.

El acuse estricto es una operación diferente y sí escribe la confirmación.
Comprueba la referencia y huella de la entrega, delega en el confirmador
existente dentro de la misma transacción y comprueba la confirmación resultante
antes de devolver éxito. Repetir un acuse ya confirmado no confirma una
revisión nueva de la misma orden. La recuperación de un acuse pendiente no
exige volver a autorizar una escritura que ya se aplicó.

Si se vuelve a cerrar la pausa, una entrega sin confirmar queda retenida por
la semántica del confirmador existente y no recibe un éxito falso. Una entrega
ya confirmada admite la lectura de su acuse idéntico sin cambiar colas ni
fechas, incluso con la pausa cerrada. En ambos casos el cliente conserva el
recibo y no repite la escritura en Sheets.

El `request_id` del acuse vincula petición y respuesta. No constituye un
registro de autorizaciones persistido por el servidor: la autorización no
escribe uno. El diario local y la entrega inmutable son las evidencias usadas
por las dos partes para esta recuperación.

## Persistencia y límites reales

Una hoja de Google y PostgreSQL no comparten una transacción. La autorización
de lectura tampoco es un bloqueo remoto durante 30 segundos. Puede cambiar el
servidor entre su lectura y la escritura en Sheets; puede intervenir un editor
humano después de la última comparación de la hoja. La protección detecta los
cambios observables y detiene las repeticiones inciertas, pero no acredita una
exclusión absoluta de esas carreras.

`LockService` limita ejecuciones del script, no las ediciones nativas de otras
personas. La documentación de Google también advierte de la intervención de
colaboradores incluso en un `batchUpdate` atómico. Esta candidata no introduce
el servicio avanzado de Sheets ni presenta su simulador como ese servicio.

El estado duradero tiene límites de tamaño y tiempo. La implementación debe
rechazar un estado que no pueda conservar antes de iniciar efectos; no debe
continuar sin diario. Se mantienen separados el ciclo transportado y la
evidencia necesaria para impedir una repetición incierta.

El recibo previsto se limita a 8 KB y se comprueba antes de autorizar. Las
entregas completas se comprimen y se conservan mediante partes y manifiesto
con huella. Si la respuesta excede el espacio disponible o se interrumpe su
persistencia, se conserva la incertidumbre de entrega. No se eliminan
automáticamente recibos o entregas anteriores para ganar espacio; una eventual
retención o limpieza requiere preservar su evidencia y no forma parte de esta
candidata.

Una versión antigua del script con una cola local todavía podría escribir sin
contactar al servidor. La instalación futura requiere detener sus ejecuciones
y revisar sus colas y acuses antes de activar la versión nueva. Una guarda de
servidor por sí sola no revoca una escritura local que nunca le consulta.

## Contraste histórico y aceptación

El ensayo preservado del 27/10/2026 contiene siete órdenes y una captura
histórica. Sus conflictos manuales son casos que deben rechazarse antes de
escribir, no datos que esta corrección deba modificar para conseguir una prueba
verde. El registro manual indicado por Metro permanece fuera de cualquier
rectificación automática.

La nueva comprobación usa una copia privada; el repositorio sólo contiene
fixtures sintéticos. La captura no acredita el estado actual de la hoja ni
incluye el código fuente del simulador original. La cobertura de metadatos
completos se limita a las filas enriquecidas de aquel ensayo, y el simulador
nuevo no calcula fórmulas de Google ni prueba permisos o servicios reales.

El contraste conserva las 6.821 filas capturadas y acredita metadatos completos
en las 532 filas de los siete DFM seleccionados. Las siete órdenes se rechazan
por contenido manual, identidad ambigua o cronología incoherente antes de
modificar Sheets o Drive y antes de pedir autorización o acuse. Se compara la
fotografía sintética anterior y posterior de cada caso. La prueba informa del
primer rechazo: que una guarda nueva detecte antes otro conflicto no resuelve
las observaciones previas del ensayo. Tampoco constituye un ciclo completo
de sincronización, una certificación de idempotencia o una aceptación operativa.

La candidata conserva las migraciones anteriores sin modificarlas y añade
`20261029184748_alpha75_autorizar_ejecucion_manteniment.sql`.
La PR continúa en borrador: implementación, ensayos y documentación no equivalen
a instalación, publicación o apertura de sincronización.

Antes de una instalación autorizada deben revisarse juntas la migración, Edge,
Apps Script, las colas anteriores y la selección concreta de aceptación. Las
ambigüedades manuales que sigan abiertas mantienen bloqueadas sus órdenes.

## Evidencia de esta ampliación

| Capa | Resultado y alcance |
| --- | --- |
| Ejecutor completo | 75 casos: 58 adversariales y 17 de cliente, persistencia, selección y compatibilidad; incluye reconstrucción GZIP y recuperación de dos selecciones tras reiniciar. |
| Paradas externas | 24 casos; se conservan los 11 de Alpha76 y se verifican los de Alpha75 por el nuevo ejecutor, incluidos enlaces Drive inequívocos entre carpetas duplicadas. |
| Edge | 51 casos nuevos; la colección de seguridad completa suma 263 casos, incluidos los 73 anteriores de preflight y compatibilidad. |
| PostgreSQL 17 | 13 escenarios nuevos de autorización, instalación y acuse. |
| Contrato GS → Edge → PostgreSQL | Dos escenarios nuevos: sobres reales de creación/asignación de trabajos y dos entregas ejecutadas en selecciones separadas, con reinicio de VM y sin redelivery. |
| Contraste privado histórico | Siete órdenes rechazadas antes de efectos; 6.821 filas preservadas en la copia. No es un ciclo operativo. |

Las pruebas de contrato ejecutan el `.gs` completo, el handler Edge distribuido
y las funciones SQL instaladas en una base sintética local. La interfaz RPC
del SDK se conecta a PostgreSQL mediante un puente de ensayo; no certifica
Supabase Auth, PostgREST ni permisos Google. Sheets, Drive y Properties son
plataformas sintéticas. Los positivos impiden confundir un cierre global del
ejecutor con una corrección funcional.

La CI incorpora las suites nuevas junto a los gates anteriores. Los 58
escenarios nativos previos más los 15 de esta ampliación suman **73**. Los
22 recorridos de navegador y cinco de arranque/caché conservan su alcance
anterior; no se les atribuye validación de Apps Script ni de hojas remotas.

El contraste privado histórico se realizó sobre la fuente de Apps Script
`a5df66e61012142ec3fca80a7f11b49b91a270b7cc6ae87d96cd64f900c68439`.
La ampliación del 31/10 declara el MIME GZIP al recuperar la bandeja y añade
su regresión automatizada; no atribuye una repetición de aquel ensayo privado
ni una ejecución real en Google a la fuente nueva.

Huellas de los archivos de producto revisados en la candidata actual:

```text
Apps Script  c6709796b8147ce3e00547ef0ac5347f234139413206d8d7a46ffba10f49c861
Edge         8b0aebf6dc039e836ff44331a230a4978b703430326d059336eb2b41a4147c67
Migración    d63ab18eccd47d8feb66db7ca243a96f00555c417f9c3c640382fda930417944
```

## Referencias

- [Instalación coordinada y primera recepción](alpha75-instalacion-sincronizacion-001.md).
- [Estado general de la candidata](alpha75-paradas-separadas-002.md).
- [Editor y fechas exactas](alpha75-editor-fechas-exactas-001.md).
- [Planificación, bandeja y journal de Apps Script](alpha75-ejecutor-cliente-001.md).
- [Pruebas adversariales del ejecutor](../tests/alpha75-sync-executor-adversarial.test.mjs).
- [Plataformas sintéticas del ejecutor](../tests/helpers/alpha75-sync-executor-harness.mjs).
- [Contrato SQL y Edge del ejecutor](../tests/sql/README-native-sync-execution.md).
- [Google Sheets: garantías de batchUpdate](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets/batchUpdate).
- [Apps Script: LockService](https://developers.google.com/apps-script/reference/lock/lock-service).
- [Apps Script: cuotas y límites](https://developers.google.com/apps-script/guides/services/quotas).
