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

## Funciones heredadas

- Hotel, T, cronología, múltiples entradas de taller y anotaciones auditadas.
- Reactivación histórica coherente y protección de reservas.
- Panel, Histórico, 24H, Activos, Reservas, Listados y catálogos editables.
- Presencia, clasificación de accesos y marcador único por sesión.
- Sincronización bidireccional protegida con MANTENIMENT.
