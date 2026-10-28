# Recorrido UI → PostgreSQL de PARADAS-SEPARADAS-002

Esta prueba abre un navegador nuevo, recorre los formularios reales de 24H,
ejecuta la RPC pública en una base efímera y vuelve a leer las vistas reales
de Hotel y Panel. Usa exclusivamente datos sintéticos. No instala la candidata
en Supabase, no utiliza cuentas operativas y no ejecuta sincronización.

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
cuatro capturas sintéticas: asistente, Hotel, Panel y diálogo de seguimiento.
No se incluyen en el repositorio ni en el sitio publicado.

## Qué se prueba

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

## Piezas reales y dobles

- Se sirve el archivo completo del asistente Alpha34, suprimiendo únicamente su
  importación de arranque de Alpha33. Renderizado, controles, validaciones,
  navegación, payload y guardado son los de producto. Se cargan el adaptador y
  el seguimiento Alpha75 completos; su observador coloca el botón del diálogo.
- Hotel utiliza `renderHotelCard` real. La composición del listado y las tarjetas
  de Asistencias pertenecen al shell sintético. Se comprueba además la derivación
  real con el modelo `entrada_hitos_v1`; no se abre el editor completo.
- El módulo Panel completo realiza sus lecturas, clasificación, contadores y
  detalles. Las vistas `hotel_actual` y `hotel_actual_detalle` se crean a partir
  de sus definiciones operativas revisadas el 28/10/2026, conservadas literalmente
  con sus huellas en `fixtures/hotel-views.sql` y `security_invoker=true`.
- La RPC `public.guardar_activacion_24h`, la migración congelada y sus funciones
  y triggers se ejecutan en PostgreSQL nativo. Las altas de taller del escenario
  se hacen mediante la RPC pública, sin simular un formulario de taller.
- El cliente Supabase se sustituye por un puente HTTP local con consultas
  permitidas explícitamente. PostgreSQL genera el JSON de las lecturas para
  conservar fechas `DATE` literales; no se convierten mediante la zona de Node.
  Usuario, sesión y catálogos son sintéticos. Facturación y documentos tienen
  respuestas vacías delimitadas; no se afirman resultados sobre esos servicios.

## Aislamiento y límites

El helper admite únicamente el socket Unix del servidor dedicado, crea una base
con nombre nuevo y la elimina en `finally`. No acepta DSN remoto. El navegador
usa contexto nuevo, service workers bloqueados, un proxy local que no reenvía,
resolución externa deshabilitada y una lista de origen permitido. Cualquier
petición de la página fuera del harness hace fallar la prueba.

No se prueban Supabase Auth, RLS de usuarios reales, PostgREST ni el SDK de
Supabase. Tampoco el arranque completo entre versiones, cachés, Histórico,
instalación, documentos, facturación o sincronización. El shell y sus estilos
son de prueba; las capturas no certifican la presentación completa de la app.
El único cambio de producto motivado por este ensayo es sincronizar la casilla
de traslado con el resultado explícito desde el adaptador de Alpha75.
