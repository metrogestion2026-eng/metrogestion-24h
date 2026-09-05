# Alpha72 · comprobaciones técnicas finales

Fecha de creación: 04/09/2026

Fecha de comprobación final: 05/09/2026

Estado: **pruebas superadas y validación aceptada por el usuario**.

## Código y publicación

- Las 15 pruebas automáticas Alpha71/72 finalizaron correctamente.
- Todos los módulos JavaScript de `r1-alpha72/src` superaron la comprobación de sintaxis.
- El módulo compartido de presencia y el Google Apps Script de MANTENIMENT superaron la comprobación de sintaxis.
- Todas las referencias locales de las entradas Alpha63, Alpha69 y Alpha72 apuntan a archivos existentes.
- Las rutas públicas Alpha63 y Alpha69 cargan la edición validada Alpha72.
- Los módulos públicos principales de Alpha72 respondieron correctamente desde GitHub Pages.

## Base de datos e integridad

- Los objetos correspondientes a las nueve migraciones Alpha72 están instalados y operativos.
- Los RPC de lectura, creación y edición Alpha72 están instalados.
- Los disparadores de reapertura, coherencia diferida, cierre de pendientes y registro de accesos están activos.
- No existen reservas repetidas entre fichas activas de una misma Pizarra.
- No existen posiciones activas de T duplicadas dentro de una ficha.
- No existen fichas activas que conserven realizada su T final de recuperación o liberación.
- No existen anotaciones manuales vacías ni resoluciones de pendientes sin fecha.
- No existen sesiones de acceso duplicadas ni accesos huérfanos de usuario.

## Seguridad

- `registros_hotel`, `etapas_hotel`, `anotaciones_manuales_hotel`, `reservas_pendientes_resueltos` y `accesos_usuario` mantienen RLS activado.
- `anon` no puede ejecutar los RPC administrativos de presencia ni de edición Alpha72.
- `authenticated` no dispone de lectura directa sobre el registro privado de accesos.
- El asesor no muestra errores críticos propios de Alpha72.
- Permanece la recomendación general de Auth para activar la protección contra contraseñas filtradas.
- El aviso informativo de que `accesos_usuario` no tiene políticas es intencionado: no admite lectura directa y solo se consulta mediante la función administrativa protegida.

## Confirmación en uso

- Tras actualizar el acceso antiguo, la conexión activa se registró como `r1.0.0-alpha.72`.
- El marcador de accesos conserva una sola entrada por sesión autenticada, aunque existan varias pestañas o pulsos automáticos.
