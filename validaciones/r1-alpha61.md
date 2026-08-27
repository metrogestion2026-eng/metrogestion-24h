# r1.0.0-alpha.61 · EN PRUEBAS

Fecha de publicación: 27/08/2026

Estado: PENDIENTE DE VALIDACIÓN DEL USUARIO.

Enlace de prueba:
- https://metrogestion2026-eng.github.io/metrogestion-24h/r1-alpha61/

Punto de partida:
- Parte íntegramente de Alpha60.
- Conserva Activar 24H, la documentación compartible, la creación de fichas, la apertura estable de las T, los tipos editables, el buscador y el Panel.
- Alpha58 permanece validada, cerrada e inmutable.
- Alpha59 y Alpha60 no se modifican.

Corrección en prueba · Usuarios exclusivo del administrador:
- Ninguna cuenta de usuario o administrador secundario ve la pestaña `Usuarios`.
- Ninguna cuenta no administradora puede consultar la lista de usuarios o dispositivos mediante acceso directo.
- El bloque `Usuarios y accesos` no aparece en el Panel de las cuentas no administradoras.
- El administrador principal conserva la pestaña Usuarios y el bloque correspondiente del Panel.
- Se elimina del administrador la opción de conceder la pestaña Usuarios a otras cuentas.
- Las cuentas existentes han quedado normalizadas y las nuevas cuentas tampoco podrán recibir ese acceso.

Corrección en prueba · media manual:
- Las cuentas normales pueden consultar la Pizarra y los datos de sustitución en modo lectura.
- No muestran el editor `Media km/día manual`, el botón `Guardar media manual`, `Volver a automático` ni el control de precio R.
- Aunque se intentara llamar directamente a la operación, Supabase rechaza el guardado.
- Solo el administrador principal puede crear, cambiar o retirar una media manual y modificar el precio fijo de sustitución R.

Seguridad:
- La restricción no depende únicamente de ocultar botones.
- Las políticas de lectura de `usuarios` permiten a cada cuenta leer solo su propio perfil y reservan la lista completa al administrador principal.
- Un trigger de base de datos fuerza `usuarios.ver=false` y `usuarios.editar=false` en cualquier perfil no administrador.
- Las funciones de facturación manual comprueban explícitamente que el actor sea el administrador principal.

Alpha61 no se declarará validada ni cerrada hasta recibir confirmación expresa del usuario.
