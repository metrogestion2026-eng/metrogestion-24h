# Alpha74 · base de pruebas

Fecha de creación: 06/09/2026

Estado: **en pruebas**. Alpha73 permanece validada, cerrada y asignada a los usuarios.

Distribución: **no asignada a usuarios**. Alpha74 no sustituirá a Alpha73 sin validación y autorización expresa del usuario responsable.

## Punto de partida

- Copia funcional de Alpha73 en el momento de su cierre.
- Identificador visible actualizado a `r1.0.0-alpha.74`.
- Alpha73 no se modifica.

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
