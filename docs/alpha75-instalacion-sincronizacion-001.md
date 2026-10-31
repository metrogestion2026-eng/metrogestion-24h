# Alpha75.25 · instalación y primera sincronización controlada

31/10/2026 · candidata de la PR #90 · **MG75-EJECUCION-ORDEN-001**.

Esta guía concreta la instalación de la candidata. No es evidencia de que sus
componentes estén instalados ni de que se haya ejecutado una sincronización.
El destino de 75.25 es **metrogestion-pruebas** (`aemoouldgguyjsxrfuwo`); el
laboratorio del PC corresponde a 80.

## 1. Acreditar el punto de partida

Identificar la copia de seguridad por archivo, fecha y contenido real. Una
copia de `MANTENIMENT` no acredita por sí sola una copia del resto de pestañas,
del backend, del proyecto Apps Script, de sus propiedades o de las carpetas
Drive. Conservar por separado las evidencias necesarias para reconciliar una
interrupción; no publicar claves, propiedades completas ni payloads privados.

Comprobar el archivo madre configurado en Apps Script y en el backend:
`1PQE5VsjTvDFvQZcqedyQKIs3RbSySHFK4JPQXBD0XyU`, pestaña `MANTENIMENT`.
El código utiliza ese ID fijo: abrir o copiar el proyecto desde otro archivo
no convierte una ejecución en una prueba sobre la copia.

Desde el archivo madre, abrir **Extensiones → Apps Script**. Registrar el
código instalado y revisar **Activadores** y **Ejecuciones**. La versión
`alpha75-2026.10.26.1` se conserva también en la candidata, por lo que una
coincidencia de esa cadena no acredita que el ejecutor nuevo esté instalado.

## 2. Detener y reconciliar el trabajo anterior

Coordinar una ventana sin ediciones de toda la fotografía entrante de
MANTENIMENT ni operaciones de la app que cambien sus identidades u órdenes
durante la instalación y aceptación; no basta con las filas seleccionadas. Las
primeras migraciones cambian comportamiento de la app aunque la sincronización
esté pausada; deben considerarse junto con la publicación de su interfaz.

Detener las ejecuciones anteriores y ambos mecanismos automáticos:
`metrogestionSincronizarProgramada` y `metrogestionReanudarProgramada`.
Cerrar los diálogos de sincronización y comprobar que no queda ninguna ejecución
activa; eliminar un activador no cancela una ejecución ya iniciada.
Revisar los titulares que hayan creado activadores: `getProjectTriggers()`
enumera los del proyecto y usuario actuales, no todos los de otros usuarios.
`metrogestionInstalarActualizacion()` gestiona el periódico; no prueba la
ausencia de reanudaciones pendientes. **Ver estado local** tampoco inventaría
todo ese estado. La pausa de próximas necesidades no es una pausa global.

Preservar e inspeccionar `METROGESTION_CICLO`, confirmaciones pendientes,
selección, solicitud de entrega, bandejas y diarios que existan. Una cola
anterior puede escribir localmente sin volver al backend. No borrar sus
propiedades para eludir un bloqueo ni fabricar un recibo a partir de una fila
parecida. Un estado incierto requiere reconciliación antes del siguiente paso.

## 3. Instalar los componentes como una sola candidata

Repetir el preflight de catálogo inmediatamente antes de aplicar las
migraciones y contrastarlo con sus requisitos de funciones, disparadores,
propietarios, ACL y objetos nuevos. Un catálogo compatible no demuestra que
los datos operativos o las colas sean aptos para una orden concreta.
Mantener `solo_lectura_manual_protegida=true`, `escritura_segura_manual=false`
y `pausa_importacion_identidad=true` durante la instalación y el diagnóstico.
La apertura corresponde al paso posterior de aceptación.

Las cinco migraciones se aplican en este orden:

| Orden | Archivo | Efecto relevante |
| --- | --- | --- |
| 1 | `20261028174243_alpha75_24h_paradas_independientes.sql` | Cambia reglas Hotel/24H e instala las guardas de paradas independientes. No repara históricos. |
| 2 | `20261029060636_alpha75_continuidad_sustitucion_entre_pa.sql` | Instala continuidad; requiere la barrera siguiente para quedar operativa. |
| 3 | `20261029060925_alpha75_continuidad_barrera_manteniment.sql` | Instala la barrera y registra procedencia de seguimientos existentes en tablas privadas. Incluye inserciones de trazabilidad; no es sólo DDL. |
| 4 | `20261029072758_alpha75_editor_timestamps_exactos.sql` | Instala parser y capacidad para fechas exactas; la interfaz anterior sigue perdiendo precisión si no se actualiza. |
| 5 | `20261029184748_alpha75_autorizar_ejecucion_manteniment.sql` | Exige capacidad nueva, autoriza referencias exactas y endurece el acuse. No abre las banderas de sincronización. |

Registrar el nombre y versión realmente anotados por el servicio, además de
la huella del SQL aplicado. Si el instalador asigna una versión con la fecha
actual, no repetir una migración no idempotente para hacer coincidir el prefijo
del archivo histórico.

Cada archivo SQL tiene su propia transacción; las cinco instalaciones no
constituyen una transacción conjunta. Ante error, deriva de catálogo o
resultado incierto, detener la secuencia y leer el estado realmente instalado
antes de reintentar. Si falla la tercera, las dos anteriores pueden seguir
instaladas y la continuidad permanece bloqueada por su guarda provisional.
Conservar las barreras cerradas y los activadores detenidos durante esa revisión.

Publicar coordinadamente Edge `manteniment-sync-r1`, la interfaz de la misma
candidata y el archivo completo `sincronizar_manteniment.gs` en el proyecto
vinculado. Conservar las propiedades. Evitar una mezcla de interfaz antigua y
SQL nuevo durante la ventana. No recrear activadores al guardar el código.
Comprobar la capacidad `MG75-EJECUCION-ORDEN-001` y la huella exacta de los
componentes instalados; las huellas de producto figuran en la
[guía del protocolo](alpha75-ejecucion-sincronizacion-001.md).

## 4. Comprobar la instalación y la selección

Ejecutar el diagnóstico independiente
`metrogestionComprobarInstalacionSoloLectura()`. Este diagnóstico no inicia
`sync`, no abre Sheets y no escribe propiedades ni activadores. Un resultado
APTO no verifica por sí solo el código instalado ni constituye aceptación del
ejecutor, las fórmulas, las cuotas o los permisos de Google.
El preflight distingue compatibilidad de barreras cerradas. Tras habilitar la
ejecución, no exigir el mismo resultado APTO de barreras cerradas ni tratar
`compatible=true` como una autorización de órdenes.

Obtener las referencias candidatas mediante una lectura SQL pura de outbox y
entregas. No llamar al receptor ni al exportador sólo para descubrirlas: pueden
consumir o registrar entregas. Conservar literalmente `tipo`, `sync_id`,
`revision` y `payload_sha256` calculados por el servidor. No reconstruir la
huella mediante `JSON.stringify`.

Contrastar cada identidad con la hoja actual, incluidos valores manuales,
periodos y notas. Mantener protegidos 2637 y cualquier caso ambiguo. Las siete
órdenes del ensayo histórico no pasan a ser aceptables por haber cambiado el
ejecutor ni por existir una copia de seguridad. Una revisión nueva necesita
una selección expresa nueva.

La selección exacta limita **las órdenes salientes**. `sync` sigue procesando
la fotografía entrante completa de activos, paradas, cierres, trabajos y
pendientes. El modo `prueba` tampoco convierte ese receptor en sólo lectura.
Comprobar ambas direcciones antes de habilitar su primera recepción.
`pausa_importacion_identidad=true` bloquea antes de importar; ponerla en
`false` permite procesar la entrada incluso si
`solo_lectura_manual_protegida=true` retiene las órdenes de salida.

Las banderas requeridas para autorizar una orden son
`solo_lectura_manual_protegida=false`, `escritura_segura_manual=true` y
`pausa_importacion_identidad=false`. Cambiarlas permite efectos reales: deben
quedar ligadas a esta ventana, al estado reconciliado y a la aceptación concreta.
Las migraciones no las cambian por sí solas.

## 5. Recibir, inspeccionar y ejecutar una orden

Sólo después de comprobar que **no existe ciclo pendiente ni estado incierto**,
guardar un alcance exacto de **una referencia** para la primera aceptación y
realizar una única llamada a
`metrogestionContinuarSincronizacion()`. En ese estado la llamada prepara el
ciclo desde entregas ya conservadas, o solicita y conserva una recepción si
falta alguna referencia, antes de aplicar órdenes a Sheets o Drive. Registrar
cuál de las dos rutas ocurrió. Una recepción nueva sí puede producir efectos
en el servidor al importar la fotografía completa.
Con un ciclo previo, esa misma función puede continuar directamente su
ejecución: no usarla como inventario de diagnóstico.

No usar el menú **Sincronizar ahora** para esta separación: continúa las tandas
automáticamente. Inspeccionar la entrega durable y la selección antes de la
llamada que aplicará la orden. Conservar también las órdenes no seleccionadas;
una revisión PARADA puede entregarse una sola vez.

Verificar después el resultado de la hoja, metadatos, fórmulas, enlaces Drive,
diario durable y acuse de la referencia exacta. Un resultado incierto bloquea
la repetición; un acuse pendiente recuperable repite sólo el acuse después de
verificar su recibo. Una respuesta perdida antes de conservarse no autoriza
pedir automáticamente otra entrega.

Registrar cada resultado antes de ampliar el alcance. Mantener detenida la
automatización hasta cerrar la aceptación controlada y reconciliar los estados
pendientes. La copia de seguridad conserva un punto de retorno; no equivale a
una transacción conjunta ni permite deshacer efectos parciales sin revisión.

## Referencias

- [Protocolo y evidencia automatizada](alpha75-ejecucion-sincronizacion-001.md).
- [Bandeja, planificación y diarios del cliente](alpha75-ejecutor-cliente-001.md).
- [ScriptApp: activadores del proyecto y usuario actuales](https://developers.google.com/apps-script/reference/script/script-app#getProjectTriggers()).
