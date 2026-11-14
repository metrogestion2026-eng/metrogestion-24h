# Alpha75 · Identidad de PA y conservación de tramos

Estado: candidata del 7 de noviembre de 2026. La instalación y la conciliación
de datos existentes son actuaciones separadas. Este documento no acredita que
se haya aplicado SQL remoto ni abierto la sincronización.

## Defecto

Una fila copiada podía conservar la nota `METROGESTION_PARADA:<UUID>` de otra
PA. El cliente transmitía correctamente el DFM, la matrícula, el número de PA
y el ID_FILA, pero el importador operativo seleccionaba el seguimiento solo
por ese UUID. Al procesar varios tramos, el último elemento del array imponía
sus fechas al seguimiento y podía convertir el inicio de un tramo contable en
el inicio original de la ficha.

El constructor de órdenes combinaba después la identidad de la ficha con las
fechas importadas. Comprobar únicamente que K sea posterior a J no detecta los
cruces cuya cronología parece válida.

## Identidades y significado de las fechas

| Dato | Función |
| --- | --- |
| ID_FILA de T | Identidad estable de la fila de origen; se conserva en la fotografía de revisión. |
| Posición física | Ubicación observada en una lectura; no selecciona la PA. |
| UUID de sincronización | Vínculo con un seguimiento, que debe concordar con DFM, matrícula y PA. |
| J/K de TANCAMENT | Inicio y fin del tramo contable recibido. |
| Inicio original de la parada | Hecho independiente que no se obtiene por descarte de J. |
| Retirada, recuperación y sustitución vigentes | Hechos operativos que no se deducen del cierre contable. |

La candidata no convierte T en UUID ni crea un registro canónico nuevo de
ID_FILA para todas las tablas. Tampoco modifica las fórmulas o las notas de la
hoja.

## Comportamiento de los importadores

El importador PARADA valida el grupo completo de cada UUID antes de modificar
su contexto. Una contradicción con la identidad canónica retiene el grupo y
los vehículos implicados. Varias copias diarias del mismo seguimiento no
constituyen por sí solas identidades distintas.

Solo un tramo abierto inequívoco y con sustituto concordante permite
actualizar el contexto contable permitido. La función no cambia el inicio
original, la ficha, su estado, la retirada ni la disponibilidad del sustituto.
Sin tramo abierto, con varios abiertos o con un sustituto no acreditado,
conserva el estado y registra la revisión del seguimiento. Esta revisión de
tramos no debe bloquear otra PA independiente del mismo vehículo.

El importador contable calcula toda la partición de vehículos retenidos antes
del primer alta o actualización. Conserva las fuentes de los vehículos
retenidos y los excluye expresamente del barrido de ausencias, incluyendo sus
UUID y seguimientos canónicos. Los vehículos limpios mantienen el calendario
y las claves de origen existentes. Una identidad que no permita delimitar el
vehículo obliga a conservar el bloque completo para revisión.

La protección de continuidad ya existente participa en esa partición. Esto
evita insertar una nueva clave `MANTENIMENT` mientras una clave `SYNC` del mismo
tramo permanezca protegida. En un vehículo limpio, borrar una nota mantiene el
recorrido contable habitual: se comprueba que quede una sola fuente presente,
también después de reintentar.

Una fila sin nota sigue enviándose por el feed de cierres con T y sus datos
manuales. Se conserva su fotografía incluso cuando K está vacía y el periodo
todavía no debe materializarse. La ausencia de UUID no crea una PA, no recupera
un vehículo y no resuelve por sí sola el vínculo operativo.

## Retención efectiva de las salidas

La revisión se conserva en una tabla privada con la fotografía completa, su
huella, el motivo y el alcance. No se concede acceso a clientes ni se expone
una operación pública para resolverla.

La misma guarda se consulta antes de reencolar, antes de registrar una entrega
y al autorizar una orden. Una revisión nueva del outbox no elimina la
retención. La autorización utiliza el motivo ya admitido por el protocolo,
`ORDEN_RETENIDA_O_CONFIRMADA`, y conserva el detalle en la revisión privada.

Una fotografía posterior aparentemente limpia, una fila ausente o una nota
borrada no prueban que los datos importados anteriormente hayan sido
conciliados. Resolver la revisión requiere evidencia explícita. El protocolo
de ACK de efectos ya acreditados permanece separado y no se utiliza para
simular una aplicación.

La autorización emitida por el protocolo existente tiene una vigencia breve;
una revisión posterior no puede revocar una copia de autorización que el
cliente ya haya recibido. La instalación debe conservar las barreras y
comprobar que no hay ejecución en curso.

## Instalación y validación

La migración exige las huellas exactas de las cinco funciones base revisadas
y comprueba la conservación de sus OID, propietario, ACL y demás propiedades.
No cambia las versiones, el wrapper público, las referencias firmadas, el
payload de órdenes, el preflight ni el ACK. Instalar las guardas no modifica
las banderas ni repara o reenvía órdenes existentes.

La suite usa datos sintéticos y ejecuta las funciones SQL reales. Cubre el
UUID copiado, la inversión del orden, los tramos legítimos, las identidades
incompletas, la nota eliminada, los vehículos retenidos y limpios del mismo
periodo, la ausencia de doble cómputo, el reencolado, una entrega previa y el
ACK. La prueba de reproducción anterior a la migración acredita el defecto
que corrige la candidata.

La validación en PostgreSQL nativo se ejecuta con el harness aislado del
repositorio. Cuando se use PGlite como comprobación local adicional, debe
declararse ese motor; no se presenta como prueba de concurrencia nativa.

## Trabajo de conciliación separado

Las fechas originales ya alteradas requieren su auditoría de creación o
edición anterior a la contaminación. No se reconstruyen con el mínimo J ni
revirtiendo ciegamente la última importación. Los tramos manuales correctos
conservan su significado aunque una retirada administrativa tenga otra fecha.

Las notas eliminadas no se reponen automáticamente. La correspondencia
ID_FILA–PA–seguimiento puede prepararse con las identidades existentes, pero
su revisión no equivale a restaurar hechos operativos ni a abrir la salida
general.
