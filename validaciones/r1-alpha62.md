# r1.0.0-alpha.62 · EN PRUEBAS

Fecha de publicación: 27/08/2026

Estado: PENDIENTE DE VALIDACIÓN DEL USUARIO.

Enlace de prueba:
- https://metrogestion2026-eng.github.io/metrogestion-24h/r1-alpha62/

Punto de partida:
- Parte íntegramente de Alpha61.
- Conserva Usuarios exclusivo del administrador principal.
- Conserva la restricción de media manual y precio R al administrador principal.
- Conserva Activar 24H, documentación compartible, creación de fichas, apertura estable de T, tipos editables, buscador y Panel.
- Alpha58 permanece validada, cerrada e inmutable.
- Alpha61 no se modifica.

Corrección en prueba · navegación Hotel / Panel:
- Se establece un único estado de navegación que identifica qué módulo ha elegido realmente el usuario.
- Al pulsar `Panel`, el Panel toma la pantalla con un solo clic; una carga anterior de Hotel no puede sobrescribirlo cuando termina más tarde.
- Al pulsar `Hotel`, se cancela la propiedad y la actualización automática pendiente del Panel.
- El refresco automático del Panel solo puede ejecutarse mientras el módulo elegido continúa siendo Panel.
- Si una respuesta antigua intenta dibujar Hotel sobre Panel o Panel sobre Hotel, el controlador recupera inmediatamente el módulo elegido y descarta la vista atrasada.
- Se elimina el comportamiento por el que Hotel podía aparecer al primer clic en Panel y cambiar espontáneamente a Panel después.

Integración:
- La navegación se decide antes de que actúen los renderizadores de Hotel y Panel.
- El control no depende del texto visible de la pantalla ni de esperar un segundo clic.
- Las versiones anteriores no se modifican.

Alpha62 no se declarará validada ni cerrada hasta recibir confirmación expresa del usuario.
