# r1.0.0-alpha.72 · VALIDADA Y CERRADA

Fecha de publicación: 04/09/2026

Fecha de validación: 05/09/2026

Estado: **VALIDADA POR EL USUARIO Y CERRADA**.

Commit remoto de cierre funcional:
- `3ba83cd48a8ec9e96545fbb33ca69a06d9abfe28`

Enlace histórico:
- https://metrogestion2026-eng.github.io/metrogestion-24h/r1-alpha72/

## Reglas de cierre

- La carpeta `r1-alpha72` queda inmutable.
- Alpha72 es la versión asignada actualmente a los usuarios.
- Los usuarios permanecerán en Alpha72 y no se actualizarán a Alpha73 ni a otra versión hasta que el usuario responsable lo autorice expresamente.
- Cualquier corrección o mejora posterior se realizará en `r1-alpha73` o una versión posterior.
- Alpha73 y las versiones siguientes deberán conservar íntegramente las funciones validadas de Alpha72.
- Alpha71 permanece intacta como base validada anterior.
- Los accesos heredados Alpha63 y Alpha69 continúan como entradas de compatibilidad hacia Alpha72 para que los usuarios no necesiten cambiar sus enlaces; su código histórico interno no se reutiliza.

## Funciones validadas

- Se conserva íntegramente todo lo validado en Alpha71.
- Una parada admite varias entradas de taller y mantiene su cronología completa.
- La modalidad operativa se separa del vehículo sustituto real: sin sustitución, reparado en ruta y reserva en reparación.
- Cada ficha conserva su número de parada y termina correctamente en Histórico.
- Las anotaciones manuales pueden crearse y modificarse, conservando autoría, fecha y auditoría.
- El editor señala y localiza los campos incompatibles que impiden guardar.
- La reactivación desde Histórico vuelve a situar la ficha en la Pizarra actual, reabre la T final y evita mezclar fichas que comparten reserva.
- Los pendientes exactos de una reserva se cierran automáticamente al realizar su trabajo y se conservan en un histórico inmutable.
- El panel de seguridad distingue identificación, contraseña rechazada, dispositivo reconocido y huella bloqueada.
- El marcador muestra accesos de hoy, últimos siete días, último acceso, dispositivo y versión por usuario.
- Cada sesión autenticada cuenta una sola vez; las pestañas y los pulsos automáticos no incrementan el marcador.
- Los enlaces Alpha63 y Alpha69 cargan la Alpha72 validada y registran la versión ejecutada como Alpha72.

## Verificaciones finales

- Las 15 pruebas automáticas Alpha71/72 finalizaron correctamente.
- Todos los módulos JavaScript de Alpha72 y el Google Apps Script superaron la comprobación de sintaxis.
- Los enlaces y recursos públicos de Alpha63, Alpha69 y Alpha72 respondieron correctamente.
- La conexión activa del usuario quedó registrada como `r1.0.0-alpha.72`.
- Los RPC, índices y disparadores de Alpha72 están instalados en Supabase.
- No hay reservas activas duplicadas, posiciones activas de T duplicadas, cierres finales incoherentes ni sesiones de acceso duplicadas.
- Las tablas públicas comprobadas mantienen RLS activo.
- Los RPC administrativos no son ejecutables por `anon` y el historial de accesos no admite lectura directa desde el navegador.
- No se detectaron errores críticos de seguridad propios de Alpha72.

## Continuidad

- Alpha73 parte de una copia funcional exacta de Alpha72, salvo su identificador visible de versión.
- Alpha73 es la única versión abierta para nuevos cambios.
- MANTENIMENT continúa siendo la base madre.
