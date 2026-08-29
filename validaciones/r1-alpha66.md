# r1.0.0-alpha.66 · VALIDADA Y CERRADA

Fecha de publicación: 28/08/2026

Fecha de validación: 29/08/2026

Estado: VALIDADA POR EL USUARIO Y CERRADA.

Enlace histórico:
- https://metrogestion2026-eng.github.io/metrogestion-24h/r1-alpha66/

## Reglas de cierre

- La carpeta `r1-alpha66` queda inmutable.
- No se modificará ni se sobrescribirá su código.
- Cualquier corrección o mejora posterior se realizará en una versión nueva.
- Alpha67 y todas las versiones siguientes deberán conservar todas las funciones validadas de Alpha66.
- Alpha64 permanece validada, cerrada e inmutable.
- Alpha65 no se modifica ni se reabre.

## Base conservada

- Parte íntegramente de Alpha65.
- Conserva el cambio de contraseña, las contraseñas temporales y el botón Sugerencias.
- Conserva la recuperación de dispositivos revocados y el límite de un móvil y un ordenador por usuario.
- Conserva la navegación estable entre Hotel y Panel.
- Conserva Usuarios exclusivamente para el administrador principal.
- Conserva la media manual y el precio R reservados al administrador principal.
- Conserva Activar 24H, documentación compartible, creación de fichas, apertura estable de T, tipos editables, buscador y Panel.

## Bloque validado · fechas visibles en cada ficha

- Cada ficha del Hotel muestra el bloque nativo `Fechas operativas de la ficha`.
- Se muestra siempre la `Fecha de parada`.
- Se muestra la T que sirve de referencia operativa y la fecha vinculada a ella.
- Cuando existe una T en estado `en_curso`, aparece como `T en ejecución` con su fecha de inicio.
- Cuando no existe una T marcada `en_curso`, aparece la última T realmente ejecutada, que representa el punto operativo actual de la ficha.
- Si todavía no se ha ejecutado ninguna T, aparece la próxima T programada o pendiente con su fecha prevista.
- Una fecha ausente queda señalada como `Sin registrar`; no se sustituye silenciosamente por otra fecha.
- El mismo bloque aparece en Hotel activo y en las fichas del Histórico.

## Bloque validado · sustitución y facturación

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
- Los valores sin media o precio no se presentan como cero: quedan identificados como pendientes o sin dato.

## Integración validada

- Alpha66 utiliza sus propios componentes de ficha de Hotel e Histórico.
- El componente nativo se construye antes de mostrar la tarjeta; no se añade después mediante un observador visual.
- El enriquecedor antiguo de Alpha30/Alpha31 queda bloqueado para que no existan dos cálculos ni dos bloques de facturación compitiendo.
- El administrador principal conserva dentro del componente nativo la edición de la media manual y la vuelta a CTM.
- Los usuarios normales ven los cálculos en modo lectura y no reciben controles para guardar una media manual.
- Al guardar o restaurar una media, el mismo bloque se recalcula sin desaparecer de la ficha.

## Referencia validada

- Una parada iniciada el 24/08/2026 y consultada el 28/08/2026 muestra 5 días totales.
- Como el periodo 2026-09 empieza el 25/08/2026, esa misma parada muestra 4 días dentro del periodo actual.
- Esta diferencia confirma que `total desde parada` y `días del periodo` son dos datos distintos.

## Continuidad

- Alpha67 incorpora el marcado rápido y seguro de una T como realizada.
- Esa mejora posterior debe conservar íntegramente las fechas operativas y los cálculos de sustitución y facturación validados en Alpha66.
- Alpha67 continúa en pruebas y no modifica ni reabre Alpha66.
