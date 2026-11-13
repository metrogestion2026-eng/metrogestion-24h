# Alpha75 · Tres hitos de taller

Revisión de cliente: `75.26-taller-hitos-001`. Versión visible: `r1.0.0-alpha.75.26`.

La T de entrada al taller del modelo `entrada_hitos_v1` registra tres hechos
distintos. El botón confirma únicamente el próximo hito y conserva las fechas
anteriores con su precisión original.

| Botón | Fecha que registra el servidor | Estado de la T | Situación de la ficha |
| --- | --- | --- | --- |
| Entrada a taller | `fecha_inicio_real` | En curso | En taller |
| Terminado en taller | `fecha_fin_real` | En curso | Terminado, pendiente de recoger |
| Recogido de taller | `fecha_real` | Realizada | Se deriva de las T pendientes y los hechos de la ficha |

La siguiente T se presenta según su orden manual. Su movimiento requiere su
propia confirmación. La recuperación de ruta conserva su acción independiente;
la recogida del taller no libera por sí misma el sustituto.

## Guardado y compatibilidad

El control activo de Hotel e Histórico es `r1-alpha75/src/stage-quick.js` y abre
el editor de Alpha75. Consulta el modelo de las fichas por lotes y mantiene la
protección de dos pulsaciones. Los tipos equivalentes de entrada se reconocen
sin reescribir el catálogo ni la identidad de las T. Los flujos legacy conservan
sus actuaciones separadas.

`obtener_contexto_taller_t_alpha75(uuid[])` exige una sesión de administrador
principal y dispositivo autorizado. `registrar_hito_taller_alpha75` recibe ID,
versión, hito y un identificador de petición; el reloj del servidor determina la
fecha real. La función bloquea ficha y T, comprueba la pizarra actual, el modelo,
la secuencia y la coherencia de las fechas. Un conflicto no repite la escritura.

El guardado actualiza la misma tarjeta, sus botones y el resumen leído de la
vista. Los cargadores de documentos permanecen montados. Un fallo al refrescar
el resumen se informa como tal y conserva la confirmación del movimiento.

Las fechas ausentes o incoherentes se señalan para corregirlas en el editor;
no se completan inventando hechos anteriores. Un hito normal no crea un aviso
genérico de datos pendientes.

## Migración y pruebas

La migración `20261113171227_alpha75_botones_hitos_taller.sql` añade los RPC y
ajusta por anclas verificadas las funciones existentes que interpretan entradas
de taller. Incluye la propagación y el recálculo interno de fechas de trabajos,
para que finalización y recogida sigan separadas también después de editar.
No contiene backfill ni ejecuta movimientos sobre fichas existentes.

Los gates de CI comprueban el helper de interfaz, la secuencia completa en
PGlite y PostgreSQL17 aislados, permisos, versión, rechazo de pasos fuera de
orden, conservación de fechas, orden manual, reserva, trabajos y documentos.
La prueba de navegador ejecuta el control real con los RPC sobre PostgreSQL
aislado y verifica los tres pasos sin sustituir la tarjeta.

El fixture del disparador de fechas es código genérico revisado. Sus tablas y
filas son sintéticas. La cola externa se sustituye por un registrador local:
esas pruebas acreditan la propagación interna, no un envío a MANTENIMENT ni a
Google Sheets.
