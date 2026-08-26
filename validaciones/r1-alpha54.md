# r1.0.0-alpha.54 · EN PRUEBAS

Fecha de publicación: 26/08/2026

Estado: PENDIENTE DE VALIDACIÓN DEL USUARIO.

Enlace de prueba:
- https://metrogestion2026-eng.github.io/metrogestion-24h/r1-alpha54/

Punto de partida:
- Parte de Alpha53.
- Conserva la documentación PDF y fotografías dentro de cada T del Hotel y del Histórico.
- Conserva el Panel general validado en Alpha52 sin modificarlo.
- Alpha50 permanece validada, cerrada e inmutable.

Cambio en prueba · Buscador de Pizarra:
- Se incorpora un buscador visible en la parte superior del Hotel activo.
- Permite localizar una ficha por DFM o R, matrícula, número de parada, sustituto, matrícula del sustituto, INC, UPC, lugar o taller, causa, estado, marca, modelo, próximo movimiento y anotaciones.
- También localiza por número, nombre, lugar, estado y observaciones de las T.
- El texto visible de la documentación de las T también forma parte de la búsqueda.
- La búsqueda admite varias palabras y exige que todas aparezcan en la ficha, sin importar mayúsculas, minúsculas ni acentos.
- Muestra en todo momento cuántas fichas coinciden y dispone de un botón para limpiar la búsqueda.
- Puede combinarse con los seis bloques operativos: fichas activas, pendientes de parar, pendientes de taller, en taller, pendientes de recoger y pendientes de recuperar.
- Cuando no hay coincidencias se muestra un aviso claro sin eliminar ni alterar ninguna ficha.

Integración sin parches:
- El buscador forma parte del render nativo del Hotel de Alpha54.
- No busca elementos de una pantalla anterior para añadir controles después.
- La visibilidad de cada ficha se calcula conjuntamente por estado y por texto de búsqueda dentro del mismo módulo.
- Alpha53 no se modifica.

Alpha54 no se declarará validada ni cerrada hasta recibir confirmación expresa del usuario.
