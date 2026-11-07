# Alpha75 · Fórmulas manuales y recepción protegida

Candidata `alpha75-2026.11.07.12`. Conserva la versión de transporte
`alpha75-2026.10.26.1` y el protocolo `MG75-EJECUCION-ORDEN-001`.
La candidata requiere instalación y aceptación separadas; este documento no
acredita un envío operativo, una ejecución en Google ni una reparación de datos
históricos del servidor.

## Las fórmulas son contenido

Una fórmula que muestra vacío sigue ocupando la celda. El criterio compartido
de completar huecos conserva esa fórmula y su resultado, sin reemplazarla por
el valor propuesto ni escribir ese valor en la copia de planificación.

Se aplica a las celdas completadas de PARADA y de trabajos, incluidas las fechas
I/J/K. Un resultado calculado no vacío que contradiga una propuesta mantiene el
conflicto manual existente. Las fechas I/J de una PARADA ya existente siguen
sin reescribirse.

Las rutas de asignación y reutilización de trabajos no colorean una recogida
si K conserva una fórmula vacía. Una E calculada vacía tampoco se convierte en
una actuación ni recibe un vínculo como si fuera un hueco. El enlace del archivo
no sustituye una E calculada por texto enriquecido.

Si un cambio de periodo necesita completar una K que contiene una fórmula
vacía, se retiene el cambio completo: no se modifica la fórmula ni se abre otro
tramo fingiendo que el anterior quedó cerrado.

## Plan, comprobación y recibo

La comprobación previa conserva tanto la expresión como el resultado visible
usado al planificar. Un cambio durante la autorización invalida ese plan.

La comparación posterior ya usa la expresión R1C1 para las celdas con fórmula.
Por eso un recálculo legítimo de L/P al completar K no convierte el resultado
en incierto. Una expresión alterada sí impide el ACK. Las celdas sin fórmula,
las notas, los formatos, los enlaces y la identidad T conservan sus
comparaciones estrictas.

## Enviar la hoja sin ejecutar salidas

La función pública `metrogestionEnviarHojaAMetrogestion()` envía la fotografía
completa al receptor. El servidor importa datos; por eso no se denomina una
operación global de solo lectura. Esta entrada no modifica celdas, fórmulas,
notas, filtros o activadores y no ejecuta órdenes, autorización ni ACK.

Antes de solicitar la fotografía:

- Adquiere el bloqueo del script y exige que no haya ciclo, acuse, diario o
  solicitud de entrega pendientes o inciertos.
- Valida el preflight existente, la identidad del archivo y la compatibilidad.
- Exige `solo_lectura_manual_protegida=true`, `escritura_segura_manual=false`
  y `pausa_importacion_identidad=false`. No modifica ninguna bandera.

Utiliza el mismo capturador de los cinco feeds, incluidas las comprobaciones
de ID_FILA. La ruta habitual de ejecución conserva su requisito de una
selección real de órdenes; esta entrada no crea, sustituye ni consulta un
alcance para simularlo.

La respuesta completa se conserva antes de examinarla. Debe acreditar salida
protegida y una lista vacía de órdenes. Se comprueban de nuevo las barreras
antes de informar del éxito. Una respuesta inesperada o una interrupción
conservan la evidencia y no activan un reintento automático.

El registro final distingue expresamente fotografía recibida, cero escrituras
en la hoja y sincronización total pendiente. El ciclo y los recibos existentes
no se presentan como terminados por esta nueva recepción.

## Verificación

Los ensayos ejecutan el GS distribuido sobre una plataforma Google sintética,
sin conectarse a hojas o servidores operativos. Las 26 regresiones específicas
cubren fórmulas vacías y no vacías, recálculo, alteración, reutilización,
reintento, recogida calculada, cambio de periodo, barreras, incertidumbre y
conservación íntegra de respuestas. Las suites relacionadas de identidad T,
cliente, preflight y fechas también forman parte de la comprobación:

```bash
node --test tests/alpha75-sync-executor-*.test.mjs \
  tests/alpha75-insertion-formula-diagnostic.test.mjs \
  tests/security-alpha75-preflight-client.test.mjs
```

Las dos suites nuevas usan el prefijo `alpha75-sync-executor-` para formar
parte del paso de sincronización del CI existente.
