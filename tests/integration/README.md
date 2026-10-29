# Recorridos UI → PostgreSQL de paradas, continuidad y editor

Estas pruebas abren un navegador nuevo, recorren los formularios reales de 24H
y los controles explícitos de recuperación y continuidad y el editor completo,
ejecutan las RPC
públicas en una base efímera y vuelven a leer Hotel, Panel, Histórico y Listados.
Usan exclusivamente datos
sintéticos. No instalan la candidata en Supabase, no utilizan cuentas operativas
y no ejecutan sincronización.

## Ejecución

Dependencias fijadas: Node 24, Playwright `1.62.1` y `pg@8.16.3` mediante el
helper de `tests/sql`. La ejecución local verificada utilizó PostgreSQL `17.11`,
Chrome `156.0.8078.73` y zona del navegador `Europe/Madrid`.

```bash
npm ci --prefix tests/sql --ignore-scripts --no-fund --no-audit
npm ci --prefix tests/integration --ignore-scripts --no-fund --no-audit
node tests/integration/node_modules/playwright/cli.js install --with-deps chromium
```

Se necesita el servidor local dedicado descrito en
[README-native-concurrency.md](../sql/README-native-concurrency.md). En un entorno
nuevo Ubuntu 24.04/amd64, el script del repositorio lo prepara con
`python3 .github/scripts/local-postgres17.py start`; rechaza reutilizar un
directorio de datos existente. Con el servidor preparado:

```bash
METROGESTION_LOCAL_PG_DSN='postgresql://metrogestion_test@localhost/postgres?host=/tmp/metrogestion-pg17-native/socket&port=55473' \
npm test --prefix tests/integration
```

`METROGESTION_BROWSER_EXECUTABLE` permite indicar otro ejecutable local compatible
con Playwright. En la verificación local se usó
`/tmp/metrogestion-browser/chrome/opt/google/chrome/chrome`, extraído del paquete
oficial de Chrome, porque la descarga del navegador de Playwright llegó inválida.
Sin esa variable, se utiliza el Chromium instalado por Playwright.

`METROGESTION_UI_SCREENSHOT_DIR=/tmp/metrogestion-ui-review` guarda opcionalmente
capturas sintéticas: asistente, Hotel, Panel, diálogo de seguimiento,
confirmación de recuperación, Histórico de la PA recuperada y previsiones de
continuidad normal y con cero días. La suite del editor captura su overlay a
1440 × 1000 y 390 × 844 con los CSS del index candidato.
No se incluyen en el repositorio ni en el sitio publicado.

Las cuatro suites con PostgreSQL también se ejecutan por separado, con las
mismas variables de entorno:

```bash
node tests/integration/alpha75-ui-postgres.test.mjs
node tests/integration/alpha75-recovery-history.test.mjs
node tests/integration/alpha75-substitution-continuity.test.mjs
node tests/integration/alpha75-hotel-editor.test.mjs
```

## Asistencia y paradas separadas: cuatro recorridos

1. Alta por los siete pasos del asistente, doble clic con una única RPC, rechazo
   de una hora final anterior y cierre por traslado. La PA previa de taller
   permanece idéntica; la asistencia recibe otra identidad. La casilla de
   traslado coincide con el resultado elegido y con el valor persistido.
2. Guardado de una sustitución abierta y cierre desde el diálogo de seguimiento.
   La fecha de activación visible debe coincidir con la fecha SQL. El resultado
   sigue siendo sustitución, la reserva permanece ocupada y la PA de taller
   posterior es distinta. Intentar duplicar su asignación se rechaza.
3. Respuesta HTTP truncada después del commit: el reintento del usuario conserva
   petición y contenido, recupera la misma activación y no crea otra PA.
4. Rechazo real por identidad ambigua de T24H: el diálogo y su borrador permanecen,
   la tarjeta continúa abierta y la activación persistida no cambia.

Después de los cierres válidos se comprueban las tarjetas reales de Hotel y los
contadores y detalles del Panel contra las lecturas de PostgreSQL. Los centinelas
históricos sintéticos y sus valores manuales deben permanecer idénticos.

## Recuperación explícita e Histórico: cinco recorridos

1. El Hotel Alpha75 completo carga una PA de taller con reserva y recuperación
   pendiente, junto a otra PA del mismo DFM con asistencia 24H abierta. El botón
   real exige dos pulsaciones; la primera no envía escritura. La RPC registra
   la hora del servidor, recupera y retira únicamente la PA elegida y libera su
   reserva. La activación 24H, su PA, las demás T, los trabajos y sus identidades
   permanecen iguales. Se comprueban el refresco del Hotel y los contadores y
   detalles reales del Panel contra PostgreSQL.
2. Una modificación concurrente sintética deja obsoleta la versión de la T
   cargada en pantalla. PostgreSQL rechaza la confirmación; el control muestra
   el error, vuelve a estar disponible y no anuncia éxito. La T y la reserva
   mantienen exactamente los valores anteriores a la llamada rechazada.
3. El módulo Histórico Alpha75 completo consulta el día mediante la vista real
   `hotel_por_dia`: muestra la PA recuperada, la asistencia separada, la nota
   manual y el trámite aún pendiente. Se abre el detalle real de esa T y se
   comprueban su trabajo, observaciones y fecha prevista. El Histórico no ofrece
   el botón rápido para realizar una T pendiente.
4. La búsqueda global recorre más de 200 registros sintéticos y ejecuta su
   segunda página por clave. Encuentra ambas PA por DFM, una PA por número y la
   ficha correcta por trabajo o nota; respeta Desde/Hasta y rechaza un intervalo
   invertido antes de consultar. Los resultados proceden de tablas PostgreSQL
   y del buscador real, sin listas de resultados prefabricadas.
5. Se leen los centinelas sintéticos 2556 y 2637 por búsqueda y fecha. Sus PA,
   T, activación y valores manuales de sincronización se comparan íntegramente
   con la instantánea anterior. Consultar Histórico y detalle no envía RPC de
   escritura ni modifica notas o la PA recuperada.

El efecto observado de la recuperación explícita conserva un trámite pendiente
incluso cuando retira la PA. La prueba exige que ese trámite siga pendiente;
no interpreta la recuperación como confirmación de que todas las T terminaron.
También conserva la identidad del sustituto en la ficha histórica y el aviso
de datos pendientes del marcado rápido. No se ensaya completar ese aviso.

## Continuidad entre PA: cinco recorridos

1. Selección expresa de origen y T de entrada, sin fecha editable ni candidatos
   preseleccionados. La previsión muestra un día de origen y dos de destino.
   Dos clics de confirmación producen una única RPC y un vínculo. Se comprueba
   desde otra conexión que no se han creado ni completado T, que la reserva
   sigue ocupada y que las fechas físicas y las dos medias manuales permanecen
   exactas. Hotel, Panel, Listados e Histórico se contrastan con las vistas SQL.
   El detalle histórico muestra el vínculo sin habilitar su confirmación.
2. Entrega y entrada en el mismo día: origen con cero días, destino con todo el
   día de entrada. El origen conserva su fecha física sin recuperación, y el
   Panel atribuye la cobertura al destino. Los días facturables no se solapan.
3. La respuesta HTTP se trunca después del commit. La UI conserva la petición,
   mantiene bloqueada la selección y permite comprobarla. Antes del reintento,
   otro cliente registra finalización, recogida y recuperación reales
   sintéticas. El replay conserva el vínculo, reconoce al propietario en el
   momento de confirmar y admite que ahora ya no exista propietario vigente.
4. Una edición concurrente cambia la versión después de previsualizar. SQL
   rechaza la confirmación sin efectos. La UI conserva ambas selecciones,
   desmarca la confirmación y exige una previsión nueva.
5. La recuperación desde el botón real de Hotel exige sus dos pulsaciones y
   sus hitos previos. Libera la reserva del destino, mantiene la PA origen y
   la asistencia 24H, conserva el vínculo y no inventa un fin físico del origen.

La pizarra sintética de esta suite utiliza el día actual en Europe/Madrid para
comparar la referencia de Hotel con el periodo de Listados. Las pruebas previas
conservan sus fechas históricas. Las medias decimales se comprueban en SQL; la
presentación de la tarjeta conserva su redondeo anterior a km enteros.

## Editor completo: ocho recorridos

Se abre el formulario real mediante los botones de Hotel e Histórico y se
envían todas sus T y trabajos a la cadena SQL real de guardado. El fixture
incluye las 26 definiciones verificadas y la migración de fechas exactas,
documentados en [README-native-editor.md](../sql/README-native-editor.md).

1. Anotación en el origen después del vínculo, con doble clic y una sola
   escritura. Después de cerrar su 24H por la RPC real, se guarda otra anotación
   desde el editor histórico sin alterar taller, reserva ni fechas.
2. Diagnóstico de un trabajo existente y anotación del destino: se mantienen IDs,
   entrada con seis decimales, propietario y medias manuales distintas de ambas PA.
3. Acabado y Recogido desde el formulario, recuperación por el botón real y
   anotación posterior desde Histórico, conservando el instante de recuperación.
4. Versión obsoleta: rechazo SQL específico, borrador en pantalla e inventario
   persistido idéntico.
5. Cambio deliberado de la entrada protegida: rollback de la operación completa,
   incluida la nota que acompañaba al cambio.
6. Respuesta HTTP truncada después del commit: estado incierto, ninguna nueva
   escritura y una sola anotación comprobada al reabrir.
7. Lector sin contrato de fechas: no se construye el formulario y no se envía
   ninguna RPC de escritura.
8. Error de transporte devuelto como valor, con `status: 0` y código vacío,
   después de un commit real: mantiene el mismo bloqueo persistente que la
   excepción. Es la forma documentada del SDK, reproducida por el transporte
   controlado; no se presenta como ejecución del SDK real.

Los dos casos inciertos también despachan un evento de clic pese al botón
deshabilitado y exigen que no vuelva a aparecer la confirmación ni se envíe
otra RPC. Se verifica así la guarda de escritura, además de la presentación.

Antes del arreglo se reprodujeron el rechazo de fechas al guardar una nota y la
reactivación incorrecta del guardado ante el error de transporte devuelto como
valor. Las correcciones conservan las aserciones exactas; sólo se alineó el
catálogo sintético `24H` con el código creado por la RPC.

## Piezas reales y dobles

- Se sirve el archivo completo del asistente Alpha34, suprimiendo únicamente su
  importación de arranque de Alpha33. Renderizado, controles, validaciones,
  navegación, payload y guardado son los de producto. Se cargan el adaptador y
  el seguimiento Alpha75 completos; su observador coloca el botón del diálogo.
- En la suite de asistencia, Hotel utiliza `renderHotelCard` real; la composición
  del listado y las tarjetas de Asistencias pertenecen al shell sintético. Se
  comprueba además la derivación real con el modelo `entrada_hitos_v1`.
- La suite de recuperación carga completos `hotel-native.js`, `history-native.js`
  y el Panel Alpha75 desde una navegación sintética. Sus consultas, filtros,
  controles, render y refrescos son los de producto. El botón de recuperación y
  el detalle de T son los módulos Alpha67 importados por Alpha75. No se abre ni
  guarda el editor completo de Hotel.
- La suite de continuidad añade el módulo real de Listados y el diálogo real
  de continuidad. Su transporte permite exactamente las dos RPC públicas nuevas
  con sus argumentos explícitos. Las tablas y vistas financieras dejan de ser
  dobles vacíos en esta suite: `cierres_facturacion`,
  `paradas_sustitucion_resumen`, `facturacion_dfm_periodos`,
  `facturacion_r_sustituciones` y configuración se consultan en PostgreSQL.
- El módulo Panel completo realiza sus lecturas, clasificación, contadores y
  detalles. Las vistas `hotel_actual` y `hotel_actual_detalle` se crean a partir
  de sus definiciones operativas revisadas el 28/10/2026, conservadas literalmente
  con sus huellas en `fixtures/hotel-views.sql` y `security_invoker=true`.
  `fixtures/history-view.sql` conserva la definición literal de `hotel_por_dia`;
  el fixture comprueba su huella de catálogo antes de aplicar ambas migraciones
  de continuidad y conserva `security_invoker=true`. Las cuatro suites cargan
  esas migraciones sin reinstalar después las vistas antiguas. La del editor
  añade el runtime completo de persistencia y la migración de fechas; las tres
  anteriores mantienen sus dobles explícitos del editor.
- La RPC `public.guardar_activacion_24h`, la migración congelada y sus funciones
  y triggers se ejecutan en PostgreSQL nativo. Las altas de taller del escenario
  se hacen mediante la RPC pública, sin simular un formulario de taller.
- La recuperación utiliza las definiciones reales verificadas por huella en
  `../sql/fixtures/recovery-runtime.sql`, mediante `../sql/recovery-scenarios.mjs`.
  Incluye `public.marcar_t_realizada_rapida` y la función de liberación real;
  no utiliza el doble anterior de liberación. Las decisiones y las T iniciales
  de estos escenarios se preparan de forma explícita en el fixture, sin afirmar
  que se haya recorrido un formulario de alta de taller.
- El cliente Supabase se sustituye por un puente HTTP local con consultas
  permitidas explícitamente. PostgreSQL genera el JSON de las lecturas para
  conservar fechas `DATE` literales; no se convierten mediante la zona de Node.
  Usuario, sesión y catálogos son sintéticos. Las tablas auxiliares de anotaciones
  se crean con filas sintéticas; las tres suites anteriores ejercen su consulta
  y render. La suite del editor sí guarda anotaciones mediante las funciones
  reales y comprueba la lectura desde otra conexión.
  Las dos suites anteriores mantienen sus respuestas financieras vacías; la
  suite de continuidad usa vistas reales. Documentos y dispositivos mantienen
  respuestas vacías delimitadas.
  La consulta de órdenes MANTENIMENT del Panel administrador recibe una lista
  vacía explícita; ninguna cola externa está conectada. Auditoría, autorización
  y efectos de sincronización conservan los dobles declarados por el fixture SQL.

## Aislamiento y límites

El helper admite únicamente el socket Unix del servidor dedicado, crea una base
con nombre nuevo y la elimina en `finally`. No acepta DSN remoto. El navegador
usa contexto nuevo, service workers bloqueados, un proxy local que no reenvía,
resolución externa deshabilitada y una lista de origen permitido. Cualquier
petición de la página fuera del harness hace fallar la prueba.

Estas cuatro suites con PostgreSQL no prueban Supabase Auth, RLS de usuarios
reales, PostgREST ni el SDK de Supabase. Tampoco certifican una sesión completa,
el arranque entre versiones, cachés, instalación, documentos ni sincronización
contra una hoja. La facturación cubierta se limita a la proyección de los
tramos DFM sintéticos y la conservación de los valores expresamente probados;
no acredita cierres contables operativos. La navegación sigue siendo sintética;
la suite del editor carga los estilos de producto y las otras conservan los
estilos auxiliares anteriores. Las capturas no certifican la presentación
completa de la app ni un dispositivo físico. Las carreras y
el protocolo de entrega/ACK de MANTENIMENT tienen pruebas nativas separadas.

`npm test --prefix tests/integration` ejecuta los 22 recorridos de las cuatro
suites y, después, los cinco
escenarios de arranque descritos en [README-boot-cache.md](README-boot-cache.md).
Los scripts `test:assistance`, `test:recovery-history`, `test:continuity`, `test:editor` y `test:boot` permiten
ejecutarlos por separado. La prueba de caché mantiene habilitada la caché HTTP
y conserva sus propios límites de sesión nula e index candidato recién servido.
