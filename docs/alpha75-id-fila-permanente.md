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
