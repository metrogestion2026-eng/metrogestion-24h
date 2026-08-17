# Estado de Metrogestión clean-r1

Fecha de validación: 17/08/2026

## Aislamiento

- Rama de código: `clean-r1`.
- Base de datos: proyecto gratuito `metrogestion-pruebas` (`aemoouldgguyjsxrfuwo`).
- Producción `programa de gestión` no se ha modificado.
- La configuración y la Content Security Policy de `clean-r1` solo permiten conectar con `metrogestion-pruebas`.
- No existe service worker ni actualización automática en `clean-r1`.

## Migraciones aplicadas en metrogestion-pruebas

1. `001_core_tables`: estructura inicial.
2. `002_security_functions`: usuario activo, permisos y dispositivos.
3. `003_rls_policies`: RLS y privilegios mínimos en todas las tablas públicas.
4. `004_private_security_core`: funciones privilegiadas encerradas en `app_private`.
5. `005_audit_and_no_physical_delete`: auditoría automática, versiones y bloqueo del borrado físico desde la app.
6. `006_hotel_source_views`: fuentes nuevas `hotel_actual` y `hotel_por_dia` con `security_invoker`.
7. `007_indexes_and_rls_initplan`: índices de claves foráneas y optimización de políticas.

## Seguridad validada

- El rol `anon` no tiene SELECT sobre Hotel ni usuarios.
- El rol `anon` no puede ejecutar las funciones de dispositivo.
- Un autenticado sin perfil ve cero registros.
- Administrador principal: ve todos los perfiles, ve Hotel y edita sin depender de un dispositivo autorizado.
- Usuario de solo lectura: ve su perfil y Hotel con dispositivo autorizado, pero no puede modificarlo.
- El mismo usuario con dispositivo incorrecto no ve Hotel.
- Usuario editor: ve y modifica Hotel con dispositivo autorizado.
- Las modificaciones autorizadas quedan auditadas.
- Revisión automática de seguridad de Supabase: cero avisos.

Resultado de pruebas de perfiles y permisos: **10 de 10 correctas**.

## Auditoría validada

Una prueba transaccional de alta y modificación de taller produjo:

- versión final de la ficha: 2;
- eventos de auditoría: `INSERT` y `UPDATE`;
- ningún dato de prueba persistente después del rollback.

## Modelo Hotel validado

- Solo puede existir una pizarra en curso.
- `hotel_actual` muestra únicamente movimientos activos.
- Las reservas liberadas no aparecen en Hotel activo.
- Las fichas canceladas no aparecen en Hotel activo.
- Las fichas retiradas del Hotel activo no aparecen en Hotel activo.
- `hotel_por_dia` conserva todos los registros del día, incluidos cancelados, retirados y reservas liberadas.
- Las T canceladas no alteran los recuentos activos.

Resultado de pruebas del modelo: **7 de 7 correctas**.

## Rendimiento

- No quedan claves foráneas sin índice.
- No quedan advertencias de inicialización repetitiva en RLS.
- Supabase únicamente informa de índices todavía no utilizados, algo normal porque la base de pruebas aún está vacía.

## Código de la aplicación

Versión: `r1.0.0-alpha.2`.

- Login solo mediante el botón Entrar.
- Identificador criptográfico de dispositivo.
- Comprobación de cuenta activa y dispositivo.
- Una única interfaz para todos los perfiles.
- Hotel en lectura desde `hotel_actual`.
- Histórico por día desde `hotel_por_dia` y sus T.
- Panel permanece expresamente EN CONSTRUCCIÓN.

## Siguiente bloque

1. Crear una cuenta permanente de administrador principal exclusivamente en `metrogestion-pruebas`.
2. Cargar un conjunto pequeño y reconocible de datos de prueba.
3. Publicar una vista previa aislada de `clean-r1` sin sustituir ningún enlace actual.
4. Validar login, dispositivo, Hotel e Histórico en navegador real.
5. Solo después habilitar el primer formulario de edición de Hotel.
