# r1.0.0-alpha.58 · EN PRUEBAS

Fecha de publicación: 26/08/2026

Estado: PENDIENTE DE VALIDACIÓN DEL USUARIO.

Enlace de prueba:
- https://metrogestion2026-eng.github.io/metrogestion-24h/r1-alpha58/

Punto de partida:
- Parte íntegramente de Alpha57.
- Conserva la apertura estable de las fichas T.
- Conserva los tipos de trabajo editables y su incorporación al listado general.
- Conserva el buscador de Pizarra, documentos PDF/fotografías y carga por arrastre.
- Conserva el Panel general validado en Alpha52.
- Alpha53 permanece validada, cerrada e inmutable.
- Alpha57 no se modifica.

Corrección en prueba · crear nueva ficha:
- Se recupera el botón `＋ Crear nueva ficha` dentro de la cabecera nativa de Hotel.
- El botón forma parte del render principal de la Pizarra; no se añade mediante un observador o una capa posterior.
- Solo aparece al administrador principal o a usuarios con permiso de edición de Hotel.
- En modo lectura permanece visible pero deshabilitado, para que la función no desaparezca de la pantalla.
- Al activar `Lectura y edición`, el botón queda habilitado.
- Abre el formulario auditado de alta de ficha y crea el registro en la única pizarra en curso.
- Supabase asigna automáticamente el número de parada, el orden y el seguimiento de auditoría.
- Al terminar, la Pizarra se vuelve a cargar y muestra la ficha recién creada.
- Los usuarios de solo lectura no ven el botón y tampoco pueden ejecutar la operación de creación en Supabase.

Alpha58 no se declarará validada ni cerrada hasta recibir confirmación expresa del usuario.
