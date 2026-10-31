# MANTENIMENT ↔ Metrogestión · candidata Alpha75.25

31/10/2026 · **MG75-EJECUCION-ORDEN-001** · PR #90.

Este directorio contiene el código que debe revisarse junto con las cinco
migraciones, Edge y la interfaz de la candidata. Publicarlo en GitHub no lo
instala en el proyecto de Google Apps Script vinculado a **MANTENIMIENTOS**.

La [guía de instalación coordinada](../../docs/alpha75-instalacion-sincronizacion-001.md)
es la referencia actual. Incluye las comprobaciones previas, el orden de los
componentes y la primera recepción controlada. Las instrucciones de septiembre
se conservan en el [historial del README](https://github.com/metrogestion2026-eng/metrogestion-24h/blob/f02f71afb2d7a9419a5975da4cdca8222e205283/r1-alpha75/google-apps-script/README.md);
sus indicaciones de sustituir el código y pulsar inmediatamente «Sincronizar
ahora» quedan sustituidas por esta guía.

## Destino y versión

- La sincronización actual de **75.25** usa **metrogestion-pruebas**
  (`aemoouldgguyjsxrfuwo`). El laboratorio del PC queda reservado para 80.
- El script fija el archivo madre
  `1PQE5VsjTvDFvQZcqedyQKIs3RbSySHFK4JPQXBD0XyU`, pestaña `MANTENIMENT`.
  Ejecutar el código desde una copia no cambia ese destino.
- La cadena `alpha75-2026.10.26.1` es la versión conservada del transporte;
  por sí sola no identifica el código nuevo. La capacidad del ejecutor es
  `MG75-EJECUCION-ORDEN-001`.
- La clave se conserva en las propiedades del proyecto. No se copia al código,
  a celdas, a registros públicos ni a capturas compartidas.

## Antes de instalar

Revisar el código realmente instalado, **Activadores** y **Ejecuciones** del
proyecto vinculado. Deben quedar detenidas las ejecuciones anteriores y los
dos mecanismos automáticos: `metrogestionSincronizarProgramada` y
`metrogestionReanudarProgramada`. Cerrar los diálogos de sincronización y
comprobar que no quedan ejecuciones activas; quitar un activador no cancela las
ya iniciadas. Conservar y reconciliar las propiedades,
colas, acuses, bandejas y diarios anteriores antes de continuar.

Una cola antigua puede escribir en la hoja sin consultar al servidor. Las
banderas del backend y una copia de seguridad no demuestran que esa cola esté
detenida. Tampoco debe borrarse para hacer que el código nuevo arranque.

## Qué permite cada control

| Control | Alcance real |
| --- | --- |
| `metrogestionComprobarInstalacionSoloLectura()` | Diagnóstico independiente: no inicia `sync`, no abre Sheets ni modifica propiedades o activadores. Su resultado no acredita la instalación del ejecutor nuevo. |
| «Ver estado local» | Información parcial; no inventaría todas las propiedades, diarios, activadores de otros titulares ni ejecuciones en curso. |
| Pausa de próximas necesidades | No es una pausa general de sincronización. |
| `metrogestionContinuarSincronizacion()` | Sin ciclo pendiente, prepara el ciclo desde la bandeja o desde una nueva recepción antes de aplicar órdenes; con un ciclo pendiente puede ejecutar. Revisar antes el estado. |
| «Sincronizar ahora» | Continúa automáticamente las tandas; no sirve para recibir y detenerse a inspeccionar la entrega. |
| Alcance exacto de órdenes | Limita las órdenes salientes. La fotografía entrante que procesa `sync` sigue completa; el modo de prueba tampoco es un ensayo sin escrituras. |

## Protección y aceptación

Las referencias se eligen expresamente por tipo, UUID, revisión y huella del
servidor. Se mantienen la prioridad de los datos manuales y la protección de
2637. Una identidad ambigua o una aplicación incierta exige revisión, sin
inventar equivalencias, recibos o nuevas entregas.

Las pruebas automatizadas usan plataformas Google sintéticas. La aceptación
real debe comprobar código instalado, permisos, cuotas, fórmulas, estado
duradero y resultado de cada orden durante una ventana coordinada de edición.
Consultar el [protocolo de ejecución](../../docs/alpha75-ejecucion-sincronizacion-001.md)
y el [detalle del cliente](../../docs/alpha75-ejecutor-cliente-001.md).
