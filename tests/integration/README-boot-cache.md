# Arranque publicado y caché de Alpha75

Este ensayo cubre un riesgo distinto de las pruebas de formularios: que la
entrada candidata llegue a ejecutar un asistente compartido, un lector
financiero o un editor anterior conservado en la caché HTTP. Construye los archivos públicos con el mismo script de
publicación y abre el `r1-alpha75/index.html` resultante en un navegador nuevo.
No publica esos archivos ni utiliza una sesión operativa.

## Ejecución

Con Node 24, Python 3, Playwright 1.62.1 y su navegador instalado:

```bash
npm ci --prefix tests/integration --ignore-scripts --no-fund --no-audit
node tests/integration/node_modules/playwright/cli.js install --with-deps chromium
npm run test:boot --prefix tests/integration
```

También acepta `METROGESTION_BROWSER_EXECUTABLE` para un ejecutable local
compatible. La ejecución local del 29/10/2026 utilizó Chrome 156.0.8078.73 y zona
Europe/Madrid. No necesita PostgreSQL.

## Cinco escenarios

1. **Arranque frío:** se carga el index publicado y su grafo real de módulos,
   incluida la cadena heredada completa. Se comprueba la versión visible,
   presencia del asistente compartido y módulos de la candidata. Con sesión
   nula, la pantalla de identificación sigue visible y la aplicación protegida
   permanece oculta.
2. **Caché caliente:** en el mismo origen y contexto se almacena el asistente
   anterior, con una hora de frescura HTTP. Una segunda lectura devuelve
   exactamente esos bytes sin una nueva petición al servidor. Después se abre
   el index candidato y se retrasa 700 ms el cuerpo de la precarga; se exige la
   descarga completa del SHA256 actual y que el asistente anterior no se ejecute.
3. **Fallo de precarga:** con el asistente antiguo acreditado en caché, se
   devuelve HTTP 503 a su precarga. Se exige observar ese fallo y otra petición
   de módulo que descarga exactamente la candidata, sin ejecutar la anterior.
4. **Lector financiero anterior:** en un contexto nuevo se almacena el lector
   previo a CONTINUIDAD-001 bajo su URL sin revisión. Una segunda lectura
   idéntica sin petición HTTP demuestra que está en caché. El arranque candidato
   debe obtener los bytes actuales mediante `?v=75.25-continuidad-001` y no
   ejecutar el lector anterior. Se comprueba también la revisión nueva de
   los módulos que lo importan, manteniendo la versión visible 75.25.
5. **Editor anterior:** se acredita en caché la URL real
   `hotel-editor.js?v=75.25-paradas-002`, con los bytes del commit `18ba1e8`.
   El index candidato debe obtener la huella exacta del editor corregido y su
   helper de fechas con `75.25-editor-fechas-001`, sin ejecutar el editor anterior.
   La cadena de Hotel, Histórico y Panel usa esta misma revisión.

El tercer escenario comprueba la recuperación observada del cargador de módulos.
No demuestra que toda indisponibilidad de red pueda recuperarse ni que exista
un modo sin conexión. La cadena de importación de los módulos modificados para
la continuidad se renueva expresamente; la prueba acredita ese recorrido bajo
un index candidato recién servido.

## Procedencia del asistente anterior

`fixtures/alpha34-before-paradas002.js` conserva sin modificaciones el archivo
`r1-alpha34/src/app.js` del commit
`8d0138e10e61c67cf321147cd279e81a7cdfc780`. Su SHA256 es:

```text
d48844d48691ddfdc514aca257a98a65c343f0eb4d70b55fef20907b8c126c13
```

El servidor agrega a esa respuesta antigua una marca de ejecución de prueba.
La respuesta candidata conserva los bytes exactos del archivo construido.
Los fixtures no forman parte del sitio publicado.

`fixtures/alpha75-billing-before-continuidad001.js` conserva los bytes de
`r1-alpha75/src/billing-data-hf2.js` del commit
`c5324299d09140549b9cf4d068e9d7ffb23497ec`, con SHA256:

```text
894860b836d294b83a8e5536372a98919efcc26c726a7e40774e7adc0c09d455
```

Su respuesta antigua también recibe una marca de ejecución de prueba. La
respuesta actual se contrasta con el archivo construido, no con una copia
simulada del lector.

`fixtures/alpha75-editor-before-fechas001.js` conserva los 22.408 bytes de
`r1-alpha75/src/hotel-editor.js` del commit
`18ba1e87739b6cf22b644ffa01c44bc01d65e29c`, con SHA256:

```text
b3db99af9cb4e663909ab04032826fae50644394b523e6487722ce728f1b020d
```

La respuesta antigua recibe únicamente la marca de ejecución del ensayo. La
respuesta candidata se contrasta con los bytes de la construcción pública.

## Aislamiento y límites

El servidor escucha sólo en `127.0.0.1`. Su proxy rechaza solicitudes externas y
túneles CONNECT; no reenvía tráfico. La página tiene una CSP adicional limitada
al mismo origen y la resolución externa del navegador queda bloqueada. Se
comprueba que la aplicación no solicita recursos externos; los intentos propios
del navegador hacia sus servicios de fondo también quedan bloqueados por el
proxy.

El cliente Supabase se sustituye por un cliente de sesión nula que rechaza RPC y
lecturas de datos. La configuración apunta al servidor local y el estado de
activación inicial responde cerrado. No se modifican el index, el arranque ni
los controladores de producto. Los archivos públicos temporales se eliminan al
terminar.

La prueba mantiene la caché HTTP habilitada. No utiliza `page.route` ni
`context.route`, porque [activar routing en Playwright deshabilita esa caché](https://playwright.dev/docs/api/class-browsercontext#browser-context-route).

Se prueba el **index candidato recién servido**, con caché previa de sus módulos.
No se certifica que un index antiguo se actualice automáticamente: el mecanismo
de refresco compara la versión visible 75.25, que no distingue esta revisión de
otras 75.25. La aceptación futura debe empezar con una recarga completa y
verificar la revisión cargada. Tampoco se certifican una sesión autenticada,
las cabeceras del alojamiento desplegado ni el arranque de Alpha80test, que no
pasa por `boot75`.
