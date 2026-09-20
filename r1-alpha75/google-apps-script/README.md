# MANTENIMENT ↔ Metrogestión · Alpha75 / Alpha76

Este script sustituye el contenido del proyecto de Google Apps Script vinculado al archivo madre **MANTENIMIENTOS**.

## Actualización del 20/09/2026 · script `alpha75-2026.09.20.2`

En las reparaciones y mantenimientos de taller vinculados a una PA, J es la
entrada y K la recogida. Una J informada y una fila coloreada siguen pendientes
hasta completar K. Los trámites de cierre único conservan su regla anterior.

- El servidor reutiliza la entrada del mismo taller cuya fecha real coincide con
  J; si hay varias coincidencias o falta una entrada compatible, avisa sin crear
  otra T. Solo procesa las visitas incluidas en el lote recibido.
- La recogida confirmada completa K y pinta la línea de verde. Una K introducida
  manualmente se conserva. Una fila histórica realizada sin vínculo PA no se
  vuelve a importar.
- El listado de pendientes aplica también este criterio hasta la recogida.
- El servidor rechaza individualmente las notas técnicas que pertenecen a otro
  vehículo, sin trasladar su T ni bloquear las filas válidas. El aviso aparece
  en el resultado y las filas afectadas quedan en el detalle de sincronización.
  Esta protección se activa en el servidor y no requiere reinstalar el script.

Publicar la app o este archivo en GitHub no instala el script en Google.
Para activar la lectura corregida hay que actualizar el proyecto vinculado con
este archivo completo y comprobar `alpha75-2026.09.20.2` en **Ver estado local**.

El listado de pendientes recibe todas las necesidades de la hoja, incluidas las
que aún no tienen una T, las lejanas y las que no tienen fecha. Este bloque de
lectura es independiente del bloque que crea órdenes y no genera T nuevas.
La sincronización anterior sigue enviando vencidas, próximas y prioritarias;
instalar este script amplía el listado completo y añade el detalle de Q.
La interfaz Alpha75.19 incluye vencidas y fechas hasta hoy + 30 días y aplica
el selector de unidad de forma explícita, sin limitarlo internamente a R.

Parte del código activo `alpha75-2026.09.17.4` facilitado por el usuario, incluidas
la ejecución por tandas, la vista previa, la pausa y las reglas de próximas necesidades.

- Actualiza una cola guardada de la versión anterior con las órdenes vigentes del
  servidor, conservando el identificador del ciclo y los contadores de avance.
- Localiza trabajos por UUID, unidad, matrícula, necesidad y fecha, con lectura
  actual de las filas y del color de G. Una nota copiada a otra necesidad no basta.
- Si la confirmación al servidor falla después de escribir, guarda su acuse y
  reintenta solo esa confirmación.
- Conserva el paso del error aunque después tenga que restaurar el filtro.
- Replanifica próximas necesidades tras cada tanda; reutiliza las ya existentes y
  señala las coincidencias ambiguas sin crear otra copia.
- Completa F según las normas confirmadas de Mercedes, Iveco, gestión y extintores,
  únicamente en necesidades pendientes; conserva los talleres históricos.

Sustituir **todo** el código del mismo proyecto de Apps Script, guardar, recargar
la hoja y pulsar **Metrogestión → Sincronizar ahora**. No borrar las propiedades
ni cambiar la clave: el avance se recupera automáticamente. Comprobar la versión
en **Ver estado local**. El identificador del script es distinto de la versión
`r1.0.0-alpha.76.4` de la interfaz web.

Validado con simulaciones locales de filas desplazadas, notas copiadas, fallos de
confirmación e interrupciones de creación. La ejecución real en Google queda
pendiente de instalar este código en el proyecto vinculado.

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
- Cada número de parada utiliza una sola carpeta en `A-FLOTA/<DFM>/PARADAS/<PA-número>`.
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

## Taller F de las necesidades pendientes

El script completa o normaliza F con estas normas confirmadas:

| Marca / necesidad | F | G, si cambia |
| --- | --- | --- |
| Mercedes · MCD o AV | STERN MOTOR | |
| Todas · RT | AUTODIS | |
| Iveco · MCD o AV | AUTODIS | |
| MAN · MCD o AV | MAN | |
| Volvo · MCD o AV | VOLVO | |
| Carrier · MCD o AV | FRIDIEL | |
| Thermo King · MCD o AV | FRIGICOLL | |
| Hwasung / HW · MCD o AV | DIESEL PENEDÈS | |
| Iveco · GP o GC, incluidas marcas mixtas con equipo de frío | AUTODIS | |
| Frigorífico · GP o GC | DIRECAUTO | |
| N = FRAGADIS · Iveco · AV | SIDECO | |
| N = FRAGADIS · Volvo · AV | REUS FLEMING | |
| Todas · BPW | DIRECAUTO | |
| Todas · ATP o TMG | INVERYCA | |
| Todas · GESTIÓN | UPC | |
| Todas · EXTINTOR | TM | TRÁMITE |

La regla requiere J y K vacías, H blanca y G sin pedido amarillo. Se aplica a la
hoja al procesar próximas necesidades y al envío de pendientes a la app. Las
renovaciones nuevas reciben la misma norma. Las necesidades realizadas conservan
su taller, modalidad y datos; la clave de origen enviada al servidor sigue siendo
la de la fila leída, aunque se normalice el taller del envío.

En marcas mixtas (por ejemplo, `IVECO/CAR` o `MER/CARR`), Q distingue el
mantenimiento del vehículo del frigorífico. A/B, horas H y MHW se asignan al
equipo de frío; los códigos de motor, tiempo, frenos, EO o FF van al vehículo.
Los trabajos sin detalle suficiente conservan F para consulta. Los tipos sin
una norma no se completan en la hoja.

Para GP/GC, la regla de Iveco tiene prioridad sobre la del equipo de frío y se
aplica tanto a tractoras como a rígidos. La distinción de destino entre tractoras
y rígidos de otras marcas sigue pendiente de confirmación.

Si Q no identifica el mantenimiento, P se contrasta con el kilometraje de la
misma unidad. Se priorizan lecturas de TRUCKPOINT, IVECO ON o GESINFLOT; después,
kilómetros de trabajos realizados en talleres del vehículo y previsiones cuyo
tipo es conocido. Se excluyen los kilómetros facturables de PARADA. Se admiten
unidades explícitas H/HORAS/KM y separadores de millares de la hoja.

Como margen conservador, un P igual o inferior a la décima parte de la referencia se
interpreta como horas del frigorífico; desde la mitad de la referencia se
interpreta como kilómetros. Los valores intermedios o sin referencia conservan
F para revisión. No se modifica P. La excepción FRAGADIS afecta únicamente a AV;
los MCD del camión conservan el taller de su marca.

En el servidor, F explícita conserva prioridad. Cuando llega vacía, el helper
privado aplica estas normas y conserva las inferencias anteriores para BPW,
frigoríficos R, MAN, Volvo, ITV, RT y TMG/ATP. No modifica históricos almacenados.

## Visitas y cierre

- `TANCAMENT n` utiliza la fecha K como corte de facturación y no como recuperación operativa.
- La celda Q permanece rosa pastel mientras el cierre no esté supervisado.
- En las necesidades predictivas, el fondo de la columna H es autoritativo:
  **blanco significa pendiente**; cualquier otro color no crea una T nueva.
- Las necesidades predictivas incluyen tanto unidades R como DFM.
- Los trabajos que comparten taller en F se agrupan dentro de una sola visita:
  una T de entrada, todos sus trabajos y una T de recogida.
- Una H diferente en el mismo taller crea otro trabajo dentro de la visita,
  no otra T. La agrupación por lugar también incluye `GESTIÓN` y `TRÁMITE`.
- `TM` crea una entrada con sus trabajos, pero no crea T de recogida.
- Una visita exclusivamente de `TRÁMITE` o `GESTIÓN` no genera entrada, recogida
  ni recuperación de ruta. Si comparte F con trabajos físicos, se integra en su visita.
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
