# Alpha74 · base de pruebas

Fecha de creación: 06/09/2026

Estado: **en pruebas**. Alpha73 permanece validada, cerrada y asignada a los usuarios.

Distribución: **no asignada a usuarios**. Alpha74 no sustituirá a Alpha73 sin validación y autorización expresa del usuario responsable.

## Punto de partida

- Copia funcional de Alpha73 en el momento de su cierre.
- Identificador visible actualizado a `r1.0.0-alpha.74.1`.
- Alpha73 no se modifica.

## Reabrir una T realizada

- El administrador principal dispone de «Reabrir T (deshacer realizada)» en las T realizadas de la Pizarra actual.
- La operación exige motivo y dos pulsaciones; la segunda se habilita tras 650 ms y caduca a los 5 segundos.
- La T no se elimina: vuelve a `pendiente` o `programada` y conserva usuario, fecha, motivo y contador de reaperturas.
- Si existe una T posterior realizada, se bloquea la operación y se exige reabrir de la última a la primera.
- Al reabrir una entrada a taller se borra la fecha J de sus trabajos vinculados en la siguiente sincronización.
- Al reabrir una recogida se borra K y se retira el fondo verde A:Q, conservando E azul como vínculo de la actuación.
- Al reabrir la recuperación se borra K de la fila PARADA y la ficha recupera el estado que tenía antes del cierre.
- Los pendientes de reserva resueltos por la T vuelven a la reserva y se cierran otra vez si la T se realiza de nuevo.
- La reversión se transmite por el mismo `sync_id`, sin duplicar PARADA ni líneas de trabajo.
- Las pruebas de entrada, recogida, recuperación y bloqueo por orden se ejecutaron dentro de transacciones con `ROLLBACK`.

## Gestión directa de anotaciones

- «Modificar» abre únicamente el texto de la anotación, sin desbloquear la ficha completa.
- «Eliminar» exige confirmación y retira la línea de la vista sin borrarla físicamente.
- La eliminación deja autor, fecha, motivo y cambio completo en auditoría.
- Ambas operaciones requieren usuario activo, sesión vigente, dispositivo autorizado y permiso de edición de Hotel.
- El servidor comprueba que la ficha sigue activa y que la anotación pertenece al mismo seguimiento.
- El número de versión evita sobrescribir un cambio realizado desde otro dispositivo.
- Las operaciones no modifican registros, T, trabajos, reservas ni ningún otro campo de Hotel.

## Órdenes pendientes de MANTENIMENT

- El Panel muestra al administrador principal el número de órdenes PARADA pendientes y su detalle por vehículo y número de parada.
- Cada línea indica si debe crear o actualizar la fila, la revisión y la última actualización.
- La vista es estrictamente de solo lectura: no confirma, reenvía, cancela ni modifica órdenes.
- La consulta exige usuario activo, sesión Auth vigente, dispositivo autorizado y rol de administrador principal.
- No expone el payload, el token, el identificador de sincronización ni el texto interno de posibles errores.
- Los demás usuarios no ejecutan la consulta ni ven la sección.

## PARADA al asignar número y anulación trazable

- Al asignarse el número de parada se encola inmediatamente una única fila `PARADA`, aunque J siga vacía porque todavía sea una propuesta pendiente de parar.
- La columna I nace con la fecha de propuesta del día en que Metrogestión genera el número; J continúa vacía hasta la parada real.
- La misma fila queda vinculada por `sync_id`; reintentos y cambios actualizan esa fila y no crean duplicados.
- Si una fila histórica aún no tiene `sync_id`, solo se adopta por coincidencia exacta de DFM y número de parada; una coincidencia múltiple se bloquea sin escribir.
- Si la ficha se anula, H cambia a `ANULADA` con fondo rosa pastel y la fila se conserva como histórico.
- Una fila anulada deja de enviar fechas, días, kilómetros o TANCAMENT a Metrogestión.
- La identidad A-E, G y O continúa gobernada y restaurada por Metrogestión.
# Estados Trámite y Gestión en Operativa

- En una ficha del Hotel, abre `2. Situación operativa` y despliega `Estado`: deben aparecer `Trámite` y `Gestión`.
- Guarda una ficha con cada uno de los nuevos estados y vuelve a abrirla: debe conservar el valor elegido.
- En la pizarra del Hotel deben aparecer los filtros `Trámites` y `Gestiones`, cada uno con su contador.
- En `Panel > Operativa ahora` deben aparecer también los contadores `Trámites` y `Gestiones`.
- En Histórico, el estado debe mostrarse con tilde y nombre legible, no como el código interno.

## Refresco estable del Panel

- Deja abierto el Panel durante más de un minuto: debe permanecer visible mientras se actualiza en segundo plano.
- Abre el detalle de uno de sus contadores y déjalo abierto: el refresco automático no debe cerrarlo.
- Si falla una consulta automática, el Panel anterior debe conservarse y mostrar el aviso `No se pudo actualizar · se conserva el Panel`.
- El botón `Actualizar` debe seguir permitiendo una recarga manual completa.

## Reapertura compacta de una T realizada

- Cada T realizada debe mostrar únicamente el botón discreto `Deshacer realizada`.
- Al pulsarlo se despliegan el motivo obligatorio, la preparación y la explicación auditada.
- Al cerrar el desplegable, la T vuelve a ocupar solo el espacio habitual.
- El color rojo se reserva para la confirmación final o los avisos, no para el estado normal de una T realizada.

## Pendientes 30d dentro de T pendientes

- La navegación debe mostrar `T pendientes` en lugar de `T programadas`.
- Dentro de la pestaña deben aparecer `Todas pendientes`, `Pendientes 30d`, `Vencidas`, `Sin fecha` y `En curso`.
- `Pendientes 30d` incluye únicamente unidades R con fecha entre hoy y los próximos 30 días; no mezcla DFM. Las anteriores aparecen en `Vencidas`.
- Los filtros disponibles son `ITV`, `Averías`, `Mantenimientos`, `Extintores`, `Trámites` y `Otros`.
- Una T con varios trabajos de MANTENIMENT aparece una sola vez y conserva el acceso a su ficha completa.
- Las T realizadas o anuladas no aparecen; si una T realizada se reabre, vuelve a entrar automáticamente.

## Trámites y TM sin recogida

- Una necesidad con F=`TM` mantiene una T de entrada con sus trabajos, pero no genera `Recogida taller`.
- `LKT` y `EXTINTOR` se clasifican como `TRÁMITE` aunque F esté rellenada.
- Cada `LKT` o `EXTINTOR` conserva una sola T propia, sin duplicados y sin recogida.
- Al guardar o reconciliar manualmente una ficha, las recogidas excluidas no vuelven a crearse.

## Gestión en Tipo de T

- El selector `Tipo de T` muestra `GESTIÓN` junto a `TRÁMITE`.
- Una T de tipo `GESTIÓN` se puede crear y editar con el guardado habitual.
- `GESTIÓN` no implica entrada en taller ni genera una T de recogida.
