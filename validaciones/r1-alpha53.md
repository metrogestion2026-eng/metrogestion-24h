# r1.0.0-alpha.53 · VALIDADA Y CERRADA

Fecha de publicación: 25/08/2026

Fecha de validación: 26/08/2026

Estado: VALIDADA POR EL USUARIO Y CERRADA.

Enlace de trabajo:
- https://metrogestion2026-eng.github.io/metrogestion-24h/r1-alpha53/

Reglas de cierre:
- La carpeta `r1-alpha53` queda inmutable.
- No se modificará ni se sobrescribirá su código.
- El usuario puede seguir trabajando normalmente en Alpha53: los datos operativos continúan guardándose en Supabase y son compartidos con las versiones posteriores.
- Cualquier mejora de código posterior se implementará en una nueva versión.
- Alpha54, Alpha55 y las siguientes deberán conservar todas las funciones validadas de Alpha53.

Base conservada:
- Parte de Alpha52.
- Alpha50 permanece validada, cerrada e inmutable.
- El Panel general validado en Alpha52 se conserva sin modificar.
- Se mantienen Usuarios, el estado real de Reservas, Activar 24H, Listados y los seis bloques operativos del Hotel.

Bloque validado · Documentación por cada T:
- Cada T del Hotel dispone de un bloque propio para PDF y fotografías.
- Se pueden seleccionar varios archivos o hacer una foto directamente desde el móvil.
- Formatos admitidos: PDF, JPG/JPEG, PNG, WEBP, HEIC y HEIF.
- Límite: 25 MB por archivo.
- Los archivos se guardan en un contenedor privado de Supabase y se abren mediante enlaces temporales.
- Cada fotografía puede previsualizarse; los PDF y fotografías pueden abrirse y descargarse.
- El nombre visible y la descripción pueden modificarse indicando un motivo obligatorio.
- Un archivo no se borra físicamente: se anula indicando el motivo, permanece en histórico y puede restaurarse.
- Cada creación, modificación, anulación y restauración registra usuario, fecha, valores y motivo.

Integración validada sin parches de fichas:
- El Hotel activo se renderiza de forma nativa con la documentación dentro de cada T.
- El Histórico por día también se renderiza de forma nativa con el mismo bloque documental en cada T.
- La identidad documental de la T se conserva al crear la pizarra diaria; por tanto, el archivo sigue unido a la misma T durante todo su recorrido.
- Cada ficha activa e histórica muestra un resumen de archivos, fotos, PDF y anulados.
- El buscador del Histórico encuentra también nombres y descripciones de documentos.

Seguridad validada:
- La documentación respeta los permisos de Hotel, Histórico y Documentación.
- Solo un dispositivo autorizado puede consultar o añadir archivos.
- Las operaciones de metadatos se realizan exclusivamente mediante funciones auditadas.
- Los archivos ya registrados no pueden eliminarse físicamente del almacenamiento; únicamente pueden anularse de forma lógica.
