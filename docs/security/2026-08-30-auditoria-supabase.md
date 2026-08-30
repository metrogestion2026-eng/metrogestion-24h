# Auditoría de seguridad de Supabase — 2026-08-30

Proyecto: `metrogestion-pruebas` (`aemoouldgguyjsxrfuwo`)

## Resultado

- Security Advisor antes: 30 avisos, incluidos 8 errores de exposición de datos o bypass de RLS.
- Security Advisor después: 0 errores de base de datos y 0 advertencias de base de datos.
- Único aviso restante: protección de contraseñas filtradas de Supabase Auth desactivada.
- Tablas públicas sin RLS: 0.
- Funciones `SECURITY DEFINER` en el esquema público: 0.
- Relaciones accesibles por `anon`: 0.
- Funciones públicas ejecutables por `anon`: 0.
- Alpha66 y Alpha67 no se han modificado.

## Correcciones aplicadas

1. RLS habilitado en:
   - `public.medias_km_dfm`;
   - `public.cierres_facturacion`;
   - `public.config_facturacion_sustituciones`.

2. Permisos de facturación:
   - lectura de medias automáticas y cierres solo para usuarios autenticados, con dispositivo autorizado y acceso a Hotel o Histórico;
   - precio R solo para el administrador principal;
   - media manual solo para el administrador principal;
   - escrituras directas eliminadas; las modificaciones continúan por RPC protegida y auditada.

3. Vistas:
   - `hotel_actual_detalle`;
   - `listado_paradas_operativas`;
   - `paradas_sustitucion_resumen`;
   - `facturacion_dfm_periodos`;
   - `facturacion_r_sustituciones`.

   Todas usan `security_invoker=true`, respetan las políticas RLS del usuario y quedan en solo lectura.

4. RPC:
   - las implementaciones privilegiadas se han movido a `app_private`;
   - el esquema `public` conserva pasarelas `SECURITY INVOKER` con la misma firma, para no romper la aplicación;
   - se ha eliminado la ejecución anónima heredada;
   - la recepción de MANTENIMENT ya no está expuesta por Data API a `anon` ni a `authenticated`: entra exclusivamente por la Edge Function y se ejecuta internamente con `service_role` después de validar la clave.

5. Prevención:
   - los permisos por defecto del rol de migraciones `postgres` ya no conceden automáticamente CRUD ni ejecución a `anon` o `authenticated`;
   - las nuevas migraciones deberán conceder de forma explícita únicamente los permisos necesarios.

6. Políticas RLS:
   - optimizadas las evaluaciones de `auth.uid()` en `activaciones_24h`, `sugerencias` y `usuarios`;
   - Performance Advisor queda con 0 advertencias. Los avisos informativos de índices se conservan para no crear o retirar índices sin métricas reales de uso.

## Pruebas realizadas

- `anon` no puede leer las tablas ni las vistas corregidas.
- Un rol autenticado sin sesión/dispositivo autorizado obtiene 0 filas.
- `service_role` conserva acceso operativo: 12 medias, 12 cierres, 1 configuración y 28 paradas leídas durante la prueba.
- `authenticated` no puede actualizar directamente el precio R ni la media manual.
- Los RPC de recepción de MANTENIMENT no son ejecutables por `anon` ni por `authenticated`; `service_role` conserva exclusivamente el acceso interno requerido por la Edge Function.
- En el momento de la prueba, la actualización automática de MANTENIMENT estaba desactivada y rechazó la llamada de prueba antes de procesar datos.
- El bucket `hotel-documentos` es privado y tiene políticas limitadas a usuarios autenticados/autorizados.
- El bucket `metrogestion-r1-preview` permanece público para archivos estáticos de vista previa; no existe política de escritura anónima.
- La búsqueda del repositorio no encontró claves `service_role`, claves secretas modernas ni uso de GraphQL.

## Acción pendiente en Supabase Auth

Activar **Leaked Password Protection** en la configuración de seguridad de contraseñas de Auth y volver a ejecutar Security Advisor:

https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection

Este ajuste pertenece a la configuración del servicio Auth y no está disponible mediante el conector utilizado para la auditoría.

## Edge Functions

- `gestionar-usuarios-r1` y `gestionar-claves-r1`: JWT obligatorio y comprobación interna del administrador.
- `bootstrap-admin-r1`: la configuración estaba usada y caducada. Se retiró el código con `service_role`, se sustituyó por una respuesta fija `410 Gone` y se activó `verify_jwt=true`.
- `metrogestion-r1-preview` y `publish-preview-r1`: ya estaban cerradas con respuesta fija `410 Gone`; no acceden a datos ni contienen credenciales.
- `manteniment-sync-r1`: permanece sin JWT por diseño para Google Apps Script, pero exige una clave `mg_` de 256 bits, limita método, tipo y tamaño de la petición, y la valida por hash dentro de la base. El RPC directo está cerrado. El `service_role` solo se lee desde secretos del entorno y no está incluido en el cliente.


## Refuerzo de Alpha68

- Edge Function `manteniment-sync-r1` desplegada en versión 2 con respuestas no almacenables, validación estricta del formato de clave y sin CORS de navegador.
- Apps Script actualizado para llamar únicamente a la Edge Function; eliminada la clave pública de Supabase y la llamada directa a `/rest/v1/rpc`.
- Criterio comprobado contra la hoja privada el 30 de agosto: 135 filas exactamente `ALTA`, coincidentes con las 135 filas del snapshot inicial.
