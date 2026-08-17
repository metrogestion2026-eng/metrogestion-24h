# Estado de Metrogestión clean-r1

Fecha de validación: 17/08/2026

## Aislamiento

- Rama de código: `clean-r1`.
- Base de datos: proyecto gratuito `metrogestion-pruebas` (`aemoouldgguyjsxrfuwo`).
- Producción `programa de gestión` no se ha modificado.
- La configuración y la Content Security Policy solo permiten conectar con `metrogestion-pruebas`.
- No existe service worker ni actualización automática.
- Cada prueba publicada es inmutable y utiliza una carpeta distinta.
- Alpha 4, Alpha 5, Alpha 6, Alpha 7 y Alpha 8 permanecen separadas.
- Alpha 8: `https://metrogestion2026-eng.github.io/metrogestion-24h/r1-alpha8/`.
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
16. `016_hotel_transformation_preview`: reglas declarativas y vista de transformación previa.
17. `017_hotel_manual_review`: revisión manual separada para prioridad, INC, fecha y hora.
18. `018_harden_manual_review_writes`: escritura directa revocada; guardado únicamente mediante RPC validada y auditada.

## Seguridad validada

- `anon` no puede consultar Hotel, usuarios, transformación ni revisión manual.
- Administrador principal: consulta y edita según el módulo.
- Solo lectura: consulta con dispositivo autorizado, pero no modifica.
- Editor: consulta y modifica con dispositivo autorizado.
- La revisión manual solo es visible para el administrador principal.
- El rol autenticado puede leer la revisión, pero no puede insertar ni actualizar directamente la tabla de revisiones.
- El único camino de escritura es `guardar_revision_importacion_hotel`, que comprueba sesión, dispositivo, administrador principal, instantánea, fila, parada, prioridad, INC, fecha, hora y versión.
- Cada guardado queda agrupado por una referencia y registrado en auditoría.
- La instantánea original de Drive queda congelada; las correcciones se guardan en una tabla separada.
- La contraseña no se guarda en GitHub ni en la conversación.

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
- las incidencias se rellenan manualmente y quedan vinculadas a la parada.

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
- 11 prioridades pendientes de asignación manual;
- 13 INC pendientes de rellenar manualmente.

## Revisión manual

- Las 13 paradas activas requieren revisión.
- Las 6 reservas libres quedan resueltas automáticamente y no solicitan INC, prioridad ni hora.
- Prioridad admite valores 0–5.
- El Nº de parada se muestra bloqueado y no puede cambiarse desde esta pantalla.
- El INC se introduce junto a su parada y queda asociado a esa fila de origen.
- Las fichas `AL TALLER` muestran la fecha extraída y exigen una hora real antes de validarse.
- `PENDENT TALLER` y `24H` no exigen hora de entrada.
- Puede guardarse un borrador incompleto.
- La validación final exige todos los campos obligatorios.
- Una ficha validada puede reabrirse sin borrar su histórico.
- Se aplica control de versión para evitar sobrescribir una revisión modificada desde otra sesión.

Pruebas transaccionales:

- una ficha `AL TALLER` se validó con prioridad, INC, fecha y hora;
- una ficha `24H` se validó con prioridad 1 e INC sin exigir hora;
- ambas generaron auditoría;
- la transacción se revirtió y no quedó ningún dato de prueba persistente;
- escritura directa: denegada;
- escritura por RPC controlada: correcta.

## Código de la aplicación

Versión publicada: `r1.0.0-alpha.8`.

- Conserva Hotel, editor, T visibles, Histórico, previa original y transformación previa.
- Añade `Revisión manual`, visible únicamente para el administrador principal.
- Muestra las 13 paradas que deben completarse.
- Permite guardar borradores y validar cada ficha por separado.
- Muestra prioridad propuesta, INC vinculado, fecha recuperada, hora pendiente y T transformadas.
- Las fichas validadas se separan en un bloque desplegable.
- No contiene ningún botón de importar o aplicar.
- Panel permanece EN CONSTRUCCIÓN.

## Estado del bloque actual

Pendiente de validación humana de Alpha 8:

1. Abrir `Revisión manual`.
2. Confirmar que aparecen 13 fichas pendientes y 6 reservas libres automáticas.
3. Comprobar que las dos fichas 24H proponen prioridad 1 y no piden hora.
4. Comprobar que las ocho fichas `AL TALLER` muestran la fecha y piden hora.
5. Guardar primero un único borrador, sin validarlo.
6. Volver a abrirlo y confirmar que los datos permanecen.
7. Validar esa misma ficha y comprobar que pasa al bloque de validadas.
8. Todavía no se importará nada al Hotel activo.
