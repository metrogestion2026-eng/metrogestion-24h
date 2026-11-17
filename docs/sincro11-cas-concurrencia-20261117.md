# SINCRO 11 · Dos sesiones CAS y mapeo T → objeto · 17/11/2026

**CANDIDATA DE LABORATORIO. NO INSTALAR NI FUSIONAR LA PR.**

## Continuidad, sin reiniciar

Base de partida: PR borrador [#132](https://github.com/metrogestion2026-eng/metrogestion-24h/pull/132), receptor CAS anterior ya ensayado en PostgreSQL 17 aislado (run 44034986250, `ROLLBACK`). La identidad de fila es **únicamente el valor en T / ID_FILA**. Biblia SYNC-001: corrección manual acreditada manda por campo; no borrado de otros campos; no rejuvenecer órdenes antiguas. Solo movimientos auténticamente posteriores al corte del 15/11/2026. No reabrir 2552/2712/2746 históricos ni tocar R1515.

## Verificación de esquemas reales (solo SELECT)

En Supabase `metrogestion-pruebas`, el 17/11/2026 se consultaron exclusivamente la estructura y los recuentos:

| Tabla técnica | Filas presentes |
| --- | ---: |
| `app_private.mg9_filas_identidad` | **0** |
| `app_private.mg9_cambios_recibidos` | **0** |
| `app_private.mg9_entregas_registradas` | **0** |

`mg9_filas_identidad` tiene clave `(spreadsheet_id,id_fila)`, revisión y huella. `mg9_cambios_recibidos` distingue T y columna. La cola real de parada usa `seguimiento_id`/`sync_id`/`revision` y no garantiza una referencia individual `(ID_FILA, campo)` para anular con seguridad una sola propuesta. Por tanto, ninguna T↔objeto está acreditada en **estas tablas** y no se puede declarar instalado el retorno ni generar ese vínculo por semejanza de UUID, DFM o PA. No hacer escrituras de staging por estas pruebas.

## Componentes nuevos (solo código de laboratorio)

- `sql/sincro11_concurrencia_setup_20261117.sql`: **rechaza cualquier base distinta de `sincro11_lab`** antes de crear `s11_ci`; genera cinco identidades ficticias y una función `SECURITY INVOKER` que exige fuente/mapeo exacto por T+columna+clase+significado+objeto. T 90005 comparte UUID con 90002 pero está **pendiente**, por lo que se rechaza y jamás se empareja por UUID.
- `tests/integration-sincro11-concurrencia.pg.test.mjs`: usa **dos procesos `psql`**, dos conexiones de PostgreSQL 17 al mismo tiempo. Una prueba intenta dos correcciones sobre **la misma T y J**: el primer commit cambia la revisión; el segundo recibe `S11_CI_CAS_DESTINO` sin sobrescribir. Otra prueba mantiene abierto J mientras un segundo proceso modifica K sobre la misma T; comprueba que ambos campos se conservan. Hay comprobaciones de recibo idempotente, TANCAMENT sin mapeo, identidad ausente, vínculo no acreditado, exclusión del operador y retención de outbox **solamente** por T+campo+revisión obsoleta.
- `tests/security-sincro11-concurrencia-static.test.mjs`: guardas del código, base ficticia, ausencia de red/secreto y de escrituras a los esquemas reales.
- `sql/sincro11_concurrencia_teardown_20261117.sql`: elimina **solo** `s11_ci` en la base ficticia y comprueba ausencia de esquema. La base de servicio de GitHub se destruye al concluir el job. **A diferencia del ensayo de una sola sesión, la prueba de dos conexiones necesita confirmar las tablas de laboratorio antes de arrancar ambas; no afirmar un único `ROLLBACK` global.**
- `.github/workflows/sincro11-cas-laboratorio.yml`: reutiliza el servicio PostgreSQL 17 aislado de la candidata y añade el ensayo con limpieza obligatoria incluso si falla.

## Lo que el resultado NUNCA significa

El agente de captura, la marca `FICCION_NO_ACREDITA_HUMANO`, UUID, revisión de origen y mapeos se fabrican **solo para pruebas**. No prueban una persona, no demuestran origen auténtico en Google, no crean llaves de producción, no autorizan SQL para Supabase ni aplican cambios a Metroges. Los dos campos J/K ensayados son trabajos **ficticios** y no conceden permisos sobre TANCAMENT. El ensayo no verifica todavía un conflicto entre Apps Script y Google Sheets durante la captura; requerirá mecanismo acreditado de fuente real. La separación por campo no permite inferir qué hacer con las fórmulas históricas ni con notas o campos aún sin contrato.

## Estado y siguiente paso

**VALIDADO CON POSTGRESQL 17 Y DOS SESIONES REALES:** GitHub Actions run `44043369104` completó **SUCCESS**. Seguridad estática (8 casos originales + 8 nuevos = **16/16**), concurrencia real (**7/7**) y limpieza de esquema `s11_ci` mediante `DROP SCHEMA` confirmada. La primera ejecución de CI general detectó que el fichero se había colocado bajo el patrón `security-*` y lo intentó ejecutar sin `PGDATABASE`; el bloqueo `S11: prohibido ejecutar fuera de base ficticia` funcionó correctamente. El test de dos sesiones se movió a `tests/integration-sincro11-concurrencia.pg.test.mjs`, ejecutado únicamente en el job con PG17. Esto corrige la clasificación de la prueba, no la seguridad de inicio de sesión de la app. Pasado ese control, el siguiente paso es definir el mapa del receptor por **clase y columna** sobre vínculos confiables que todavía no existen, sin escribir datos reales. Mantener protección de hoja, F2 sin instalar, V1 sellada sin resellar, PR en borrador y operativa de Metro intacta.

Referencia técnica: [PostgreSQL 17 — Transaction Isolation](https://www.postgresql.org/docs/17/transaction-iso.html), [PostgreSQL 17 — Explicit Locking](https://www.postgresql.org/docs/17/explicit-locking.html).