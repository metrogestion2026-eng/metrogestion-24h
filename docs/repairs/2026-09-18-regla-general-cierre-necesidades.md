# Regla general de cierre de necesidades desde la T actual

Aplicada el 18/09/2026 en el proyecto `aemoouldgguyjsxrfuwo`, a petición del
usuario: «pero no lo corrijas para este solo, corrígelos como regla para todos».
Migración registrada: `20260918071101_alpha75_cierre_necesidades_t_actual`.

## Problema y comportamiento corregido

El vínculo del trabajo conservaba la T original mientras las operaciones se
realizaban sobre una copia diaria. El trigger no encontraba el trabajo y podía
intentar encolar el identificador de la T en vez del seguimiento de la ficha.
Además, la salida calculaba K solo desde una recogida física o una fecha
previamente almacenada. Así, una T administrativa realizada podía dejar K vacía.

La regla utiliza `manteniment_etapa_actual` para todas las necesidades vinculadas
a la T y toma el seguimiento de su registro padre para encolar la ficha:

- Trámites, gestiones y visitas sin recogida: K toma la fecha real del cierre.
- Taller ordinario: entrada en J y recogida en K, manteniendo ambas separadas.
- REPUESTOS, ACT, CV y LINDEP: se conserva J ya guardada al completar K.
- Una T compartida transmite el cierre a todas sus necesidades vinculadas.
- No se infiere cierre desde T pendientes o anuladas ni se utilizan trabajos
  cancelados. Las referencias con otra designación quedan excluidas.

La salida calcula también el cierre desde la T actual si el vínculo aún no lo
tiene guardado. La reparación de datos recupera fechas reales existentes y
conserva las ya registradas; no inventa fechas para T antiguas sin fecha real.
Se reencolan únicamente las fichas cuyo conjunto de asignaciones cambia.

El Apps Script `alpha75-2026.09.17.5` ya escribe `fecha_salida` en K vacía y
pinta A:Q de verde `#d9ead3`, respetando los amarillos especiales de G/M.
No requiere reinstalación. Conserva K cuando el usuario ya había anotado una
fecha, aunque difiera de la fecha de la T.

## Comprobaciones

Nueve comprobaciones SQL pasaron dentro de una transacción revertida: varias
filas GP de una T, copia diaria y seguimiento de ficha, fecha de Madrid,
conservación del pedido de REPUESTOS, T pendientes, T anuladas/trabajos
cancelados, ausencia de fecha real, entrada sin recogida, entrada/recogida de
taller y cierre conjunto ITV + 44TN (algunas comprobaciones cubren varios puntos).
El archivo de pruebas contiene su propio BEGIN/ROLLBACK y debe ejecutarse
completo sobre los fixtures indicados. No prueba la reapertura de una T.

Tras aplicar: cero trabajos directos realizados con fecha real conocida y K
de sincronización pendiente. Los permisos de ambas funciones privadas siguen
limitados a postgres/service_role. Los asesores de seguridad no muestran
hallazgos nuevos.

## Revisión de la hoja

Se revisaron las 26 referencias de necesidades con fecha de salida emitidas por
la función, resolviendo las notas técnicas de E contra las filas actuales de
MANTENIMENT. Sus posiciones antiguas no son fiables.

De las 25 filas encontradas por nota, 20 coincidían en unidad, matrícula,
designación y fecha de necesidad: todas tenían K y verde, incluidas las tres
filas del 2723 reparadas inicialmente. Otras tres referencias tenían cambios
de designación o fecha programada y también K y verde; dos notas estaban
copiadas en otro vehículo. No se modificó ninguna de estas cinco referencias.
Los números de fila y motivos constan en el JSON de verificación adjunto.

No se localizó una referencia EDT del 2552 ni la segunda referencia MCD antigua
del R1320. La fila actual MCD B+LKT del R1320 tiene fecha 17/09/2027, sin vínculo
con la actuación cerrada; se conserva como necesidad futura. No se asume que
una necesidad nueva sustituya a una referencia antigua para cerrarla.

Única T realizada sin fecha real y sin K en los vínculos activos revisados:
LKT del R1243, parada 2600162, fila actual 4595. La nota E confirma el UUID
`dcfe3d6f-67d1-4876-be1f-55604748fe9a`; J/K siguen vacías. Falta la fecha real
para completar ese cierre. No se tomó la fecha de otra T de la ficha.

## Publicación

La regla de sincronización está aplicada en la base de datos compartida.
El código y las pruebas quedan en la rama de trabajo y PR 17. No se publica
una nueva versión de la interfaz: Alpha75 sigue siendo el entorno de cambios
y Alpha76 la aplicación de los usuarios.
