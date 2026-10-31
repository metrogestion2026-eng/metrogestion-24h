# 75.25 · Proyección única de continuidad en Sustituciones

Regla técnica: `MG75-PANEL-PROYECCION-001`.

## Incidencia

Después de instalar la continuidad entre PA, el Panel puede agotar los ocho
segundos permitidos para su lectura de `paradas_sustitucion_resumen`. La consulta
real selecciona quince columnas y utiliza los límites de imputación para detectar
sustituciones sin media de kilómetros. Hotel, Histórico y las vistas de
facturación también consumen este resumen.

El CTE `datos` original tiene un único consumidor. PostgreSQL puede incorporarlo
a la consulta exterior y repetir la función `STABLE` de continuidad en cada
extracción JSON. Una aparición en la definición de la vista no garantiza una
única ejecución por fila. Tampoco basta contar apariciones en `EXPLAIN VERBOSE`:
los nodos padres pueden imprimir expresiones cuyos valores calcula un hijo.

## Cambio

La migración
`20261031115637_alpha75_panel_sustituciones_proyeccion_unica.sql` reemplaza
exclusivamente el fragmento que obtiene los metadatos por una subconsulta
`LATERAL` correlacionada con `OFFSET 0`. Esa frontera conserva un valor de
metadatos por fila física seleccionada. El filtro exterior por `seguimiento_id`
puede seguir aplicándose antes de la proyección; las consultas que sólo cuentan
o leen identidades pueden seguir omitiendo la función.

Se conservan todas las expresiones de negocio: fechas físicas y de imputación,
continuidad, titularidad actual, días, recuperación real y prioridad de la media
manual. La función continúa siendo `STABLE`. No se materializa el resumen
completo ni se modifica el código de la interfaz.

## Instalación protegida

La migración comprueba previamente la huella completa de la vista y de las dos
funciones de continuidad. Falla si detecta deriva. Después de `CREATE OR REPLACE
VIEW`, comprueba que siguen iguales el OID, el contrato de columnas, el
propietario, la ACL y las opciones de la vista, incluido `security_invoker=true`.

El bloqueo de DDL está acotado a tres segundos y la transacción de instalación a
quince. Los límites de ocho segundos de los roles de aplicación se conservan.
No hay DML sobre datos operativos ni cambios de funciones, permisos o banderas
de sincronización. La instalación utiliza la migración nueva; no vuelve a
aplicar las cinco migraciones del 28/29 de octubre.

## Verificación

`tests/sql/alpha75-panel-projection-performance.test.mjs` ejecuta la consulta
literal del Panel en PostgreSQL 17 nativo, con datos sintéticos. Cuenta llamadas
reales mediante `pg_stat_xact_user_functions`, sin sustituir la función por un
contador `VOLATILE` que alteraría por sí mismo las decisiones del optimizador.

La suite comprueba la repetición en la versión anterior, una proyección por PA
en la nueva, una sola para un seguimiento filtrado y cero para las consultas
sin metadatos. Compara las filas completas de resumen y facturación, medias
manuales, cierres conservados, día de origen cero, recuperación y copias
históricas. También verifica permisos, guardas de deriva y conservación de los
datos de negocio. El flujo de integración ejecuta esta regresión y las suites
existentes sobre la vista corregida.

El ensayo nativo del 31/10/2026 supera nueve comprobaciones más la suite que
las agrupa. En los trece casos pequeños, las llamadas reales pasan de 125 a 13;
la lectura de una PA pasa de nueve a una y las de identidades/recuento siguen
en cero. La muestra de volumen contiene 153 PA, 1.415 registros y 11.218 etapas.
Devuelve las 153 filas con 153 llamadas a cada función bajo el límite de ocho
segundos: 53,042 ms como propietario y 78,067 ms como `authenticated` en ese
ensayo. Los permisos de usuario/dispositivo y las políticas RLS de esta última
prueba son dobles sintéticos explícitos, no una reproducción de la sesión de
producción. La denegación sintética devuelve cero filas y cero proyecciones.

En la comprobación de sólo lectura del 31/10/2026, a las 11:57:12 UTC, la vista
original y la candidata derivada devolvieron 138 filas completas idénticas en
una misma transacción `REPEATABLE READ`, con cero diferencias en ambos sentidos.
Una medición previa de `EXPLAIN ANALYZE` registró 819,204 ms para la original y
59,015 ms para la candidata. Son mediciones de la conexión de gestión como
`postgres`, sujetas a caché y carga; no acreditan por sí solas el tiempo de la
sesión autenticada del Panel. La evidencia operativa posterior y la instalación
efectiva se registran en la Bitácora.

## Referencias

- [PostgreSQL 17: incorporación y materialización de CTE](https://www.postgresql.org/docs/17/queries-with.html#QUERIES-WITH-CTE-MATERIALIZATION).
- [PostgreSQL 17: EXPLAIN y ejecución real](https://www.postgresql.org/docs/17/using-explain.html).
- [PostgreSQL 17: estadísticas en la transacción actual](https://www.postgresql.org/docs/17/monitoring-stats.html#MONITORING-STATS-VIEWS).
