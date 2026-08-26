# r1.0.0-alpha.56 · EN PRUEBAS

Fecha de publicación: 26/08/2026

Estado: PENDIENTE DE VALIDACIÓN DEL USUARIO.

Enlace de prueba:
- https://metrogestion2026-eng.github.io/metrogestion-24h/r1-alpha56/

Punto de partida:
- Parte de Alpha55.
- Conserva el buscador de Pizarra de Alpha54.
- Conserva la carga de PDF y fotografías por selección, cámara y arrastre de Alpha55.
- Conserva el Panel general validado en Alpha52.
- Alpha53 permanece validada, cerrada e inmutable.

Incidencia corregida · apertura irregular de las T:
- Alpha54/Alpha55 todavía heredaban el antiguo realce asíncrono de Alpha26, que añadía el clic a las T después de construir la pantalla y las relacionaba por posición.
- El Hotel nativo de las versiones nuevas sustituía esas fichas durante la carga; según qué proceso terminaba primero, una T podía conservar el clic antiguo o quedarse sin él.
- Las T de Alpha56 ya no utilizan la clase ni el manejador antiguo.
- Cada T se construye desde el origen con un botón propio `Ver ficha` y un identificador real de etapa.
- La apertura no depende del orden visual, de un observador posterior ni de que otra versión haya terminado de modificar la pantalla.

Ficha completa de la T:
- Abre siempre en modo consulta desde Hotel y desde Histórico.
- Muestra estado, tipo, lugar, posición, fechas programadas y reales, observaciones, versión y última modificación.
- Consulta en ese momento los trabajos asociados a la T y muestra motivo de entrada, diagnóstico, expediente, kilómetros, descripción, peritaje y observaciones.
- Resume también la documentación activa y anulada de esa T.
- Los controles de documentos, fotografías y arrastre no abren accidentalmente la ficha ni interfieren con ella.

Integración sin parches:
- La T es un componente nativo propio de Alpha56.
- Se utiliza una clase nueva que el realce antiguo de Alpha26 no reconoce.
- Hotel e Histórico comparten la misma función de apertura de ficha.
- Alpha54 y Alpha55 no se modifican.

Alpha56 no se declarará validada ni cerrada hasta recibir confirmación expresa del usuario.
