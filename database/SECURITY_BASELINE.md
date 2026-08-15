# Línea base de seguridad · no aplicada a producción

Fecha de revisión: 15/08/2026.
Proyecto revisado: `njtohfkqjjoavtumtmza`.

## Hallazgos que bloquean una publicación definitiva

1. La vista `public.resumen_paradas_gestion` está definida con comportamiento SECURITY DEFINER.
2. Existen funciones SECURITY DEFINER ejecutables por el rol `anon`, incluidas operaciones capaces de modificar Hotel, T, paradas, correcciones, sincronización y auditoría.
3. Varias funciones privilegiadas son ejecutables por cualquier usuario autenticado; deben revisarse una por una y conservar únicamente las necesarias con validación interna de permiso.
4. `public.auditoria_hotel_undo`, `public.contadores_parada`, `public.paradas_hotel` y `public.registro_sincronizaciones` tienen RLS activada sin políticas. Debe decidirse expresamente si son solo internas o necesitan políticas concretas.
5. La protección de contraseñas filtradas de Supabase Auth está desactivada.
6. `taller_contactos` permite arrays de teléfonos y correos, pero el requisito vigente exige una fila/recuadro por teléfono y una extensión opcional. Será necesaria una migración controlada del modelo.

## Orden de corrección

1. Crear una rama de desarrollo de Supabase o una copia separada de la base.
2. Respaldar esquema, datos, Auth, funciones y políticas.
3. Revocar `EXECUTE` de `anon` en funciones no públicas.
4. Revisar cada función SECURITY DEFINER y fijar comprobaciones de sesión, usuario activo, permiso y dispositivo.
5. Convertir o sustituir la vista SECURITY DEFINER.
6. Definir políticas para tablas con RLS sin políticas o moverlas a un esquema no expuesto.
7. Añadir auditoría uniforme para INSERT, UPDATE, cancelación, restauración y cambios históricos.
8. Migrar contactos de taller a una fila por teléfono con campo de extensión.
9. Ejecutar pruebas automatizadas por perfiles: anónimo, usuario bloqueado, solo lectura, editor, administrador secundario y administrador principal.
10. Aplicar a producción únicamente tras superar las pruebas y disponer de reversión.

## Decisión actual

No se ha aplicado ninguna modificación de seguridad a producción porque un cambio directo de grants, RLS o funciones podría interrumpir v36/v39. La nueva aplicación se desarrolla separada y en modo lectura hasta disponer de un entorno de prueba de base de datos.
