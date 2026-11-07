# ID_FILA permanente de MANTENIMENT

Fecha de adopción: 01/11/2026.

## Regla

La columna **T** de `MANTENIMENT` es la identidad permanente de la fila.

- `T1 = ID_FILA`.
- La numeración inicial se asignó una sola vez sobre la fotografía de trabajo «inicio»: **1…6828**.
- El número no depende de la posición física de la fila.
- Ordenar, filtrar, ocultar o mover una fila no cambia su ID.
- Una fila nueva recibe siempre `ULTIMO_ID_EMITIDO + 1`, independientemente de dónde se inserte.
- Si una fila se elimina, su ID pasa a **BORRADA** en `REGISTRO_FILAS`.
- Un ID BORRADA no puede volver a aparecer ni ser asignado a otra fila.
- El siguiente ID no se calcula con `MAX(T)`; se conserva un contador monotónico en `REGISTRO_FILAS!H2`.
- Si una reserva de ID se interrumpe antes de terminar una alta, ese ID queda consumido como RESERVADA y tampoco se reutiliza.
- Un duplicado, un ID desconocido o la reaparición de un ID BORRADA detienen la conciliación; nunca se renumera automáticamente para ocultar el conflicto.

## Registro técnico

La hoja oculta `REGISTRO_FILAS` conserva:

- ID_FILA
- ESTADO
- FECHA_ASIGNACION
- FECHA_ELIMINACION
- OBSERVACION
- ULTIMO_ID_EMITIDO

Estados previstos:

- `ACTIVA`: ID presente en MANTENIMENT.
- `BORRADA`: la fila dejó de existir.
- `RESERVADA`: ID consumido durante una creación que no llegó a confirmarse.

## Automatización candidata

`alpha75-2026.11.01.2` incorpora:

- asignación inmediata de ID en altas creadas por Metrogestión;
- asignación para PARADA, próximas necesidades y órdenes autorizadas;
- control por `LockService` para evitar dos IDs iguales por concurrencia;
- disparador instalable `metrogestionIdentidadFilasCambio` para altas/bajas estructurales manuales;
- asignación al editar una fila nueva sin ID;
- reconciliación del registro contra la columna T;
- rechazo de duplicados, IDs desconocidos y resurrecciones de IDs borrados.

La instalación de esta candidata en el Apps Script vivo es un paso separado. La numeración inicial y el registro técnico ya existen en la hoja original.

## Sincronización y diagnóstico por T · 07/11/2026

La referencia principal es el número de **ID_FILA en T**. En un ejemplo de
diagnóstico, ID_FILA 6839 puede estar ubicado en la posición 439 y pasar a otra
posición tras ordenar la hoja. Esa ubicación no forma parte de su identidad
ni debe conservarse como dirección permanente.

La candidata `alpha75-2026.11.07.10` incorpora este criterio en la lectura del
snapshot y en la ejecución protegida de órdenes:

- Lee T como valor literal, entero positivo seguro, único y ACTIVA en
  `REGISTRO_FILAS`. Rechaza fórmulas, ausencias, duplicados y referencias no
  acreditadas; esta comprobación no asigna ni renumera IDs.
- Contrasta T antes, durante y después de leer A:T para detectar movimientos
  entre las lecturas de datos. El contenido operativo conservado sigue siendo
  A:Q; R/S no se convierten en campos de negocio.
- Envía `id_fila` como campo separado en ALTA, PARADA, cierres, trabajos y
  pendientes. `fila` conserva el significado de posición física en el snapshot.
- Los avisos identificables muestran primero ID_FILA y DFM. Las referencias de
  un error HTTP se resuelven contra la fotografía enviada, no contra una hoja
  que el usuario haya podido ordenar mientras esperaba la respuesta.
- Incluye el vector T en la huella local de la fotografía y vincula cada
  operación con los IDs de sus filas. Resuelve ID a posición antes de escribir,
  copiar, insertar, ajustar una altura o enlazar una carpeta. Un movimiento
  durante una orden autorizada invalida ese plan; no recoloca sus escrituras
  silenciosamente.
- Las filas nuevas se siguen como inserciones del plan hasta que el asignador
  emite sus IDs mediante el contador existente. Se verifica el resultado antes
  y después de asignar esos IDs; la T de la plantilla no se copia.
- Los recibos anteriores ya confirmados siguen reconocidos. Un recibo aplicado
  anterior sin prueba de T se conserva para revisión y no obtiene un acuse
  automático con evidencia que no existía cuando se aplicó.

### Compatibilidad y alcance

El transporte sigue siendo `alpha75-2026.10.26.1` y la referencia de una orden
sigue siendo `{tipo, sync_id, revision, payload_sha256}`. Los UUID de objetos,
las claves contables, la autorización, los acuses y las barreras de escritura
conservan sus contratos.

La Edge y el SQL instalados aceptan `id_fila` adicional en los cinco feeds.
Actualmente ALTA, PARADA, cierres y trabajos no lo persisten como identidad de
fila en columnas propias. Pendientes conserva el JSON completo, pero aún no
usa T como clave de deduplicación. Esta candidata acredita la identidad local
de las lecturas y las escrituras protegidas; no equivale a una migración de la
identidad canónica del servidor ni de todas las funciones heredadas del script.

La validación incluye movimientos antes y durante la lectura, errores HTTP
referidos a una fotografía anterior, cambios de T durante la autorización y
entre escrituras, creación de IDs en inserciones y tratamiento de recibos
anteriores. Se ejecuta el script distribuido con objetos de Google sintéticos;
estas pruebas no sincronizan ni modifican la hoja original.

La instalación de `.10` se realiza por separado. El auxiliar
`metrogestionComprobarReintentoSoloLectura` puede acreditar después el build y
el estado local sin iniciar una nueva sincronización. Una importación que ya
consta correcta no debe repetirse para instalar esta revisión de código.
