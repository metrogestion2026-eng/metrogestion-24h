# Candidata: fechas explícitas en propuestas de creación

Estado: **construida para ensayo; no instalada ni registrada como migración**.

La candidata `alpha75_export_fechas_origen_v2.sql` sustituye únicamente
`app_private.manteniment_trabajos_por_crear(uuid)`. No cambia el registrador de
trabajos, el importador, las tablas, las fechas almacenadas, las colas, los acuses
ni las barreras de sincronización.

## Problema que delimita

El exportador anterior entrega `fecha_necesidad` desde una columna técnica que
puede haber sido rellenada con una fecha real, prevista o de creación de la app.
Su nombre no acredita que sea el evento o vencimiento de MANTENIMENT. Además,
`fuentes=[]` significa que falta una vinculación acreditada; no demuestra que el
trabajo falte en la hoja.

Esta candidata mantiene visibles las mismas propuestas y sus datos heredados,
pero identifica el contrato de fechas y retiene todas las propuestas cuyo origen
no está acreditado. No ejecuta una conciliación ni habilita escrituras.

## Contrato de salida

| Campo | Significado en esta candidata |
| --- | --- |
| `contrato_fechas_version` | `2` |
| `fecha_necesidad_origen` | `null`: estos trabajos tienen `fuentes=[]` |
| `procedencia_fecha_necesidad` | `no_acreditada` |
| `fecha_necesidad` | Valor técnico heredado, conservado sin reinterpretación |
| `significado_fecha_necesidad` | `contextual_legacy_no_acreditada` |
| `fecha_programada_visita` | `etapa_actual.fecha_prevista`, como timestamp o `null` |
| `fecha_inicio_real`, `fecha_fin_real`, `fecha_real` | Valores directos de la etapa actual resuelta, con sus vacíos conservados |
| `etapa_fechas_id` | Identidad de la etapa de la que proceden los timestamps |
| `procedencia_fecha_programada_visita` | `etapas_hotel.fecha_prevista` |
| `procedencia_hitos_reales` | `etapas_hotel` |
| `contexto_operativo_vigente` | Estado operativo reconocido y un único registro no cancelado/no retirado del seguimiento entre todas las pizarras en curso |
| `retener_propuesta` | `true` mientras la necesidad de origen no esté acreditada |
| `motivos_retencion` | Origen no acreditado; también contexto no vigente o ambiguo cuando corresponda |

Los timestamps se serializan directamente desde PostgreSQL: conservan el instante
y la zona representada por la sesión. No se recortan a fecha de calendario ni se
rellenan unos hitos con otros. Los campos heredados `fecha_entrada` y
`fecha_salida` permanecen sin cambios; no acreditan por sí solos los nuevos hitos.

Los filtros preexistentes sobre cancelaciones, trabajos ya vinculados y 24H se
conservan. No se añade un filtro para ocultar las propuestas históricas: se
devuelven con el indicador y los motivos de retención.

El estado del registro se acredita mediante una lista explícita tomada de
`r1-alpha75/src/hotel-operational-state.js`: los seis `PRE_ENTRY_STATES`, los tres
`EXCEPTION_STATES` y los estados operativos que esa función deriva expresamente:
`entrada_taller_programada`, `en_taller`, `terminado_pendiente_recogida`,
`recogido_pendiente_ruta` y `asistencia_24h`. Un estado desconocido, vacío o nulo
no acredita vigencia. `realizada` se conserva porque está expresamente admitido
entre los estados previos de una ficha por el código; las condiciones de
retirada, cancelación y pizarra siguen siendo obligatorias.

La unicidad se comprueba globalmente para el seguimiento en todas las pizarras
`en_curso`, no solo en la pizarra escogida por la consulta existente. Se cuentan
todos sus registros no cancelados/no retirados, de forma conservadora: otro
registro incoherente no se oculta para declarar una identidad única. Dos
pizarras en curso con registros activos del mismo seguimiento producen contexto
no acreditado y retención. Los estados personalizados no incluidos requerirán
una revisión explícita; esta lista no pretende descubrir nuevas reglas de negocio.

## Base, privilegios y alcance de instalación

La definición base se capturó mediante `pg_get_functiondef` el 01/11/2026;
su MD5 es `87cbb18160b9c88696ae38a98ce7d577`. La prueba de PGlite reproduce esa
misma definición antes de instalar la candidata sobre datos sintéticos.
La definición candidata tras la revisión de vigencia tiene MD5
`e7d3262d1aebacb0f057551019dc3e7a`; ese valor se verifica en el preflight para
permitir su segunda aplicación sin aceptar una definición diferente.

La candidata usa una transacción y rechaza una función ausente o una definición
distinta de la base acreditada y de la propia candidata. La segunda aplicación
de la misma candidata es válida. `CREATE OR REPLACE` conserva el propietario y
los privilegios; no se añaden permisos. Se mantienen la firma, `STABLE`,
`SECURITY DEFINER` y el `search_path` existente, con relaciones cualificadas.

El CLI de Supabase no estaba instalado en el entorno de preparación. Por ello
este archivo se conserva fuera de `supabase/migrations`: no se inventa un nombre
de migración ni se presenta como un cambio desplegado.

Antes de una instalación debe estar validada la puerta del cliente que exija la
versión 2, necesidad de origen acreditada, contexto vigente y ausencia de
retención. El cliente debe usar exclusivamente `fecha_necesidad_origen` para el
dato de origen; nunca debe recurrir al campo heredado. La compatibilidad de los
campos anteriores no convierte esta candidata en segura para un cliente antiguo.
Las órdenes ya almacenadas no se regeneran, aplican, cancelan ni confirman por
instalar este exportador.

## Verificación reproducible

Desde `tests/sql`, con Node 24 y las dependencias fijadas en `package-lock.json`:

```sh
npm ci --ignore-scripts
node alpha75-export-fechas-origen.test.mjs
```

La suite usa PostgreSQL de PGlite 0.3.16 en memoria, el exportador base real y la
función real de resolución de etapa sobre un esquema mínimo. Todas las filas
son sintéticas; no se conecta a servidores, hojas ni colas reales.

Comprueba la reproducción del contrato ambiguo, fechas reales y agenda vacía,
agenda independiente, hechos reales nulos, propuestas históricas visibles,
estados cerrados o retirados, registros ambiguos, etapa actual frente a copia
histórica, preservación de campos y orden, filtros anteriores, privilegios,
datos y rechazo de una base distinta. No acredita el recorrido completo de
sincronización ni la instalación en Apps Script o en un servidor.
