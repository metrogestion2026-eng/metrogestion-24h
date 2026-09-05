# Alpha73 · base de pruebas

Fecha de creación: 05/09/2026

Estado: **en pruebas**. Alpha72 permanece validada, cerrada e inmutable.

Distribución: **no asignada a usuarios**. Alpha73 no sustituirá a Alpha72 sin autorización expresa del usuario responsable.

## Punto de partida

- Copia funcional exacta de Alpha72 en el momento de su cierre.
- Identificador visible actualizado a `r1.0.0-alpha.73`.
- Parte de una copia sin cambios funcionales de Alpha72.
- Toda mejora nueva deberá realizarse únicamente dentro de Alpha73 y sus migraciones asociadas.

## Anotaciones sin modo edición

- La acción `✎ Añadir anotación` está disponible en cada ficha para quien tenga permiso de edición de Hotel, aunque la pantalla permanezca en `Modo lectura`.
- El guardado usa una operación independiente: solo inserta la anotación y no cambia la ficha, la reserva, las T, el estado ni su versión.
- La base de datos vuelve a comprobar usuario activo, dispositivo autorizado y permiso de edición de Hotel.
- Cada alta conserva autor, fecha, origen e identificador de auditoría.
- El identificador de petición hace el alta idempotente y evita duplicados por reintentos.
- El texto se limita a entre 1 y 4.000 caracteres y solo se admite sobre fichas activas de la pizarra en curso.
- Alpha72 y los enlaces asignados a usuarios permanecen sin cambios.

## Protección contra mezcla de fichas

- El editor completo fija al abrir una identidad inmutable formada por registro, seguimiento, pizarra, número de parada, vehículo y reserva.
- Antes de guardar muestra y pide confirmar explícitamente el vehículo, la parada y la reserva; se advierte que una reserva reutilizada no identifica una ficha.
- La base de datos vuelve a comparar esa identidad con la fila bloqueada y rechaza cualquier discrepancia antes de modificar datos.
- Cada T existente debe pertenecer al registro abierto y cada trabajo existente debe pertenecer a esa T y a ese registro.
- Las dos anotaciones ajenas importadas en R1443 se cancelan mediante una corrección exacta y auditada; no se borran físicamente.
- La anotación correcta de R1443, «parado pendiente de Fridiel», permanece visible.
- La acción rápida para añadir una anotación conserva su operación independiente y no abre ni guarda la ficha completa.
- Alpha72 permanece como versión de usuarios y su código no se modifica.

## Refuerzo de sesiones

- Todas las operaciones que dependen de `usuario_activo()` conservan la comprobación de cambio de contraseña y añaden la validación del `session_id` del JWT.
- La sesión debe existir en `auth.sessions`, pertenecer al mismo usuario y no haber superado `not_after`.
- Un JWT de una sesión cerrada, inexistente o vencida deja de autorizar operaciones aunque todavía no haya alcanzado su expiración local.
- La función interna no es ejecutable por `anon` ni por `authenticated`; únicamente la invocan los controles protegidos del servidor.
- El refuerzo no modifica el código de Alpha72 ni exige actualizar la versión instalada por los usuarios.

## Funciones heredadas

- Hotel, T, cronología, múltiples entradas de taller y anotaciones auditadas.
- Reactivación histórica coherente y protección de reservas.
- Panel, Histórico, 24H, Activos, Reservas, Listados y catálogos editables.
- Presencia, clasificación de accesos y marcador único por sesión.
- Sincronización bidireccional protegida con MANTENIMENT.
