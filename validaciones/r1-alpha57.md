# r1.0.0-alpha.57 · EN PRUEBAS

Fecha de publicación: 26/08/2026

Estado: PENDIENTE DE VALIDACIÓN DEL USUARIO.

Enlace de prueba:
- https://metrogestion2026-eng.github.io/metrogestion-24h/r1-alpha57/

Punto de partida:
- Parte de Alpha56.
- Conserva la apertura estable de las fichas T.
- Conserva el buscador de Pizarra, la documentación PDF/fotografías y la carga por arrastre.
- Conserva el Panel general validado en Alpha52.
- Alpha53 permanece validada, cerrada e inmutable.
- Alpha56 no se modifica.

Cambio en prueba · tipos editables en «Trabajos de esta T»:
- El campo `Tipo` deja de ser un selector cerrado.
- Permite elegir un tipo existente del listado o escribir libremente uno nuevo.
- Los tipos existentes se muestran por su nombre legible y conservan internamente su código.
- Al guardar la ficha completa, un tipo nuevo se incorpora al catálogo general de tipos de trabajo.
- Al volver a abrir cualquier T, el nuevo tipo aparece ya como opción del listado.
- El encabezado de cada trabajo se actualiza mientras se escribe para mostrar el tipo seleccionado o creado.
- El guardado continúa siendo único, transaccional y auditado mediante la función de edición completa del Hotel.

Edición también desde «Ver ficha»:
- La ficha de consulta de cada T muestra el bloque `Trabajos de esta T`.
- El administrador o usuario con permiso de edición puede cambiar directamente los tipos y pulsar `Guardar tipos`.
- Un tipo escrito por primera vez se añade al listado inmediatamente después del guardado.
- Los trabajos anulados permanecen en consulta y no pueden modificarse sin restaurarlos.
- La modificación se propaga a las copias de la misma T en las pizarras históricas y posteriores, manteniendo la trazabilidad.
- Cada cambio conserva usuario, fecha, motivo técnico y versión mediante la auditoría existente.

Integración sin capas posteriores:
- Alpha57 utiliza un editor de Hotel propio que llama a la función de guardado con catálogos.
- Hotel activo e Histórico utilizan el mismo editor de tipos.
- La ficha T utiliza una operación de negocio específica para modificar tipos, sin acceso directo de la interfaz a escrituras de tabla.
- No se borra ningún tipo ni trabajo existente.

Alpha57 no se declarará validada ni cerrada hasta recibir confirmación expresa del usuario.
