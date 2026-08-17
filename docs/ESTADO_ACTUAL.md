# Estado de Metrogestión clean-r1

Fecha de validación: 17/08/2026

## Aislamiento

- Rama de código: `clean-r1`.
- Base de datos: proyecto gratuito `metrogestion-pruebas` (`aemoouldgguyjsxrfuwo`).
- Producción `programa de gestión` no se ha modificado.
- La configuración y la Content Security Policy de `clean-r1` solo permiten conectar con `metrogestion-pruebas`.
- No existe service worker ni actualización automática en `clean-r1`.
- Vista previa aislada: `https://metrogestion2026-eng.github.io/metrogestion-24h/r1-preview/`.
- La publicación en `main` añadió exclusivamente la carpeta `r1-preview`; no sustituyó ni modificó archivos de v36 o v39.

## Migraciones aplicadas en metrogestion-pruebas

1. `001_core_tables`: estructura inicial.
2. `002_security_functions`: usuario activo, permisos y dispositivos.
3. `003_rls_policies`: RLS y privilegios mínimos en todas las tablas públicas.
4. `004_private_security_core`: funciones privilegiadas encerradas en `app_private`.
5. `005_audit_and_no_physical_delete`: auditoría automática, versiones y bloqueo del borrado físico desde la app.
6. `006_hotel_source_views`: fuentes nuevas `hotel_actual` y `hotel_por_dia` con `security_invoker`.
7. `007_indexes_and_rls_initplan`: índices de claves foráneas y optimización de políticas.
8. `008_bootstrap_admin_config`: activación inicial de un único administrador principal de pruebas, con código temporal, caducidad, límite de intentos y cierre automático después del uso.

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
- La activación inicial solo acepta peticiones desde la vista previa autorizada y se bloquea durante quince minutos después de cinco códigos erróneos.
- La contraseña de pruebas se crea en el navegador y no se guarda en GitHub ni en la conversación.

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

## Datos reconocibles de prueba

Se ha cargado un conjunto pequeño, exclusivamente ficticio:

- dos pizarras: día actual y día anterior;
- dos movimientos activos visibles en Hotel: `TEST-2604` y `TEST-R1487`;
- una reserva ocupada y una reserva libre;
- seis T, incluido un trabajo AV con diagnóstico de prueba;
- una ficha cancelada que solo debe conservarse en Histórico;
- un taller ficticio con un contacto, teléfono separado y extensión `123`;
- una unidad DAF para comprobar la regla de cuatro años o 640.000 km.

No se ha copiado ningún dato operativo de producción.

## Rendimiento

- No quedan claves foráneas sin índice.
- No quedan advertencias de inicialización repetitiva en RLS.
- Supabase únicamente informa de índices todavía no utilizados, algo normal en una base de pruebas recién creada.

## Código de la aplicación

Versión: `r1.0.0-alpha.3`.

- Login solo mediante el botón Entrar.
- Identificador criptográfico de dispositivo.
- Comprobación de cuenta activa y dispositivo.
- Una única interfaz para todos los perfiles.
- Hotel en lectura desde `hotel_actual`.
- Histórico por día desde `hotel_por_dia` y sus T.
- Panel permanece expresamente EN CONSTRUCCIÓN.
- Activación inicial de administrador disponible únicamente mientras no exista ninguna cuenta.

## Validaciones de publicación

- GitHub Pages publicó correctamente el commit de la vista previa.
- La entrada responde `200` como `text/html`.
- CSS y módulos JavaScript responden con sus tipos correctos.
- `src/config.js` identifica la versión `r1.0.0-alpha.3`.
- La función de activación reconoce el origen de GitHub Pages y confirma que la activación está abierta y sin bloqueo.
- Las funciones temporales utilizadas para publicar por otros caminos quedaron cerradas después de la comprobación.

## Estado del bloque actual

Pendiente de validación humana en navegador real:

1. Crear la cuenta permanente de administrador principal en `metrogestion-pruebas` mediante el código temporal entregado fuera del repositorio.
2. Entrar con la contraseña nueva de pruebas.
3. Confirmar que Hotel muestra `TEST-2604` y `TEST-R1487`.
4. Confirmar que Histórico abre la pizarra del día anterior y conserva la reserva liberada y la ficha cancelada.
5. No se habilitará ningún formulario de edición hasta completar estas cuatro comprobaciones.
