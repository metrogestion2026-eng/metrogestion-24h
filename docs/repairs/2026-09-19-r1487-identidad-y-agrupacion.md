# R1487: identidad de T y agrupación por F

Aplicado el 19/09/2026 por petición del usuario. Parada 2600152.

## Causa comprobada

Las T originales conservaban `seguimiento_id` al copiarse, pero las rutas de
propagación y reactivación omitían `grupo_documental_id`. El trigger de documentos
calculaba otro grupo. El importador resolvía la T vigente por el grupo documental
y materializaba otra T con el grupo anterior, aunque los trabajos ya estuvieran
en la T original. En R1487 las siete T activas sobrantes no tenían trabajos.

Había además cuatro T anuladas procedentes de agrupaciones antiguas. No contenían
trabajos ni documentos. Los cinco trabajos vigentes estaban en las T originales.

La planificación también separaba visitas del mismo F por modalidad y podía
degradar una visita vinculada a «pendiente de taller» cuando llegaba F vacío.

## Corrección general aplicada

- La T actual se resuelve primero por su identidad operativa `seguimiento_id`.
  El grupo documental solo es una compatibilidad para datos sin copia por identidad.
- Propagación y ambas rutas de reactivación copian explícitamente el grupo
  documental. La copia diaria ya lo conservaba.
- Un índice único impide repetir la identidad de una T dentro de una ficha.
- Los importadores concurrentes bloquean los seguimientos en orden antes de
  preparar sus candidatos; no compiten con planes de identidades obsoletos.
- Las nuevas visitas usan una clave por F normalizado, sin separar reparación,
  mantenimiento, trámite y gestión. Nuevas H se incorporan como trabajos.
- La modalidad se calcula sobre la visita completa. Una reparación añadida a una
  gestión reutiliza la T y añade la recogida que corresponde. Un trámite incluido
  en una visita de taller no suprime su recogida.
- Una necesidad vinculada que llega con F vacío conserva la visita asignada.
  Los cambios de F actualizan el lugar de las T automáticas abiertas conservando
  identidades, trabajos y fechas reales. La búsqueda de una T previa cuando aún
  no existe una visita excluye las realizadas.

La migración no contiene identificadores de R1487. La limpieza de sus datos
heredados está separada en `2026-09-19-r1487.sql`, con verificaciones que abortan
si aparecen trabajos, documentos, fechas o vínculos en una T que se va a retirar.
No es un borrado periódico para ocultar duplicados: el importador y las rutas que
copian las T quedan corregidos antes de retirar los datos sobrantes.

## Resultado de R1487

| T | Lugar / trabajo |
|---|---|
| 1 | Entrada DIRECAUTO: GP y BPW como trabajos |
| 2 | Recogida DIRECAUTO |
| 3 | Entrada FRIGICOLL: MCD |
| 4 | Recogida FRIGICOLL |
| 5 | UPC: gestión LKT |
| 6 | APPLUS VILAFRANCA: ITV |
| 7 | Recuperar ruta y liberar reserva |

Se retiraron once T de la ficha actual y sus copias vacías: 119 filas en total.
No queda ninguna T anulada en este seguimiento. Los cinco trabajos conservan
exactamente sus IDs y todos sus campos, incluido `EXP-5150942`. No había documentos
en las T retiradas. La auditoría sigue habilitada. No quedan vínculos huérfanos.

F se contrastó con las seis filas actuales de MANTENIMENT antes de aplicar:
6678, 6680, 6685, 6687, 6688 y 6692. No se modificó la hoja.

## Verificación

Todas las pruebas previas se ejecutaron en transacciones revertidas:

- Doce comprobaciones de identidad y agrupación: tres pasadas reales de R1487,
  F vacío, combinación de gestión/trámite/reparación, repetición del lote,
  ampliación de una gestión con una reparación en otra sincronización,
  propagación histórica y copia diaria con la función real del cambio de día.
- Seis regresiones de agrupación: 2719, ITV/44TN, cierre parcial y conjunto,
  MCD/ACT. El fixture ahora obtiene la ficha vigente en vez de fijar el UUID de
  un día anterior.
- Nueve regresiones de J/K: fechas reales, zona horaria, cierre conjunto,
  REPUESTOS, entrada/recogida y exclusión de anuladas o fechas desconocidas.

Después de aplicar la migración y la limpieza, tres importaciones reales
consecutivas de las seis filas dieron `t_creadas=0` y `trabajos_creados=0`.
La comparación de los cinco trabajos antes/después fue idéntica. Advisors no
añadió avisos de seguridad y se conservaron los permisos de las funciones.

## Entrega

Migración: `20260919064206_alpha75_identidad_operativa_y_visita_por_lugar.sql`.
Prueba nueva: `tests/alpha75-identidad-visita-por-lugar.sql`.

La corrección está aplicada en la base compartida y guardada en la rama de
revisión de Alpha75. No se publicó una versión nueva del frontend ni se cambió
Apps Script. La PR 17 continúa como borrador.
