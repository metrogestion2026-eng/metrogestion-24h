# r1.0.0-alpha.57 · VALIDADA Y CERRADA

Fecha de publicación: 26/08/2026

Fecha de validación: 27/08/2026

Estado: VALIDADA POR EL USUARIO Y CERRADA.

Enlace histórico:
- https://metrogestion2026-eng.github.io/metrogestion-24h/r1-alpha57/

Reglas de cierre:
- La carpeta `r1-alpha57` queda inmutable.
- No se modificará ni se sobrescribirá su código.
- Cualquier corrección o mejora posterior se mantendrá en una versión nueva.
- Alpha58, Alpha59, Alpha60 y las siguientes deberán conservar todas las funciones validadas de Alpha57.
- Alpha53 permanece validada, cerrada e inmutable.

Base conservada:
- Parte de Alpha56.
- Conserva la apertura estable de las fichas T.
- Conserva el buscador de Pizarra, la documentación PDF/fotografías y la carga por arrastre.
- Conserva el Panel general validado en Alpha52.

Bloque validado · tipos editables en «Trabajos de esta T»:
- El campo `Tipo` permite elegir un tipo existente o escribir libremente uno nuevo.
- Los tipos existentes se muestran por su nombre legible y conservan internamente su código.
- Al guardar, un tipo nuevo se incorpora al catálogo general de tipos de trabajo.
- Al volver a abrir cualquier T, el nuevo tipo aparece como opción del listado.
- El encabezado del trabajo refleja el tipo seleccionado o creado.
- El guardado permanece transaccional y auditado.

Edición validada desde «Ver ficha»:
- La ficha completa de cada T muestra el bloque `Trabajos de esta T`.
- El administrador o usuario con permiso de edición puede cambiar directamente los tipos y pulsar `Guardar tipos`.
- Los tipos nuevos quedan disponibles inmediatamente en el listado general.
- Los trabajos anulados permanecen visibles y no se pueden modificar sin restaurarlos.
- La modificación se propaga a las copias de la misma T en las pizarras históricas y posteriores.
- Cada cambio conserva usuario, fecha, motivo técnico y versión.

Integración validada sin escrituras directas desde la interfaz:
- Hotel activo e Histórico utilizan el mismo sistema de tipos.
- La ficha T utiliza una operación de negocio específica para modificar los tipos.
- No se elimina ningún tipo ni trabajo existente.

Continuidad conocida:
- El botón `Crear nueva ficha`, ausente en Alpha57, fue restablecido en Alpha58.
- Alpha57 queda cerrada tal como fue validada; para trabajar con creación de fichas debe utilizarse Alpha58 o una versión posterior.
