# r1.0.0-alpha.71 · VALIDADA Y CERRADA

Fecha de publicación: 02/09/2026

Fecha de validación: 04/09/2026

Estado: **VALIDADA POR EL USUARIO Y CERRADA**.

Commit remoto de cierre:
- `88bbe1333c4b855953da640845a51cd33b1a57c1`

Enlace histórico:
- https://metrogestion2026-eng.github.io/metrogestion-24h/r1-alpha71/

## Reglas de cierre

- La carpeta `r1-alpha71` queda inmutable.
- No se modificará ni se sobrescribirá su código.
- Cualquier corrección o mejora posterior se realizará en `r1-alpha72` o una versión posterior.
- Alpha72 y las versiones siguientes deberán conservar íntegramente las funciones validadas de Alpha71.
- Alpha70 y todas las versiones cerradas anteriores permanecen intactas.

## Funciones validadas

- Se conserva íntegramente todo lo validado en Alpha70.
- La sincronización del maestro `ALTA` distingue fecha de matriculación en I y fecha de alta en J.
- El fin de contrato se calcula desde la matriculación y la próxima ITV inicial a un año.
- Activos permite alta, edición y baja lógica con devolución controlada a MANTENIMENT.
- Hotel genera filas `PARADA` vinculadas y aplica el mapeo operativo de A a Q.
- `TANCAMENT n` queda marcado en rosa pastel hasta la supervisión del administrador principal.
- La navegación de Hotel conserva pantalla, filtro, bloque seleccionado y edición durante las actualizaciones automáticas.
- Los catálogos de la ficha son editables, muestran el listado al abrirse y permanecen cerrados inicialmente en móvil.
- El módulo 24H conserva los datos de la llamada y recupera la ficha temporal al volver a Metrogestión.
- Histórico busca globalmente todas las fichas sin quedar limitado por la fecha seleccionada.
- Crear nueva ficha permite crear conjuntamente sus T y trabajos mediante una operación atómica.
- El guardado conjunto de las T conserva el número de parada asignado a la ficha.
- Los resultados y avisos del Panel son interactivos y abren la ficha o el módulo correspondiente.

## Verificaciones finales

- Las siete pruebas automáticas propias de Alpha71 finalizaron correctamente.
- Todos los módulos JavaScript de `r1-alpha71/src` superaron la comprobación de sintaxis.
- El Google Apps Script de MANTENIMENT superó la comprobación de sintaxis.
- El árbol funcional local coincide con el publicado en la rama `main` al cierre.
- Las migraciones de sincronización bidireccional, seguridad privada, Activos, creación conjunta de ficha y T, fecha de matriculación y protección del número de parada están instaladas en Supabase.
- La configuración privada de MANTENIMENT tiene la clave activa y un intervalo objetivo de seis horas.
- La última sincronización comprobada el 04/09/2026 terminó con estado `correcta`: 140 filas recibidas, 140 ALTA, 1 insertada y 139 sin cambios.
- El asesor de seguridad de Supabase no muestra incidencias ni tablas públicas con RLS desactivado.
- Las tablas públicas comprobadas mantienen RLS activo; la configuración secreta permanece en `app_private`.

## Continuidad

- Alpha72 parte de una copia funcional exacta de Alpha71, salvo su identificador visible de versión.
- Alpha72 es la única versión abierta para nuevos cambios.
- MANTENIMENT continúa siendo la base madre.
