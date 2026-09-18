# SG del 2724 y 2746: bloqueo por filas filtradas

Seguimiento del fallo después de instalar `alpha75-2026.09.18.1`.
La protección detuvo tres tandas con el mismo plan; la ampliación del tiempo
de escritura no había resuelto esta ejecución.

## Evidencia y reparación aplicada en MANTENIMENT

La fila 3433 (2724, SG del 01/04/2026) seguía sin M ni nota de ciclo. El origen
del 2746, fila 3639, ya tenía M y nota. Ambos tenían J/K del 01/04/2026 y la
regla existente proponía una sola SG del 01/04/2027 para cada unidad.

El filtro activo ocultaba expresamente 2724 y 2746. Al intentar insertar/copiar
las filas, la API de Sheets devolvió:
«Esta operación no se admite en un intervalo con una fila filtrada».
Ese primer lote se rechazó de forma atómica y no aplicó cambios.

Se repitió la operación con el filtro suspendido: nota I y fecha M amarilla del
origen 2724 y dos nuevas filas blancas con sus vínculos de origen en I. No se
copiaron expedientes, adjuntos, notas de T ni fechas de realización a las hijas.

Al restaurar el filtro mediante la API con sus `sortSpecs`, Sheets reaplicó la
ordenación por fecha a toda la hoja. Se recuperó el orden anterior mediante una
permutación de las 7096 filas de datos: 7091 identidades exactas y otras cinco
identificadas unívocamente, cuya única diferencia era el resultado de fórmulas
que dependían de la posición. Se conservaron las celdas originales, sin
sobrescribirlas con una fotografía anterior. Las cinco fórmulas recuperaron sus
resultados anteriores al restablecer el orden.

La columna auxiliar usada para ordenar se creó y retiró en el mismo lote. La
hoja queda con 19 columnas y 7097 filas; se restauraron los criterios originales
del filtro, sin volver a ejecutar su ordenación. Las ARRAYFORMULA de R1/S1 se
conservan y las nuevas filas dejan J/K vacías.

Estado final verificado:

| Unidad | Origen actual | Próxima fila actual | I de la próxima SG |
| --- | --- | --- | --- |
| 2724 / 4590NGW | 3433 | 3434 | 01/04/2027 |
| 2746 / 7349NKN | 3640 | 3641 | 01/04/2027 |

El motor, ejecutado contra la lectura final de toda la hoja, devuelve cero
cambios, cero nuevas necesidades y 117 avisos. El usuario confirmó después
una sincronización correcta con 26 órdenes confirmadas y esos mismos 117 avisos.
El contador de nuevas del ciclo es cero porque las dos filas se crearon durante
esta reparación, fuera de ese ciclo de Apps Script.

## Regla general en `alpha75-2026.09.18.2`

- Suspende el filtro antes de cualquier tanda que escriba necesidades.
- El minuto de escritura comienza después de preparar el filtro y mantiene el
  límite global introducido en .1.
- Confirma con `flush` y relectura los valores y la nota de cada fila antes de
  contabilizarla. Verifica también el amarillo de M cuando se solicita.
- Restaura los criterios y amplía el rango del filtro al insertar, conservando
  el orden de las filas. El adaptador de Apps Script no reaplica ordenaciones.
- Restaura el filtro también ante errores y conserva el diagnóstico original.
- Conserva la protección contra tres planes idénticos sin avance.

Diez pruebas de tandas y 16 regresiones de asignaciones/reintentos pasan. Las
nuevas pruebas cubren SG filtradas, restauración tras un fallo de copia y una
escritura descartada que debe detectarse en esa misma tanda.

El archivo de Alpha75 queda preparado para instalar. No se modifica el script
de Alpha76 ni se publica una interfaz nueva. La reparación de datos ya está
aplicada; instalar .2 previene que otra necesidad filtrada vuelva a bloquearse.
