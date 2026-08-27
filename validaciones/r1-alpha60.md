# r1.0.0-alpha.60 · EN PRUEBAS

Fecha de publicación: 27/08/2026

Estado: PENDIENTE DE VALIDACIÓN DEL USUARIO.

Enlace de prueba:
- https://metrogestion2026-eng.github.io/metrogestion-24h/r1-alpha60/

Punto de partida:
- Parte íntegramente de Alpha59.
- Conserva el botón Compartir de cada documento de una T.
- Conserva la creación de fichas, la apertura estable de las T y los tipos de trabajo editables.
- Conserva el buscador, la carga documental y el Panel general.
- Alpha59 no se modifica.

Cambio en prueba · permisos iniciales de usuario:
- Las áreas operativas se muestran en modo de solo lectura: Hotel · Pizarra, T programadas, Reservas, Histórico, Talleres, Panel y documentación de las T.
- Listados continúa visible en consulta.
- Usuarios aparece como `🔒 Usuarios`.
- Un usuario no administrador puede abrir Usuarios en modo consulta, pero no puede crear cuentas, bloquear usuarios, autorizar dispositivos ni cambiar permisos.
- Activar 24H queda habilitado para lectura y edición.
- Un usuario normal continúa viendo y modificando únicamente sus propias incidencias 24H; el administrador principal mantiene la visión completa.
- El usuario de prueba Josep Manel ha recibido esta configuración.
- Los nuevos usuarios creados desde Alpha60 reciben la misma configuración inicial.

Corrección de seguridad y permisos 24H:
- Las operaciones de crear, guardar seguimiento, modificar, anular y restaurar una incidencia comprueban el permiso específico `activar24h.editar`.
- La consulta de incidencias comprueba el permiso específico `activar24h.ver`.
- La actualización de seguimiento valida también la propiedad de la incidencia para impedir que un usuario normal modifique una incidencia ajena conociendo su identificador.
- El administrador principal conserva acceso total.

Permisos iniciales:
- `activar24h`: lectura y edición.
- `hotel`, `t_programadas`, `reservas`, `historico`, `talleres`, `resumen`, `documentacion` y `listados`: solo lectura.
- `usuarios`: consulta visible y edición bloqueada.

Alpha60 no se declarará validada ni cerrada hasta recibir confirmación expresa del usuario.
