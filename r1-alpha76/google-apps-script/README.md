# MANTENIMENT ↔ Metrogestión · Alpha75

Este script sustituye el contenido del proyecto de Google Apps Script vinculado al archivo madre **MANTENIMIENTOS**.

## Actualización del 23/09/2026 · sincronización por trabajo

Cada trabajo nuevo añadido manualmente en una T genera su propia necesidad.
Cada necesidad nueva se incorpora como trabajo a la visita abierta del mismo
taller, incluso si la entrada ya está realizada. Dos campañas distintas siguen
siendo dos necesidades dentro de una única T. CV requiere parada; OTA se mantiene
como gestión remota, sin generar una entrada o recogida de taller.

La escritura usa el identificador del trabajo y conserva documentos, notas y
kilometraje en los reintentos. Las copias diarias de la pizarra y las importaciones
no exportan necesidades nuevas. Las T históricas no se rellenan retroactivamente.

Orden de instalación:

1. Copiar el script completo `alpha76-2026.09.23.1` en el mismo proyecto
   vinculado a MANTENIMIENTOS y guardar. Conservar sus propiedades y el avance.
2. Aplicar en Supabase la migración
   `20260923142949_alpha75_trabajos_necesidades_bidireccionales.sql`.
3. Ejecutar **Sincronizar ahora** y comprobar la necesidad y su vínculo en E.
   Repetir la sincronización: debe conservar la misma fila y la misma T.

Fusionar este cambio en GitHub no realiza ninguno de los dos primeros pasos.
El servidor conserva pendiente una orden si un script antiguo intenta confirmarla
sin haber creado su necesidad. Ante identidades ambiguas informa sin sobrescribir.

## Actualización del 21/09/2026 · script `alpha76-2026.09.21.2`

Las paradas de vehículos externos pueden crearse sin una fila ALTA. Su archivo
documental se busca primero en `A-FLOTA/<DFM>` y, si no existe allí, en
`A-FLOTA/7A INTERCAMBIO/<DFM>`. Dentro de la carpeta existente se crea o reutiliza
`PARADAS/<PA-número>`, conservando su ubicación y documentación anterior.
No se crea una carpeta DFM duplicada ni se da de alta el vehículo en la flota.
Si la carpeta falta en ambas ubicaciones o hay nombres duplicados que impiden
elegir con seguridad, se conserva el avance y se informa del problema.

Actualizar el código completo dentro del mismo proyecto de Apps Script y
guardar. Conservar las propiedades del proyecto y usar **Reintentar** o
**Metrogestión → Sincronizar ahora** para retomar el avance guardado.
La versión equivalente de Alpha75 es `alpha75-2026.09.21.2`.

## Qué sincroniza

- Solo usa la hoja `MANTENIMENT` del archivo madre configurado.
- Las filas `ALTA` mantienen el comportamiento bidireccional existente entre Google y Supabase.
- Las bajas se conservan como `BAJA` y nunca borran el histórico.
- La columna I se interpreta como **fecha de matriculación**.
- La columna J se interpreta como **fecha de alta en delegación**.
- Las fichas nuevas de Hotel solo crean o actualizan una fila `PARADA` cuando existe un sustituto real. TRÁMITE y GESTIÓN conservan su número de actuación sin crear esa fila.
- Solo las filas `PARADA` creadas por Metrogestión pueden volver desde Google a su ficha. Las filas históricas sin identificador no se importan automáticamente.
- En las filas `PARADA` vinculadas, **MANTENIMENT gobierna I, J, K, L y P**. En Q conserva lo ya escrito; si está vacío, Metrogestión añade automáticamente el período abierto como `TANCAMENT n`.
- Cuando una plantilla histórica utiliza P como control desplegable `OK/KO`, el
  sincronizador conserva ese estado y no intenta convertirlo en kilómetros.
- Q puede conservar enlaces o referencias documentales como `FOTO` u `OR-…`.
  Solo se envía como período de cierre cuando contiene exactamente `TANCAMENT n`.
- **Metrogestión protege A-E, G y O**: DFM, matrícula, tipo, UPC, número de actuación, sustituto y marca. Los cambios de esas columnas se ignoran al importar y la orden siguiente restaura los valores de la ficha.
- La columna E conserva su enlace de Drive cuando el número de actuación protegido no ha cambiado.
- Las columnas auxiliares R y S quedan libres para sus `ARRAYFORMULA`: calculan
  mes y año desde J y el sincronizador nunca copia valores sobre ellas. Ambas
  columnas quedan protegidas contra escrituras manuales y la sincronización
  incluye una función específica para restablecer la protección si faltara. La
  comprobación no se repite en cada sincronización para no consumir tiempo.
- Cada número de parada utiliza una sola carpeta en `A-FLOTA/<DFM>/PARADAS/<PA-número>`
  o, para los archivos de intercambio, en `A-FLOTA/7A INTERCAMBIO/<DFM>/PARADAS/<PA-número>`.
  Si una fila ya tiene un enlace creado manualmente, se reutiliza. Al sincronizar,
  el mismo enlace se aplica a todas las filas que contengan ese número de parada,
  incluidas `PARADA`, `AV`, mantenimientos, recogidas y recuperaciones.
- La carpeta de la parada se crea únicamente cuando no existe. Si un DFM ya tiene
  varias carpetas `PARADAS` o varias carpetas con el mismo `PA-número`, se reutiliza
  la que ya esté enlazada en MANTENIMENT. Si todavía no hay enlace, se elige la más
  antigua. No se borra ni se mueve ninguna carpeta existente.
  Los enlaces históricos de GP, ACT u otros trabajos no se consideran carpetas de
  parada y se sustituyen en E por el archivo común; sus enlaces propios se conservan
  en la columna donde figure el trabajo.
- Durante cada ejecución se reutilizan las carpetas ya localizadas y no se
  reescriben enlaces que ya sean correctos, reduciendo las llamadas a Drive.

## Taller F automático para R y DFM

Si F está vacío, Metrogestión lo completa al importar sin modificar la hoja:

- GESTIÓN → `UPC`.
- MANTENIMIENTO + H=`BPW` → `DIRECAUTO`.
- MANTENIMIENTO + H=`MCD` + Q=`THERMO KING` → `FRIGICOLL`.
- MANTENIMIENTO + H=`MCD` + Q=`CARRIER` → `FRIDIEL`.
- TRÁMITE + H=`ITV` → `APPLUS (RED DE ITV)`.
- TRÁMITE + H=`RT` → `AUTODIS`.
- TRÁMITE + H=`TMG` o `ATP` → `INVERYCA`.
- TRÁMITE + H=`EXTINTOR` → `UPC`.

Para los DFM, si F está vacío y H=`MCD` o H=`AV`, la marca de O asigna el taller:

- `MERCEDES` → `STERN MOTOR`.
- `IVECO` → `AUTO DISTRIBUCIÓN`.
- `MAN` → `MAN`.
- `VOLVO` → `VOLVO`.

Si O no permite identificar exactamente una de estas cuatro marcas, el taller
queda vacío para revisión manual.

Un valor escrito en F tiene prioridad salvo en `TRÁMITE` y `GESTIÓN`, donde manda G.
`LKT` y `EXTINTOR` se consideran siempre `TRÁMITE`. REPARACIÓN no infiere taller.
- `TANCAMENT n` utiliza la fecha K como corte de facturación y no como recuperación operativa.
- La celda Q permanece rosa pastel mientras el cierre no esté supervisado.
- En las necesidades predictivas, el fondo de la columna H es autoritativo:
  **blanco significa pendiente**; cualquier otro color no crea una T nueva.
- Las necesidades predictivas incluyen tanto unidades R como DFM.
- Los trabajos que comparten taller en F se agrupan dentro de una sola visita:
  una T de entrada, todos sus trabajos y una T de recogida.
- Una H diferente en el mismo taller crea otro trabajo dentro de la visita,
  no otra T. `GESTIÓN` y `TRÁMITE` sí conservan una T propia.
- `TM` crea una entrada con sus trabajos, pero no crea T de recogida.
- `LKT`, `EXTINTOR` y los demás `TRÁMITE` crean una sola T propia y nunca recogida.
- `TRÁMITE` y `GESTIÓN` no generan entrada, recogida ni recuperación de ruta.
- Al realizar una T administrativa, su fecha se escribe en J y K y la línea completa
  queda verde, sin crear por ello una fila `PARADA`.

## Instalación

1. Abrir **Extensiones → Apps Script** desde el archivo madre.
2. Sustituir el código anterior por `sincronizar_manteniment.gs`.
3. Guardar el proyecto.
4. Volver a la hoja y recargarla.
5. Ejecutar **Metrogestión → Sincronizar ahora** y aceptar los permisos si Google los solicita.
6. Comprobar **Metrogestión → Ver estado local**.

La clave sigue guardada en las propiedades del script y no debe copiarse a ninguna celda ni al código.
