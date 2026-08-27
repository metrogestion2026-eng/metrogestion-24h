# r1.0.0-alpha.63 · EN PRUEBAS

Fecha de publicación: 27/08/2026

Estado: PENDIENTE DE VALIDACIÓN DEL USUARIO.

Enlace de prueba:
- https://metrogestion2026-eng.github.io/metrogestion-24h/r1-alpha63/

Punto de partida:
- Parte íntegramente de Alpha62.
- Conserva la navegación estable entre Hotel y Panel.
- Conserva Usuarios exclusivo del administrador principal.
- Conserva la restricción de media manual y precio R al administrador principal.
- Conserva Activar 24H, documentación compartible, creación de fichas, apertura estable de T, tipos editables, buscador y Panel.
- Alpha58 permanece validada, cerrada e inmutable.
- Alpha62 no se modifica.

Cambio en prueba · dos dispositivos por usuario:
- Cada usuario puede mantener simultáneamente dos dispositivos autorizados.
- Las dos plazas son independientes: un móvil y un ordenador.
- Autorizar el segundo dispositivo no revoca el primero.
- No se permiten dos móviles ni dos ordenadores autorizados a la vez para la misma cuenta.
- Si una plaza ya está ocupada, debe revocarse ese dispositivo antes de autorizar otro del mismo tipo.
- El límite se aplica en base de datos mediante trigger e índice único, no únicamente en la interfaz.

Usuarios · administración de dispositivos:
- El administrador principal ve una tarjeta por usuario con dos bloques: `Móvil` y `Ordenador`.
- Cada bloque indica si la plaza está disponible u ocupada.
- Las solicitudes pendientes aparecen dentro del tipo correspondiente.
- Se puede autorizar, rechazar o revocar cada dispositivo de forma independiente.
- La pantalla muestra el total autorizado de cada usuario: 0/2, 1/2 o 2/2.
- Los usuarios normales continúan sin ver la pestaña Usuarios ni el bloque Usuarios del Panel.

Flujo de alta:
- El usuario entra primero desde el móvil y genera una solicitud.
- Después entra desde el ordenador y genera una segunda solicitud.
- El administrador autoriza ambas desde Usuarios.
- El mismo correo y contraseña se utilizan en los dos dispositivos.
- El token de cada equipo se conserva localmente; no debe utilizarse navegación privada para el uso habitual.

Alpha63 no se declarará validada ni cerrada hasta recibir confirmación expresa del usuario.
