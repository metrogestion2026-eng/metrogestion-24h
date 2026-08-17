# Estado de Metrogestión clean-r1

Fecha de validación: 17/08/2026

## Aislamiento

- Rama de código: `clean-r1`.
- Base de datos: proyecto gratuito `metrogestion-pruebas` (`aemoouldgguyjsxrfuwo`).
- Producción `programa de gestión` no se ha modificado.
- La configuración y la Content Security Policy solo permiten conectar con `metrogestion-pruebas`.
- No existe service worker ni actualización automática.
- Cada prueba publicada es inmutable y utiliza una carpeta distinta.
- Alpha 4, Alpha 5 y Alpha 6 permanecen separadas.
- Alpha 6: `https://metrogestion2026-eng.github.io/metrogestion-24h/r1-alpha6/`.
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

## Seguridad validada

- `anon` no puede consultar Hotel, usuarios ni funciones de edición.
- Administrador principal: consulta y edita.
- Solo lectura: consulta con dispositivo autorizado, pero no modifica.
- Editor: consulta y modifica con dispositivo autorizado.
- Las funciones de guardado son `security invoker` y comprueban permiso, dispositivo, versión y ficha.
- Las modificaciones quedan auditadas.
- La contraseña no se guarda en GitHub ni en la conversación.
- Las vistas `hotel_actual_detalle` y `hotel_importacion_drive_previa` respetan RLS.
- Las tablas de importación solo son visibles para el administrador principal.

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

Se creó una instantánea aislada de la pizarra del 17/08/2026:

- filas de origen: 232–250;
- 19 filas capturadas;
- 10 movimientos con reserva;
- 1 movimiento sin reserva;
- 2 reservas en taller sin flota asignada;
- 6 reservas libres;
- 13 números de parada;
- 0 números de parada duplicados;
- 0 avisos automáticos de formato.

La instantánea está en staging. No se ha aplicado a `registros_hotel`, `etapas_hotel`, Histórico ni producción.

## Código de la aplicación

Versión publicada: `r1.0.0-alpha.6`.

- Conserva Hotel, editor, T visibles e Histórico de Alpha 5.
- Añade el módulo exclusivo del administrador principal `Hotel real · Previa`.
- La previa muestra los 19 registros, los números de parada de la columna L, los estados originales, las T anotadas y el INC pendiente de rellenar.
- Separa visualmente movimientos y reservas libres.
- No contiene ningún botón para aplicar o modificar la instantánea.
- Panel permanece EN CONSTRUCCIÓN.

## Estado del bloque actual

Pendiente de validación humana de Alpha 6:

1. Abrir `Hotel real · Previa`.
2. Confirmar que aparecen 19 filas.
3. Confirmar que se muestran 13 paradas numeradas.
4. Revisar la separación entre 13 movimientos/reservas en taller y 6 reservas libres.
5. Confirmar que la columna L aparece como `Nº de parada` y que `INC manual` aparece separado.
6. Después se definirá la transformación de estados y T, sin aplicar todavía los datos al Hotel activo.
