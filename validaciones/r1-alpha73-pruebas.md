# Alpha73 · versión validada de usuarios

Fecha de creación: 05/09/2026

Estado: **validada y publicada** el 06/09/2026. Alpha72 permanece cerrada e inmutable.

Distribución: **versión oficial de usuarios**. Sustituye a Alpha72 con autorización expresa del usuario responsable.

Enlace oficial: https://metrogestion2026-eng.github.io/metrogestion-24h/r1-alpha73/

## Punto de partida

- Copia funcional exacta de Alpha72 en el momento de su cierre.
- Identificador visible actualizado a `r1.0.0-alpha.73`.
- Parte de una copia sin cambios funcionales de Alpha72.
- Alpha73 queda cerrada como versión de usuarios; cualquier mejora posterior deberá prepararse en una versión nueva.

## Anotaciones sin modo edición

- La acción `✎ Añadir anotación` está disponible en cada ficha para quien tenga permiso de edición de Hotel, aunque la pantalla permanezca en `Modo lectura`.
- El guardado usa una operación independiente: solo inserta la anotación y no cambia la ficha, la reserva, las T, el estado ni su versión.
- La base de datos vuelve a comprobar usuario activo, dispositivo autorizado y permiso de edición de Hotel.
- Cada alta conserva autor, fecha, origen e identificador de auditoría.
- El identificador de petición hace el alta idempotente y evita duplicados por reintentos.
- El texto se limita a entre 1 y 4.000 caracteres y solo se admite sobre fichas activas de la pizarra en curso.
- Alpha72 permanece sin cambios; los enlaces heredados Alpha63 y Alpha69 cargan ahora Alpha73.

## Protección contra mezcla de fichas

- El editor completo fija al abrir una identidad inmutable formada por registro, seguimiento, pizarra, número de parada, vehículo y reserva.
- Antes de guardar muestra y pide confirmar explícitamente el vehículo, la parada y la reserva; se advierte que una reserva reutilizada no identifica una ficha.
- La base de datos vuelve a comparar esa identidad con la fila bloqueada y rechaza cualquier discrepancia antes de modificar datos.
- Cada T existente debe pertenecer al registro abierto y cada trabajo existente debe pertenecer a esa T y a ese registro.
- Las dos anotaciones ajenas importadas en R1443 se cancelan mediante una corrección exacta y auditada; no se borran físicamente.
- La anotación correcta de R1443, «parado pendiente de Fridiel», permanece visible.
- La acción rápida para añadir una anotación conserva su operación independiente y no abre ni guarda la ficha completa.
- Alpha72 permanece cerrada e inmutable; Alpha73 es la versión de usuarios.

## Refuerzo de sesiones

- Todas las operaciones que dependen de `usuario_activo()` conservan la comprobación de cambio de contraseña y añaden la validación del `session_id` del JWT.
- La sesión debe existir en `auth.sessions`, pertenecer al mismo usuario y no haber superado `not_after`.
- Un JWT de una sesión cerrada, inexistente o vencida deja de autorizar operaciones aunque todavía no haya alcanzado su expiración local.
- La función interna no es ejecutable por `anon` ni por `authenticated`; únicamente la invocan los controles protegidos del servidor.
- El refuerzo no modifica el código de Alpha72 y queda incluido en la versión oficial Alpha73.

## Funciones heredadas

- Hotel, T, cronología, múltiples entradas de taller y anotaciones auditadas.
- Reactivación histórica coherente y protección de reservas.
- Panel, Histórico, 24H, Activos, Reservas, Listados y catálogos editables.
- Presencia, clasificación de accesos y marcador único por sesión.
- Sincronización bidireccional protegida con MANTENIMENT.
