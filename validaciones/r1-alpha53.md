# r1.0.0-alpha.53 · EN PRUEBAS

Fecha de publicación: 25/08/2026

Estado: PENDIENTE DE VALIDACIÓN DEL USUARIO.

Enlace de prueba:
- https://metrogestion2026-eng.github.io/metrogestion-24h/r1-alpha53/

Punto de partida:
- Parte de Alpha52.
- Alpha50 permanece validada, cerrada e inmutable.
- El Panel general validado en Alpha52 se conserva sin modificar.
- Se mantienen Usuarios, el estado real de Reservas, Activar 24H, Listados y los seis bloques operativos del Hotel.

Cambio en prueba · Documentación por cada T:
- Cada T del Hotel dispone de un bloque propio para PDF y fotografías.
- Se pueden seleccionar varios archivos o hacer una foto directamente desde el móvil.
- Formatos admitidos: PDF, JPG/JPEG, PNG, WEBP, HEIC y HEIF.
- Límite: 25 MB por archivo.
- Los archivos se guardan en un contenedor privado de Supabase y se abren mediante enlaces temporales.
- Cada fotografía puede previsualizarse; los PDF y fotografías pueden abrirse y descargarse.
- El nombre visible y la descripción pueden modificarse indicando un motivo obligatorio.
- Un archivo no se borra físicamente: se anula indicando el motivo, permanece en histórico y puede restaurarse.
- Cada creación, modificación, anulación y restauración registra usuario, fecha, valores y motivo.

Integración sin parches de fichas:
- El Hotel activo se renderiza de forma nativa con la documentación dentro de cada T.
- El Histórico por día también se renderiza de forma nativa con el mismo bloque documental en cada T.
- La identidad documental de la T se conserva al crear la pizarra diaria; por tanto, el archivo sigue unido a la misma T durante todo su recorrido.
- Cada ficha activa e histórica muestra un resumen de archivos, fotos, PDF y anulados.
- El buscador del Histórico encuentra también nombres y descripciones de documentos.

Seguridad:
- La documentación respeta los permisos de Hotel, Histórico y Documentación.
- Solo un dispositivo autorizado puede consultar o añadir archivos.
- Las operaciones de metadatos se realizan exclusivamente mediante funciones auditadas.
- Los archivos ya registrados no pueden eliminarse físicamente del almacenamiento; únicamente pueden anularse de forma lógica.

Alpha53 no se declarará validada ni cerrada hasta recibir confirmación expresa del usuario.
