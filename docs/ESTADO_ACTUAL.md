# Estado de Metrogestión clean-r1

Fecha de validación: 17/08/2026

## Aislamiento

- Rama de código: `clean-r1`.
- Base de datos: proyecto gratuito `metrogestion-pruebas` (`aemoouldgguyjsxrfuwo`).
- Producción `programa de gestión` no se ha modificado.
- La configuración y la Content Security Policy de `clean-r1` solo permiten conectar con `metrogestion-pruebas`.
- No existe service worker ni actualización automática en `clean-r1`.
- Vista previa aislada: `https://metrogestion2026-eng.github.io/metrogestion-24h/r1-preview/`.
- La publicación en `main` utiliza exclusivamente la carpeta `r1-preview`; no sustituye ni modifica archivos de v36 o v39.

## Migraciones aplicadas en metrogestion-pruebas

1. `001_core_tables`: estructura inicial.
2. `002_security_functions`: usuario activo, permisos y dispositivos.
3. `003_rls_policies`: RLS y privilegios mínimos en todas las tablas públicas.
4. `004_private_security_core`: funciones privilegiadas encerradas en `app_private`.
5. `005_audit_and_no_physical_delete`: auditoría automática, versiones y bloqueo del borrado físico desde la app.
6. `006_hotel_source_views`: fuentes nuevas `hotel_actual` y `hotel_por_dia` con `security_invoker`.
7. `007_indexes_and_rls_initplan`: índices de claves foráneas y optimización de políticas.
8. `008_bootstrap_admin_config`: activación inicial de un único administrador principal de pruebas, con código temporal, caducidad, límite de intentos y cierre automático después del uso.
9. `009_hotel_edit_pilot`: ficha piloto, carga completa de ficha/T/trabajos y guardado atómico con control de versión.
10. `010_audit_request_context`: referencia común para agrupar todos los cambios de un mismo guardado.
11. `011_noop_updates_without_audit`: los guardados sin cambios no aumentan versiones ni generan auditoría.
12. `012_ignore_generated_stage_position_in_noop`: evita falsos cambios provocados por la posición activa calculada de las T.
13. `013_bootstrap_config_explicit_deny`: denegación RLS explícita sobre la configuración de activación inicial.

## Seguridad validada

- El rol `anon` no tiene SELECT sobre Hotel ni usuarios.
- El rol `anon` no puede ejecutar las funciones de dispositivo ni las de edición.
- Un autenticado sin perfil ve cero registros.
- Administrador principal: ve todos los perfiles, ve Hotel y edita sin depender de un dispositivo autorizado.
- Usuario de solo lectura: ve su perfil y Hotel con dispositivo autorizado, pero no puede modificarlo.
- El mismo usuario con dispositivo incorrecto no ve Hotel.
- Usuario editor: ve y modifica Hotel con dispositivo autorizado.
- Las modificaciones autorizadas quedan auditadas.
- Las funciones de guardado son `security invoker`, verifican permiso, dispositivo y ficha autorizada, y no contienen privilegios elevados.
- La contraseña de pruebas se creó en el navegador y no se guardó en GitHub ni en la conversación.
- La activación inicial quedó cerrada después de crear el administrador principal.

Resultado previo de pruebas de perfiles y permisos: **10 de 10 correctas**.

## Auditoría y guardado piloto

La ficha `TEST-2604` es la única habilitada para edición durante esta fase.

El guardado:

- comprueba la versión abierta antes de modificar;
- actualiza ficha, T y trabajos dentro de una única transacción;
- anula o restaura sin borrado físico;
- permite añadir T y trabajos;
- permite cambiar el orden de las T mediante una restricción diferible;
- registra valor anterior, valor nuevo, usuario y una referencia común del guardado.

Pruebas transaccionales realizadas, todas revertidas al terminar:

- carga completa: ficha, 3 T, trabajos, 10 estados y maestro de talleres;
- guardado sin cambios: versión sin aumento y **0 eventos de auditoría**;
- cambio simultáneo de ficha, una T y un trabajo: versión de ficha 2 y **3 eventos de auditoría**;
- los valores modificados fueron devueltos correctamente por la misma transacción;
- ningún cambio de estas pruebas quedó persistente.

## Modelo Hotel validado

- Solo puede existir una pizarra en curso.
- `hotel_actual` muestra únicamente movimientos activos.
- Las reservas liberadas no aparecen en Hotel activo.
- Las fichas canceladas no aparecen en Hotel activo.
- Las fichas retiradas del Hotel activo no aparecen en Hotel activo.
- `hotel_por_dia` conserva todos los registros del día, incluidos cancelados, retirados y reservas liberadas.
- Las T canceladas no alteran los recuentos activos.

Resultado de pruebas del modelo: **7 de 7 correctas**.

## Datos reconocibles de prueba

Se ha cargado un conjunto pequeño, exclusivamente ficticio:

- dos pizarras: día actual y día anterior;
- dos movimientos activos visibles en Hotel: `TEST-2604` y `TEST-R1487`;
- una reserva ocupada y una reserva libre;
- seis T, incluido un trabajo AV con diagnóstico de prueba;
- una ficha cancelada que solo aparece en Histórico;
- un taller ficticio con un contacto, teléfono separado y extensión `123`;
- una unidad DAF para comprobar la regla de cuatro años o 640.000 km.

No se ha copiado ningún dato operativo de producción.

## Código de la aplicación

Versión: `r1.0.0-alpha.4`.

- Login solo mediante el botón Entrar.
- Identificador criptográfico de dispositivo.
- Comprobación de cuenta activa y dispositivo.
- Una única interfaz para todos los perfiles.
- Hotel abre siempre en modo lectura.
- El administrador con permiso puede activar `Lectura y edición`.
- Solo `TEST-2604` muestra el botón `Abrir edición completa` en esta fase.
- El formulario incluye todos los campos actuales de la ficha, todas las T y sus trabajos.
- Cancelar, retirar, anular y restaurar no borran datos físicamente.
- Hotel en lectura desde `hotel_actual`.
- Histórico por día desde `hotel_por_dia` y sus T.
- Panel permanece expresamente EN CONSTRUCCIÓN.

## Estado del bloque actual

Pendiente de validación humana en navegador real:

1. Comprobar que la versión visible es `r1.0.0-alpha.4`.
2. Confirmar que Hotel abre protegido en `Modo lectura`.
3. Activar `Lectura y edición` y comprobar que únicamente `TEST-2604` ofrece `Abrir edición completa`.
4. Abrir el formulario y revisar ficha, 3 T y trabajo AV.
5. Realizar una modificación sencilla y guardar.
6. Confirmar que la ficha vuelve a cargarse con la versión aumentada y el valor modificado.
7. No se habilitará la edición para el resto de fichas hasta completar estas comprobaciones.
