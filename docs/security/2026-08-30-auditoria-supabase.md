# Auditoría de seguridad de Supabase — 2026-08-30

Proyecto: `metrogestion-pruebas` (`aemoouldgguyjsxrfuwo`)

## Resultado

- Security Advisor antes: 30 avisos, incluidos 8 errores de exposición de datos o bypass de RLS.
- Security Advisor después: 0 errores de base de datos y 0 advertencias de base de datos.
- Único aviso restante: protección de contraseñas filtradas de Supabase Auth desactivada.
- Tablas públicas sin RLS: 0.
- Funciones `SECURITY DEFINER` en el esquema público: 0.
- Relaciones accesibles por `anon`: 0.
- Funciones públicas ejecutables por `anon`: 1, exclusivamente el webhook `recibir_snapshot_manteniment(text,jsonb)`.
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
   - el único acceso anónimo permitido es el webhook de MANTENIMENT, que valida su clave dentro de `app_private`.

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
- El webhook anónimo existe como pasarela sin privilegios de propietario.
- En el momento de la prueba, la actualización automática de MANTENIMENT estaba desactivada y rechazó la llamada de prueba antes de procesar datos.
- El bucket `hotel-documentos` es privado y tiene políticas limitadas a usuarios autenticados/autorizados.
- El bucket `metrogestion-r1-preview` permanece público para archivos estáticos de vista previa; no existe política de escritura anónima.
- La búsqueda del repositorio no encontró claves `service_role`, claves secretas modernas ni uso de GraphQL.

## Acción pendiente en Supabase Auth

Activar **Leaked Password Protection** en la configuración de seguridad de contraseñas de Auth y volver a ejecutar Security Advisor:

https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection

Este ajuste pertenece a la configuración del servicio Auth y no está disponible mediante el conector utilizado para la auditoría.
