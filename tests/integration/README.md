# Recorridos UI → PostgreSQL de PARADAS-SEPARADAS-002

Estas pruebas abren un navegador nuevo, recorren los formularios reales de 24H
y el control explícito de recuperación, ejecutan las RPC públicas en una base
efímera y vuelven a leer Hotel, Panel e Histórico. Usan exclusivamente datos
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
seis capturas sintéticas: asistente, Hotel, Panel, diálogo de seguimiento,
confirmación de recuperación e Histórico de la PA recuperada.
No se incluyen en el repositorio ni en el sitio publicado.

Los dos recorridos con PostgreSQL también se ejecutan por separado, con las
mismas variables de entorno:

```bash
node tests/integration/alpha75-ui-postgres.test.mjs
node tests/integration/alpha75-recovery-history.test.mjs
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
- El módulo Panel completo realiza sus lecturas, clasificación, contadores y
  detalles. Las vistas `hotel_actual` y `hotel_actual_detalle` se crean a partir
  de sus definiciones operativas revisadas el 28/10/2026, conservadas literalmente
  con sus huellas en `fixtures/hotel-views.sql` y `security_invoker=true`.
  `fixtures/history-view.sql` conserva la definición literal de `hotel_por_dia`;
  la prueba comprueba su huella de catálogo y `security_invoker=true`.
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
  se crean con filas sintéticas; se ejercen su consulta y render, no su guardado.
  Facturación, documentos y dispositivos tienen respuestas vacías delimitadas.
  La consulta de órdenes MANTENIMENT del Panel administrador recibe una lista
  vacía explícita; ninguna cola externa está conectada. Auditoría, autorización
  y efectos de sincronización conservan los dobles declarados por el fixture SQL.

## Aislamiento y límites

El helper admite únicamente el socket Unix del servidor dedicado, crea una base
con nombre nuevo y la elimina en `finally`. No acepta DSN remoto. El navegador
usa contexto nuevo, service workers bloqueados, un proxy local que no reenvía,
resolución externa deshabilitada y una lista de origen permitido. Cualquier
petición de la página fuera del harness hace fallar la prueba.

Estas dos suites con PostgreSQL no prueban Supabase Auth, RLS de usuarios
reales, PostgREST ni el SDK de Supabase. Tampoco certifican una sesión completa,
el arranque entre versiones, cachés, instalación, documentos, facturación o
sincronización. El shell y sus estilos son de prueba; las capturas no certifican
la presentación completa de la app. El ajuste de la casilla de traslado fue el
único cambio de producto del ensayo previo de asistencia. La ampliación de
recuperación e Histórico sólo añade pruebas y fixtures.

`npm test --prefix tests/integration` ejecuta ambas suites y, después, los tres
escenarios de arranque descritos en [README-boot-cache.md](README-boot-cache.md).
Los scripts `test:assistance`, `test:recovery-history` y `test:boot` permiten
ejecutarlos por separado. La prueba de caché mantiene habilitada la caché HTTP
y conserva sus propios límites de sesión nula e index candidato recién servido.
