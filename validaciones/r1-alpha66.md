# r1.0.0-alpha.66 · EN PRUEBAS

Fecha de publicación: 28/08/2026

Estado: PENDIENTE DE VALIDACIÓN DEL USUARIO.

Enlace de prueba:
- https://metrogestion2026-eng.github.io/metrogestion-24h/r1-alpha66/

Punto de partida:
- Parte íntegramente de Alpha65.
- Conserva el cambio de contraseña, las contraseñas temporales y el botón Sugerencias.
- Conserva la recuperación de dispositivos revocados y el límite de un móvil y un ordenador por usuario.
- Conserva la navegación estable entre Hotel y Panel.
- Conserva Usuarios exclusivamente para el administrador principal.
- Conserva la media manual y el precio R reservados al administrador principal.
- Conserva Activar 24H, documentación compartible, creación de fichas, apertura estable de T, tipos editables, buscador y Panel.
- Alpha64 permanece validada, cerrada e inmutable.
- Alpha65 no se modifica.

## Cambio en prueba · fechas visibles en cada ficha

- Cada ficha del Hotel muestra un bloque nativo `Fechas operativas de la ficha`.
- Se muestra siempre la `Fecha de parada`.
- Se muestra la T que sirve de referencia operativa y la fecha vinculada a ella.
- Cuando existe una T en estado `en_curso`, aparece como `T en ejecución` con su fecha de inicio.
- Cuando no existe una T marcada `en_curso`, aparece la última T realmente ejecutada, que representa el punto operativo actual de la ficha.
- Si todavía no se ha ejecutado ninguna T, aparece la próxima T programada o pendiente con su fecha prevista.
- Una fecha ausente queda señalada como `Sin registrar`; no se sustituye silenciosamente por otra fecha.
- El mismo bloque aparece en Hotel activo y en las fichas del Histórico.

## Cambio en prueba · sustitución y facturación

- El bloque `Sustitución / facturación` forma parte nativa de la ficha.
- Muestra en primer lugar `Días totales desde parada`.
- Muestra separadamente `Días del periodo actual`.
- El periodo se obtiene de `cierres_facturacion`; no se confunde con el mes natural.
- Se muestran el código y las fechas de inicio y cierre del periodo.
- También se muestra el tramo exacto de la parada que pertenece al periodo.
- Los días se calculan de forma inclusiva: cuentan el día inicial y el día final.
- En Histórico, el cálculo se limita a la fecha de la pizarra consultada y muestra los días del periodo correspondiente a esa ficha histórica.
- Para DFM se conservan la media utilizada, los kilómetros del periodo y los kilómetros totales.
- Para R se conserva la facturación fija de una unidad, su precio y el importe, y se muestran los días como control operativo.
- Las fichas sin sustituto continúan mostrando los días y quedan identificadas como `Sin sustituto`.

## Integración sin doble control

- Alpha66 utiliza sus propios componentes de ficha de Hotel e Histórico.
- El componente nativo se construye antes de mostrar la tarjeta; no se añade después mediante un observador visual.
- Se bloquea el enriquecedor antiguo de Alpha30/Alpha31 para que no existan dos cálculos ni dos bloques de facturación compitiendo.
- El administrador principal conserva dentro del componente nativo la edición de la media manual y la vuelta a CTM.
- Los usuarios normales ven los cálculos en modo lectura y no reciben controles para guardar una media manual.
- Al guardar o restaurar una media, el mismo bloque se recalcula sin desaparecer de la ficha.

## Referencia de comprobación

- Una parada iniciada el 24/08/2026 y consultada el 28/08/2026 muestra 5 días totales.
- Como el periodo 2026-09 empieza el 25/08/2026, esa misma parada muestra 4 días dentro del periodo actual.
- Esta diferencia confirma que `total desde parada` y `días del periodo` son dos datos distintos.

Alpha66 no se declarará validada ni cerrada hasta recibir confirmación expresa del usuario.
