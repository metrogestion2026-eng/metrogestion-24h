# Metrogestión 24H — Memorando de versiones

## r1.0.0-alpha.71 — 02/09/2026

- Versión de pruebas creada desde Alpha70 validada y cerrada.
- Sincronización bidireccional del maestro `ALTA`: I es matriculación y J es alta en delegación.
- Fin de contrato calculado desde matriculación y próxima ITV inicial a un año.
- Altas, ediciones y bajas de Activos se devuelven al archivo madre sin borrar filas.
- Las fichas nuevas de Hotel generan una fila `PARADA` vinculada por identificador estable.
- Mapeo de `PARADA`: A DFM, B matrícula, C tipo, D UPC, G sustituto, H PARADA, I programada, J parada, K recuperación/corte, L días, O marca, P km y Q TANCAMENT.
- `TANCAMENT n` mantiene Q en rosa pastel hasta la supervisión del administrador principal y no cierra operativamente la ficha.
- Outbox privado, confirmaciones idempotentes, token protegido y wrappers públicos sin `SECURITY DEFINER` para Activos.

## r1.0.0-alpha.70 — 02/09/2026

- Validada por el usuario y cerrada sobre el commit `32373e410fe9e4925cd7f8d201262d87090202f2`.
- La carpeta `r1-alpha70` queda inmutable.
- Alpha71 parte de una copia exacta y concentra las mejoras posteriores.
- Se validan los catálogos editables, el buscador del Histórico, la última T por fecha efectiva, las exportaciones PDF/XLSX, la creación de reservas y la gestión protegida de Activos.

## Beta 1.7 — 29/07/2026

- El DFM permanece visible en todos los pasos de la activación.
- La matrícula también se muestra permanentemente.
- La identificación se actualiza al escribir, seleccionar o introducir manualmente el vehículo.

## Beta 1.6 — 29/07/2026

- El panel principal abre el asistente completo de activación 24H.
- Comprobación automática del límite de kilómetros del contrato.
- Comprobación del vencimiento por fecha: tres años para tractoras y cuatro para rígidos.
- Bloqueo del avance cuando se supera cualquiera de las dos condiciones.
- Aviso con los teléfonos de TM, Gestión Mantenimiento BCN y Área de Mantenimiento.
- Botón para volver al panel principal.

## Beta 1.5 — 27/07/2026

- Nueva pestaña «Mi cuenta» disponible para todos.
- Cada usuario puede cambiar su propio PIN.
- Se exige el PIN actual y la doble confirmación del nuevo.
- El administrador principal mantiene la posibilidad de restablecer PIN ajenos.

## Beta 1.4 — 27/07/2026

- Edición de nombre, teléfono y correo en las cuentas ya creadas.
- Validación de teléfono y correo obligatorios.
- Control para impedir que dos cuentas compartan teléfono o correo.

## Beta 1.3 — 27/07/2026

- Se incorpora un apartado «Versiones» en el panel de administración.
- Se establece la numeración Beta 1.1, 1.2, 1.3… 1.10 y posteriormente 2.0.

## Beta 1.2 — 27/07/2026

- Gestión funcional de usuarios desde la cuenta administradora principal.
- Cambio de PIN del administrador y de los usuarios.
- Alta de administradores secundarios.
- Teléfono y correo obligatorios y únicos para cada cuenta.
- Bloqueo y reactivación de accesos.

## Beta 1.1 — 27/07/2026

- Publicación inicial mediante GitHub Pages.
- Acceso principal y panel de incidencias.
- Módulo guiado para activar asistencia 24H.
- Búsqueda escribiendo DFM o matrícula.
- Alta manual de vehículos no incluidos en la base.
- Manual operativo en formato PDF.
