# r1.0.0-alpha.70 · VALIDADA Y CERRADA

Fecha de publicación: 31/08/2026

Fecha de validación: 02/09/2026

Estado: VALIDADA POR EL USUARIO Y CERRADA.

Commit de cierre:
- `32373e410fe9e4925cd7f8d201262d87090202f2`

Enlace histórico:
- https://metrogestion2026-eng.github.io/metrogestion-24h/r1-alpha70/

## Reglas de cierre

- La carpeta `r1-alpha70` queda inmutable.
- No se modificará ni se sobrescribirá su código.
- Cualquier corrección o mejora posterior se realizará en `r1-alpha71` o una versión posterior.
- Alpha71 y todas las versiones siguientes deberán conservar íntegramente las funciones validadas de Alpha70.
- Alpha69 permanece validada, cerrada e inmutable.

## Funciones validadas

- Se conservan la seguridad, la presencia en tiempo real, los rangos y los bloqueos validados en Alpha69.
- Se conservan las fechas operativas, la sustitución y la facturación validadas en Alpha66.
- Se conservan el marcado rápido de T, la sincronización protegida de MANTENIMENT y el control diario de flota.
- La ficha completa utiliza catálogos editables para sus desplegables y mantiene control de versión.
- El buscador del Histórico responde por DFM, matrícula, número de parada, reserva, incidencia, T y documentación.
- El resumen operativo, el Histórico y el Panel determinan la última T por su fecha efectiva de realización.
- Panel y Listados permiten imprimir, guardar PDF, compartir el PDF como archivo y exportar una hoja de cálculo XLSX.
- Reservas permite crear nuevas reservas según permisos.
- La pestaña Activos muestra la flota de Supabase y permite alta, edición, baja lógica y reactivación protegidas.

## Verificaciones finales

- Todos los módulos JavaScript propios de `r1-alpha70/src` superaron `node --check`.
- La prueba automática del buscador del Histórico finalizó correctamente.
- La prueba automática de la última T confirmó `2T · Recogida Autodis` como última ejecutada.
- La publicación histórica cargó `r1.0.0-alpha.70` en GitHub Pages.
- No se observaron errores propios de Alpha70 durante la carga pública.
- El asesor de Supabase no muestra tablas públicas con RLS desactivado ni incidencias críticas.
- Permanecen advertencias conocidas sobre dos RPC de Activos con comprobaciones internas de usuario, dispositivo y permisos, además de la recomendación general de Auth para contraseñas filtradas. Su endurecimiento se realizará en Alpha71 sin modificar Alpha70.

## Continuidad

- Alpha71 parte de una copia exacta de Alpha70.
- Alpha71 incorporará la sincronización bidireccional de las fechas I/J de ALTA y la generación controlada de filas PARADA en MANTENIMENT.
- MANTENIMENT continúa siendo la base madre.
