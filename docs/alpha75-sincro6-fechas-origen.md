# Alpha75 · SINCRO 6 · procedencia de fechas y retención de propuestas

Fecha: 1 de noviembre de 2026. Estado: candidata para revisión, sin instalación
en Apps Script ni aplicación de SQL remoto.

## Problema y resultado

La fecha contextual que el registro antiguo llamaba `fecha_necesidad` podía
proceder de una visita prevista, de un hecho real o de la creación del trabajo.
Usarla para identificar o crear una necesidad en MANTENIMENT podía dar por
diferentes dos filas equivalentes o añadir una necesidad con significado falso.
Además, una propuesta histórica podía permanecer en la cola después de una
revisión manual de la hoja.

El ejecutor candidato exige procedencia explícita antes de crear o vincular
trabajos. Una propuesta sin esa procedencia conserva íntegro su payload y queda
pendiente antes de autorizar, crear journal, escribir en Sheets/Drive o emitir
un ACK. La retención no equivale a cancelación, obsolescencia ni aplicación.

## Significados independientes

| Concepto | Campo del contrato candidato | Tratamiento |
| --- | --- | --- |
| Día del caso, evento o vencimiento de la necesidad | `fecha_necesidad_origen` | Fecha civil `YYYY-MM-DD`; única fuente admitida para I de un trabajo creado o vinculado |
| Momento previsto de llevar el vehículo al taller | `fecha_programada_visita` | Instante con zona horaria, o `null`; no sustituye a la necesidad |
| Inicio real del trabajo | `fecha_inicio_real` | Hecho independiente; no prueba por sí solo una entrada física |
| Fin real del trabajo | `fecha_fin_real` | Hecho independiente; no prueba por sí solo una recogida |
| Realización del trabajo | `fecha_real` | Hecho independiente; puede acreditar una realización administrativa cuando corresponda |
| Fecha contextual heredada | `fecha_necesidad` | Se conserva en el payload original; el cliente v2 no la usa para I ni para la clave de necesidad |

La preferencia por un dato manual requiere la misma identidad, el mismo campo
y el mismo significado. Una diferencia entre la necesidad y la cita no es por
sí sola un conflicto. La lectura de trabajos conserva ahora el taller manual
no vacío de F antes de usar una regla derivada de la designación.

## Contrato de creación v2

`metrogestionFechaNecesidadOrigenTrabajo_` es una comprobación sin efectos.
Exige versión numérica `2`, contexto vigente booleano `true`,
`retener_propuesta === false`, motivos de retención presentes y vacíos, fecha
de origen válida y procedencia `manteniment` o `necesidad_declarada`.

Los cuatro campos de agenda y hechos deben existir, aunque su valor sea `null`.
Un valor presente debe ser un instante ISO válido con zona horaria explícita.
Los espacios, fechas no canónicas, días inexistentes, versiones en texto y
contratos incompletos no se convierten en valores por defecto.

Si se propone completar J o K, también se exige una prueba con exactamente
`hecho` y `fecha_hora`. J acepta `entrada_taller` y K acepta `recogida_taller`.
El día civil propuesto debe coincidir con el del hecho en `Europe/Madrid`.
Cuando se acreditan ambos hechos físicos, la recogida no puede preceder a la
entrada, incluso dentro de un mismo día o con offsets diferentes.

Para un tipo administrativo, `realizacion_administrativa` puede acreditar el
campo correspondiente si su instante coincide con `fecha_real`. El cliente
no convierte el comienzo o fin de trabajo en una entrada o recogida. Tampoco
inventa un hito ausente para completar otro.

La clave de necesidad usa la fecha de origen. La autorización sigue enviando
el payload recibido sin reescribirlo, con la huella del servidor intacta.
Una fila manual compatible se reutiliza; un conflicto conserva el bloqueo
del plan completo.

## Exportador SQL conservador

La [candidata SQL](../supabase/candidates/README-alpha75-fechas-origen-v2.md)
modifica únicamente el exportador de propuestas sin fuentes. Esas propuestas
no acreditan todavía una fecha de necesidad de origen: todas se publican con
origen nulo y retención explícita. Se conservan los valores legacy para
auditoría y se exponen por separado los instantes de la etapa actual.

El contexto requiere un estado operativo reconocido por el código, una
pizarra en curso y un único registro no cancelado ni retirado del seguimiento
entre todas las pizarras en curso. Los históricos y contextos ambiguos siguen
visibles, con motivo adicional de retención.

Esta candidata no cambia las fechas almacenadas, el registrador, el importador,
las colas ni las barreras. Está fuera de `supabase/migrations`. Su preflight
exige la definición base acreditada o la misma definición candidata, y las
pruebas verifican conservación de propietario, OID y ACL e idempotencia.
Un cliente antiguo no es compatible con el significado del nuevo exportador;
conservar los campos legacy no autoriza desplegarlo por separado.

## Versiones y diagnóstico estructural

| Elemento | Identificador |
| --- | --- |
| Revisión local del código (`buildVersion`) | `alpha75-2026.11.01.1` |
| Identidad de transporte (`scriptVersion`) | `alpha75-2026.10.26.1` |
| Protocolo del ejecutor | `MG75-EJECUCION-ORDEN-001` |

La identidad de transporte permanece en el valor que exigen SQL y Edge.
Cambiarla solo en el cliente hace que el servidor retenga la entrega. La
revisión de código se identifica por separado; `buildVersion` no se envía como
un campo nuevo ni demuestra qué versión está instalada en Google. La lectura
de telemetría antigua tampoco acredita esa instalación.

El [diagnóstico de inserciones](alpha75-diagnostico-inserciones-001.md) usa
las posiciones reales y el orden de los cortes para comprobar las referencias
originales. Distingue una expresión que cambiaría de otra que permanece igual.
No habilita una inserción antes retenida: sigue faltando la cobertura del libro
fuera de A:Q y de las fórmulas copiadas o creadas durante el plan.

## Verificación y límites de la candidata

Las suites ejecutan el GS distribuido sobre una plataforma sintética, el
exportador candidato sobre PostgreSQL en memoria y el recorrido de entrega,
autorización y ACK sobre PostgreSQL 17 nativo aislado por socket. Los fixtures
contienen exclusivamente datos ficticios. El positivo v2 utiliza una necesidad
declarada sintética; no afirma que el exportador actual ya pueda producirla.

Las negativas comprueban conservación de la hoja, ausencia de efectos y ACK,
persistencia de la propuesta completa y el mismo resultado después de reiniciar.
El diagnóstico de fórmulas incluye un oráculo independiente con 448
combinaciones de posiciones de origen, destino y corte.

Persisten trabajos distintos de esta corrección:

- Acreditar y persistir la necesidad de origen para los trabajos sin fuentes,
  sin convertir fechas contextuales históricas en necesidades manuales.
- Revisar el contrato de `trabajos_asignados`, que conserva su ruta legacy de
  completar huecos; estas comprobaciones nuevas de procedencia cubren
  `trabajos_crear`.
- Completar la reconciliación del importador para actualizar datos de la app
  cuando una fuente manual inequívoca del mismo significado prevalece.
- Acreditar la cobertura estructural completa y probar en Google el plan con
  sus datos, fórmulas nuevas y metadatos. Una inserción de fila vacía no valida
  ese plan completo.

Las pruebas locales no constituyen una aplicación de órdenes operativas ni
una validación de una copia actual de todo el libro. La candidata no se
presenta como sustitución lista para pegar y ejecutar en producción.
