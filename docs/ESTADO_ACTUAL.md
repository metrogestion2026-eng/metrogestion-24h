# Estado de Metrogestión clean-r1

Fecha de validación: 17/08/2026

## Aislamiento

- Rama de código: `clean-r1`.
- Base de datos: proyecto gratuito `metrogestion-pruebas` (`aemoouldgguyjsxrfuwo`).
- Producción `programa de gestión` no se ha modificado.
- La configuración y la Content Security Policy de `clean-r1` solo permiten conectar con `metrogestion-pruebas`.
- No existe service worker ni actualización automática en `clean-r1`.
- Cada prueba publicada es inmutable y utiliza una carpeta distinta.
- Alpha 4 permanece en `r1-alpha4`.
- Alpha 5 está publicada en `https://metrogestion2026-eng.github.io/metrogestion-24h/r1-alpha5/`.
- Las publicaciones únicamente añaden carpetas `r1-*`; no sustituyen archivos de v36 o v39.

## Migraciones aplicadas en metrogestion-pruebas

1. `001_core_tables`: estructura inicial.
2. `002_security_functions`: usuario activo, permisos y dispositivos.
3. `003_rls_policies`: RLS y privilegios mínimos en todas las tablas públicas.
4. `004_private_security_core`: funciones privilegiadas encerradas en `app_private`.
5. `005_audit_and_no_physical_delete`: auditoría automática, versiones y bloqueo del borrado físico desde la app.
6. `006_hotel_source_views`: fuentes nuevas `hotel_actual` y `hotel_por_dia` con `security_invoker`.
7. `007_indexes_and_rls_initplan`: índices de claves foráneas y optimización de políticas.
8. `008_bootstrap_admin_config`: activación inicial de un único administrador principal de pruebas.
9. `009_hotel_edit_pilot`: ficha piloto, carga completa y guardado atómico con control de versión.
10. `010_audit_request_context`: referencia común para agrupar todos los cambios de un mismo guardado.
11. `011_noop_updates_without_audit`: los guardados sin cambios no aumentan versiones ni generan auditoría.
12. `012_ignore_generated_stage_position_in_noop`: evita falsos cambios por la posición activa calculada de las T.
13. `013_bootstrap_config_explicit_deny`: denegación RLS explícita sobre la configuración de activación inicial.
14. `014_hotel_card_stage_summary`: nueva fuente `hotel_actual_detalle`, que conserva las columnas de Hotel y añade el resumen ordenado de todas las T para mostrarlas en cada ficha.

## Seguridad validada

- El rol `anon` no tiene SELECT sobre Hotel ni usuarios.
- El rol `anon` no puede ejecutar las funciones de dispositivo ni las de edición.
- Un autenticado sin perfil ve cero registros.
- Administrador principal: ve y edita Hotel.
- Usuario de solo lectura: puede consultar con dispositivo autorizado, pero no modificar.
- Usuario editor: puede consultar y modificar con dispositivo autorizado.
- Las modificaciones autorizadas quedan auditadas.
- Las funciones de guardado son `security invoker`, verifican permiso, dispositivo, versión y ficha autorizada.
- La contraseña no se guarda en GitHub ni en la conversación.
- La activación inicial quedó cerrada después de crear el administrador principal.
- `hotel_actual_detalle` usa `security_invoker`, por lo que respeta las mismas políticas RLS que Hotel.

Resultado de pruebas de perfiles y permisos: **10 de 10 correctas**.

## Auditoría y guardado piloto

La ficha piloto es la única habilitada para edición durante esta fase.

El guardado:

- comprueba la versión abierta antes de modificar;
- actualiza ficha, T y trabajos dentro de una única transacción;
- anula o restaura sin borrado físico;
- permite añadir T y trabajos;
- permite cambiar el orden de las T;
- registra valor anterior, valor nuevo, usuario y referencia común del guardado.

Validaciones:

- Guardado sin cambios: versión sin aumento y 0 eventos de auditoría.
- Cambio simultáneo de ficha, T y trabajo: una única transacción auditada.
- Alta, anulación y reordenación de T: correctas dentro de una única transacción.
- La primera modificación humana quedó guardada: la ficha alcanzó la versión 2.
- La base registra por separado el cambio de la ficha y el cambio posterior de una T.

## Modelo Hotel validado

- Solo puede existir una pizarra en curso.
- `hotel_actual` y `hotel_actual_detalle` muestran únicamente movimientos activos.
- Las reservas liberadas, fichas canceladas y fichas retiradas no aparecen en Hotel activo.
- `hotel_por_dia` conserva todos los registros del día, incluidos cancelados y reservas liberadas.
- Las T canceladas no alteran los recuentos activos.
- Alpha 5 muestra dentro de cada ficha todas las T activas, ordenadas por posición.
- Cada T muestra nombre, estado, lugar, fecha aplicable y observaciones.
- Las T realizadas aparecen diferenciadas de las que están en curso, programadas o pendientes.
- Las T anuladas se conservan en un bloque desplegable de histórico.

## Código de la aplicación

Versión: `r1.0.0-alpha.5`.

- Login solo mediante el botón Entrar.
- Identificador criptográfico de dispositivo.
- Una única interfaz para todos los perfiles.
- Hotel abre siempre en modo lectura.
- El administrador con permiso puede activar `Lectura y edición`.
- Solo la ficha piloto ofrece `Abrir edición completa` en esta fase.
- El formulario incluye todos los campos de la ficha, todas las T y sus trabajos.
- Cancelar, retirar, anular y restaurar no borran físicamente.
- Las T son visibles en la ficha de Hotel incluso cuando está en modo lectura.
- Hotel carga desde `hotel_actual_detalle`.
- Histórico continúa cargando por día desde `hotel_por_dia`.
- Panel permanece EN CONSTRUCCIÓN.

## Estado del bloque actual

Pendiente de validación humana de Alpha 5:

1. Confirmar que aparece `r1.0.0-alpha.5`.
2. Comprobar que la ficha del vehículo 2516 muestra sus 3 T:
   - 1T Entrada en taller, realizada.
   - 2T Diagnóstico y reparación, en curso.
   - 3T Recogida en taller, programada.
3. Comprobar que `TEST-R1487` muestra sus 2 T.
4. Confirmar que las T se ven también con Hotel bloqueado en modo lectura.
5. No se ampliará la edición al resto de fichas hasta validar esta presentación.
