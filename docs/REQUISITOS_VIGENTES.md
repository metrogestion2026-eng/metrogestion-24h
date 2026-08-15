# Requisitos vigentes de creación

## Principios obligatorios

- Una única aplicación, una única interfaz y una única fuente de datos.
- Administrador y usuarios cargan los mismos archivos; únicamente cambian los permisos efectivos.
- Hotel es el punto único de recogida de datos y alimenta Histórico, Reservas, T programadas, futuros informes y módulos derivados.
- Ninguna solución provisional se considera definitiva.
- No se modifican versiones validadas: cada entrega es identificable y recuperable.
- Los cambios de diseño o concepto deben poder incorporarse sin alterar la integridad de los datos ni romper módulos no relacionados.
- Toda cancelación o supresión es lógica y auditable; no elimina el histórico.

## Contratos de vehículos

- Iveco: 550.000 km o el límite temporal aplicable, lo que venza primero.
- Mercedes: 475.000 km o el límite temporal aplicable, lo que venza primero.
- Volvo y MAN: 450.000 km o el límite temporal aplicable, lo que venza primero.
- DAF: cuatro años o 640.000 km, lo que venza primero. Esta condición específica prevalece sobre la regla general de tractoras.
- Regla general restante: tractoras tres años y rígidos cuatro años.

## Hotel

- Pizarra diaria por fecha real.
- Modo lectura por defecto.
- El administrador principal puede rectificar, añadir, modificar, cancelar, restaurar o suprimir cualquier dato de Hotel, incluidas todas las T.
- Campos mínimos: flota/R, matrículas, reserva, nº parada, fechas, movimiento, marca, motor, modelo, UPC, teléfono, lugar, taller, causa, trabajos de reserva, INC, próximo, observaciones, prioridad 0–5, estado y T.
- Deben conservarse usuario, fecha, valor anterior y valor nuevo de cada modificación.
- Una corrección histórica debe propagarse a las pizarras posteriores afectadas sin borrar la trazabilidad.
- Reservas libres y movimientos activos se muestran separados.
- Relevos temporales se muestran en ambas paradas y quedan en el histórico.

## T y expedientes

- Añadir, editar, realizar, dejar pendiente, anular, restaurar, reordenar y suprimir lógicamente.
- Una T puede contener varios trabajos: AV, M, GP, GC, GM, MCD, EXT, RO, MB, ITV, 44TN, TMG y RT.
- Datos de T: nombre, posición, taller, centro, lugar, fechas prevista/inicio/fin/real, estado, observaciones, trabajos, diagnóstico, km, pedidos/OR, documentos, fotos y correos.
- La edición global de Hotel debe incluir íntegramente las T y sus expedientes.

## Histórico

- Búsqueda por un día concreto.
- Al seleccionar el día aparece la pizarra completa de esa fecha, no un resumen mensual.
- La pizarra histórica puede rectificarse por usuarios autorizados después de desbloquear la edición.
- Todo cambio queda auditado y mantiene el estado original y la versión corregida.

## Panel

- El diseño anterior queda retirado.
- El Panel permanece EN CONSTRUCCIÓN hasta su rediseño completo.
- Cuando se reconstruya, su única fuente será Hotel.

## Talleres y contactos

- Un taller puede tener centros y tantos contactos como sean necesarios.
- Cada teléfono se muestra en un recuadro independiente.
- Cada recuadro contiene contacto, cargo, teléfono, extensión opcional, correo, observaciones, indicador de principal y uso para envíos.
- Dos teléfonos distintos no comparten el mismo recuadro, aunque pertenezcan a la misma persona.

## Seguridad

- Autenticación mediante Supabase Auth.
- Cuenta activa obligatoria.
- Dispositivo autorizado obligatorio salvo administrador principal.
- RLS activa en todas las tablas expuestas.
- Ninguna función con privilegios elevados será ejecutable por `anon` salvo justificación documentada.
- Las funciones `SECURITY DEFINER` deben validar usuario, permisos, dispositivo y fijar `search_path` seguro.
- `service_role` nunca aparece en frontend, repositorio público, almacenamiento local ni mensajes.
- Documentos en bucket privado con rutas ligadas a T/parada y políticas RLS.
- Registro de accesos, cambios y operaciones administrativas.
- Copias de seguridad verificables antes de migraciones de esquema o permisos.
