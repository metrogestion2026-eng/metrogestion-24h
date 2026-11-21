# METROGES · SINCRO 13 · Paridad de triggers Hotel (19/11/2026)

**PR #133 — CANDIDATA NO DESPLEGADA.** Este documento establece resultados comprobables sin consultar ni modificar filas operativas.

## Hallazgos que obligaron a corregir el diseño

**Identidad T:** En el proyecto conectado de **Supabase de pruebas** se cotejaron 327 trabajos técnicos con trabajo, etapa y ficha de Hotel existentes. Para esos 327 casos, el seguimiento propio de `etapas_hotel.seguimiento_id` era distinto de `registros_hotel.seguimiento_id`, mientras que el seguimiento del catálogo técnico correspondía a la ficha. Por tanto la identidad causal debe ser **T (ID_FILA) → UUID de trabajo → trabajo de etapa → etapa → registro**, sin comparar los seguimientos propios de T y ficha. Este error estaba en la primera candidata y se ha corregido en `sincro13_adopcion_hotel_k_candidato_20261119.sql` y `sincro13_cas_k_candidato_20261119.sql`, con regresiones específicas.

**Semántica de la recogida:** El RPC vigente `app_private.registrar_hito_taller_alpha75` marca el hito Recogido como `etapas_hotel.fecha_real` con hora **y** `estado='realizada'`, y actualiza la situación operativa de la ficha. No realiza la T de Recuperar ni libera por sí mismo la reserva. Por eso la candidata S13 se corrigió para solicitar exactamente la misma transición de estado, respetar el código de catálogo y llamar a la función real de proyección operativa, sin inventar hora desde la K manual.

## Captura solo de código, sin datos

Se consultaron en modo **solo lectura** las definiciones de las funciones y triggers del Supabase de pruebas. Se archivaron en la rama las funciones de fecha y resolución de etapa, cuatro funciones de trigger de T, tres funciones de trigger de ficha, y el ayudante de numeración. No se copiaron datos de vehículos, fichas, usuarios, credenciales, ni claves.

- `tests/sql/fixtures/sincro13-live-date-functions-20261119.sql`: dos funciones vigentes de fechas e identidad, MD5 de referencia.
- `tests/sql/fixtures/sincro13-live-four-trigger-functions-20261119.sql`: auditoría, bloqueo de recogida, grupo documental, marcado rápido.
- `tests/sql/fixtures/sincro13-live-ficha-trigger-functions-20261119.sql`: asignar número de parada, encolar cambio de ficha, reabrir cierre y comprobar número utilizado.
- `tests/sql/fixtures/sincro13-hotel-audit-prerequisites.sql` y `sincro13-ficha-trigger-prerequisites.sql`: solo objetos sintéticos faltantes y activación correcta del trigger de fecha_entrada.
- `tests/sql/fixtures/sincro13-hotel-trigger-inventory-20261119.json`: referencia de 43 triggers del Supabase de **pruebas**, con SHA-256 de cada función `pg_get_functiondef` y definición `pg_get_triggerdef`.

## Test nativo sobre PostgreSQL 17 aislado

`tests/sql/sincro13-hotel-current-date-functions.test.mjs` compara contra el manifiesto **todos los 25 triggers de etapas y 18 de fichas**, no solo sus nombres: compara SHA-256 de cuerpo de función y del SQL que define el evento disparador.

GitHub Actions seguridad, job ID **135664710995**: `S13_PARIDAD_43_TRIGGERS_CODIGO_Y_ACTIVACION` devolvió:

- T de Hotel: 25 de 25, ninguna función o definición de activación distinta.
- Fichas Hotel: 18 de 18, ninguna función o definición de activación distinta.
- Nombres faltantes o extra: ninguno.
- `paridad_completa_verificada=true` **exclusivamente respecto de esa comparación de definiciones**.

La primera comparación había encontrado cuatro cuerpos de T diferentes, luego tres cuerpos de ficha y una definición de activación de ficha, y se resolvieron **únicamente en el fixture** tomando las definiciones actuales. No se reescribió ningún trigger conectado.

`tests/sql/sincro13-hotel-adoption-current-runtime.test.mjs` ejecuta en ese escenario la RPC SQL candidata real (pero con datos inventados) con los hitos del taller y los triggers actuales de ensayo. Verifica adopción de K solo con hora real, T realizada, ficha actualizada, proyección K, J original, documento, siguiente recuperación aún pendiente, vehículo reserva ocupado, aprobador autenticado, rechazo de versión T obsoleta y replay idempotente.

## Límites: no confundir definiciones idénticas con seguridad operativa certificada

La paridad de SHA-256 **no implica** que las bases contengan los mismos datos, todas las tablas dependientes, políticas RLS, permisos, configuraciones externas, activadores de Google o eventos simultáneos. El entorno sólo fue creado con fixtures sintéticos; las llamadas a servicios externos se mantuvieron aisladas. La configuración independiente de Google/OAuth aún no existe en el Supabase conectado; la SINCRO NO está activada.

**Se mantienen cerradas** las puertas de operación: sin instalación de Apps Script, Edge, SQL, cuentas, permisos ni triggers; sin cambios en MANTENIMENT/TANCAMENT/Pizarra/Hotel conectados, R1515, V1/F2 o historia pre-corte. La PR #132 sigue laboratorio congelado, #133 OPEN/DRAFT/UNMERGED. No validar Alpha75.26 hasta poder demostrar ida/vuelta segura con hechos auténticos y autorización expresa.

El desarrollo pendiente crítico sigue siendo el primer ciclo real supervisado Google → aprobación Metroges → adopción de la T de Hotel → estado y K → confirmación de MANTENIMENT, con relectura independiente, sin duplicados ni sobreescrituras.
