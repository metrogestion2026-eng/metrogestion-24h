# r1.0.0-alpha.55 · EN PRUEBAS

Fecha de publicación: 26/08/2026

Estado: PENDIENTE DE VALIDACIÓN DEL USUARIO.

Enlace de prueba:
- https://metrogestion2026-eng.github.io/metrogestion-24h/r1-alpha55/

Punto de partida:
- Parte de Alpha54.
- Conserva el buscador de Pizarra.
- Conserva la documentación PDF y fotografías dentro de cada T del Hotel y del Histórico.
- Conserva el Panel general validado en Alpha52 sin modificarlo.
- Alpha50 permanece validada, cerrada e inmutable.

Cambio en prueba · carga de archivos arrastrando:
- Cada T incorpora una zona visible «Arrastra aquí PDF o fotos».
- Se pueden arrastrar uno o varios archivos desde el escritorio o una carpeta y soltarlos directamente en la T correcta.
- Al pasar los archivos por encima, la zona cambia visualmente para confirmar el destino.
- Al soltarlos se utiliza la misma validación, almacenamiento privado, registro y auditoría que en el botón «Añadir PDF o fotos».
- Se mantienen el botón de selección y el botón «Hacer foto»; la nueva opción no elimina ninguna forma de carga anterior.
- La descripción escrita se aplica a todos los archivos soltados en ese envío.
- El formato y tamaño permitidos continúan siendo PDF, JPG/JPEG, PNG, WEBP, HEIC y HEIF, con un máximo de 25 MB por archivo.
- La carga por arrastre está disponible tanto en las fichas activas del Hotel como en las fichas del Histórico.
- Soltar accidentalmente un archivo fuera de la zona de carga no abre ni reemplaza la aplicación en el navegador.

Integración sin parches:
- La zona de arrastre forma parte del componente nativo de documentos de cada T.
- Hotel e Histórico utilizan el mismo componente documental de Alpha55.
- Alpha54 no se modifica.

Alpha55 no se declarará validada ni cerrada hasta recibir confirmación expresa del usuario.
