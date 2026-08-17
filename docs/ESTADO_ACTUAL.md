# Estado de Metrogestión clean-r1

Fecha de validación: 17/08/2026

## Aislamiento

- Rama de código: `clean-r1`.
- Base de datos: proyecto gratuito `metrogestion-pruebas` (`aemoouldgguyjsxrfuwo`).
- Producción `programa de gestión` no se ha modificado.
- La configuración y la Content Security Policy solo permiten conectar con `metrogestion-pruebas`.
- No existe service worker ni actualización automática.
- Cada prueba publicada es inmutable y utiliza una carpeta distinta.
- Alpha 4, Alpha 5, Alpha 6 y Alpha 7 permanecen separadas.
- Alpha 7: `https://metrogestion2026-eng.github.io/metrogestion-24h/r1-alpha7/`.
- Las publicaciones solo añaden carpetas `r1-*`; no sustituyen archivos de v36 o v39.

## Migraciones aplicadas en metrogestion-pruebas

1. `001_core_tables`: estructura inicial.
2. `002_security_functions`: usuario activo, permisos y dispositivos.
3. `003_rls_policies`: RLS y privilegios mínimos.
4. `004_private_security_core`: funciones privilegiadas en `app_private`.
5. `005_audit_and_no_physical_delete`: auditoría, versiones y bloqueo del borrado físico.
6. `006_hotel_source_views`: fuentes `hotel_actual` y `hotel_por_dia`.
7. `007_indexes_and_rls_initplan`: índices y optimización RLS.
8. `008_bootstrap_admin_config`: activación inicial del administrador principal.
9. `009_hotel_edit_pilot`: ficha piloto y guardado atómico.
10. `010_audit_request_context`: referencia común por guardado.
11. `011_noop_updates_without_audit`: guardados sin cambios no generan versiones ni auditoría.
12. `012_ignore_generated_stage_position_in_noop`: evita falsos cambios de posición.
13. `013_bootstrap_config_explicit_deny`: denegación RLS explícita del bootstrap.
14. `014_hotel_card_stage_summary`: T visibles dentro de cada ficha.
15. `015_hotel_drive_staging`: zona aislada de captura y validación de la hoja Hotel real.
16. `016_hotel_transformation_preview`: reglas declarativas y vista de transformación previa de estados, T y efectos finales.

## Seguridad validada

- `anon` no puede consultar Hotel, usuarios ni funciones de edición.
- Administrador principal: consulta y edita.
- Solo lectura: consulta con dispositivo autorizado, pero no modifica.
- Editor: consulta y modifica con dispositivo autorizado.
- Las funciones de guardado son `security invoker` y comprueban permiso, dispositivo, versión y ficha.
- Las modificaciones quedan auditadas.
- La contraseña no se guarda en GitHub ni en la conversación.
- Las vistas de importación y transformación respetan RLS.
- Las tablas de importación y reglas de transformación solo son visibles para el administrador principal.

Resultado de pruebas de perfiles y permisos: **10 de 10 correctas**.

## Edición y T

- La primera modificación humana quedó guardada y auditada.
- La ficha piloto alcanzó la versión 2.
- Las T se muestran dentro de la ficha en modo lectura.
- Se diferencian T realizadas, en curso, programadas, pendientes y anuladas.
- El editor mantiene un único guardado para ficha, T y trabajos.
- Cancelar, retirar, anular y restaurar no borran físicamente.

## Hotel real actualizado

Fuente conectada: libro `RESERVAS 2026`, hoja `8`.

Se confirmó en la cabecera del 17/08/2026:

- columna L = `PARADA`;
- el valor se interpreta como `Nº de parada`, nunca como expediente;
- el campo `INC` continúa separado;
- las incidencias se rellenarán manualmente y quedarán vinculadas a la parada.

Instantánea aislada:

- filas 232–250;
- 19 filas capturadas;
- 13 movimientos o reservas en taller;
- 6 reservas libres;
- 13 números de parada;
- 0 números duplicados;
- 0 avisos de formato.

La instantánea sigue en staging y no se ha aplicado a Hotel, T, Histórico ni producción.

## Reglas de transformación confirmadas

- `LIBRE` y `LLIURE`, aplicados a una reserva, significan reserva disponible para asignar y poder parar otra unidad de flota.
- `OPERATIVO` significa vehículo de flota que no necesitó sustitución y vuelve directamente a su ruta.
- `RECUPERAR`, cuando existió sustitución, devuelve la flota a ruta y libera la reserva.
- `24H` significa asistencia activa y propone prioridad 1.
- `PENDENT TALLER` se transforma en pendiente de taller.
- `AL TALLER dd/mm/aa` se transforma en realizando trabajos en taller y propone la fecha de entrada sin inventar la hora.
- Talleres y trabajos reconocidos: AUTODIS, STERN, ODEXAN, DIRECAUTO, FRIGICOLL, VOLVO, HWASUNG, ITV, RODES y ALINEADO.

Resultado automático:

- 19 de 19 filas con regla de estado reconocida;
- 31 de 31 T reconocidas;
- 0 T sin regla;
- 8 fechas de entrada extraídas;
- 10 finales `RECUPERAR`;
- 2 finales de liberación de reserva desde una T;
- 1 final `OPERATIVO` sin reserva;
- 11 prioridades todavía pendientes de asignación manual;
- 13 INC pendientes de rellenar manualmente.

## Código de la aplicación

Versión publicada: `r1.0.0-alpha.7`.

- Conserva Hotel, editor, T visibles, Histórico y la previa original.
- Añade `Transformación · Previa`, visible solo para el administrador principal.
- Cada ficha compara el dato original con el resultado propuesto.
- Muestra estado, fecha, prioridad, INC, T transformadas y efecto final.
- Distingue expresamente LIBRE/LLIURE, OPERATIVO y RECUPERAR.
- No contiene ningún botón para aplicar la transformación.
- Panel permanece EN CONSTRUCCIÓN.

## Estado del bloque actual

Pendiente de validación humana de Alpha 7:

1. Abrir `Transformación · Previa`.
2. Confirmar que aparecen 19 de 19 filas y 31 de 31 T reconocidas.
3. Revisar `LIBRE/LLIURE` como reserva disponible.
4. Revisar `OPERATIVO` como vuelta directa a ruta sin sustitución.
5. Revisar `RECUPERAR` como flota operativa más reserva liberada.
6. Revisar las fechas extraídas de los estados `AL TALLER`.
7. Después se preparará la pantalla para rellenar prioridades, horas e INC, todavía sin aplicar datos al Hotel activo.
