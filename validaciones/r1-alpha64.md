# r1.0.0-alpha.64 · VALIDADA Y CERRADA

Fecha de publicación: 27/08/2026

Fecha de validación: 28/08/2026

Estado: VALIDADA POR EL USUARIO Y CERRADA.

Enlace histórico:
- https://metrogestion2026-eng.github.io/metrogestion-24h/r1-alpha64/

Reglas de cierre:
- La carpeta `r1-alpha64` queda inmutable.
- No se modificará ni se sobrescribirá su código.
- Cualquier corrección o mejora posterior se realizará en una versión nueva.
- Alpha65 y todas las versiones siguientes deberán conservar todas las funciones validadas de Alpha64.
- Alpha58 permanece validada, cerrada e inmutable.
- Alpha63 no se modifica ni se reabre.

Base conservada:
- Parte de Alpha62 e incorpora la gestión de dos dispositivos por usuario desarrollada en Alpha63.
- Conserva un máximo de un móvil y un ordenador autorizados simultáneamente por cuenta.
- Conserva la navegación estable entre Hotel y Panel.
- Conserva la pestaña Usuarios exclusivamente para el administrador principal.
- Conserva la media manual y el precio R reservados al administrador principal.
- Conserva Activar 24H, la documentación compartible, la creación de fichas, la apertura estable de las T, los tipos editables, el buscador de Pizarra y el Panel.

Bloque validado · recuperación de dispositivos revocados:
- Los dispositivos revocados aparecen dentro de la plaza correspondiente, en `Revocados o rechazados`.
- El administrador principal puede recuperar un móvil o un ordenador revocado mediante su botón específico.
- La recuperación solicita confirmación y un motivo obligatorio.
- Se recupera el mismo registro y el mismo identificador del dispositivo; no se crea un duplicado.
- Recuperar un dispositivo no desconecta el otro tipo autorizado para la misma cuenta.
- La acción solo está disponible cuando la plaza de ese tipo está libre.
- Si ya existe otro dispositivo autorizado del mismo tipo, primero debe revocarse el que ocupa la plaza.
- Un dispositivo rechazado o bloqueado no se recupera con esta acción: debe generar una nueva solicitud desde ese equipo.

Seguridad validada:
- La recuperación se ejecuta mediante una función específica de Supabase.
- Solo el administrador principal puede ejecutarla.
- Supabase vuelve a comprobar el límite total de dos dispositivos y la exclusividad por tipo antes de autorizar.
- Ningún dispositivo se recupera automáticamente; la acción exige una decisión expresa del administrador.

Continuidad:
- Alpha65 añade cambio de contraseña, contraseñas temporales y sugerencias.
- Esas mejoras posteriores no modifican ni reabren Alpha64.
