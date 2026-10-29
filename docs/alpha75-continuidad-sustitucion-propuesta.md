# Continuidad del mismo sustituto entre PA: criterio aprobado

Regla: **MG75-CONTINUIDAD-SUSTITUCION-ENTRE-PA-001**, aprobada por Metro el
29/10/2026 mediante «ok, adelante» y registrada en la Biblia. La aprobación
autoriza su implementación y validación en la candidata 75.25; no autoriza
despliegue, sincronización ni cambios retroactivos de datos operativos.

Se conserva el nombre de este archivo para mantener los enlaces de la propuesta
del 28/10. El criterio ya está aprobado; su instalación sigue pendiente.

## Lo ya decidido

MG75-24H-PARADAS-SEPARADAS-002 exige una PA propia para la asistencia 24H y otra
para el taller posterior. La asistencia termina por su actuación. No se debe
duplicar la imputación del sustituto ni inventar una recuperación para separar
las PA. Los valores manuales y los periodos cerrados deben conservarse.

La regla anterior que asigna el día del cambio al sustituto nuevo describe el
**cambio físico de sustituto dentro de una misma PA**. La nueva decisión fija
expresamente el cambio de PA cuando continúa el mismo sustituto. El cierre de
la asistencia, la entrada en taller y la devolución del sustituto son hechos
distintos.

## Decisión aprobada

Cuando el mismo sustituto sigue cubriendo al mismo vehículo afectado, la
**entrada real en taller**, confirmada expresamente y vinculada a la PA de
destino, inicia su nuevo tramo de imputación. El día de esa entrada corresponde
a la PA de taller; el tramo imputable a la PA anterior termina el día previo.

Es un traspaso de imputación entre dos PA identificadas, sin devolución física
ni liberación intermedia de la reserva. Se conservan las fechas y horas reales
de asistencia, entrada en taller y recuperación. Si no existe una fecha real
acreditada de entrada, no se deduce del cierre de la 24H ni de la fecha del
guardado.

## Ejemplo aprobado

Ejemplo sintético: un sustituto se entrega el 27/10; la asistencia termina ese
mismo día; el vehículo entra realmente al taller el 28/10 y el sustituto se
recupera el 30/10.

| Hecho o tramo | Imputación aprobada |
| --- | --- |
| Asistencia 24H | Mantiene su PA y su fin real del 27/10 |
| Imputación a la PA de asistencia | 27/10: un día |
| Entrada al taller | 28/10: otra PA, con su fecha y hora reales |
| Imputación a la PA de taller | 28/10 a 30/10: tres días inclusivos |
| Ocupación física del sustituto | Continua del 27/10 al 30/10, sin una devolución ficticia el 28/10 |
| Total imputado | Cuatro días, sin duplicar el 28/10 |

Si la entrega y la entrada al taller son el mismo día, la primera PA puede
quedar con cero días imputados. La asistencia y sus hechos siguen existiendo;
no se aplica un mínimo por PA que duplique ese día. Este caso forma parte de
la aprobación expresa.

## Condiciones de implementación

Una acción explícita debe identificar PA origen, PA destino, vehículo
afectado, sustituto y fecha/hora efectiva, y conservar un historial del vínculo.
El servidor comprueba los permisos y la vigencia de ambas identidades, y
registra el traspaso de forma atómica e idempotente. La reserva sigue
ocupada hasta su recuperación real; cambiar físicamente de sustituto sigue
siendo otra operación.

El cálculo separa hechos físicos y fechas de imputación, limita cada tramo al
periodo contable correspondiente y exige ausencia de solapamientos.
No se recalculan periodos cerrados ni datos manuales para hacer encajar un
traspaso. La media TOP3 y su conversión pendiente no se resuelven por esta
decisión. Los casos históricos requieren su revisión específica, sin migración
automática ni PA retroactivas.

Mientras la continuidad no esté confirmada explícitamente por el servidor, se
conserva la asignación original y se rechaza duplicar el sustituto en otra PA
activa. La aprobación de la regla no elimina esa protección.

## Alcance de la candidata

La acción se incorpora a una PA de Hotel ya guardada, en modo de edición. El
usuario elige el origen y la T de entrada persistida, revisa el reparto y
confirma expresamente. El servidor comprueba identidades, permisos, versiones,
propietario vigente, hechos reales, datos manuales y barreras de sincronización.
Una respuesta perdida conserva la misma petición para consultar su resultado.

La implantación cubre unidades afectadas DFM y sustitutos RESERVA o FLOTA. Las
unidades afectadas R conservan su regla de cobro por unidad y quedan bloqueadas
en esta operación. Un código R de la reserva utilizada como sustituto no es
esa exclusión. Las modalidades manuales incompatibles se revisan en el editor;
el traspaso no las sobrescribe.

MANTENIMENT no representa estos tramos con su protocolo de PARADA anterior.
Las PA enlazadas conservan sus colas y quedan retenidas para ese intercambio.
Una entrega anterior no resuelta impide confirmar la continuidad. Todo
seguimiento anterior a la nueva barrera exige reconciliación específica,
incluso si tiene una confirmación histórica. No se deduce ausencia de órdenes
pendientes de una outbox vacía ni de una fecha de creación editable.

La migración de paradas separadas se conserva intacta. Dos migraciones nuevas
añaden el registro de continuidad, sus proyecciones y la barrera. Las pruebas
locales y de CI usan exclusivamente datos sintéticos y no autorizan aplicar
esas migraciones en el backend operativo. El estado de verificación y los
límites figuran en [la documentación de la candidata](alpha75-paradas-separadas-002.md).
