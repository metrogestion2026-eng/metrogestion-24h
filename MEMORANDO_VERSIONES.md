# Metrogestión 24H — Memorando de versiones

## r1.0.0-alpha.73 — 05/09/2026

- Versión de trabajo creada desde Alpha72 validada y cerrada.
- Hereda íntegramente todas las funciones de Alpha72.
- Permite añadir anotaciones auditadas desde cada ficha sin activar la edición completa; la operación no modifica ningún otro dato de Hotel.
- Protege el guardado completo con la identidad inmutable de registro, seguimiento, pizarra, parada, vehículos y reserva; además exige una confirmación visible con vehículo, parada y reserva.
- Corrige de forma localizada y auditable las dos anotaciones de R1304 que habían quedado asociadas por error a la parada 2600151 de R1443.
- Refuerza el servidor común: una credencial solo es válida si su `session_id` continúa en Auth, pertenece al mismo usuario y no ha vencido; cerrar una sesión invalida también sus operaciones sobre la base de datos.
- No está asignada a los usuarios y no sustituirá a Alpha72 sin autorización expresa.

## r1.0.0-alpha.72 — 04/09/2026

- Validada por el usuario y cerrada el 05/09/2026 sobre el commit remoto `3ba83cd48a8ec9e96545fbb33ca69a06d9abfe28`.
- La carpeta `r1-alpha72` queda inmutable; Alpha73 concentra las mejoras posteriores.
- Es la versión asignada a los usuarios y se mantendrá sin actualizar hasta nueva autorización expresa.
- Versión creada desde Alpha71 validada y cerrada.
- Hereda íntegramente Hotel, T, 24H, Panel, Histórico, Activos, Reservas, Listados, catálogos y sincronización MANTENIMENT de Alpha71.
- Cierra automáticamente los pendientes exactos de una reserva cuando su trabajo se marca realizado, conservando un histórico inmutable.
- Separa la modalidad operativa del vehículo sustituto real con los valores iniciales «Sin sustitución», «Reparado en ruta» y «Reserva en reparación».
- Cada ficha conserva siempre su número de parada y termina en Histórico; «Reparado en ruta» no genera recuperación y «Sin sustitución» solo la genera si la parada supera un día.
- Permite crear desde la pizarra actual una ficha cuya fecha real de parada sea anterior, sin sustituirla por la fecha de la pizarra.
- Admite varias entradas de taller dentro de una misma parada y conserva su cronología.
- Permite crear y editar anotaciones manuales con autoría, fechas y auditoría.
- Señala los campos incompatibles que impiden guardar una ficha.
- Reactiva fichas históricas de forma coherente, reabre la T final y evita mezclar reservas entre fichas activas.
- Clasifica los accesos no completados y añade un marcador por usuario con una sola entrada por sesión autenticada.
- Los enlaces heredados Alpha63 y Alpha69 cargan la Alpha72 validada.

## r1.0.0-alpha.71 — 02/09/2026

- Validada por el usuario y cerrada el 04/09/2026 sobre el commit remoto `88bbe1333c4b855953da640845a51cd33b1a57c1`.
- La carpeta `r1-alpha71` queda inmutable; Alpha72 concentra todas las mejoras posteriores.
- Versión creada desde Alpha70 validada y cerrada.
- Sincronización bidireccional del maestro `ALTA`: I es matriculación y J es alta en delegación.
- Fin de contrato calculado desde matriculación y próxima ITV inicial a un año.
- Altas, ediciones y bajas de Activos se devuelven al archivo madre sin borrar filas.
- Las fichas nuevas de Hotel generan una fila `PARADA` vinculada por identificador estable.
- Mapeo de `PARADA`: A DFM, B matrícula, C tipo, D UPC, G sustituto, H PARADA, I programada, J parada, K recuperación/corte, L días, O marca, P km y Q TANCAMENT.
- `TANCAMENT n` mantiene Q en rosa pastel hasta la supervisión del administrador principal y no cierra operativamente la ficha.
- Outbox privado, confirmaciones idempotentes, token protegido y wrappers públicos sin `SECURITY DEFINER` para Activos.
- Hotel conserva la pantalla, el filtro y la edición activa durante las actualizaciones automáticas.
- Los catálogos de la ficha son editables, muestran su listado bajo demanda y permanecen cerrados inicialmente para facilitar el uso móvil.
- La llamada 24H conserva los datos recopilados y recupera la ficha de llamada al volver a Metrogestión.
- Histórico busca todas las fichas independientemente de la fecha seleccionada.
- Crear nueva ficha permite guardar conjuntamente sus T y trabajos en una operación atómica.
- El número de parada recién asignado queda protegido al guardar conjuntamente las T.
- Los resultados y avisos del Panel abren directamente la ficha o el módulo operativo correspondiente.

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
