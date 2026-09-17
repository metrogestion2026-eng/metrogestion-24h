# Próximas necesidades al cerrar trabajos

Versión del Apps Script: `alpha75-2026.09.17.4`.

## Reducción de carga tras el segundo corte

Después de instalar `.3`, la hoja llegó a 28 próximas necesidades creadas, pero
volvió a alcanzar el tiempo máximo. No se dispone de la traza de aquella ejecución
para atribuirlo a una única llamada. Se han reducido dos costes del recorrido:
reconstruir el filtro y encadenar varias inserciones antes de devolver el control.

La versión `.4` aplica como máximo una orden, o tres cambios en filas existentes,
o una inserción por llamada. Nunca mezcla correcciones e inserciones de
necesidades en la misma llamada. Comprueba un presupuesto de 60 segundos antes
de comenzar otro trabajo y de nuevo después de validar el origen de una inserción.
Mantiene el filtro de la hoja durante las necesidades, que se procesan por número
absoluto de fila, y reduce la lectura de colores de A:Q a G:M. La altura de la
fila se lee antes de insertar/escribir para evitar forzar otro envío intermedio.

Registra el paso antes de las operaciones principales. Si se corta, la ventana
muestra «Sincronización detenida», recupera el último paso sin abrir Sheets y
ofrece «Reintentar». Deja de mostrar la instrucción de continuación automática
cuando no hay ninguna llamada programada. «Ver estado local» incluye ese paso.
Se conserva el formato del avance de `.2` y `.3` y su lectura MIME corregida.

Validación de `.4`: 64 pruebas superadas. Simulación local de las 7.020 filas
leídas después del segundo corte: conserva 28 hijas y completa las 66 restantes
en 66 llamadas de una inserción; al repetir, cero nuevas y cero cambios. No se
han escrito datos de la hoja desde las herramientas. La duración real y el
comportamiento del filtro nativo deberán verificarse en el proyecto instalado;
el presupuesto no puede interrumpir una llamada individual lenta de Google.

## Corrección al recuperar el avance

La versión `.2` reconstruía el archivo comprimido desde sus bytes sin indicar
el tipo de contenido. Esto provocaba «El objeto blob no puede contener un tipo
de contenido nulo» al leer la cola. La versión `.3` indica `application/gzip`
al recuperar el blob y `application/json` al guardar el estado, con nombres
explícitos. El formato de las propiedades no cambia: retoma las colas de `.2`
sin borrarlas ni iniciar de nuevo el intercambio con el servidor.

La prueba local reproduce ahora el rechazo del tipo nulo y comprueba la lectura
y continuación de una cola guardada con el formato anterior. No se ha ejecutado
esta versión desde las herramientas en el proyecto Apps Script del usuario.
Referencia: [Utilities y creación de blobs](https://developers.google.com/apps-script/reference/utilities/utilities#newBlob(Byte[],String,String)).

## Corrección del tiempo máximo de ejecución

La primera ejecución real de `.1` alcanzó a guardar 94 referencias de ciclo y a
crear 4 necesidades antes de agotar el tiempo. Las pruebas locales anteriores
validaban las reglas, pero no reproducían la latencia de las escrituras de Google.

La versión `.2` separa lectura, órdenes y necesidades en llamadas independientes.
Cada tanda procesa hasta 3 órdenes, 12 cambios o 4 inserciones. Comprueba un
presupuesto de 120 segundos antes de iniciar el siguiente trabajo, dejando margen
para guardar el avance, confirmar y restaurar el filtro. Una llamada individual
de Google puede durar más de lo previsto; no se presenta este margen como una
garantía de duración. [Límites de Apps Script](https://developers.google.com/apps-script/guides/services/quotas).

**Sincronizar ahora** abre una ventana de progreso que continúa automáticamente
con llamadas sucesivas. Cerrarla detiene la continuación del navegador; la tanda
en curso puede terminar. Al volver a abrir el menú se retoma la cola guardada.
Se guardan las órdenes en propiedades comprimidas, con partes inferiores a 9 KB
y un manifiesto que solo cambia tras completar su escritura. Cada orden se
confirma antes de retirarla de la cola; un error no se presenta como finalización.

La siguiente tanda vuelve a leer la hoja. Las notas de origen y las filas ya
creadas evitan duplicados aunque hayan cambiado los números de fila. La consulta
de enlaces de cada parada se hace en bloque y las filas nuevas copian solo el
formato, sin copiar el contenido ni la identidad de la fila realizada.

Si se usa la modalidad programada existente, se añade únicamente una continuación
temporal para terminar ese ciclo; se retira al finalizar. El menú manual no instala
disparadores ni modifica la periodicidad configurada.

La generación se ejecuta en el sincronizador de MANTENIMENT, después de recibir
los cierres del Hotel. También reconoce cierres introducidos manualmente. Solo
este motor genera las próximas filas; sustituye la antigua función exclusiva de
ITV. No cambia los períodos ni los cálculos de facturación.

## Reglas

| Tipo | Cierre | Próxima necesidad |
|---|---|---|
| ITV | J realizada; completa K si está vacía | Conserva I + 1 año si J está entre I menos un mes e I; fuera de esa ventana, J + 1 año |
| RT, TMG | J realizada; completa K vacía | J + 2 años |
| LKT | J realizada; completa K vacía | J + 1 año; Carrier es trámite, otras marcas de frío comprobadas son gestión |
| SG | J realizada; completa K vacía | I + 1 año; no desplaza el vencimiento por gestionar antes o después |
| EXTINTOR | J sustitución; completa K vacía | Caducidad exacta de la etiqueta en M amarilla, sin sumar otro año |
| ATP / ALTA ATP | J realizada; completa K vacía | Caducidad exacta del certificado en M amarilla |
| LINDEP | J entrada nave; K salida nave independiente | Primera: matriculación + 5 años. Siguientes: K + 3 años. TM, trámite, sin recogida exterior nueva |
| 44TN, OTA | J realizada; completa K vacía | Ninguna |
| REPUESTOS | I rotura; J pedido; K colocación | Ninguna; el pedido no cierra el trabajo |
| ACT, CV | I referencia; J entrada; K salida independiente | Ninguna |
| LV / LAVADO | Conserva las tres fechas; verde con J/K cumplimentadas | Ninguna; envío de pedidos pendiente de otra entrega |
| PLATAFORMA, TELEMÁTICA, REFORMA | Sin intervención de este motor | Excluidas |

La regla de ITV ya instalada se mantiene, incluida la realización posterior al
vencimiento. Los años y meses son de calendario, con ajuste del 29 de febrero.
Se reconocen también ALTA RT, ALTA TMG y ALTA LKT como primeros ciclos.

La hoja consultada tiene MARCA en **O** y KM / HORES en **P**. Q contiene
ALBARÀ / ENTRADA. No se deduce una marca de frío a partir de kilómetros, albaranes
ni de la marca de la tractora. Si la marca no es reconocible se muestra un aviso.

## Protección de los datos existentes

- Reutiliza una próxima necesidad manual si unidad, tipo y fecha coinciden sin
  ambigüedad. Si hay otra pendiente con fecha distinta, avisa y no añade otra.
- Solo renueva el último ciclo realizado de cada unidad/tipo. No recorre el
  histórico creando todas las renovaciones antiguas que falten.
- Respeta una M manual incompatible con la regla y la presenta para revisión.
- Guarda origen y ciclo en una nota de I, conservando la nota humana. Las filas
  pueden cambiar de posición sin cambiar su identidad.
- Una corrección actualiza su hija automática pendiente únicamente si sigue
  intacta. Si tiene cambios, una parada asignada o realización, se conserva y avisa.
- Al anular/reabrir el origen o dar de baja la unidad, suspende su hija automática
  intacta como ANULADA. Conserva las hijas manuales o iniciadas para revisión.
- La nueva fila contiene unidad, tipo y fecha I; no copia PA, pedido, reserva,
  fechas J/K, documentos ni notas de enlaces anteriores.
- El cierre verde conserva el amarillo de G (pedido) y M (próxima fecha).
- Las fórmulas R/S quedan intactas. Las inserciones se hacen junto al origen, de
  abajo arriba; se corrigen los números de fila antes de confirmar comandos.
- Una sincronización repetida no vuelve a generar las mismas necesidades. Si una
  escritura se interrumpe después de crear la fila, el reintento reconoce la fila
  exacta y no la duplica.

## Instalación y comprobación

1. En **MANTENIMIENTOS → Extensiones → Apps Script**, sustituir por completo
   `Código.gs` con `r1-alpha75/google-apps-script/sincronizar_manteniment.gs`.
   No añadirlo al final ni usar las antiguas copias `.txt` o numeradas.
2. Guardar y comprobar `scriptVersion: 'alpha75-2026.09.17.4'`.
3. Recargar la hoja. Abrir **Metrogestión → Vista previa de próximas necesidades**.
   La vista previa no escribe nada; muestra las nuevas filas y todos los avisos.
4. Ejecutar **Sincronizar ahora** y dejar la ventana abierta hasta que indique
   **Sincronización terminada**. Si se cierra, volver al mismo menú para retomar.

La migración `alpha75_necesidades_cierre_por_tipo` se aplicó el 17/09/2026. Solo
ajusta la interpretación de las fechas y la clasificación; no contiene un arreglo
masivo de datos. Mantiene los controles de acceso existentes. Un LKT/LINDEP ya
integrado en una visita conserva su visita y documentos; no se traslada al
aplicar la clasificación nueva.

Las necesidades creadas se incorporan al envío en la siguiente sincronización.
La ventana existente de Hotel sigue siendo de un mes o prioridad amarilla; crear
una fila futura no crea por sí mismo una parada. La pestaña independiente de
gestiones/trámites y los avisos de Hotel son otra fase del plan.

El menú **Pausar / reanudar próximas necesidades** permite detener estas reglas
sin borrar las necesidades ni detener la sincronización habitual. No se añade
ninguna periodicidad nueva ni se envían pedidos automáticamente.

## Verificación

- 19 pruebas específicas: calendario, todas las recurrencias, excepciones,
  reutilización, anulación, corrección, identidad e interrupción de escritura.
- Pruebas existentes de Alpha75 superadas junto al nuevo motor.
- Simulación local del 17/09/2026 sobre 6.992 filas de datos, sin escribir en la
  hoja: 94 nuevas (69 LINDEP, 10 RT, 6 SG, 5 EXTINTOR, 2 LKT, 1 ITV, 1 TMG),
  420 próximas ya existentes reutilizadas y 120 avisos. Segunda y tercera
  pasadas: **0 nuevas y 0 cambios**.
- Los avisos incluyen fechas M incompatibles, marcas sin confirmar, fechas
  inválidas/futuras y posibles duplicados. No se han corregido automáticamente.
- La simulación no equivale a una ejecución del proyecto Apps Script instalado:
  la instalación y primera sincronización real deben comprobarse en la hoja.
- Corrección `.2`: simulación sobre las 6.996 filas leídas después del error.
  Conserva las 4 necesidades existentes y completa las 90 restantes en 23 tandas,
  con un máximo de 4 inserciones por llamada. Al repetir: 0 nuevas y 0 cambios.
- Pruebas de cola persistida, confirmación fallida, reloj agotado, ventana cerrada,
  propiedades fragmentadas, enlaces por bloque y continuación programada.

Desarrollo: editar `shared/manteniment-necesidades.js` y su adaptador, ejecutar
`node scripts/build-necesidades-apps-script.mjs` y
`node --test tests/alpha75-necesidades-predictivas.test.mjs`.
