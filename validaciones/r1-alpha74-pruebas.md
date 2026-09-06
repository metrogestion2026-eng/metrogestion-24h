# Alpha74 · base de pruebas

Fecha de creación: 06/09/2026

Estado: **en pruebas**. Alpha73 permanece validada, cerrada y asignada a los usuarios.

Distribución: **no asignada a usuarios**. Alpha74 no sustituirá a Alpha73 sin validación y autorización expresa del usuario responsable.

## Punto de partida

- Copia funcional de Alpha73 en el momento de su cierre.
- Identificador visible actualizado a `r1.0.0-alpha.74`.
- Alpha73 no se modifica.

## Gestión directa de anotaciones

- «Modificar» abre únicamente el texto de la anotación, sin desbloquear la ficha completa.
- «Eliminar» exige confirmación y retira la línea de la vista sin borrarla físicamente.
- La eliminación deja autor, fecha, motivo y cambio completo en auditoría.
- Ambas operaciones requieren usuario activo, sesión vigente, dispositivo autorizado y permiso de edición de Hotel.
- El servidor comprueba que la ficha sigue activa y que la anotación pertenece al mismo seguimiento.
- El número de versión evita sobrescribir un cambio realizado desde otro dispositivo.
- Las operaciones no modifican registros, T, trabajos, reservas ni ningún otro campo de Hotel.
