# r1.0.0-alpha.58 · VALIDADA Y CERRADA

Fecha de publicación: 26/08/2026

Fecha de validación: 27/08/2026

Estado: VALIDADA POR EL USUARIO Y CERRADA.

Enlace histórico:
- https://metrogestion2026-eng.github.io/metrogestion-24h/r1-alpha58/

Reglas de cierre:
- La carpeta `r1-alpha58` queda inmutable.
- No se modificará ni se sobrescribirá su código.
- Cualquier corrección o mejora posterior se realizará en una versión nueva.
- Alpha59, Alpha60 y las siguientes deberán conservar todas las funciones validadas de Alpha58.
- Alpha57 permanece validada, cerrada e inmutable.
- Alpha53 permanece validada, cerrada e inmutable.

Base conservada:
- Parte íntegramente de Alpha57.
- Conserva la apertura estable de las fichas T.
- Conserva los tipos de trabajo editables y su incorporación al listado general.
- Conserva el buscador de Pizarra, los documentos PDF y fotografías y la carga por arrastre.
- Conserva el Panel general validado en Alpha52.

Bloque validado · crear nueva ficha:
- Se recupera el botón `＋ Crear nueva ficha` dentro de la cabecera nativa de Hotel.
- El botón forma parte del render principal de la Pizarra; no se añade mediante un observador ni una capa posterior.
- Solo está disponible para el administrador principal o para usuarios con permiso de edición de Hotel.
- Para una cuenta con permiso de edición, el botón permanece visible pero deshabilitado mientras la pantalla está en `Modo lectura`.
- Al activar `Lectura y edición`, el botón queda habilitado.
- Abre el formulario auditado de alta de ficha y crea el registro en la única pizarra en curso.
- Supabase asigna automáticamente el número de parada, el orden y el seguimiento de auditoría.
- Al finalizar, la Pizarra se vuelve a cargar y muestra la ficha recién creada.
- Las cuentas con permiso exclusivamente de lectura no pueden crear fichas ni ejecutar la operación en Supabase.

Continuidad:
- Alpha59 añade el uso compartido de documentos de las T.
- Alpha60 incorpora la nueva configuración inicial de permisos de usuario.
- Esas mejoras posteriores no modifican ni reabren Alpha58.
