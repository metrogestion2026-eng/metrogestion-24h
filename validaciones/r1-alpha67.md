# r1.0.0-alpha.67 · EN PRUEBAS

Fecha de publicación: 29/08/2026

Estado: PENDIENTE DE VALIDACIÓN DEL USUARIO.

Enlace de prueba:
- https://metrogestion2026-eng.github.io/metrogestion-24h/r1-alpha67/

Punto de partida:
- Parte íntegramente de Alpha66.
- Conserva fechas operativas, días totales desde parada y días del periodo de facturación.
- Conserva el cambio de contraseña, contraseñas temporales y Sugerencias.
- Conserva la recuperación de dispositivos revocados y el límite de un móvil y un ordenador por usuario.
- Conserva la navegación estable Hotel/Panel, documentación, creación de fichas, apertura de T, tipos editables, buscador y Panel.
- Alpha64 permanece validada, cerrada e inmutable.
- Alpha65 y Alpha66 no se modifican.

## Cambio en prueba · marcado rápido de una T como realizada

- Cada T pendiente, programada o en curso de la Pizarra actual incorpora el botón `✓ Marcar realizada` exclusivamente para el administrador principal.
- No se utiliza un doble clic del navegador, porque en móvil o tableta puede interpretarse como zoom o perderse.
- La protección exige dos pulsaciones deliberadas sobre el mismo botón.
- La primera pulsación prepara la operación, muestra exactamente su efecto y abre una ventana de confirmación de 5 segundos.
- Durante los primeros 650 milisegundos la segunda pulsación permanece deshabilitada para evitar que un rebote o doble clic físico confirme accidentalmente.
- La segunda pulsación confirma la operación; si no se realiza dentro de los 5 segundos, el botón vuelve solo a su estado inicial.
- Los usuarios normales no ven el control y Supabase rechaza cualquier intento directo de ejecutarlo.

## Fecha, hora y trazabilidad

- La confirmación guarda la fecha y hora exactas del servidor como `fecha_real` y `fecha_fin_real`.
- Si la T ya tenía `fecha_inicio_real`, se conserva.
- Si la T estaba programada o pendiente, no se inventa una fecha de inicio.
- Se registra el usuario que realizó el marcado, la fecha del marcado rápido, la versión previa de la T y un identificador de auditoría.
- La operación utiliza el mismo cambio nativo de estado a `realizada`; no modifica solamente el texto visible.
- La versión de la T se comprueba antes de guardar para evitar confirmar sobre datos que otro proceso haya cambiado.

## T con efectos especiales

- En `Recogida taller`, el botón explica que registrará la hora real de salida del taller.
- En `Recuperar ruta y liberar reserva`, el botón explica que la ficha quedará recuperada y el sustituto se liberará.
- En `Liberar reserva`, el botón explica que la reserva volverá a quedar disponible según sus pendientes.
- Las acciones especiales pasan por los desencadenadores y reglas existentes del Hotel; no existe una vía paralela.

## Datos pendientes de completar

- Después del marcado rápido, la T queda realizada, pero muestra el aviso amarillo `⚠ Datos pendientes de completar`.
- La hora real ya queda asegurada aunque el resto de la ficha se complete más tarde.
- El botón `Completar datos de esta T` abre el editor completo existente.
- El aviso solo se cierra después de guardar correctamente desde ese botón y registrar la finalización de los datos.
- Si la ficha deja de estar visible en Hotel por una recuperación o liberación, el aviso continúa disponible en Histórico.
- El estado de marcado rápido y datos pendientes se conserva al clonar la pizarra diaria.
- Si la T se anula o deja de estar realizada, el aviso pendiente se limpia de forma coherente.

## Integración

- El control se construye dentro del componente nativo de cada T en Hotel y en Histórico.
- No se añade mediante un observador visual después de dibujar la Pizarra.
- Las consultas de estado de las T se agrupan para evitar una petición independiente por cada botón.
- Alpha67 utiliza operaciones de negocio protegidas de Supabase para marcar y completar; no escribe directamente desde el navegador sobre la tabla.

## Verificaciones

- La migración se ha aplicado correctamente en Supabase.
- Se han creado restricciones, claves externas, índices, desencadenadores y funciones protegidas.
- La sintaxis JavaScript de los cuatro archivos modificados se ha comprobado localmente con `node --check`.
- No se ha marcado ninguna T real durante la implantación.

Alpha67 no se declarará validada ni cerrada hasta recibir confirmación expresa del usuario.
