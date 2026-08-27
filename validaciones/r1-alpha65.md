# r1.0.0-alpha.65 · EN PRUEBAS

Fecha de publicación: 27/08/2026

Estado: PENDIENTE DE VALIDACIÓN DEL USUARIO.

Enlace de prueba:
- https://metrogestion2026-eng.github.io/metrogestion-24h/r1-alpha65/

Punto de partida:
- Parte íntegramente de Alpha64.
- Conserva la recuperación de dispositivos revocados y el límite de un móvil y un ordenador por usuario.
- Conserva la navegación estable entre Hotel y Panel.
- Conserva Usuarios exclusivo del administrador principal.
- Conserva la restricción de media manual y precio R al administrador principal.
- Conserva Activar 24H, documentación compartible, creación de fichas, apertura estable de T, tipos editables, buscador y Panel.
- Alpha58 permanece validada, cerrada e inmutable.
- Alpha64 no se modifica.

Cambio en prueba · cambio de contraseña propio:
- Todas las cuentas, incluido el administrador principal, disponen del botón `🔑 Contraseña` en la barra de sesión.
- El usuario debe introducir la contraseña actual, la nueva y su confirmación.
- La contraseña nueva debe tener entre 8 y 72 caracteres e incluir al menos una letra y un número.
- La contraseña actual se comprueba contra Supabase Auth antes de realizar el cambio.
- Un usuario normal solo puede hacer un cambio voluntario desde uno de sus dispositivos autorizados.
- Tras el cambio se cierran las sesiones abiertas y es necesario volver a entrar con la contraseña nueva.
- Metrogestión nunca muestra ni almacena la contraseña propia del usuario.

Cambio en prueba · contraseña temporal administrada:
- Dentro de `Usuarios`, el administrador principal dispone del bloque `Contraseñas y recuperación`.
- Puede generar una contraseña temporal para una cuenta que haya olvidado su contraseña.
- La contraseña anterior queda anulada inmediatamente.
- La contraseña temporal se genera de forma aleatoria y se muestra una sola vez al administrador para copiarla o preparar un mensaje de entrega.
- Al entrar con ella, el usuario no puede consultar ni editar ningún módulo hasta sustituirla por una contraseña propia.
- El usuario debe introducir la contraseña temporal y crear una nueva contraseña personal.
- Después del cambio obligatorio se cierran las sesiones y debe iniciar sesión nuevamente.
- Emitir otra contraseña temporal sustituye e invalida la temporal anterior.
- Se registra el usuario afectado, el administrador que la emitió, la fecha y el tipo de operación, pero nunca el contenido de ninguna contraseña.

Seguridad de sesiones:
- Al emitir una contraseña temporal o cambiar una contraseña, las credenciales anteriores dejan de tener acceso a los datos.
- Las funciones de consulta y edición comprueban que el usuario esté activo, que no tenga un cambio obligatorio pendiente y que la sesión sea posterior al último cambio de credenciales.
- La gestión sensible se ejecuta en la función segura `gestionar-claves-r1`; la clave de servicio no se expone al navegador.

Cambio en prueba · sugerencias:
- Todas las cuentas con sesión y dispositivo autorizados disponen del botón `💡 Sugerencias`.
- Se puede indicar si se trata de una sugerencia, mejora, incidencia de la aplicación o pregunta.
- Se guardan el asunto, el mensaje, el usuario, la fecha, el módulo activo, la versión y el contexto técnico de navegación.
- La sugerencia queda guardada en Supabase aunque el usuario cierre después su aplicación de correo.
- Después de guardarla, Metrogestión prepara un correo dirigido al correo del administrador principal y abre la aplicación de correo del usuario.
- El envío del correo no es automático: el usuario debe revisar el mensaje y pulsar `Enviar` en su aplicación de correo.
- Si el dispositivo no tiene una aplicación de correo configurada, se puede copiar el mensaje completo.
- El administrador principal dispone, dentro del mismo botón, de una bandeja de sugerencias recibidas con contador de nuevas.
- Puede marcar cada sugerencia como nueva, leída, en estudio, resuelta o descartada y responder por correo.
- Los usuarios normales solo pueden consultar sus propias sugerencias; el administrador principal puede consultar todas.

Control técnico:
- La migración `alpha65_contrasenas_temporales_y_sugerencias` está aplicada en Supabase.
- La función Edge `gestionar-claves-r1` está activa y exige una sesión válida.
- La publicación de GitHub Pages y la comprobación automática de sintaxis JavaScript han finalizado correctamente.

Alpha65 no se declarará validada ni cerrada hasta recibir confirmación expresa del usuario.
