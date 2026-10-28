# Continuidad del mismo sustituto entre PA: propuesta pendiente

Estado: propuesta para decisión de Metro. No modifica la Biblia, no está
implementada y no autoriza despliegue, sincronización ni reparto contable.

## Lo ya decidido

MG75-24H-PARADAS-SEPARADAS-002 exige una PA propia para la asistencia 24H y otra
para el taller posterior. La asistencia termina por su actuación. No se debe
duplicar la imputación del sustituto ni inventar una recuperación para separar
las PA. Los valores manuales y los periodos cerrados deben conservarse.

La regla aprobada que asigna el día del cambio al sustituto nuevo describe el
**cambio físico de sustituto dentro de una misma PA**. No fija expresamente el
cambio de PA cuando continúa el mismo sustituto. El cierre de la asistencia,
la entrada en taller y la devolución del sustituto son hechos distintos.

## Decisión concreta propuesta

Cuando el mismo sustituto sigue cubriendo al mismo vehículo afectado, propongo
que la **entrada real en taller**, confirmada expresamente y vinculada a la PA
de destino, inicie su nuevo tramo de imputación. El día de esa entrada
correspondería a la PA de taller; el tramo imputable a la PA anterior terminaría
el día previo.

Esto sería un traspaso de imputación entre dos PA identificadas, sin devolución
física ni liberación intermedia de la reserva. Se conservarían las fechas y
horas reales de asistencia, entrada en taller y recuperación. Si no existe una
fecha real acreditada de entrada, no se deduciría del cierre de la 24H ni de la
fecha del guardado.

**Pregunta pendiente:** ¿la entrada real al taller debe iniciar ese nuevo tramo,
asignando a la PA de taller el día de transición?

## Ejemplo para revisar la propuesta

Ejemplo sintético: un sustituto se entrega el 27/10; la asistencia termina ese
mismo día; el vehículo entra realmente al taller el 28/10 y el sustituto se
recupera el 30/10.

| Hecho o tramo | Propuesta |
| --- | --- |
| Asistencia 24H | Mantiene su PA y su fin real del 27/10 |
| Imputación a la PA de asistencia | 27/10: un día |
| Entrada al taller | 28/10: otra PA, con su fecha y hora reales |
| Imputación a la PA de taller | 28/10 a 30/10: tres días inclusivos |
| Ocupación física del sustituto | Continua del 27/10 al 30/10, sin una devolución ficticia el 28/10 |
| Total imputado | Cuatro días, sin duplicar el 28/10 |

Si la entrega y la entrada al taller fueran el mismo día, esta propuesta
permitiría cero días imputados a la primera PA. La asistencia y sus hechos
seguirían existiendo; no se aplicaría un mínimo por PA que duplique ese día.
Este caso también forma parte de la propuesta pendiente de aprobación.

## Condiciones de la futura implementación

Una acción explícita tendría que identificar PA origen, PA destino, vehículo
afectado, sustituto y fecha/hora efectiva, y conservar un historial del vínculo.
El servidor comprobaría los permisos y la vigencia de ambas identidades, y
registraría el traspaso de forma atómica e idempotente. La reserva seguiría
ocupada hasta su recuperación real; cambiar físicamente de sustituto seguiría
siendo otra operación.

El cálculo separaría hechos físicos y fechas de imputación, limitaría cada
tramo al periodo contable correspondiente y exigiría ausencia de solapamientos.
No se recalcularían periodos cerrados ni datos manuales para hacer encajar un
traspaso. La media TOP3 y su conversión pendiente no se resolverían por esta
decisión. Los casos históricos requerirían su revisión específica, sin migración
automática ni PA retroactivas.

Hasta que esta regla se apruebe, la candidata conserva la asignación original,
permite crear la PA de taller y rechaza duplicar el sustituto en otra PA activa.
