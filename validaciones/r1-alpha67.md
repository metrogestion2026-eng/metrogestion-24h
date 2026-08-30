# r1.0.0-alpha.67 · VALIDADA Y CERRADA

Fecha de publicación: 29/08/2026

Fecha de validación: 30/08/2026

Estado: VALIDADA POR EL USUARIO Y CERRADA.

Enlace histórico:
- https://metrogestion2026-eng.github.io/metrogestion-24h/r1-alpha67/

## Reglas de cierre

- La carpeta `r1-alpha67` queda inmutable.
- No se modificará ni se sobrescribirá su código.
- Cualquier corrección o mejora posterior se realizará en una versión nueva.
- Alpha68 y todas las versiones siguientes deberán conservar íntegramente las funciones validadas de Alpha67.
- Alpha66 permanece validada, cerrada e inmutable.
- Alpha64 permanece validada, cerrada e inmutable.
- Alpha65 no se modifica ni se reabre.

## Base conservada

- Parte íntegramente de Alpha66.
- Conserva las fechas operativas de cada ficha.
- Conserva los días totales desde parada y los días del periodo de facturación.
- Conserva los kilómetros totales y del periodo, y el tratamiento diferenciado de DFM y R.
- Conserva la media manual y el precio R exclusivamente para el administrador principal.
- Conserva el cambio de contraseña, las contraseñas temporales y Sugerencias.
- Conserva la recuperación de dispositivos revocados y el límite de un móvil y un ordenador por usuario.
- Conserva la navegación Hotel/Panel, la documentación, la creación de fichas, la apertura de T, los tipos editables, el buscador y el Panel.

## Bloque validado · marcado rápido de una T como realizada

- Cada T pendiente, programada o en curso de la Pizarra actual incorpora el botón `✓ Marcar realizada` exclusivamente para el administrador principal.
- No se utiliza el doble clic convencional del navegador.
- La primera pulsación no modifica ningún dato.
- El botón pasa a color naranja y muestra `¿Confirmar realizada? · 5 s`.
- Durante los primeros 650 milisegundos la segunda pulsación permanece deshabilitada para evitar rebotes o dobles clics físicos accidentales.
- La segunda pulsación deliberada confirma la operación.
- Si termina la cuenta atrás, el botón recupera automáticamente su estado inicial y la T continúa sin cambios.
- El comportamiento está diseñado para ratón, móvil y tableta.

## Fecha, hora y trazabilidad

- La confirmación guarda la fecha y hora exactas del servidor como `fecha_real` y `fecha_fin_real`.
- Si la T ya tenía `fecha_inicio_real`, se conserva.
- Si la T estaba pendiente o programada sin fecha de inicio, no se inventa ninguna.
- Se registra el usuario del marcado, la fecha del marcado rápido, la versión de la T y el identificador de auditoría.
- La versión se comprueba antes de guardar para impedir confirmar una ficha que haya cambiado.
- La operación cambia el estado real a `realizada`; no modifica únicamente la presentación visual.
- Una segunda ejecución accidental queda rechazada.

## T con consecuencias operativas

- En `Recogida taller`, la confirmación avisa de que registrará la hora real de salida del taller y utiliza el mismo movimiento operativo del procedimiento completo.
- En `Recuperar ruta y liberar reserva`, la confirmación avisa de la recuperación y liberación.
- Al confirmar una recuperación se actualiza la T, la ficha pasa a `recuperado` y la reserva queda `libre` o `disponible_con_pendientes`, según corresponda.
- En `Liberar reserva`, la reserva vuelve a quedar disponible según sus pendientes.
- Las acciones especiales utilizan los desencadenadores existentes del Hotel; no existe una vía paralela que pueda dejar estados contradictorios.

## Datos pendientes de completar

- Después del marcado rápido aparece el aviso amarillo `⚠ Datos pendientes de completar`.
- La hora real queda guardada aunque el resto de la ficha se complete más tarde.
- `Ver ficha y completar datos` abre el editor completo existente.
- Al guardar correctamente por ese procedimiento se registran la fecha y el usuario de finalización de datos y desaparece el aviso.
- Los usuarios normales ven que la T está realizada y que tiene datos pendientes, pero no reciben ningún botón de marcado ni de cierre.
- Si la ficha pasa al Histórico por una recuperación o liberación, el aviso continúa disponible.
- El estado del marcado rápido y de los datos pendientes se conserva al clonar la pizarra diaria.
- Si la T se anula o deja de estar realizada, el aviso se limpia de forma coherente.

## Seguridad validada

- La operación pública no puede ejecutarse como usuario anónimo.
- Supabase comprueba que exista una sesión vigente, un dispositivo autorizado y un administrador principal.
- Los usuarios autenticados que no son administrador principal quedan rechazados.
- Se comprueba que la T pertenezca a la Pizarra actual, no esté anulada ni realizada y conserve la versión cargada.
- La operación queda auditada con un identificador propio.
- Las funciones públicas de Alpha67 no aparecen señaladas por el asesor de seguridad de Supabase.
- La tabla `etapas_hotel` mantiene RLS activado y restricciones de coherencia para el marcado rápido y los datos pendientes.

## Verificaciones finales

- La migración `alpha67_marcado_rapido_t_realizada_v2` está aplicada en Supabase.
- Se comprobaron columnas, claves externas, restricciones, índice, desencadenadores y funciones.
- Se ejecutaron pruebas transaccionales de autorización, versión, auditoría, marcado, idempotencia, recogida de taller, recuperación/liberación y cierre posterior de datos.
- Todas las pruebas transaccionales se revirtieron automáticamente: ninguna T, ficha o reserva real quedó modificada.
- La sintaxis JavaScript de los archivos de entrada de Alpha67 se comprobó correctamente.
- GitHub Pages publica `r1.0.0-alpha.67`, muestra la pantalla de acceso y no genera errores propios de la página.

## Continuidad

- Alpha68 y las versiones siguientes deberán conservar íntegramente Alpha67.
- Alpha68 continúa en pruebas y no modifica ni reabre Alpha67.
